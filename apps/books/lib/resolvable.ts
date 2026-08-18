// WHICH WORKLIST ROWS MAY REACH THE RESOLVE WRITE. One function, tested.
//
// ===========================================================================
// THIS EXISTS BECAUSE THE BRANCH THAT USED TO DECIDE IT WENT WRONG SILENTLY
// ===========================================================================
// `GET …/worklist` merges three tables into one list, and all three keep
// SEPARATE `seq` counters. `POST /entries/{n}/resolve` addresses `books.entry`
// ONLY. So a row of any other kind, resolved by its #number, rewrites whatever
// journal entry happens to carry that number — and answers 200. Reproduced
// 2026-08-18: RI #5 (TWINT *8842, 120.00) → `books.entry` #5, the January
// payroll, in a different book. Ticket #51.
//
// `<WorklistRows>` used to decide this inline, as
// `row.kind === 'ri_entry' ? readOnly : resolveForm`. That was EXHAUSTIVE while
// there were two kinds and correct on the day it was written. Phase 3's backend
// added `kind: 'piece'`; six pièce rows fell into the else, each rendered
// "Explain this", and pressing it would have POSTed
// `/entries/{piece.number}/resolve`. Pièce #1 rewriting journal entry #1.
//
// **Nothing was written wrong. A correct backend change retargeted a correct
// branch** — CLAUDE.md finding #10's mechanism. `npm run typecheck` was red on
// `_WorklistKeys` in `lib/wire-parity.test.ts` for the whole merge, and nobody
// read it; the `row as ResolvableRow` cast at the call site is what kept the
// compiler quiet at the line that mattered.
//
// ── WHY A FUNCTION AND NOT A TIDIER TERNARY ──────────────────────────────
// A ternary inside a 350-line component can only be checked by scanning the
// file as text, and `lib/dashboard-paths.test.ts` in apps/issues is on record
// twice for what text scanning is worth: the granularity of the scan is part of
// what it checks, and both of its first two versions passed against code that
// did the wrong thing.
//
// A function can be CALLED, over every member of the union, by a test that
// fails to compile when the union grows. That is the difference between a guard
// that reads right and a guard that has been watched go red.

import type { WorklistRow } from './types'

/** A row `POST /entries/{n}/resolve` may safely address. */
export type ResolvableRow = WorklistRow & { kind: 'entry' }

/**
 * May this row reach the resolve write?
 *
 * **POSITIVE and enumerated.** `kind === 'entry'`, never `!== something`. A
 * fourth kind added on the server is then a rendering nobody wrote — the row
 * gets the read-only explanation — and never a write nobody meant.
 */
export function isResolvable(row: WorklistRow): row is ResolvableRow {
  return row.kind === 'entry'
}

/**
 * Every kind the worklist serves, for a test to iterate.
 *
 * ── IT IS TYPED SO THE UNION CANNOT OUTGROW IT ───────────────────────────
 * `readonly WorklistRow['kind'][]` alone would let a new member be forgotten
 * here and leave the test passing over a smaller set — the vacuous shape this
 * whole module exists to avoid. The `Exhaustive` alias below fails to compile
 * unless every member of the union appears, so adding a kind to `lib/types.ts`
 * without adding it here is a build error rather than an untested branch.
 */
type Exhaustive<T extends readonly WorklistRow['kind'][]> =
  WorklistRow['kind'] extends T[number] ? T : never

export const WORKLIST_KINDS = ['entry', 'ri_entry', 'piece'] as const satisfies Exhaustive<
  readonly ['entry', 'ri_entry', 'piece']
>
