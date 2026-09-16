'use client'

// The Authorize button on `/cli/authorize`.
//
// It posts to `/api/cli/authorize` — the same route, and the only route, that
// mints a CLI token at this origin. Plain `fetch` here because phase 0 has no
// client data layer: phase 1 introduces `lib/client.ts` as the single `fetch`
// site and a module-graph guard that fails the build on a stray one, and this
// component moves behind it then.
//
// ── IT IS AN ACCOUNT WRITE, NOT A BILLING WRITE ───────────────────────────
// It touches no `billing.*` table and creates no invoicing record. When phase 1
// adds `lib/mutations.ts` for the app's own writes, this must not move there:
// an invoicing permission that could stop somebody signing a terminal in would
// be a preference that had quietly become a permission.

import { useState } from 'react'

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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/cli/authorize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callback, state, name }),
      })
      const body = (await res.json().catch(() => null)) as
        | { redirect_url?: string; message?: string; suggestion?: string }
        | null

      if (!res.ok) {
        setError(
          [body?.message ?? `authorize failed (${res.status})`, body?.suggestion]
            .filter(Boolean)
            .join(' — ')
        )
        return
      }
      if (!body?.redirect_url) {
        // The route answered 200 with no callback URL. Saying so beats a button
        // that stops spinning and does nothing, which reads as the click not
        // having landed — and the terminal is meanwhile still waiting.
        setError('the server approved but sent no callback URL; the terminal is still waiting')
        return
      }
      window.location.replace(body.redirect_url)
    } catch {
      setError('could not reach the server')
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      {error && (
        <p role="alert" style={{ color: '#b00', fontSize: 13 }}>
          {error}
        </p>
      )}
      <label htmlFor="token-name" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
        Token name
      </label>
      <input
        id="token-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        // No `maxLength`. The cap lives once in `@blackcode/platform-api` and is
        // enforced by the route; importing it here would pull that barrel into
        // the browser bundle for one integer. A long name gets the route's own
        // 400, which carries the number and a suggestion.
        style={{ padding: '6px 8px', minWidth: 280, fontFamily: 'ui-monospace, monospace' }}
      />
      <p style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
        You can revoke it later from any blackcode app.
      </p>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={approve}
          disabled={pending || !name.trim()}
          style={{ padding: '8px 16px' }}
        >
          {pending ? 'Authorizing…' : 'Authorize'}
        </button>
        <a href="/dashboard" style={{ padding: '8px 16px' }}>
          Deny
        </a>
      </div>
    </div>
  )
}
