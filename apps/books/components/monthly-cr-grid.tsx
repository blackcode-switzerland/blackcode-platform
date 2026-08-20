'use client'

// `<MonthlyCrGrid>` — the compte de résultat, twelve times. Ticket #64.
//
// ===========================================================================
// THIS IS A READING AID. NO COLUMN IN IT IS FILABLE.
// ===========================================================================
// Art. 959b CO defines the ANNUAL statement. A month is not a legal reporting
// period, so none of these twelve columns is a document — they exist to answer
// the one question the annual figure cannot: *the year lost 10'993.60, and
// almost all of it was March.*
//
// The note is rendered above the grid rather than tucked under it, in the same
// voice `<SimplifiedBookNotice>` uses: neutral, explanatory, and stating a legal
// fact rather than warning about one.
//
// ===========================================================================
// THIS COMPONENT DECIDES NOTHING. `lib/monthly-cr.ts` DOES.
// ===========================================================================
// The row order, the missing-cell rule and the total column are the three
// things ticket #64 is actually about, and all three live in `monthlyCrView` —
// a pure transform, with `lib/monthly-cr.test.ts` asserting them on real values.
// This app's tests run in a `node` environment with no DOM, so a rule enforced
// inside a `.tsx` render is a rule nothing can observe; the only guard left
// would be a text scan over this file, whose granularity is its own bug
// (CLAUDE.md finding #11).
//
// So what is left here is markup. In particular there is **no arithmetic**: not
// a `reduce`, not a `+`, not a `Number()` on any amount. `<Money>`'s prop type
// is `string | null` with no numeric overload, which is what stops one arriving.

import { Money } from './money'
import { monthlyCrView } from '@/lib/monthly-cr'
import type { MetaPayload } from '@/lib/hooks'
import type { CrResult, MonthlyCrResult } from '@/lib/types'

