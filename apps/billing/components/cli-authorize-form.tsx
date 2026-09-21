'use client'

// The Authorize button on `/cli/authorize`.
//
// It calls `lib/client.ts`' `call` directly rather than through
// `lib/mutations.ts`: this is an ACCOUNT write, not a billing record, and
// `docs/frontend.md` says it must not move behind an invoicing permission —
// an invoicing permission that could stop somebody signing a terminal in would
// be a preference that had quietly become a permission.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { WebError, call } from '@/lib/client'

export function CliAuthorizeForm({
  callback,
  state,
  defaultName,
}: {
  callback: string
  state: string
  defaultName: string
}) {
  const [name, setName] = useState(defaultName)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setError(null)
    setSubmitting(true)
    try {
      const body = await call<{ redirect_url?: string }>('/api/cli/authorize', {
        method: 'POST',
        body: { callback, state, name },
      })
      if (!body.redirect_url) {
        setError('The server authorized the request but returned no callback URL.')
        return
      }
      window.location.replace(body.redirect_url)
    } catch (e) {
      const suggestion = e instanceof WebError ? e.suggestion : undefined
      setError(
        [e instanceof Error ? e.message : 'Failed to authorize', suggestion]
          .filter(Boolean)
          .join(' — ')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          data-testid="error"
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="token-name" className="mb-1.5 block text-sm font-medium">
          Token name
        </label>
        <input
          id="token-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // No `maxLength`: the cap is declared once in `@blackcode/platform-api`
          // and enforced by the route; a long name gets the route's own 400,
          // with a suggestion.
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus:border-ring"
          data-testid="input-token-name"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          You can revoke it later from Settings → API tokens.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={approve}
          disabled={submitting || !name.trim()}
          data-testid="authorize"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Authorizing…' : 'Authorize'}
        </button>
        <a
          href="/dashboard"
          className="rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary/80"
        >
          Cancel
        </a>
      </div>
    </div>
  )
}
