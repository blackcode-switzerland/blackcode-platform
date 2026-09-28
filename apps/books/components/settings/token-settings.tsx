'use client'

// API tokens — `platform.api_tokens`, ONE list across every blackcode app,
// drawn by the shared `TokensSection` (2026-09-28) that every app renders.
//
// A token minted here works against every other app too, and one revoked here
// stops working there. That is the fact a reader is most likely to assume the
// other way round — "I made it in b/books, so it is a books token" is a
// reasonable guess and a wrong one — so the page says it.
//
// ── IT IS NOT A BOOKS WRITE, AND IT IS NOT BEHIND useCanWrite() ────────────
// A token is how an agent reaches this product at all. Gating it on the same
// hook that decides whether an entry may be posted would turn a bookkeeping
// permission into "may you use the CLI", which is a different question with a
// different answer. `lib/account.ts` holds these; `lib/read-only.test.ts` names
// that module and this component sends nothing itself.
//
// Revoking asks first, naming the token: an agent mid-run losing its credential
// does not look like "somebody clicked a button", it looks like the API being
// down.

import { toast } from 'sonner'
import { TokensSection } from '@blackcode/platform-ui/account/account-settings'
import { useTokens } from '@/lib/hooks'
import { useLocale, useT } from '@/lib/i18n'
import { useCreateToken, useRevokeToken } from '@/lib/account'
import type { Locale } from '@blackcode/platform-i18n'
import { ErrorState } from '@/components/states'
import { useAccountLabels } from './labels'

export function TokenSettings() {
  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useRevokeToken()
  const t = useT()
  const locale = useLocale()
  const labels = useAccountLabels()

  return (
    <TokensSection
      tokens={tokens.data}
      error={tokens.error ? <ErrorState error={tokens.error} title={t('settings.tokens.loadError')} /> : undefined}
      labels={labels}
      formatDate={(iso) => shortDate(iso, locale)}
      onCopy={(text) =>
        navigator.clipboard.writeText(text).then(
          () => toast.success(t('settings.tokens.copied')),
          // A clipboard write can be refused by the browser, and a silent
          // failure means somebody navigates away believing they hold a
          // credential they never captured.
          () => toast.error(t('settings.tokens.copyFailed'))
        )
      }
      onCreate={async (name) => {
        const made = await create.run({ name })
        if (!made.ok) {
          toast.error(made.message)
          throw new Error(made.message)
        }
        await tokens.refetch()
        toast.success(t('settings.tokens.created'))
        return made.data.plaintext
      }}
      onRevoke={async (tok) => {
        const gone = await revoke.run({ id: tok.id })
        if (!gone.ok) {
          toast.error(gone.message)
          throw new Error(gone.message)
        }
        await tokens.refetch()
        toast.success(t('settings.tokens.revoked', { name: tok.name }))
      }}
      // One sentence with the two commands interpolated, rather than fragments
      // around `<code>` elements: French orders the clauses differently, and
      // assembling the sentence in JSX would fix English word order into both.
      footer={t('settings.tokens.cliHint', { login: 'bk login', loginServer: 'bk login --server' })}
    />
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
 *
 * The locale is passed in, not `undefined`: the browser's locale would follow a
 * setting the reader did not make on this product. `fr-CH`, not `fr` — this is a
 * Swiss product and `fr-FR` and `fr-CH` differ in date conventions.
 */
function shortDate(iso: string, locale: Locale): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(locale === 'fr' ? 'fr-CH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
