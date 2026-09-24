'use client'

// API tokens — `platform.api_tokens`, one list across every blackcode app.
//
// A token minted here works against issues and sales too, and one revoked here
// stops working there. The page says so rather than leaving it to be
// discovered by a command failing somewhere else.

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Trash2 } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { useTokens } from '@/lib/queries'
import { useCreateToken, useDeleteToken, toastError, type MintedToken } from '@/lib/mutations'
import { Section, EmptyState, ErrorState, LoadingState } from '@/components/ui-kit'
import { APP_NAME, PLATFORM_NAME } from '@/lib/app'

export function TokenSettings() {
  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const { confirm } = useConfirm()

  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useDeleteToken()

  async function onCreate() {
    try {
      const token = await create.mutateAsync({ name: name.trim() })
      setMinted(token)
      setName('')
    } catch (e) {
      toastError(e)
    }
  }

  async function onRevoke(id: number, tokenName: string) {
    const ok = await confirm({
      title: `Revoke "${tokenName}"?`,
      description: 'Anything using this token — an agent, a script — stops authenticating immediately. This cannot be undone.',
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (!ok) return
    try {
      await revoke.mutateAsync({ id })
      toast.success('Token revoked')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-6">
      {minted && (
        <Section
          title="Copy it now"
          description="This is the only time the token is shown. Nothing — not this page, not the database — can display it again."
        >
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs" data-testid="minted-token">
              {minted.plaintext}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(minted.plaintext).then(
                  () => toast.success('Copied'),
                  () => toast.error('Could not copy — select the token and copy it by hand')
                )
              }}
            >
              <Copy size={14} />
              Copy
            </Button>
          </div>
          <button
            onClick={() => setMinted(null)}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            data-testid="minted-token-hide"
          >
            I have it — hide this
          </button>
        </Section>
      )}

      <Section title="New token" description={`Tokens are how agents reach ${PLATFORM_NAME}. This one will work against every app you have access to, not only ${APP_NAME}.`}>
        <div className="flex gap-2">
          <Input
            data-testid="input-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is it for? e.g. billing-agent"
          />
          <Button onClick={onCreate} disabled={!name.trim() || create.isPending} data-testid="create-token">
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          From a terminal, <code className="rounded bg-muted px-1 py-0.5">bk login</code> does this for
          you and stores the result.
        </p>
      </Section>

      <Section title="Your tokens">
        {tokens.isPending ? (
          <LoadingState count={2} />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} retry={tokens.refetch} />
        ) : tokens.data.length === 0 ? (
          <EmptyState title="No tokens" hint="Create one above, or run `bk login` from a terminal." />
        ) : (
          <ul className="divide-y divide-border" data-testid="token-list">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5" data-testid={`token-${t.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <code>bk_live_{t.token_prefix}…</code>
                    {' · '}
                    {t.last_used_at ? `last used ${short(t.last_used_at)}` : 'never used'}
                    {t.expires_at ? ` · expires ${short(t.expires_at)}` : ''}
                  </span>
                </span>
                <button
                  onClick={() => onRevoke(t.id, t.name)}
                  aria-label={`Revoke ${t.name}`}
                  data-testid={`revoke-token-${t.id}`}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function short(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
