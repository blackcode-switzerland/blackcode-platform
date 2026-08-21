// `<Field>` / `<FieldGrid>` — the label-above-value pattern, kept where it is
// right and made dense.
//
// ===========================================================================
// THIS PATTERN IS NOT THE PROBLEM. USING IT FOR A LIST IS
// ===========================================================================
// The 2026-08-21 refresh turns most of this app's label-above-value blocks into
// TABLE ROWS, because when the same eight fields repeat per book, per source or
// per pièce, a table is how a reader compares them and a stack of field grids is
// how a reader gives up. The overview is the clearest case: three books × eight
// stacked fields, where the mockup has three rows.
//
// **But a table of one row is not a table.** On a DETAIL screen — one entry, one
// source, one analyse — there is nothing to compare downward, and a field list
// is exactly right: it is an identity card, and the mockup uses one there too
// (`.cl-idcard`).
//
// So the rule is about cardinality, not taste:
//
//   many of a thing, same fields   → `<DataTable>`
//   one thing, its own facts       → `<FieldGrid>`
//
// ── THE LABEL COLUMN IS FIXED-WIDTH, AND THAT IS THE WHOLE POINT ───────────
// The mockup pins its label column at 138px so every value in the card starts at
// the same x. A label column that sizes to its content puts each value at a
// different indent, and the reader's eye has to re-find the value column on
// every row — which is the same failure as a ragged column of amounts, one axis
// over.

import type { ReactNode } from 'react'

export function FieldGrid({
  children,
  columns = 1,
  className = '',
}: {
  children: ReactNode
  /**
   * How many field COLUMNS side by side. Two is the useful maximum on a detail
   * page: three puts the third value against the right edge of a wide card,
   * where it reads as unrelated to its own label.
   */
  columns?: 1 | 2
  className?: string
}) {
  return (
    <dl
      className={
        'grid gap-x-8 gap-y-2.5 ' + (columns === 2 ? 'sm:grid-cols-2 ' : '') + className
      }
    >
      {children}
    </dl>
  )
}

export function Field({
  label,
  children,
  figure = false,
}: {
  /** Already translated. */
  label: ReactNode
  children: ReactNode
  /**
   * Set the value in the mono face. Any figure, id, date, account number or
   * checksum — the same split the tables use, so a detail page and a listing
   * agree about what a figure looks like.
   */
  figure?: boolean
}) {
  return (
    <div className="flex gap-3 text-[13px] leading-relaxed">
      <dt className="w-[132px] shrink-0 pt-[1px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </dt>
      <dd className={'min-w-0 text-foreground ' + (figure ? 'figure ' : '')}>{children}</dd>
    </div>
  )
}