export function MonthlyCrGrid({
  /**
   * The whole payload — annual body AND months, from ONE request.
   *
   * Not two props, deliberately: two would let a caller hand this the annual
   * body of one fetch and the months of another, which is the exact thing the
   * route serves them together to prevent.
   */
  cr,
  /** `/api/meta`'s copy of the art. 959b structure. The line NAMES live there. */
  meta,
}: {
  cr: CrResult & { months: MonthlyCrResult[] }
  meta: MetaPayload | undefined
}) {
  const view = monthlyCrView(cr, meta)

  return (
    <div>
      <MonthlyReadingOnlyNotice />

      {/* The grid scrolls INSIDE its own box. Thirteen numeric columns do not
          fit a phone and they do not fit a narrow laptop either, and a page that
          scrolls sideways is the platform's one hard layout rule
          (docs/frontend.md). `min-w-max` is what makes the inner table refuse to
          squash its columns instead of wrapping amounts.

          ── BOTH EDGES ARE PINNED — BUT THE RIGHT ONE ONLY FROM `sm` ───────
          The row LABEL sticks to the left always. The YEAR sticks to the right
          from 640px up: the page column is `max-w-4xl`, so at 1440×900 the grid
          shows about five months of the twelve, and without the pin the exercice
          total — the number every month is read against — was the one column you
          could never see beside the month you were looking at.

          **Below `sm` the pin is off, and that was measured, not reasoned about**
          (found in review, 2026-08-20). At 390×844 the left label column is
          176px wide and the pinned year column started at x=246, leaving a 70px
          clear band for a `w-28` (112px + `pl-4`) month column. So at the scroll
          position the reader LANDS on, not one month figure was fully readable
          and January's sat entirely underneath the year column: `produits_nets`
          showed the year's `5'420.00` where January's `0.00` belonged. It is not
          a missing number — it is the WRONG number in the month's place, which
          is worse, and `charges_personnel` hid it completely because the seed's
          January and year figures are the same string there.

          Below `sm` there is no "beside" to preserve: only one numeric column
          fits at a time, so the pin bought nothing and cost the default view. The
          year is still the last column; it is reached by scrolling, like the
          months. Re-measured after the change at 390 (January fully readable,
          page scroll 0) and at 1440 (year still pinned at x=1280 through a full
          928px inner scroll, page scroll 0). */}
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-max border-collapse text-[13px]">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 border-b border-border bg-background py-1.5 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-primary-strong"
              >
                Compte de résultat
              </th>
              {view.columns.map((c) => (
                <th
                  key={c.month}
                  scope="col"
                  title={c.full}
                  // `relative` is load-bearing and was found in the browser.
                  //
                  // `.sr-only` is `position: absolute`, so its containing block
                  // is the nearest POSITIONED ancestor — and an absolutely
                  // positioned box is not clipped by an `overflow` ancestor that
                  // is not its containing block. With a static `<th>` the twelve
                  // gloss spans escaped the scroll box entirely and **the whole
                  // page scrolled sideways by 760px at 1200×800**, which is the
                  // platform's one hard layout rule (docs/frontend.md).
                  //
                  // Measured, not reasoned about: the annual view scrolled 0,
                  // this one scrolled 760, and hiding just these twelve spans
                  // took it back to 0. `overflow: hidden` on the wrapper changed
                  // nothing, which is what pointed at the containing block
                  // rather than at the table.
                  className="num relative w-28 border-b border-border py-1.5 pl-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {c.short}
                  <span className="sr-only"> — {c.full}</span>
                </th>
              ))}
              {/* The year, from the annual body of the same payload. Labelled
                  with the exercice rather than "total", because "total" invites
                  the reader to check it by adding the columns up — and the
                  answer to that check is the server's, not this table's. */}
              <th
                scope="col"
                className="num right-0 z-10 sm:sticky w-32 border-b-2 border-l border-border bg-background py-1.5 pl-5 text-[11px] font-semibold uppercase tracking-wider text-foreground"
              >
                {cr.exercice}
              </th>
            </tr>
          </thead>

          <tbody>
            {view.rows.map((row) => (
              <tr key={row.pos} className="border-b border-border/50" data-pos={row.pos}>
                <th
                  scope="row"
                  // ── THE CAP IS NARROWER ON A PHONE, AND THAT WAS MEASURED ──
                  // At `max-w-[22rem]` (352px) this column filled a 390px
                  // viewport on its own: the grid scrolled correctly inside its
                  // box, and the reader's first screen was ten statutory labels
                  // and NOT ONE NUMBER. A table of money whose money is entirely
                  // off-screen reads as a table that failed to load.
                  //
                  // 10rem keeps at least the first month in view. The labels wrap
                  // to two or three lines there rather than truncating, which is
                  // the right way round: the statutory wording is the row's
                  // identity and an ellipsis in the middle of art. 959b's own
                  // words is worse than a taller row.
                  className="sticky left-0 z-10 max-w-[10rem] bg-background py-1.5 pr-4 text-left font-normal sm:max-w-[22rem]"
                >
                  <span className="text-foreground">{row.fr}</span>
                  <span className="ml-2 text-[11.5px] text-muted-foreground">{row.en}</span>
                </th>
                {row.cells.map((amount, i) => (
                  <td key={view.columns[i].month} className="num py-1.5 pl-4">
                    <Money value={amount} bare />
                  </td>
                ))}
                <td className="num right-0 z-10 sm:sticky border-l border-border bg-background py-1.5 pl-5 font-medium">
                  <Money value={row.total} bare />
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-background pt-3 pr-4 text-left text-[13px] font-semibold"
              >
                Résultat
                <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">Result</span>
              </th>
              {view.resultat.cells.map((amount, i) => (
                <td key={view.columns[i].month} className="num-total pt-3 pl-4 text-[13px]">
                  <Money value={amount} bare />
                </td>
              ))}
              <td className="num-total right-0 z-10 sm:sticky border-l border-border bg-background pt-3 pl-5 text-[13px] font-semibold">
                <Money value={view.resultat.total} bare />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/**
 * The note ticket #64 asks for, in `<SimplifiedBookNotice>`'s voice.
 *
 * Not decoration, and not a warning either. It states a legal fact — art. 959b
 * fixes the ANNUAL statement, a month is not a reporting period, and nothing
 * here is filable — in the same neutral register the RI refusal uses, for the
 * same reason: nothing has gone wrong, so nothing is red.
 *
 * It says the second half too, because a reader told "not filable" and nothing
 * else will wonder whether the numbers are approximate. They are not: every
 * month comes through the same derivation as the year, and the twelve sum to it
 * exactly (`lib/wire-parity.test.ts` asserts that, in centimes).
 */
export function MonthlyReadingOnlyNotice() {
  return (
    <p
      className="rounded-lg border border-border bg-secondary px-3 py-2 text-[12px] text-muted-foreground"
      aria-live="polite"
    >
      <span className="font-medium text-foreground">
        A monthly view is for reading, not for filing.
      </span>{' '}
      Art. 959b CO defines the compte de résultat as an <em>annual</em> statement. A month is not a
      legal reporting period and no column below is a document you can file. The figures are not
      approximations: every month is derived exactly as the year is, and the twelve sum to the year
      in the last column.
    </p>
  )
}
