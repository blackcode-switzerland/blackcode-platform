'use client'

// `<HistoryTrail>` — what a record WAS, which this product claims is forever.
//
// ===========================================================================
// THE AUDIT TRAIL IS THE CLAIM. RENDERING IT BLANK IS THE WORST FAILURE HERE.
// ===========================================================================
// b/books' argument is audit defensibility: a resolved entry still shows that it
// arrived unrecognized, and what somebody decided it meant. `resolveEntry` writes
// that into `history` in the same transaction as the change, BEFORE anything is
// overwritten, and never removes an element. If the screen cannot draw it, the
// database is keeping a record nobody can read.
//
// ── AND THAT IS EXACTLY WHAT WAS HAPPENING ────────────────────────────────
// `app/dashboard/[ws]/ledger/[number]/page.tsx` rendered `{en(entry.history)}`,
// because `lib/types.ts` declared `history: Label | null`. The value
// `resolveEntry` actually writes is an ARRAY. `en()` looks for `.en`, then
// `.fr`, finds neither on an array, and returns `''` — so the block was truthy,
// rendered, and drew NOTHING. Every entry resolved through the new write path
// would have shown an empty audit trail, with no error and nothing in a log.
// Found 2026-08-18 by reading `resolve.ts` against the type. Both are fixed:
// `EntryHistory` is a union now and this component handles all three arms.
//
// ── THREE SHAPES, BECAUSE THREE THINGS HAVE WRITTEN THIS COLUMN ───────────
//
//   null              never resolved. Most rows. Renders NOTHING — see below.
//   {fr, en}          the seed's narrative sentence. An object, not a list.
//   HistoryEvent[]    the append-only log. `resolveEntry` keeps a pre-existing
//                     non-array as element 0 rather than replacing it, so a
//                     seeded row that gets resolved has BOTH arms in one array.
//
// ── NULL RENDERS NOTHING, AND THAT IS NOT A FALSY FALLBACK ────────────────
// The rule is that `undefined` must look broken rather than look like `false` or
// `0`. A null `history` is not a value this component failed to find: the column
// is nullable and "this row has never been changed" is a fact, not an absence.
// It is the CALLER that decides whether to say so — `hasHistory()` is exported
// for exactly that, so a caller which needs to distinguish "no history" from
// "history we could not draw" can, and neither is ever guessed at here.

import { en } from '@/lib/label'
import { date as formatDate } from '@/lib/format'
import { TermChip } from './chips'
import { findTerm, useMeta } from '@/lib/hooks'
import type { EntryHistory, HistoryEvent } from '@/lib/types'

/** Is this the append-only log rather than the seed's narrative object? */
function isEventList(h: EntryHistory): h is HistoryEvent[] {
  return Array.isArray(h)
}

/**
 * Does this row carry any provenance at all?
 *
 * Exported so a caller can render its own heading — or its own "never changed" —
 * without reimplementing the union. An EMPTY array counts as no history: it is
 * what a row looks like after somebody cleared the column by hand, and drawing a
 * heading over nothing reads as a rendering failure.
 */
export function hasHistory(history: EntryHistory): boolean {
  if (history === null || history === undefined) return false
  if (isEventList(history)) return history.length > 0
  return Boolean(en(history))
}

/**
 * An ISO instant as a readable moment: `18.08.2026 11:00`.
 *
 * `history.at` is the ONE timestamp in this app — every other date is a
 * Postgres `date` with no time of day, which is why `lib/format.ts`'s `date()`
 * refuses to construct a `Date` and this does not construct one either. The
 * string is sliced, so nothing shifts across a timezone: the value is already
 * UTC and is labelled as such rather than being quietly localised into a
 * different day.
 */
function instant(at: string | null | undefined): string {
  if (!at || at.length < 16) return '—'
  return `${formatDate(at.slice(0, 10))} ${at.slice(11, 16)} UTC`
}

export function HistoryTrail({ history }: { history: EntryHistory }) {
  const { data: meta } = useMeta()

  if (!hasHistory(history)) return null

  // The seed's narrative object: one sentence, and it is prose rather than a
  // structured event. Shown as what it is.
  if (!isEventList(history)) {
    return (
      <div className="mt-2 border-l-2 border-border pl-3">
        <p className="text-[12px] text-muted-foreground">{en(history)}</p>
      </div>
    )
  }

  return (
    <ol className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
      {history.map((event, i) => {
        // `resolveEntry` keeps a pre-existing NON-ARRAY history as element 0, so
        // an array can legitimately contain the seed's `{fr, en}` object. It has
        // no `.was`, and reading `event.was.recognition` off it would throw and
        // take the whole screen down with it.
        const structured = event && typeof event === 'object' && 'was' in event && event.was
        if (!structured) {
          const prose = en(event as unknown as { fr: string; en: string })
          return prose ? (
            <li key={i} className="text-[12px] text-muted-foreground">
              {prose}
            </li>
          ) : null
        }
        const was = event.was

        // ── A VERDICT EVENT CARRIES A DIFFERENT `was`, AND THIS KNEW ONE ──────
        // `appendHistory` writes `{was: {verdict}}` for a compliance verdict and
        // `{was: {recognition, explanation, counterparty}}` for a resolution.
        // This block read `was.recognition` unconditionally, so replacing a
        // verdict — filing `blocked` and then `accepted_with_warning` on the same
        // entry — printed `was · verdict 13:52 UTC` **with the value missing**.
        //
        // The screen showed only the second verdict and the trail showed neither,
        // so a replaced verdict was invisible on both. `bk books verdict --help`
        // promises the old one stays in history; it does stay in the column, and
        // this is the surface that was not reading it. Found by the phase-5
        // review, 2026-08-19.
        //
        // Branching on what the event HAS rather than on `event.event`, because a
        // sixth event kind should render its own shape or nothing — never another
        // kind's field read off an object that does not have it.
        if (was && typeof was === 'object' && 'verdict' in was) {
          const previous = (was as { verdict: unknown }).verdict as
            | { verdict?: string }
            | null
            | undefined
          return (
            <li key={i} className="text-[12px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">was</span>
                {previous?.verdict ? (
                  <TermChip
                    term={findTerm(meta, 'verdict_states', previous.verdict)}
                    value={previous.verdict}
                  />
                ) : (
                  // Never checked is not "clean", and it is the commonest prior
                  // state — every entry starts here.
                  <span className="text-muted-foreground italic">never checked</span>
                )}
                <span className="text-muted-foreground">
                  · {event.event} {instant(event.at)}
                </span>
              </div>
            </li>
          )
        }

        return (
          <li key={i} className="text-[12px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">was</span>
              <TermChip
                term={findTerm(meta, 'recognition', was.recognition)}
                value={was.recognition}
              />
              <span className="text-muted-foreground">
                · {event.event} {instant(event.at)}
              </span>
            </div>
            {/* The PREVIOUS explanation, which is the part an auditor reads:
                what somebody used to believe this money was. A row whose old
                explanation was null shows nothing here rather than an em dash —
                "it had no explanation" is why it was on the worklist. */}
            {en(was.explanation) && (
              <p className="mt-0.5 text-muted-foreground">“{en(was.explanation)}”</p>
            )}
            {was.counterparty && (
              <p className="mt-0.5 text-muted-foreground">counterparty: {was.counterparty}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
