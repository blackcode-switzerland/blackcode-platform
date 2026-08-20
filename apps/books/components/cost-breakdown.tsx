'use client'

// `<CostBreakdown>` — where the money goes, per management category.
//
// ===========================================================================
// A ZERO BUCKET IS A ROW
// ===========================================================================
// `autres` on blackcode is 0.00 across 0 lines; four of AIOS's five buckets
// are. All of them render. A breakdown that silently drops its empty buckets
// tells a reader the bucket does not exist — and the set of buckets is
// CONFIGURATION, not data, so its absence is a statement about the mapping
// rather than about the year. Same rule as the statutory zero lines, and the
// same rule `<StatementTable>` follows for the same reason.
//
// A zero row draws no bar, deliberately: a 1px mark and no mark are the same
// pixel and the reader cannot tell which they are looking at. What says "zero"
// is the figure — `CHF 0.00`, off the wire — and the line count beside it.
//
// ===========================================================================
// EVERY BAR IS ONE COLOUR, AND THE MOCKUP'S RAINBOW IS REFUSED TWICE
// ===========================================================================
// `app-analytique.html` gives each category its own hue out of a five-slot
// palette, with a sixth reserved for `autres` and `__none`. Both halves are
// wrong here, and for two independent reasons — which is what makes this a
// decision rather than a preference:
//
//   1. **The `dataviz` skill:** these categories are nominal and there is one
//      measure, so colouring each bar differently is a value-ramp on nominal
//      categories — it double-encodes the length as hue and burns the only
//      free channel on information the chart already shows. One series, one
//      colour, for every bar.
//   2. **The phase brief:** "never a colour keyed to a slug you know today."
//      `c.key === 'autres'` is exactly that. Categories are SERVED, a new one
//      must render with no frontend release, and the mockup's rule would give
//      a book whose residual bucket is called `divers` the wrong treatment
//      silently.
//
// The hue is `--chart-2` — the same one charges wear in `<FlowsChart>` above,
// because it is the same measure seen a second way. Colour follows the entity,
// never its rank.
//
// ===========================================================================
// A LINE LINKS INTO THE LEDGER ONLY WHERE THAT ADDRESS IS THIS BOOK'S
// ===========================================================================
// `line.number` is a `seq`, and **the two journals have separate counters that
// collide.** Verified against the seeded workspace on 2026-08-19, by running it
// rather than by reading it:
//
//     GET …/entries/3            → blackcode's rent écriture, IMMOREGIE SA
//     GET …/entries/3?entity=ri  → the RI's AVS instalment, Caisse de comp. VD
//
// `useEntry` sends no `?entity=`, so `/ledger/{n}` asks the grand livre first
// and a link from a simplified book's breakdown would open another company's
// record under this book's heading — this app's worst failure mode, and the
// same shape as ticket #51 and #53. So a simplified book's lines are FACTS
// here, not links, which is the rule `<RecettesDepenses>` already applies on
// the ledger screen. Making them reachable is a one-line change to `useEntry`
// plus the entry screen's heading, and it belongs to that screen rather than
// to this one; it is in the phase-4B report.

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Money } from './money'
import { DateText } from './date-text'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import { scopedHref } from '@/lib/nav'
import { accountsLabel, barLength, isZeroAmount, maxAmount, share } from '@/lib/analytique'
import type { Journal } from '@/lib/journal'
import type { AnalytiqueCategory } from '@/lib/types'

/** The single hue every bar wears. See the header. */
const BAR = 'var(--chart-2)'
/**
 * A net-refunded bucket, drawn on the other side of the baseline.
 *
 * `--destructive` rather than a fifth chart hue: a negative here is not another
 * category, it is the same category pointing the other way, and giving it a
 * series colour would read as one more thing on the legend. It is also rare —
 * a reversing entry — so it should look like an exception, not a sixth slot.
 */
const NEGATIVE_BAR = 'var(--destructive)'

