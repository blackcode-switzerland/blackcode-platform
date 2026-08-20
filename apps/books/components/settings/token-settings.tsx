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
import { useLocale, useT } from '@/lib/i18n'
import { useCreateToken, useRevokeToken, type MintedToken } from '@/lib/account'
import type { Locale } from '@blackcode/platform-i18n'
import { ErrorState, Loading } from '@/components/states'
import { Section, inputClass } from './section'

export function TokenSettings() {
  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useRevokeToken()
  const t = useT()
  const locale = useLocale()

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
    toast.success(t('settings.tokens.revoked', { name: label }))
  }

  return (
    <div className="space-y-4">
      {minted && (
        <Section
          title={t('settings.tokens.copyNow')}
          note={t('settings.tokens.copyNowNote')}
        >
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-secondary px-3 py-2 font-mono text-xs">
              {minted.plaintext}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(minted.plaintext).then(
                  () => toast.success(t('settings.tokens.copied')),
                  // A clipboard write can be refused by the browser, and a
                  // silent failure means somebody navigates away believing they
                  // hold a credential they never captured.
                  () => toast.error(t('settings.tokens.copyFailed'))
                )
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
            >
              <Copy size={14} />
              {t('settings.tokens.copy')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMinted(null)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('settings.tokens.hide')}
          </button>
        </Section>
      )}

      <Section
        title={t('settings.tokens.new')}
        note={t('settings.tokens.newNote')}
      >
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.tokens.namePlaceholder')}
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
            {create.pending ? t('settings.tokens.creating') : t('settings.tokens.create')}
          </button>
        </div>
        {/* One sentence with the two commands interpolated, rather than three
            fragments around two `<code>` elements. French puts "depuis un
            terminal" first and the clause order after it differs; assembling the
            sentence in JSX would fix English word order into both languages.
            The monospace styling is the cost. */}
        <p className="text-xs text-muted-foreground">
          {t('settings.tokens.cliHint', { login: 'bk login', loginServer: 'bk login --server' })}
        </p>
      </Section>

      <Section title={t('settings.tokens.yours')}>
        {tokens.isPending ? (
          <Loading rows={2} label={t('settings.tokens.loading')} />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} title={t('settings.tokens.loadError')} />
        ) : tokens.data.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t('settings.tokens.none', { login: 'bk login' })}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.data.map((tok) => (
              <li key={tok.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{tok.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <code>bk_live_{tok.token_prefix}…</code>
                    {' · '}
                    {tok.last_used_at
                      ? t('settings.tokens.lastUsed', { when: shortDate(tok.last_used_at, locale) })
                      : t('settings.tokens.neverUsed')}
                    {tok.expires_at
                      ? ` · ${t('settings.tokens.expires', { when: shortDate(tok.expires_at, locale) })}`
                      : ''}
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
                {confirming === tok.id ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRevoke(tok.id, tok.name)}
                      disabled={revoke.pending}
                      className="rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
                    >
                      {t('settings.tokens.revokeNamed', { name: tok.name })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('settings.tokens.cancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(tok.id)}
                    aria-label={t('settings.tokens.revokeNamed', { name: tok.name })}
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
function shortDate(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // ── THE LOCALE IS PASSED IN, NOT HARDCODED, AND NOT `undefined` ───────────
  // It was `'en-GB'`, which was correct while the app was English-only and is a
  // French page rendering "20 Aug 2026" now. `undefined` (the browser's locale)
  // would be worse than either: it would follow a setting the reader did not
  // make on this product, so a French page could render an American date for
  // somebody whose browser is American. `fr-CH`, not `fr`: this is a Swiss
  // product and `fr-FR` and `fr-CH` differ in date and number conventions.
  return d.toLocaleDateString(locale === 'fr' ? 'fr-CH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
