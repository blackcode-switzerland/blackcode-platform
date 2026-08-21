// `<Stat>` and `<StatRow>` — the figures a screen is ABOUT, lifted out of the
// prose that currently hides them.
//
// ===========================================================================
// A STAT IS NOT A DASHBOARD TILE
// ===========================================================================
// The pattern this replaces is real and specific: the overview renders
// `TOTAL ACTIF 72'850.00` as a label above a value inside a card that also holds
// seven other labels above values, so the figure a person opened the page for
// has the same weight as the book's postal address. Every screen in this app has
// a version of that.
//
// The test for whether a figure belongs here is narrow: **would the reader have
// opened this screen to see it?** Total actif, the result of the exercice, how
// many entries need a human — yes. The legal form, the VAT status, the address —
// no, those are facts about the book and they belong in a table row or a field
// list. A stat row with six tiles in it has stopped being a stat row.
//
// ── `basis` IS THE PART THAT MAKES THIS HONEST ─────────────────────────────
// Any figure this app computes rather than reads has to be able to say what it
// was computed from. `<RunFigures>` is the precedent and the whole reason it is
// trustworthy: it shows three figures it CAN derive and names what it cannot,
// instead of inventing a runway. A `<Stat>` with a derived value and no `basis`
// is the same claim without the disclosure.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────
// `value` is a `ReactNode`, and in practice it is a `<Money>`. It is deliberately
// NOT `string | number`: a `number` here would invite `Number(row.amount)` at the
// call site, and a float cannot hold a `numeric(14,2)`. The prop type is the
// same guard `<Money>` uses one layer down.

import type { ReactNode } from 'react'

export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={
        // ── AUTO-FIT, NOT A FIXED COLUMN COUNT ──────────────────────────────
        // `lg:grid-cols-4` left an EMPTY CELL whenever a row had three stats,
        // and because the gap is drawn by the container's background showing
        // through (`gap-px` over `bg-border`), that empty cell rendered as a
        // grey block on the right of the strip. It read as a figure that had
        // failed to load, which on an accounting screen is the worst thing a
        // blank can be mistaken for.
        //
        // Several of these rows are conditional — the ledger drops the neutral
        // tile when there are no neutral movements — so the count genuinely
        // varies at runtime and cannot be declared.
        'mb-4 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-border ' +
        className
      }
    >
      {children}
    </div>
  )
}

export function Stat({
  caption,
  value,
  basis,
  emphasis = false,
  tone = 'default',
}: {
  /** What the figure is. Already translated. Small caps. */
  caption: ReactNode
  /** Almost always a `<Money>`. Never a raw number — see the header. */
  value: ReactNode
  /** What it was computed from, or as of when. Already translated. */
  basis?: ReactNode
  /**
   * The one figure this screen exists for. At most ONE per row — the accent is
   * how the eye finds the headline, and two headlines is none.
   */
  emphasis?: boolean
  tone?: 'default' | 'attention'
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {caption}
      </p>
      <p
        className={
          'mt-1 figure text-[19px] leading-tight ' +
          (emphasis || tone === 'attention'
            ? 'font-medium text-primary-strong '
            : 'text-foreground ')
        }
      >
        {value}
      </p>
      {basis ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{basis}</p>
      ) : null}
    </div>
  )
}
