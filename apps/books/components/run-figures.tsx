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

'use client'

import { Money } from './money'
import { Stat, StatRow } from './stat'
import { runway, type RunwayResult } from '@/lib/runway'
import { money } from '@/lib/format'
import type { BilanResult } from '@/lib/types'
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'
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
 *
 * It returns KEYS rather than words since 2026-08-20, so a hook does not have to
 * be called from a plain function — and so a hint naming a key that does not
 * exist is a compile error.
 */
function hintKeys(journal: Journal | null): [BooksKey, BooksKey, BooksKey] {
  if (journal === 'recettes_depenses') {
    return ['run.hintRiIn', 'run.hintRiOut', 'run.hintRiNet']
  }
  if (journal === 'grand_livre') {
    return ['run.hintGlIn', 'run.hintGlOut', 'run.hintGlNet']
  }
  return ['run.hintUnknownIn', 'run.hintUnknownOut', 'run.hintUnknownNet']
}

export function RunFigures({
  totals,
  journal,
  bilan,
}: {
  totals: FlowTotals
  journal: Journal | null
  /**
   * The bilan payload, or undefined when the route refused or is in flight.
   *
   * The PAYLOAD and not the derived cash figure, because `runway()` has to be
   * able to tell "this book keeps no balance sheet" (art. 957 al. 2, and the
   * route refuses outright) from "the balance sheet has no trésorerie line".
   * Those are two different sentences and passing a derived null collapsed them
   * into the wrong one — see `lib/runway.ts`.
   */
  bilan: BilanResult | undefined
}) {
  const t = useT()
  const runwayResult = runway(bilan, totals)
  const [inHint, outHint, netHint] = hintKeys(journal)
  const figures: { key: string; label: string; value: string; hint: string }[] = [
    // The labels are the same for both regimes; the regime nuance rides in the
    // HINT, where it belongs — the reader wants to know what the number counts.
    { key: 'in', label: t('run.revenue'), value: totals.produits, hint: t(inHint) },
    { key: 'out', label: t('run.charges'), value: totals.charges, hint: t(outHint) },
    { key: 'net', label: t('run.net'), value: totals.net, hint: t(netHint) },
  ]

  return (
    <section aria-label={t('run.exerciceTotals')}>
      {/* `<StatRow>`/`<Stat>` since 2026-08-21, so this strip is the same object
          every other headline figure in the app is. It was a hand-rolled copy of
          the same grid; the only thing lost is the copy. Keyed on a STABLE id,
          not on the translated label: a React key that changes with the language
          remounts the tile on a switch. */}
      <StatRow className="mb-2">
        {figures.map((f) => (
          <Stat
            key={f.key}
            caption={f.label}
            /* `<Money>` takes the STRING. Nothing here was parsed: each value is
               `flowTotals`' exact centime sum rendered back out. */
            value={<Money value={f.value} bare />}
            basis={f.hint}
            emphasis={f.key === 'net'}
          />
        ))}
        {/* ── THE RUNWAY, WHICH THIS COMPONENT USED TO SAY IT COULD NOT GIVE ──
            The header below still records why it could not: `GET …/analytique`
            serves no cash figure. That remains true and this is not a route
            change — **the BILAN serves cash**, at `pos === 'tresorerie'`, for
            the same book and the same exercice. `lib/runway.ts` does the
            arithmetic and refuses in five distinct ways rather than dividing
            blind; `<RunwayStat>` renders whichever refusal came back, in words.

            A simplified book reaches none of this: its bilan route refuses
            (art. 957 al. 2), so `cash` is null and the tile says so. */}
        <RunwayStat result={runwayResult} />
      </StatRow>

      <p className="mt-2 text-[12px] text-muted-foreground">
        {totals.months === 0 ? (
          t('run.emptyYear')
        ) : (
          <>
            {t(totals.months === 1 ? 'run.summedOne' : 'run.summedMany', { n: totals.months })}
            {journal === 'grand_livre' && <> {t('run.backlog')}</>}
          </>
        )}
      </p>
    </section>
  )
}

/**
 * The runway tile, and its four refusals.
 *
 * ── IT NEVER RENDERS A NUMBER IT CANNOT DEFEND ────────────────────────────
 * `runway()` returns a discriminated result and each branch is a sentence. The
 * one that matters is `not_burning`: a book making money has no runway, and
 * `cash / net` on a positive net produces a NEGATIVE month count — a figure
 * that would read as "-14 months of cash" on a management screen.
 *
 * The month count is rounded to one decimal because it IS an estimate — a
 * geometry rather than a figure, in `docs/frontend.md` §4bis's terms. The two
 * exact strings it came from are printed beside it as the basis, so a reader
 * can check the division rather than take it.
 */
function RunwayStat({ result }: { result: RunwayResult }) {
  const t = useT()

  if (result.kind === 'ok') {
    return (
      <Stat
        caption={t('run.runway')}
        value={t('run.runwayMonths', { n: result.months.toFixed(1) })}
        basis={t('run.runwayBasis', {
          cash: money(result.cash, ''),
          burn: money(result.perMonth, ''),
          n: result.over,
        })}
      />
    )
  }

  const why: Record<Exclude<RunwayResult['kind'], 'ok'>, BooksKey> = {
    no_bilan: 'run.runwayNoBilan',
    no_cash_line: 'run.runwayNoCash',
    no_months: 'run.runwayNoMonths',
    not_burning: 'run.runwayNotBurning',
  }
  return (
    <Stat
      caption={t('run.runway')}
      // An em dash: there is no figure. Never `0`, which would say the cash is
      // gone — the one reading a reader must not be given by accident.
      value={<span className="text-muted-foreground">—</span>}
      basis={t(why[result.kind])}
    />
  )
}
