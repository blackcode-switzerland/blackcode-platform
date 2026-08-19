'use client'

// "Has this answer gone stale?" — asked honestly, which mostly means saying what
// this app cannot ask.
//
// ===========================================================================
// THE COMPARISON THE MOCKUP MAKES IS NOT AVAILABLE ON THIS WIRE
// ===========================================================================
// `app-analyses.html` computes `D.analysisDrift(a)`: it reads
// `a.metrics.revenue_monthly`, `a.metrics.burn_monthly.before` and
// `a.metrics.cash_chf` — three NUMBERS stored beside the answer — derives the
// same three live, and flags any that has moved more than 5%.
//
// **`metrics` is not a column and is not on the wire.** `publicAnalysis` serves
// `figures` and `based_on`, and both are arrays of `{label, value}` where the
// value is text the agent wrote: `"CHF 1'806.67"`, `"≈ CHF 97'100"`,
// `"15% → 4'500 × 1.15 = 5'175"`. There is no key from a label to a figure this
// app serves, and the `href` beside it addresses the mockup.
//
// So a label→figure mapping would be a GUESS, and a guess that quietly put a
// fresh number where a filed one had been is precisely what the route forbids:
// *"a stored answer that silently reflows is a different answer."* This
// component therefore recomputes nothing, and says so first.
//
// ===========================================================================
// WHAT IT DOES ASK, AND IT SAYS THAT TOO
// ===========================================================================
// CLAUDE.md's rule for a negative — *"say what question your command actually
// asked, and check that it is the question you are answering"* — applies to a
// screen exactly as it applies to a report. Two facts about the BOOK, neither of
// them a figure from above:
//
//   dated on or after   entries in the served exercice whose DATE is on or
//                       after the filing day. A booking date is when the money
//                       moved, **not** when the row was written — `publicEntry`
//                       carries no `created_at` — so this is a sufficient signal
//                       that the books have moved and not a necessary one. An
//                       entry back-dated into January and typed in September is
//                       invisible to it, and the copy says so.
//   staged              entries counting in nothing today. Not a change since
//                       the answer — a fact about the book now — and it matters
//                       because every derived figure an answer rests on excludes
//                       them.
//
// A simplified book gets ONE of those two: `books.ri_entry` has no `status`
// column at all, so there is nothing to exclude and claiming otherwise would
// describe a distinction that book does not have. Same rule the management view
// follows for its own disclosure.

import type { BookToday } from '@/lib/analysis'
import type { Journal } from '@/lib/journal'
import { date as formatDate } from '@/lib/format'

export function BookTodayNotice({
  asked,
  today,
  exercice,
  journal,
  /** Are the entries still in flight? A silent nothing would read as "clean". */
  loading,
}: {
  asked: string
  today: BookToday | null
  exercice: number | null
  journal: Journal | null
  loading: boolean
}) {
  return (
    <section className="rounded-lg border border-border bg-secondary px-3.5 py-3" data-book-today>
      <h2 className="text-[12.5px] font-medium text-foreground">
        Nothing above was recalculated.
      </h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Every figure on this page is the text the agent filed with its answer. This app does not
        recompute one and cannot: a filed value is prose with numbers in it, and nothing on the
        record says which figure this app serves it came from. A fresh answer means asking the
        agent again, outside this app — the record stands either way.
      </p>

      {loading && (
        <p className="mt-2 text-[12px] text-muted-foreground" role="status">
          Checking what the book holds today…
        </p>
      )}

      {/* ── THE CHECK COULD NOT RUN, AND THAT IS NOT "NOTHING MOVED" ─────
          `examined === 0` means the entries read served no rows — a book with
          none, a year with none, or a journal this screen did not fetch. An
          absence is only evidence if the instrument could have seen the
          presence, so it is reported as an absence of evidence. */}
      {!loading && (today === null || today.examined === 0) && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">
            This screen could not look at the book.
          </span>{' '}
          No entries were served for {exercice ?? 'the selected year'}, so nothing was compared —
          which is not the same as nothing having changed.
        </p>
      )}

      {!loading && today !== null && today.examined > 0 && (
        <>
          <p className="mt-2.5 text-[12px] text-muted-foreground">
            What it can check is the book. Of the{' '}
            <span className="text-foreground">{today.examined}</span>{' '}
            {today.examined === 1 ? 'entry' : 'entries'} it serves for{' '}
            <span className="text-foreground">{exercice ?? 'this year'}</span>:
          </p>
          <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
            <li data-check="dated-on-or-after">
              <span className="font-medium text-foreground">{today.datedOnOrAfter}</span>{' '}
              {today.datedOnOrAfter === 1 ? 'is' : 'are'} dated on or after{' '}
              <span className="text-foreground">{formatDate(asked)}</span>, the day this answer was
              filed.
            </li>
            {/* POSITIVE, and only for the journal that has the concept. */}
            {journal === 'grand_livre' && (
              <li data-check="staged">
                <span className="font-medium text-foreground">{today.staged}</span>{' '}
                {today.staged === 1 ? 'is' : 'are'} staged — recorded, and counting in nothing. The
                balance sheet, the income statement and every derived figure exclude them.
              </li>
            )}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Neither line is a recomputation of anything above, and neither is a verdict on this
            answer. A booking date is when the money moved rather than when the row was written, so
            an entry back-dated into an earlier month is invisible to the first one.
            {journal === 'recettes_depenses' && (
              <>
                {' '}
                This book keeps recettes-dépenses, which has no posting status, so there is no
                staged count to give.
              </>
            )}
          </p>
        </>
      )}
    </section>
  )
}
