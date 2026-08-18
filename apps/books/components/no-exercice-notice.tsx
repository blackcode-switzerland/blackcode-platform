'use client'

// `<NoExerciceNotice>` — a book that has no fiscal year yet, said calmly.
//
// ===========================================================================
// THIS IS THE FIRST STATE OF EVERY BOOK, NOT A FAILURE
// ===========================================================================
// `bk books entity create` opens no exercice. So the moment anybody creates a
// book, every statement screen asks for a year that does not exist and the route
// answers `bad_scope`. Rendered through `<ErrorState>` that came out as a red
// `role="alert"` box reading "The balance sheet could not be derived", over a
// book in perfect order that is simply one step from finished.
//
// The overview already had this right on the same data — "No fiscal year is open
// yet, so there is nothing to derive. A book gets its accounts when it is
// created; the exercice is a second step." The statement screens did not, and
// F2 of the phase-1 review caught the mismatch.
//
// It is the same rule the RI refusal is built on and the spec states outright:
// **a red error box is wrong when nothing failed.** That case was handled and
// this sibling was missed, which is why they now sit beside each other in this
// directory rather than one being a special case inside the other.
//
// `bad_scope` is the server's machine code and never reaches the reader; the
// server's own `suggestion` does, under "From the terminal", because creating an
// exercice is a CLI act today and a dead end has to name its own exit.

import { CalendarPlus } from 'lucide-react'
import type { ApiRequestError } from '@/lib/client'

export function NoExerciceNotice({
  error,
  /** What was asked for: `balance sheet`, `income statement`. */
  statement,
  bookName,
}: {
  error: ApiRequestError
  statement: string
  bookName: string | undefined
}) {
  return (
    <section className="rounded-lg border border-border bg-secondary px-4 py-4" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <CalendarPlus size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            {bookName ?? 'This book'} has no fiscal year open yet.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            There is nothing to derive, so there is no {statement} to show. A book gets its
            chart of accounts when it is created; opening an exercice is a second step, and
            every book starts here.
          </p>
          {error.suggestion && (
            <p className="mt-3 border-t border-border pt-2 text-[12px] text-muted-foreground">
              From the terminal: {error.suggestion}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * Is this refusal "no exercice", rather than a real failure?
 *
 * Matched on the server's `code`, not on its prose. The message names the book
 * and will be reworded; `bad_scope` is a contract. It is deliberately narrow —
 * `bad_scope` also covers an unknown book, which `<ScreenFrame>` catches before
 * a statement screen ever renders, so the remaining case here is the year.
 */
export function isNoExerciceRefusal(error: unknown): error is ApiRequestError {
  const e = error as { code?: string; message?: string } | null
  return e?.code === 'bad_scope' && /exercice/i.test(e?.message ?? '')
}
