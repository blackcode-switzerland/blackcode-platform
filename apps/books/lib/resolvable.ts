// WHICH WORKLIST ROWS MAY REACH THE RESOLVE WRITE, AND IN WHICH JOURNAL.
// One function, tested.
//
// ===========================================================================
// THIS EXISTS BECAUSE THE BRANCH THAT USED TO DECIDE IT WENT WRONG SILENTLY
// ===========================================================================
// `GET …/worklist` merges three tables into one list, and all three keep
// SEPARATE `seq` counters. `POST /entries/{n}/resolve` used to address
// `books.entry` ONLY. So a row of any other kind, resolved by its #number,
// rewrote whatever journal entry happened to carry that number — and answered
// 200. Reproduced 2026-08-18: RI #5 (TWINT *8842, 120.00) → `books.entry` #5,
// the January payroll, in a different book. Ticket #51.
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
// ===========================================================================
// #51 IS FIXED, AND IT IS FIXED WITH A CONDITION — TESTED 2026-08-19
// ===========================================================================
// Phase 4A's backend added an RI path: `POST /entries/{n}/resolve` now reads
// `body.entity`, and when that names a SIMPLIFIED book it runs `resolveRiEntry`
// against `(workspace_id, entity_id, seq)` instead of the grand livre.
//
// **The claim was verified before this file was widened, both ways**, because a
// guard proved only by refusals cannot be told from a subject that refuses
// everything (CLAUDE.md finding #16). Against the seeded workspace, on RI #5
// and grand-livre #5 — two live rows that share a number:
//
//   WITH the book named      `bk books resolve 5 --entity ri --explanation …`
//                            → `books.ri_entry` #5 resolved, history written,
//                              **`books.entry` #5 untouched.** The fix is real.
//
//   WITHOUT the book named   `bk books resolve 5 --explanation …`
//                            → `books.entry` #5 — the January payroll — REWRITTEN,
//                              exit 0. **The old bug is exactly as live as it was.**
//
// Both restored. So what changed is not "RI rows are resolvable"; it is "RI rows
// are resolvable WHEN THE REQUEST NAMES THE BOOK". The condition is the whole
// fix, and a predicate that widened without carrying it would hand the write
// path the same #number with nothing to disambiguate it — reintroducing #51
// through the front door while the ticket reads closed.
//
// ── SO THE DECISION TAKES TWO INPUTS AND IS POSITIVE ON BOTH ─────────────
// `resolveTargetFor(row, journal)` answers with a TARGET or with null, and each
// arm names both the kind and the journal it requires:
//
//   kind 'entry'    + journal 'grand_livre'        → resolve in the grand livre
//   kind 'ri_entry' + journal 'recettes_depenses'  → resolve in the RI journal,
//                                                    and the body MUST name the book
//   anything else                                  → null, read-only
//
// Never `!== 'piece'`, never `!== 'grand_livre'`. A fourth kind, a third journal
// or a mismatched pair is a rendering nobody wrote — the row gets the read-only
// explanation — and never a write nobody meant.
//
// **The journal comes from the SCOPE, not from the row.** The worklist is
// entity-scoped (`getWorklist(entity.id, exercice.id)`), so every row on screen
// belongs to the book in the switcher, and `useScope().journal` is the same fact
// the server reads. If the two ever disagreed the consequence is a REFUSAL —
// `not_found` in the named journal — and never a wrong write, because the server
// resolves the number inside the book the body named.
//
// ── WHY A FUNCTION AND NOT A TIDIER TERNARY ──────────────────────────────
// A ternary inside a 350-line component can only be checked by scanning the
// file as text, and `lib/dashboard-paths.test.ts` in apps/issues is on record
// twice for what text scanning is worth: the granularity of the scan is part of
// what it checks, and both of its first two versions passed against code that
// did the wrong thing.
//
// A function can be CALLED, over every member of both unions, by a test that
// fails to compile when either one grows. That is the difference between a guard
// that reads right and a guard that has been watched go red.

import type { Journal } from './journal'
import type { WorklistRow } from './types'

/** A row `POST /entries/{n}/resolve` may address in the GRAND LIVRE. */
export type ResolvableRow = WorklistRow & { kind: 'entry' }

/** A row `POST /entries/{n}/resolve` may address in the RECETTES-DÉPENSES journal. */
export type ResolvableRiRow = WorklistRow & { kind: 'ri_entry' }

/**
 * A row the resolve write may address, and the journal the #number is read in.
 *
 * A DISCRIMINATED UNION rather than a boolean, because the caller needs the
 * second half: the RI arm's request must carry `entity`, and the grand-livre
 * arm's must not grow one. A predicate answering only yes/no would leave that to
 * the component, which is where #51 lived the first time.
 */
export type ResolveTarget =
  | { journal: 'grand_livre'; row: ResolvableRow }
  | { journal: 'recettes_depenses'; row: ResolvableRiRow }

/**
 * Narrow a row to one kind.
 *
 * ── WHY THIS EXISTS AND IS NOT AN INLINE `row.kind === …` ────────────────
 * `WorklistRow` is a single interface with a UNION-TYPED FIELD, not a
 * discriminated union of three interfaces, so `if (row.kind === 'entry')` does
 * not narrow `row` — TypeScript narrows the property and leaves the object
 * alone. That is what made the old call site need `row as ResolvableRow`, and
 * that cast is on record: it is what kept the compiler quiet at the one line
 * that mattered while `_WorklistKeys` was red for a whole merge.
 *
 * A type PREDICATE is an assertion the compiler then enforces everywhere else,
 * written once, here, next to the comparison it stands for — rather than a cast
 * written at each site that reads the same as a correct narrowing and checks
 * nothing. **Making the row shape a real discriminated union in `lib/types.ts`
 * would be better still**, and it is a bigger change than this phase: the
 * payload's optional fields differ by kind and the wire test pins the key set of
 * the whole row. Recorded rather than done.
 */
function isKind<K extends WorklistRow['kind']>(
  row: WorklistRow,
  kind: K
): row is WorklistRow & { kind: K } {
  return row.kind === kind
}

/**
 * May this row reach the resolve write, and in which journal?
 *
 * **POSITIVE and enumerated on both axes.** Returns null for every pair this
 * function has not been taught, including a known kind in an unknown journal —
 * `journal` is null while the books are in flight, and resolving then would be a
 * write whose target book is a guess.
 */
export function resolveTargetFor(
  row: WorklistRow,
  journal: Journal | null
): ResolveTarget | null {
  if (isKind(row, 'entry') && journal === 'grand_livre') {
    return { journal: 'grand_livre', row }
  }
  if (isKind(row, 'ri_entry') && journal === 'recettes_depenses') {
    return { journal: 'recettes_depenses', row }
  }
  return null
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

/**
 * Every journal a row can be read in, plus the not-known case, for the same test.
 *
 * The `null` is not padding: it is the state the app is in on first render and
 * on an unknown book, and it is the one a widening is most likely to let through
 * — `journal !== 'grand_livre'` would have admitted it.
 */
type ExhaustiveJournals<T extends readonly (Journal | null)[]> =
  Journal extends T[number] ? T : never

export const RESOLVE_JOURNALS = [
  'grand_livre',
  'recettes_depenses',
  null,
] as const satisfies ExhaustiveJournals<readonly ['grand_livre', 'recettes_depenses', null]>
