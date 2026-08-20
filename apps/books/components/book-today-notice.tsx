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

'use client'

import type { BookToday } from '@/lib/analysis'
import { useT } from '@/lib/i18n'
import type { Journal } from '@/lib/journal'
import { date as formatDate } from '@/lib/format'

export function BookTodayNotice({
  asked,
  today,
  exercice,
  /** The book these counts describe — NOT necessarily the record's. */
  book,
  journal,
  /** Are the entries still in flight? A silent nothing would read as "clean". */
  loading,
}: {
  asked: string
  today: BookToday | null
  exercice: number | null
  book: string | null
  journal: Journal | null
  loading: boolean
}) {
  const t = useT()
  return (
    <section className="rounded-lg border border-border bg-secondary px-3.5 py-3" data-book-today>
      <h2 className="text-[12.5px] font-medium text-foreground">{t('today.title')}</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">{t('today.body')}</p>

      {loading && (
        <p className="mt-2 text-[12px] text-muted-foreground" role="status">
          {t('today.checking')}
        </p>
      )}

      {/* ── THE CHECK COULD NOT RUN, AND THAT IS NOT "NOTHING MOVED" ─────
          `examined === 0` means the entries read served no rows — a book with
          none, a year with none, or a journal this screen did not fetch. An
          absence is only evidence if the instrument could have seen the
          presence, so it is reported as an absence of evidence. */}
      {!loading && (today === null || today.examined === 0) && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground">{t('today.couldNotLookLead')}</span>{' '}
          {t('today.couldNotLookBody', { year: exercice ?? t('today.selectedYear') })}
        </p>
      )}

      {!loading && today !== null && today.examined > 0 && (
        <>
          <p className="mt-2.5 text-[12px] text-muted-foreground">
            {/* ── IT NAMES ITS BOOK, SINCE 2026-08-19 ────────────────────────
                "the book" was whichever book the URL selected, while the record
                above belongs to `record.entity` — and `getAnalysis` resolves on
                `(workspace_id, seq)` without filtering by book. So
                `/analyses/1?entity=aios` reported AIOS's entry counts directly
                beneath a blackcode record, with nothing saying they were about
                different books. The page knows they differ; this paragraph did
                not say so. Found by the phase-5 review. */}
            {t(
              today.examined === 1 ? 'today.whatItCanCheckOne' : 'today.whatItCanCheckMany',
              {
                book: book ?? t('today.theSelectedBook'),
                n: today.examined,
                year: exercice ?? t('today.thisYear'),
              }
            )}
          </p>
          <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
            <li data-check="dated-on-or-after">
              {t(today.datedOnOrAfter === 1 ? 'today.datedOne' : 'today.datedMany', {
                n: today.datedOnOrAfter,
                date: formatDate(asked),
              })}
            </li>
            {/* POSITIVE, and only for the journal that has the concept. */}
            {journal === 'grand_livre' && (
              <li data-check="staged">
                {t(today.staged === 1 ? 'today.stagedOne' : 'today.stagedMany', {
                  n: today.staged,
                })}
              </li>
            )}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {t('today.caveat')}
            {journal === 'recettes_depenses' && <> {t('today.riNoStaged')}</>}
          </p>
        </>
      )}
    </section>
  )
}
