'use client'

// API tokens — `platform.api_tokens`, ONE list across every blackcode app.
//
// A token minted here works against b/issues too, and one revoked here stops
// working there. That is the fact a reader is most likely to assume the other
// way round — "I made it in b/books, so it is a books token" is a reasonable
// guess and a wrong one — so the page says it rather than leaving it to be
// discovered by a command failing somewhere else.
//
// ── IT IS NOT A BOOKS WRITE, AND IT IS NOT BEHIND useCanWrite() ────────────
// A token is how an agent reaches this product at all. Gating it on the same
// hook that decides whether an entry may be posted would turn a bookkeeping
// permission into "may you use the CLI", which is a different question with a
// different answer. `lib/account.ts` holds these; `lib/read-only.test.ts` names
// that module and this component sends nothing itself.

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Trash2 } from 'lucide-react'
import { useTokens } from '@/lib/hooks'
import { useCreateToken, useRevokeToken, type MintedToken } from '@/lib/account'
import { ErrorState, Loading } from '@/components/states'
import { Section, inputClass } from './section'

export function TokenSettings() {
  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useRevokeToken()

  const [name, setName] = useState('')
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)

  async function onCreate() {
    const made = await create.run({ name: name.trim() })
    if (!made.ok) {
      toast.error(made.message)
      return
    }
    setMinted(made.data)
    setName('')
    await tokens.refetch()
  }

  async function onRevoke(id: number, label: string) {
    setConfirming(null)
    const gone = await revoke.run({ id })
    if (!gone.ok) {
      toast.error(gone.message)
      return
    }
    // If the token being revoked is the one still on screen, take it off: a
    // secret displayed under a row that no longer exists invites somebody to
    // paste a credential that stopped working while they were reading it.
    setMinted((m) => (m && m.id === id ? null : m))
    await tokens.refetch()
    toast.success(`Revoked “${label}”`)
  }

  return (
    <div className="space-y-4">
      {minted && (
        <Section
          title="Copy it now"
          note="This is the only time the token is shown. Nothing can display it again — not this page, and not the database, which stores only a hash of it."
        >
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-3 py-2 font-mono text-xs">
              {minted.plaintext}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(minted.plaintext).then(
                  () => toast.success('Copied'),
                  // A clipboard write can be refused by the browser, and a
                  // silent failure means somebody navigates away believing they
                  // hold a credential they never captured.
                  () => toast.error('Could not copy — select the token and copy it by hand')
                )
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
            >
              <Copy size={14} />
              Copy
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMinted(null)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            I have it — hide this
          </button>
        </Section>
      )}

      <Section
        title="New token"
        note="Tokens are how agents reach blackcode. This one works against every app your account can reach, not only b/books."
      >
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is it for? e.g. companion-laptop"
            className={inputClass}
            // No `maxLength`. The cap is declared once in the API package and
            // enforced by the route; importing it here would pull that barrel —
            // handler, drizzle, storage — into the browser bundle for one
            // integer. A long name gets the route's 400, which carries both the
            // number and a suggestion.
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={!name.trim() || create.pending}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {create.pending ? 'Creating…' : 'Create'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          From a terminal, <code className="rounded bg-secondary px-1 py-0.5">bk login</code> does
          this for you and stores the result — including against this app, with{' '}
          <code className="rounded bg-secondary px-1 py-0.5">bk login --server</code>.
        </p>
      </Section>

      <Section title="Your tokens">
        {tokens.isPending ? (
          <Loading rows={2} label="Loading your tokens" />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} title="Your tokens could not be loaded" />
        ) : tokens.data.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No tokens yet. Create one above, or run{' '}
            <code className="rounded bg-secondary px-1 py-0.5">bk login</code> from a terminal.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <code>bk_live_{t.token_prefix}…</code>
                    {' · '}
                    {t.last_used_at ? `last used ${shortDate(t.last_used_at)}` : 'never used'}
                    {t.expires_at ? ` · expires ${shortDate(t.expires_at)}` : ''}
                  </span>
                </span>
                {/*
                  Two steps, because one click cannot be taken back and what it
                  breaks is somewhere else: an agent mid-run losing its
                  credential does not look like "somebody clicked a bin icon", it
                  looks like the API being down. The second step names the token,
                  which is the same reason the CLI's irreversible verbs make the
                  caller repeat the target back.
                */}
                {confirming === t.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRevoke(t.id, t.name)}
                      disabled={revoke.pending}
                      className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
                    >
                      Revoke “{t.name}”
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(t.id)}
                    aria-label={`Revoke ${t.name}`}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

/**
 * A timestamp, short.
 *
 * `new Date` here and NOT in `lib/format.ts`: that file's `date()` takes the
 * wire form of a Postgres `date` and deliberately never constructs a Date,
 * because a date with no time of day shifts across a year boundary when a
 * timezone is applied to it. These are `timestamptz` — an instant, which has a
 * timezone by definition and is supposed to be rendered in the reader's.
 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
