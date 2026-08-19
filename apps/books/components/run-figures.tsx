'use client'

// `<RunFigures>` — produits, charges and the net, over the months that carry
// postings.
//
// ===========================================================================
// THE MOCKUP SHOWED FIVE FIGURES HERE. FOUR OF THEM ARE NOT BUILT.
// ===========================================================================
// `app-analytique.html`'s "Run metrics" panel is *Revenue / month*, *Burn /
// month*, *Net / month*, *Cash*, *Runway*. What is here instead is three
// TOTALS and a coverage sentence, and the difference is not a simplification:
//
//   **The three per-month figures are a DIVISION of money.** `revenueYtd /
//   MONTHS_COVERED` is exact for 13'350.00 over two months and is not for
//   133.60 over three, and the result was rendered as `CHF …` — a franc
//   figure this app computed by dividing a parsed float. That is the one
//   thing `lib/format.ts`, `lib/rollup.ts` and `<Money>`'s prop type exist
//   between them to prevent. A total is a SUM and sums are exact in centimes;
//   an average is not, and no rounding of it is the true one.
//
//   **Cash and runway are not on this route.** `GET …/analytique` serves the
//   categories and the months, and nothing else. The mockup got cash by adding
//   three named bank balances — `D.balance(entity,'1020') + …'1021' + …'1022'`
//   — which is blackcode's own chart hardcoded into a screen, and D-D forbids
//   exactly that ("no hardcoded entity slugs", "nothing may assume three
//   books"). Runway then divides cash by the net-per-month above.
//
// So the honest version of this panel is the sums it can make exactly, said to
// cover what they actually cover. Asking the backend to serve the totals — and
// a treasury figure, and the runway the Analyses journal already records — is
// in the phase-4B report. Until then, **the reader gets three exact numbers
// rather than five approximate ones**, and this comment is why.
//
// ── AND THE COVERAGE SENTENCE IS PART OF THE FIGURE ────────────────────────
// The series is sparse: blackcode's 2026 is two months, and a reader who takes
// `-10'993.60` for a year has been misled by an omission rather than by a
// number. `months` comes from `flowTotals`, counted, never assumed.

import { Money } from './money'
import type { FlowTotals } from '@/lib/analytique'
import type { Journal } from '@/lib/journal'

/**
 * What each figure IS — and it is a different fact per regime.
 *
 * ── THIS BRANCH IS NOT COSMETIC ───────────────────────────────────────────
 * "class 3 accounts, posted" is false of a simplified book twice over: it has
 * no chart of accounts, and `books.ri_entry` has no `status` column at all, so
 * there is no posted/staged distinction to exclude anything by. A sentence
 * true of one book printed over another is the exact failure
 * `<PostedOnlyNote>` was added for, one screen earlier.
 *
 * `null` is "cannot tell", never a default: the copy then says only what is
 * true of both, rather than picking the commoner book. `lib/journal.ts` records
 * why that value is carried rather than resolved.
 */
function hints(journal: Journal | null): [string, string, string] {
  if (journal === 'recettes_depenses') {
    return ['recettes, cash basis', 'dépenses, cash basis', 'recettes − dépenses']
  }
  if (journal === 'grand_livre') {
    return ['class 3 accounts, posted', 'every other CR class, posted', 'revenue − charges']
  }
  return ['money in', 'money out', 'in − out']
}

export function RunFigures({ totals, journal }: { totals: FlowTotals; journal: Journal | null }) {
  const [inHint, outHint, netHint] = hints(journal)
  const figures: { label: string; value: string; hint: string }[] = [
    // The LABELS stay English and stay the same for both regimes (D-A: English
    // chrome). The regime nuance rides in the hint, where it belongs — the
    // reader wants to know what the number counts, not what the journal is
    // called in French.
    { label: 'Revenue', value: totals.produits, hint: inHint },
    { label: 'Charges', value: totals.charges, hint: outHint },
    { label: 'Net', value: totals.net, hint: netHint },
  ]

  return (
    <section aria-label="Exercice totals">
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {figures.map((f) => (
          <div key={f.label} className="bg-card px-4 py-3">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {f.label}
            </dt>
            {/* `<Money>` takes the STRING. Nothing on this row was parsed: each
                value is `flowTotals`' exact centime sum rendered back out. */}
            <dd className="mt-0.5 text-lg font-semibold text-foreground">
              <Money value={f.value} />
            </dd>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-[12px] text-muted-foreground">
        {totals.months === 0 ? (
          <>
            No month of this exercice carries a movement yet, so these totals are zero rather
            than unknown.
          </>
        ) : (
          <>
            Summed over the{' '}
            <span className="font-medium text-foreground">
              {totals.months} {totals.months === 1 ? 'month' : 'months'}
            </span>{' '}
            of this exercice that carry a movement — not over the whole year. A month with
            nothing in it is absent from the series entirely.
            {journal === 'grand_livre' && (
              <>
                {' '}
                An unexplained backlog of staged entries understates the charges here; that is
                what the recognition worklist is for.
              </>
            )}
          </>
        )}
      </p>
    </section>
  )
}
