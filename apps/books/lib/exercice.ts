// The fiscal years, and the fact `lib/scope.ts` used to throw away.
//
// ===========================================================================
// A CLOSED YEAR IS A LEGAL FACT AND IT WAS RENDERED AS NOTHING
// ===========================================================================
// `GET …/exercices` has always served `status`. `useScope` reduced the list to
// `number[]`, because it was written when nothing could close a year. `bk books
// exercice close` landed 2026-08-20 (PR #28) and **there is no reopen, ever, by
// design** — so "filed" and "still being worked in" became a distinction no
// screen in the product could make.
//
// ── IT IS A MODULE OF ITS OWN BECAUSE IT HAS TO BE TESTABLE ───────────────
// `lib/scope.ts` is `'use client'` and pulls in `next/navigation`; this app runs
// its tests in a `node` environment (`vitest.config.ts`). A reducer living
// inside the hook is a reducer nothing can assert on, and the interesting half
// of this one — what happens when two rows for one year disagree — is precisely
// the case a browser will not show you. Same arrangement as `lib/journal.ts`.

/** One fiscal year as `GET …/exercices` serves it, narrowed to what is used here. */
export interface ExerciceStatusRow {
  year: number
  status: 'open' | 'closed'
}

/**
 * Open, closed, or **not knowable**.
 *
 * `null` is not a default and it is not "open". It covers three real situations
 * — the years have not arrived, the book has none, and the disagreement below —
 * and a screen must test for `'closed'` rather than for `!== 'open'`, or it
 * marks an unknown year as filed.
 */
export type ExerciceStatus = 'open' | 'closed' | null

/** One year in the switcher, carrying the fact `number[]` dropped. */
export interface ExerciceOption {
  year: number
  status: ExerciceStatus
}

/**
 * The served rows, deduplicated by year and newest first.
 *
 * ── BOTH HALVES OF THAT ARE BUGS THAT HAPPENED (see `lib/scope.ts`) ────────
 * DEDUPED, because an UNSCOPED request returns one row per book per year: three
 * books sharing 2026 gave `[2026, 2026, 2026, 2025]`, rendered into a `<select>`
 * as four options, two indistinguishable, on duplicate React keys.
 *
 * NEWEST FIRST, because the caller's default used to take the LAST element on
 * the assumption the list was ascending. The route serves it descending, so the
 * app opened on a CLOSED exercice and would have shown every screen a year of
 * finished books by default.
 *
 * ── AND A YEAR WHOSE ROWS DISAGREE HAS NO STATUS ──────────────────────────
 * That is the whole reason this is not a two-line `map`. When the list is
 * unscoped, three books' 2026 rows fold into one option, and they need not have
 * all been closed. Taking the first row's status would be a **legal claim about
 * somebody's books, read off an array order** — the same class of mistake as
 * `lib/scope.ts`'s "an unknown slug is kept, not silently replaced". So the
 * answer is `null`: not knowable, and nothing may draw it as open.
 */
export function exerciceOptions(rows: readonly ExerciceStatusRow[] | undefined): ExerciceOption[] {
  const byYear = new Map<number, ExerciceStatus>()
  for (const row of rows ?? []) {
    if (!byYear.has(row.year)) byYear.set(row.year, row.status)
    else if (byYear.get(row.year) !== row.status) byYear.set(row.year, null)
  }
  return [...byYear.entries()]
    .map(([year, status]) => ({ year, status }))
    .sort((a, b) => b.year - a.year)
}

/**
 * The status of one year in that list.
 *
 * Returns `null` for a year the list does not contain, which is the state a
 * screen is in before the years arrive — and, again, is not "open".
 */
export function statusOf(options: readonly ExerciceOption[], year: number | null): ExerciceStatus {
  if (year === null) return null
  return options.find((o) => o.year === year)?.status ?? null
}
