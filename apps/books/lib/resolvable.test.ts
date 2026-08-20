// The one decision that stands between a worklist row and the wrong table.
//
// ── WHAT THIS ASKS, EXACTLY ─────────────────────────────────────────────
// It asks `resolveTargetFor` about EVERY (kind, journal) PAIR the app can hold
// — three kinds × three journal states, the `null` included — and it asserts
// both halves: that the two legitimate pairs are allowed and named correctly
// (the positive cases) and that the other seven are not. A guard built only on
// "was this refused?" cannot tell a working check from one that refuses
// everything — CLAUDE.md finding #16 — so the allow cases come first and the
// refusals are the weaker half.
//
// It iterates the CROSS PRODUCT rather than a hand-written list of interesting
// pairs, because the widening this file was rewritten for (#51, 2026-08-19)
// added a second axis, and a hand-written list is how one cell of a nine-cell
// table goes unchecked.
//
// ── WHAT IT DOES NOT ASK ────────────────────────────────────────────────
// It does not render `<Worklist>` and it cannot see whether that component
// still CALLS this function, nor whether `<ResolveForm>` really sends `entity`
// on the RI arm — which is the condition the whole widening rests on. That half
// is held by the type (`ResolveTarget` is a discriminated union, and the form
// switches on it) and by the browser check recorded in the phase report. A
// component test would close it; this repo has no DOM test setup and adding one
// is not this phase's work. Named here rather than implied.
//
// It also does not check the SERVER's half. That was tested by running it, both
// ways, before the widening — the two commands and their outcomes are in
// `lib/resolvable.ts`'s header.

import { describe, it, expect } from 'vitest'
import { resolveTargetFor, RESOLVE_JOURNALS, WORKLIST_KINDS } from './resolvable'
import type { Journal } from './journal'
import type { WorklistRow } from './types'

const row = (kind: WorklistRow['kind']): WorklistRow => ({
  kind,
  number: 5,
  date: '2026-03-10',
  status: null,
  raw_label: 'x',
  counterparty: null,
  recognition: 'unrecognized',
  evidence_tier: 'bare',
  amount: '120.00',
  suggested_rules: [],
  suggested_entries: [],
})

/** The two pairs that may write, spelled as data so the refusal loop can exclude them. */
const ALLOWED: readonly { kind: WorklistRow['kind']; journal: Journal }[] = [
  { kind: 'entry', journal: 'grand_livre' },
  { kind: 'ri_entry', journal: 'recettes_depenses' },
]

describe('which worklist rows may reach the resolve write, and in which journal', () => {
  // Anti-vacuous, on BOTH axes. If either list is ever emptied or narrowed,
  // every assertion below becomes a statement about nothing.
  it('knows about every kind the worklist serves and every journal state', () => {
    expect(WORKLIST_KINDS.length, 'the kind list shrank — this file is stale').toBeGreaterThan(2)
    expect([...WORKLIST_KINDS]).toContain('piece')
    expect(RESOLVE_JOURNALS.length, 'the journal list shrank — this file is stale').toBe(3)
    expect([...RESOLVE_JOURNALS]).toContain(null)
  })

  // THE POSITIVE CASES, FIRST. A guard that says no to everything passes every
  // refusal below and protects nothing.
  it('ALLOWS a journal entry in the grand livre, and names that journal', () => {
    const target = resolveTargetFor(row('entry'), 'grand_livre')
    expect(target).not.toBeNull()
    expect(target?.journal).toBe('grand_livre')
    expect(target?.row.kind).toBe('entry')
  })

  // #51's fix, and the half that did not exist before 2026-08-19. The journal it
  // names is what makes `<ResolveForm>` send `entity` — without which the server
  // reads the number in the grand livre and rewrites an unrelated entry, which
  // was reproduced against the seeded database before this was widened.
  it('ALLOWS an ri_entry in the recettes-dépenses journal, and names that journal', () => {
    const target = resolveTargetFor(row('ri_entry'), 'recettes_depenses')
    expect(target).not.toBeNull()
    expect(target?.journal).toBe('recettes_depenses')
    expect(target?.row.kind).toBe('ri_entry')
  })

  it('refuses every other pair — the whole cross product, not a chosen few', () => {
    for (const kind of WORKLIST_KINDS) {
      for (const journal of RESOLVE_JOURNALS) {
        if (ALLOWED.some((a) => a.kind === kind && a.journal === journal)) continue
        expect(
          resolveTargetFor(row(kind), journal),
          `${kind} reached the resolve write in journal ${String(journal)}`
        ).toBeNull()
      }
    }
  })

  // The specific ones, named, so a failure says which bug came back rather than
  // "one of them".

  // #51 itself: the RI row's #number read in the grand livre. Verified live on
  // 2026-08-19 to still rewrite `books.entry` #5 when the book is not named.
  it('refuses an ri_entry in the GRAND LIVRE — ticket #51: it rewrites an unrelated entry', () => {
    expect(resolveTargetFor(row('ri_entry'), 'grand_livre')).toBeNull()
  })

  // The state the app is in on first render, and the one a `!== 'grand_livre'`
  // widening would have admitted.
  it('refuses an ri_entry when the journal is not known yet', () => {
    expect(resolveTargetFor(row('ri_entry'), null)).toBeNull()
  })

  it('refuses a journal entry when the journal is not known yet', () => {
    expect(resolveTargetFor(row('entry'), null)).toBeNull()
  })

  it('refuses a pièce in either journal — resolving one rewrites the entry of the same number', () => {
    expect(resolveTargetFor(row('piece'), 'grand_livre')).toBeNull()
    expect(resolveTargetFor(row('piece'), 'recettes_depenses')).toBeNull()
  })
})
