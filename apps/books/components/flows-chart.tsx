'use client'

// `<FlowsChart>` — produits against charges, month by month.
//
// ===========================================================================
// THE SERIES IS SPARSE AND NOTHING HERE JOINS THE DOTS
// ===========================================================================
// `monthlyFlows` drops a month with no posted écriture, so blackcode's 2026 is
// TWO rows in a twelve-month year. A line chart is therefore refused outright:
// a stroke from January to February states a figure for the days between them,
// and on a book with a gap — 2026-01 to 2026-03 — it would state a whole month
// that has no postings at all. **Columns cannot interpolate.** Each mark stands
// over its own month and the space between two marks says nothing, which is
// exactly the claim the data supports.
//
// `hasGaps` is why this is a rule rather than a preference: when a month IS
// missing between two that are served, the chart says so in words underneath,
// because equal spacing on a categorical axis makes January and March look
// adjacent and a reader would otherwise read a two-month interval as one.
//
// ===========================================================================
// THE CHART IS GEOMETRY. THE TABLE UNDERNEATH IS THE FIGURES.
// ===========================================================================
// A bar's height comes from `amount()` — a float, the sanctioned use, and it is
// never printed. Every FIGURE on this component comes off the wire as a string
// and goes through `<Money>`: the tooltip, the table, all of it. So there is no
// path from a parsed float to a rendered franc, and the table is also what
// makes the chart accessible — the `dataviz` skill's rule that a tooltip may
// enhance a value and may never be the only way to read one.
//
// The y-axis ticks are the one exception and they are not figures: they are
// scale marks, rounded to a nice step and drawn compactly (`15k`), and the axis
// is labelled `CHF` so nobody reads a tick as an amount. `axisTicks` and
// `tickLabel` live in `lib/analytique.ts` under a header saying the same.
//
// ===========================================================================
// WHY THIS IS NOT `@blackcode/platform-ui/charts`
// ===========================================================================
// The shared kit is real and this app defines its four `--chart-series-*`
// tokens, so mounting it was the first thing tried. Three of its assumptions
// are wrong here, and each one would ship a defect rather than a compromise:
//
//   1. **`HorizontalBars` renders the value with `formatNumber`** — an en-US
//      compact float, so `13350.00` prints `13.4K`. Every amount in this app is
//      a Swiss-formatted string off the wire; that prop is `value: number`, so
//      using it means `Number(amount)` at the call site, in the display path.
//   2. **`AreaLineChart` draws a LINE** between points, which is the one thing
//      this data forbids. `VelocityChart` — the kit's grouped two-series
//      component — is a thin wrapper over it.
//   3. **`ColumnChart` renders "No data." when its total is zero**, and every
//      month at zero is a real state, not an absent one.
//
// The kit is built for COUNTS — issues created, deals closed — where a float
// and a compact label are correct. This is money. Recorded here rather than in
// a commit message, because "why did they not use the shared component" is the
// first question a reviewer of this file will have.
//
// ── COLOUR ────────────────────────────────────────────────────────────────
// `--chart-1` and `--chart-2`, the app's own tokens, validated against this
// app's chart surface in both themes by the `dataviz` skill's script — see the
// note beside them in `app/globals.css`. Two series is identity, so the job is
// categorical, and the legend is always present because colour must never be
// the only channel. **`--primary` is deliberately not a series colour**: amber
// means "you are in books" (D-B), and a chart mark wearing it would collide
// with the chrome the reader uses to know which app they are in.

import { useState } from 'react'
import { Money } from './money'
import { axisTicks, barLength, hasGaps, monthLabel, tickLabel } from '@/lib/analytique'
import type { MonthlyFlow } from '@/lib/types'

/** The two series, in fixed order. Colour follows the SERIES, never its rank. */
const SERIES = [
  { key: 'produits' as const, label: 'Revenue', color: 'var(--chart-1)' },
  { key: 'charges' as const, label: 'Charges', color: 'var(--chart-2)' },
]

const PLOT_HEIGHT = 176

