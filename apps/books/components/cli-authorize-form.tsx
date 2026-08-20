'use client'

// The Authorize button on `/cli/authorize`.
//
// It posts through `lib/account.ts`, not through `apiSend` and certainly not
// through `fetch`: `lib/read-only.test.ts` allows exactly two modules to send a
// write and a component is neither. **Not `lib/mutations.ts`** — this is not a
// books record and must never sit behind `useCanWrite()`. A bookkeeping
// permission that could stop somebody signing a terminal in would be a
// preference that had quietly become a permission.

import { useState } from 'react'
import { Terminal } from 'lucide-react'
import { useAuthorizeCli } from '@/lib/account'
import { useT } from '@/lib/i18n'

export function CliAuthorizeForm({
  callback,
  state,
  defaultName,
}: {
  callback: string
  state: string
  defaultName: string
}) {
  const t = useT()
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState<string | null>(null)
  const authorize = useAuthorizeCli()

  async function approve() {
    setError(null)
    const done = await authorize.run({ callback, state, name })
    if (!done.ok) {
      setError(done.message)
      return
    }
    if (!done.data.redirect_url) {
      // The route answered 200 with no callback URL. Saying so beats a button
      // that stops spinning and does nothing, which reads as the click not
      // having landed — and the terminal is meanwhile still waiting.
      setError(t('cli.noRedirect'))
      return
    }
    window.location.replace(done.data.redirect_url)
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div>
        <label htmlFor="token-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('cli.tokenName')}
        </label>
        <input
          id="token-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // No `maxLength`. The cap lives once in `@blackcode/platform-api` and
          // is enforced by the route; importing it here would pull that barrel
          // into the browser bundle for one integer. A long name gets the
          // route's own 400, which carries the number and a suggestion.
          className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t('cli.revokeLater')}
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={authorize.pending || !name.trim()}
          className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Terminal size={15} />
          {authorize.pending ? t('cli.approving') : t('cli.approve')}
        </button>
        <a
          href="/dashboard"
          className="rounded-md bg-secondary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {t('cli.deny')}
        </a>
      </div>
    </div>
  )
}
