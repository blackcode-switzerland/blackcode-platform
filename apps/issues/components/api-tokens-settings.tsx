'use client'

// API tokens — the shared `TokensSection` (2026-09-28) every app renders, wired
// to `GET/POST /api/tokens` and `DELETE /api/tokens/{id}` (`bk token …`).
// Revoking is confirmed and names the token.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TokensSection, type TokenRow } from '@blackcode/platform-ui/account/account-settings'

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = [j.error, j.suggestion].filter(Boolean).join(' — ') || 'Something went wrong'
    toast.error(message)
    throw new Error(message)
  }
  return j as T
}

function formatDate(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ApiTokensSettings() {
  const queryClient = useQueryClient()
  const tokens = useQuery({
    queryKey: ['api-tokens'],
    queryFn: async (): Promise<TokenRow[]> => {
      const r = await fetch('/api/tokens')
      if (!r.ok) throw new Error('Failed to load tokens')
      const j = await r.json()
      return Array.isArray(j) ? j : (j.data ?? [])
    },
  })
  const reload = () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] })

  return (
    <TokensSection
      tokens={tokens.data}
      error={tokens.error ? <p className="text-sm text-destructive">{tokens.error.message}</p> : undefined}
      formatDate={formatDate}
      onCopy={(text) =>
        navigator.clipboard.writeText(text).then(
          () => toast.success('Copied to clipboard'),
          () => toast.error('Could not copy — select the token and copy it by hand')
        )
      }
      onCreate={async (name) => {
        const minted = await send<{ plaintext: string }>('POST', '/api/tokens', { name })
        await reload()
        toast.success('Token created')
        return minted.plaintext
      }}
      onRevoke={async (t) => {
        await send('DELETE', `/api/tokens/${t.id}`)
        await reload()
        toast.success('Token revoked')
      }}
      footer={
        <>
          For the <code className="rounded bg-muted px-1 py-0.5">bk</code> CLI and other API clients. From a
          terminal, <code className="rounded bg-muted px-1 py-0.5">bk login</code> does this for you and stores the
          result.
        </>
      }
    />
  )
}
