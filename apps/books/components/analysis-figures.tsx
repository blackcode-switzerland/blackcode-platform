'use client'

// The filed snapshot, and the rule that makes the analyse detail worth having.
//
// ===========================================================================
// EVERY VALUE HERE IS RENDERED VERBATIM. NOT ONE OF THEM IS FORMATTED.
// ===========================================================================
// `GET …/analyses/{n}`'s own header: *"the `based_on` snapshot exactly as it was
// filed. **NEVER recomputed** — a stored answer that silently reflows is a
// different answer."*
//
// So a `value` never reaches `<Money>` and never reaches `amount()`. It is the
// agent's own text — `"CHF 5'175.00"`, `"−5'281.20 → −10'456.20"`,
// `"13.7 → 6.9 mois"`, `"15% → 4'500 × 1.15 = 5'175"` — and this component
// prints the string. That is not laziness about formatting; **re-grouping or
// re-rounding a filed figure is editing the record**, and the record is what a
// person would take to a fiduciary.
//
// It is also why `<Money>` would be actively wrong here even where a value looks
// like money: `money()` would turn `"≈ CHF 97'100"` into an em dash, because it
// is not a `numeric(14,2)` string and never was.
//
// ── THE `href` IS RECORDED, NOT NAVIGABLE ────────────────────────────────
// The seeded records carry `app-ledger.html?entity=blackcode&account=3400` —
// **the MOCKUP's addresses.** They are not routes in this app, and an agent
// filing one tomorrow may write anything at all: `books.analysis.based_on` is
// jsonb with no validation on this field. An `<a href>` here would offer a
// reader a destination this app cannot promise, which on the two seeded records
// is a 404 dressed as a working link. So it renders as what it is: a reference
// the agent recorded, in monospace, beside a line saying so.

import type { AnalysisFigure } from '@/lib/types'
import { en } from '@/lib/label'

export function FiguresTable({
  rows,
  dropped,
  /** `data-figures` / `data-based-on` — which of the two arrays this is. */
  kind,
}: {
  rows: AnalysisFigure[]
  dropped: number
  kind: 'figures' | 'based-on'
}) {
  const anyHref = rows.some((r) => r.href)

  return (
    <div data-analysis-rows={kind}>
      <dl className="divide-y divide-border border-y border-border">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-3 py-2">
            <dt className="text-[13px] text-muted-foreground">
              {en(row.label)}
              {row.href && (
                // Not a link. See the header.
                <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground/70">
                  {row.href}
                </span>
              )}
            </dt>
            {/* `tabular-nums` for column alignment, and nothing else: the text
                inside is the agent's, character for character. `data-filed`
                carries the same string for an agent reading the DOM, so a
                machine reads the record rather than a rendering of it. */}
            <dd
              className="text-right font-mono text-[13px] tabular-nums text-foreground"
              data-filed={row.value}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {anyHref && (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          The addresses under each label are what the agent recorded as its source. They are
          references on the record, not links — this app does not serve them and cannot promise
          where one points.
        </p>
      )}

      {/* ── A ROW THIS APP COULD NOT READ IS COUNTED, NOT SWALLOWED ──────
          A snapshot is the point of the record, so a partial one rendered as a
          whole one would make an answer look better-founded than it is. See
          `analysisRows` in `lib/analysis.ts`. */}
      {dropped > 0 && (
        <p role="alert" className="mt-1.5 text-[11.5px] text-destructive">
          {dropped} further {dropped === 1 ? 'row is' : 'rows are'} on this record and could not be
          read: {dropped === 1 ? 'it is' : 'they are'} missing a label or a value. Nothing was
          guessed and nothing was filled in. <span className="font-mono">bk books analyse show</span>{' '}
          prints the record as stored.
        </p>
      )}
    </div>
  )
}

/**
 * The empty case, which is TWO different facts and must not be one sentence.
 *
 * A record with no `based_on` at all is an answer whose inputs nobody wrote
 * down. A record whose rows this app could not read is a different problem with
 * a different owner. `hasSnapshot` is what tells them apart.
 */
export function NoSnapshotNotice({ present }: { present: boolean }) {
  return (
    <p className="rounded-md border border-border bg-secondary px-3 py-2 text-[12.5px] text-muted-foreground">
      {present ? (
        <>
          <span className="font-medium text-foreground">
            This record&apos;s snapshot could not be read.
          </span>{' '}
          The rows are on the record but none of them carries both a label and a value, so there is
          nothing this screen can show without inventing it.
        </>
      ) : (
        <>
          <span className="font-medium text-foreground">
            This answer was filed without a snapshot.
          </span>{' '}
          Nothing records what the agent read to produce it, so there is no way to tell what it
          rested on — or whether that has since changed. Analyses filed through{' '}
          <span className="font-mono">bk books analyse record</span> cannot be: the route refuses a{' '}
          <span className="font-mono">based_on</span> item with no label or value.
        </>
      )}
    </p>
  )
}