export function FlowsChart({ flows }: { flows: MonthlyFlow[] }) {
  const [hover, setHover] = useState<{ month: string; series: 0 | 1 } | null>(null)

  if (flows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No month of this exercice carries a movement, so there is no series to draw. This is an
        empty year, not a failure.
      </p>
    )
  }

  const { max, ticks } = axisTicks(flows.flatMap((f) => [f.produits, f.charges]))
  // The ceiling as a decimal string, so `barLength` takes the same kind of
  // value on both sides and no second parser exists.
  const ceiling = max.toFixed(2)
  const gapped = hasGaps(flows)

  return (
    <figure className="m-0">
      {/* A legend is always present for two series — identity is never
          colour-alone. The swatch carries the colour; the text does not. */}
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] text-foreground">
            <span
              className="inline-block size-2.5 rounded-[2px]"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            {s.label}
          </span>
        ))}
      </div>

      {/* `pt-3`: the topmost tick is centred on the plot's top edge, so half of
          its text sits above the box. Without the padding it collides with the
          legend — seen in the browser, not by a test. */}
      <div
        className="relative flex pt-3"
        role="img"
        aria-label={`Revenue against charges for ${flows.length} month${flows.length === 1 ? '' : 's'}. The figures are in the table below.`}
      >
        {/* The tick gutter. `tabular-nums` here and nowhere else on this
            component: these are a column of numbers that must line up. */}
        <div
          className="relative w-11 shrink-0 tabular-nums text-[10px] text-muted-foreground"
          style={{ height: PLOT_HEIGHT }}
          aria-hidden
        >
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-1.5 -translate-y-1/2"
              style={{ bottom: `${(t / max) * 100}%` }}
            >
              {tickLabel(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" style={{ height: PLOT_HEIGHT }}>
          {/* Gridlines: hairline, solid, one step off the surface. Never
              dashed — a dashed grid reads as a threshold or a projection. */}
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: `${(t / max) * 100}%` }}
              aria-hidden
            />
          ))}

          <div className="absolute inset-0 flex items-end justify-around gap-2">
            {flows.map((f) => (
              <div key={f.month} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
                {SERIES.map((s, i) => {
                  const value = f[s.key]
                  const pct = barLength(value, ceiling)
                  const on = hover?.month === f.month && hover.series === i
                  return (
                    <div
                      key={s.key}
                      // The hit target is the full-height column, not the bar:
                      // a January revenue of 0.00 has no bar at all and must
                      // still be hoverable, and a 1.5%-tall mark is a pinpoint
                      // target the `dataviz` skill's interaction rules refuse.
                      //
                      // ── NOT FOCUSABLE, AND THE COPY SAYS SO ──────────────
                      // An earlier version gave each of these `tabIndex={0}`
                      // and the read-out said "hover or tab a column". That is
                      // a focus stop INSIDE a `role="img"`, whose subtree
                      // assistive technology does not enter — so it was a stop
                      // that announced nothing, and on a twelve-month series it
                      // would be twenty-four of them between the chart and the
                      // table that actually carries the figures. The table IS
                      // the keyboard and screen-reader path; hover is the
                      // convenience on top of it.
                      className="flex h-full max-w-[24px] flex-1 cursor-default items-end"
                      onMouseEnter={() => setHover({ month: f.month, series: i as 0 | 1 })}
                      onMouseLeave={() => setHover(null)}
                    >
                      <div
                        className="w-full rounded-t-[4px] transition-opacity"
                        style={{
                          height: `${pct}%`,
                          backgroundColor: s.color,
                          opacity: hover && !on ? 0.55 : 1,
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* The baseline. A zero bar sits ON it and draws nothing, which is
              the difference between "this month earned nothing" and "this
              month is missing" — the second one is not on the axis at all. */}
          <div className="absolute inset-x-0 bottom-0 border-t border-muted-foreground/40" aria-hidden />
        </div>
      </div>

      {/* The month band, outside the plot box, so the axis labels can never be
          clipped by a fixed plot height. */}
      <div className="flex" aria-hidden>
        <div className="w-11 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-around gap-2 pt-1.5">
          {flows.map((f) => (
            <span key={f.month} className="min-w-0 flex-1 text-center text-[10.5px] text-muted-foreground">
              {monthLabel(f.month)}
            </span>
          ))}
        </div>
      </div>

      {/* The hover read-out. It sits in normal flow rather than floating over
          the plot: at phone width a floating tooltip covers the mark it
          describes, and this value is also in the table below, so it never
          needs to be the only way to read one. */}
      <p className="mt-2 min-h-[1.25rem] text-[12px] text-muted-foreground" aria-live="polite">
        {hover
          ? (() => {
              const row = flows.find((f) => f.month === hover.month)
              const s = SERIES[hover.series]
              return row ? (
                <>
                  <span className="font-medium text-foreground">{monthLabel(row.month)}</span> ·{' '}
                  {s.label} <Money value={row[s.key]} className="text-foreground" />
                </>
              ) : null
            })()
          : 'Hover a column for its exact figure — every one of them is in the table below. Ticks are scale marks in CHF, not amounts.'}
      </p>

      <figcaption className="sr-only">
        Revenue and charges per month, for the months this book holds a movement in. The same
        figures are in the table that follows.
      </figcaption>

      {/* The table view — the WCAG-clean twin, and where every figure on this
          component actually comes from. */}
      <table className="mt-4 w-full text-[12.5px]">
        <caption className="sr-only">Revenue and charges per month</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="py-1.5 font-medium">Month</th>
            <th scope="col" className="py-1.5 text-right font-medium">Revenue</th>
            <th scope="col" className="py-1.5 text-right font-medium">Charges</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((f) => (
            <tr key={f.month} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-foreground">
                {monthLabel(f.month)}
              </th>
              <td className="py-1.5 text-right">
                <Money value={f.produits} bare />
              </td>
              <td className="py-1.5 text-right">
                <Money value={f.charges} bare />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">Amounts in CHF.</p>

      {gapped && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">A month is missing between these.</span> The
          series carries only months that hold a movement, and the columns are evenly spaced — so
          two neighbouring columns here are not always two consecutive months. Nothing has been
          drawn across the gap.
        </p>
      )}
    </figure>
  )
}
