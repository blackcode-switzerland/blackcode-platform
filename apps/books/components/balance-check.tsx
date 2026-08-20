// `<BalanceCheck>` — actif = passif, rendered on the page.
//
// ===========================================================================
// IT IS SHOWN WHEN IT PASSES, WHICH IS THE ONLY REASON IT IS WORTH ANYTHING
// ===========================================================================
// `GET …/bilan` returns `balanced` and `ecart` rather than throwing, so that a
// bilan which does NOT balance can be looked at instead of disappearing behind a
// 500 that does not say which book is broken. That decision only pays off if the
// screen renders the check — and renders it in both outcomes.
//
// A check that appears only on failure is one nobody has seen work, so nobody
// knows whether its absence means "fine" or "not run". This repo has a table of
// twenty-one guardrails that were green and inert for exactly that reason. The
// passing state is quiet — one line, muted — but it is present, and it names the
// two totals it compared.
//
// ── WHY THE BILAN BALANCING IS NOT A TAUTOLOGY ────────────────────────────
// `resultat_exercice` is INJECTED into equity from the compte de résultat rather
// than summed from an account (`lib/derive/index.ts`, note 4), so the two sides
// agreeing confirms that the postings plus the injected result add up. It fails
// when a posting is missing from one side. It is a real check.
//
// ── `ecart` IS THE SERVER'S ARITHMETIC ────────────────────────────────────
// Computed in centimes in `bilanFor` and served as a string. Nothing here
// subtracts one total from the other — that would be exactly the float this app
// spends `lib/format.ts` avoiding, on the one number whose whole job is to be
// exact.

'use client'

import { AlertTriangle, Check } from 'lucide-react'
import { money } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { Money as MoneyString } from '@/lib/types'

export function BalanceCheck({
  balanced,
  ecart,
  actif,
  passif,
}: {
  balanced: boolean
  ecart: MoneyString
  actif: MoneyString
  passif: MoneyString
}) {
  const t = useT()
  if (balanced) {
    return (
      <p
        className="mb-4 flex items-center gap-1.5 text-[12px] text-muted-foreground"
        data-balanced="true"
      >
        <Check size={13} className="shrink-0" />
        {/* ── THE AMOUNT IS INTERPOLATED AS TEXT, NOT AS `<Money>` ───────────
            The comment that stood here warned that a line break before the comma
            turns into a text node beginning with a space and prints
            `CHF 107'483.03 , so`. Splitting a sentence into three JSX fragments
            is what made that possible, and it also fixes English clause order
            into a sentence French orders differently. One entry, one
            interpolation, no fragments.

            `money()` is `lib/format.ts`'s formatter and it still never
            constructs a Number — that file's standing rule is intact, and the
            ASCII apostrophe for thousands (D-B) comes with it in both languages.
            What is lost is `<Money>`'s tabular figures inside a paragraph of
            prose, where they were doing no work. */}
        <span>{t('statements.balanced', { amount: money(actif) })}</span>
      </p>
    )
  }

  return (
    <div
      role="alert"
      data-balanced="false"
      className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('statements.unbalancedTitle')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('statements.unbalancedBody', {
              actif: money(actif),
              passif: money(passif),
              ecart: money(ecart),
            })}
          </p>
        </div>
      </div>
    </div>
  )
}