export function CostBreakdown({
  categories,
  total,
  base,
  scope,
  journal,
}: {
  categories: AnalytiqueCategory[]
  /** The exact sum of the buckets, from `breakdownTotal`. Never re-added here. */
  total: string
  base: string
  scope: { entity: string | null; exercice: number | null }
  /** The book's journal. Decides whether a line's #number is an address. */
  journal: Journal | null
}) {
  const t = useT()
  const label = useLabel()
  const [open, setOpen] = useState<string | null>(null)

  if (categories.length === 0) {
    // ── THE RECOVERY DEPENDS ON THE BOOK, AND ONE OF THEM HAS NONE ──────────
    // This told every empty book to run `bk books category create`. That command
    // **refuses a simplified book unconditionally** (exit 6), so a reader of the
    // RI book was given a paragraph about ledger accounts it does not have and a
    // command that cannot work for it — a dead end naming an exit that is not
    // there, which is the one thing `hintFor()` and the `suggestion` convention
    // exist to prevent.
    //
    // The page knows the regime; it was asking the data instead. Found by the
    // phase-4B review, 2026-08-19.
    if (journal === 'recettes_depenses') {
      return (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t('cost.emptyRi')}
        </p>
      )
    }
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {t('cost.emptyChart', { command: 'bk books category create' })}
      </p>
    )
  }

  // The ceiling is the largest bucket, so the widest bar fills the track. Not
  // the total: against a total, four small buckets would all be slivers.
  const ceiling = maxAmount(categories.map((c) => c.amount))

  return (
    <div>
      <ul className="divide-y divide-border/60">
        {categories.map((c) => {
          const zero = isZeroAmount(c.amount)
          const pct = share(c.amount, total)
          const isOpen = open === c.key
          return (
            <li key={c.key} className="py-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 sm:grid-cols-[minmax(9rem,15rem)_minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <span className={`text-[12.5px] ${zero ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {/* `en()` falls back to the French when a label has no
                        English half. A simplified book's bucket label is the
                        movement's own `category` jsonb and may genuinely be
                        French-only; the fallback is the label, never a blank. */}
                    {label(c.label) || c.key}
                  </span>
                  {/* Through `accountsLabel`, not an inline guard: null here is
                      an RI book, and the review showed that dropping the check
                      plus loosening the type is two edits that leave every gate
                      green and white-screen that book. A pure function is
                      something a test can hold. */}
                  {accountsLabel(c.accounts) && (
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {accountsLabel(c.accounts)}
                    </span>
                  )}
                </div>

                {/* The bar. Order-2 on a phone so the label and the figure sit
                    on one line and the track gets the full width below. */}
                <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                  {/* ── A NEGATIVE DRAWS FROM THE MIDDLE, LEFTWARD ──────────
                      `barLength` is SIGNED. A negative bucket is a net refund —
                      a reversing entry, which is how corrections work in this
                      product — and it drew as a positive bar until 2026-08-19,
                      identical to a small cost. The track carries a baseline and
                      the bar grows from it in the direction of the sign, so the
                      mark agrees with the figure printed beside it. */}
                  {(() => {
                    const len = barLength(c.amount, ceiling)
                    const negative = len < 0
                    return (
                      <div className="relative h-2.5 w-full rounded-[3px] bg-secondary">
                        {negative && (
                          <span
                            className="absolute inset-y-0 left-1/2 w-px bg-border"
                            aria-hidden
                          />
                        )}
                        <div
                          className="absolute inset-y-0 rounded-[3px]"
                          style={
                            negative
                              ? {
                                  right: '50%',
                                  width: `${Math.min(50, Math.abs(len) / 2)}%`,
                                  backgroundColor: NEGATIVE_BAR,
                                }
                              : { left: 0, width: `${len}%`, backgroundColor: BAR }
                          }
                          aria-hidden
                        />
                      </div>
                    )
                  })()}
                </div>

                <div className="shrink-0 text-right">
                  {/* Off the wire, through `<Money>`. Nothing on this row was
                      parsed except the bar's width, which is not printed. */}
                  <Money value={c.amount} bare className="text-[12.5px] font-medium" />
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {pct === null ? '—' : `${pct}%`}
                  </span>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {c.lines.length === 0
                    ? t('cost.noPostings')
                    : t(c.lines.length === 1 ? 'cost.linesOne' : 'cost.linesMany', {
                        n: c.lines.length,
                      })}
                </span>
                {c.lines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : c.key)}
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-0.5 rounded text-[11px] text-primary-strong hover:underline"
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {isOpen ? t('cost.hide') : t('cost.detail')}
                  </button>
                )}
              </div>

              {isOpen && (
                <ul className="mt-1.5 space-y-1 rounded-md bg-secondary/60 px-3 py-2">
                  {c.lines.map((l, i) => (
                    <li
                      key={`${l.number}-${l.account}-${i}`}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 text-[12px]"
                    >
                      <DateText value={l.date} />
                      <span className="min-w-0 truncate text-muted-foreground">
                        {l.counterparty || '—'}
                        {/* `""` on a simplified book — an RI movement has no
                            chart account, so there is nothing to name. */}
                        {l.account && (
                          <span className="ml-2 font-mono text-[11px]">{l.account}</span>
                        )}
                      </span>
                      <span className="whitespace-nowrap text-right">
                        <Money value={l.amount} bare />
                        {journal === 'grand_livre' ? (
                          <Link
                            href={scopedHref(base, `/ledger/${l.number}`, scope)}
                            className="ml-2 text-[11px] text-primary-strong hover:underline"
                          >
                            #{l.number}
                          </Link>
                        ) : (
                          // Not a link. See the header: this #number also names
                          // an écriture in the grand livre, and `/ledger/{n}`
                          // would open that one.
                          <span className="ml-2 text-[11px] text-muted-foreground">#{l.number}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-[12.5px] font-medium text-foreground">{t('cost.total')}</span>
        <Money value={total} className="text-[12.5px] font-semibold" />
      </div>
    </div>
  )
}
