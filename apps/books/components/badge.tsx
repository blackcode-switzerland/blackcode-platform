// `<Badge>` — the QUALIFIER chip, and the one level of the badge taxonomy that
// had no component.
//
// ===========================================================================
// THE FOUR LEVELS, AND WHY A FACT MAY ONLY BE DRAWN AT THE ONE IT EARNS
// ===========================================================================
// Scannability is not won by the page grid. It is won by whether a reader can
// tell, WITHOUT READING, that this row is unusual. Before 2026-08-21 this app
// had four badge-ish components and no stated system tying them together, so the
// same fact was loud on one screen and invisible on another.
//
//   1 · STATE      `<VocabChip>` / `<TermChip>` — filled, SERVED colour
//                  What the row IS: recognition state, evidence tier, entry
//                  status, source status, manifest state
//
//   2 · IDENTITY   `<EntityChip>` — outline, the book's own accent
//                  Which book, which legal form. `SA` / `RI`
//
//   3 · QUALIFIER  THIS FILE — quiet, neutral, no colour
//                  A true fact that is not the row's state: `VAT 8.1%`,
//                  `reversed`, `related party`, a count, a period
//
//   4 · ATTENTION  NOT A BADGE. A 3px leading rule on the row itself —
//                  `<DataTable>`'s `attention` prop, `<Section tone>` one level
//                  up. The row needs a human
//
// **Level 4 is deliberately not a badge, and that is the load-bearing part.**
// Badges say what something is; the leading rule says there is WORK here. Mixing
// them is why a worklist stops being scannable: if "needs a human" is a chip, it
// sits in a line of other chips and has to be read like the rest of them. As a
// rule on the edge of the row it is visible in peripheral vision, so the shape
// of the outstanding work is legible before a single word is.
//
// ── THE TWO CAPS ───────────────────────────────────────────────────────────
// A row carries **at most one level-1 badge and at most two level-3 chips.**
// Past that it stops being scannable and becomes a wall — which is the overview's
// current failure in miniature, and adding a taxonomy does not prevent it, it
// just makes it tidier. There is no guard: it is a review question, and the
// place to ask it is the busiest row of each screen.
//
// ── AND A BADGE IS NEVER A COLOUR THIS FILE INVENTED ───────────────────────
// Level 1 colours arrive from `GET /api/meta` with the value they belong to and
// level 2 from the book's own `accent`, so a state added on the server renders
// correctly with no frontend release (`components/chips.tsx` has the full
// argument). This level has NO colour at all, which is what keeps it from
// competing: a qualifier is a fact, not a signal.

import type { ReactNode } from 'react'

/** The pill shape, shared with `<VocabChip>` so the three levels sit on one line. */
const SHAPE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap'

export function Badge({
  children,
  title,
  className = '',
}: {
  /** Already translated, or a served value. Never a literal. */
  children: ReactNode
  /** The long form, where the short one is an abbreviation. */
  title?: string
  className?: string
}) {
  return (
    <span className={SHAPE + ' border-border bg-muted text-muted-foreground ' + className} title={title}>
      {children}
    </span>
  )
}

/**
 * A qualifier carrying a FIGURE — `VAT 8.1%`, `3 lines`, `115 entries`.
 *
 * The figure half is set in the mono face like every other figure in the app,
 * so a number inside a chip still reads as a number. Without this the chip is
 * the one place in the product where a figure is set in the prose face.
 */
export function FigureBadge({
  label,
  value,
  title,
  className = '',
}: {
  /** Already translated. */
  label: ReactNode
  value: ReactNode
  title?: string
  className?: string
}) {
  return (
    <span className={SHAPE + ' border-border bg-muted text-muted-foreground ' + className} title={title}>
      {label}
      <span className="figure font-medium text-foreground">{value}</span>
    </span>
  )
}
