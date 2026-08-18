// The one decision that stands between a worklist row and the wrong table.
//
// ── WHAT THIS ASKS, EXACTLY ─────────────────────────────────────────────
// It asks `isResolvable` about EVERY kind the worklist serves, and it asserts
// both halves: that `entry` is allowed (the positive case) and that nothing
// else is. A guard built only on "was this refused?" cannot tell a working
// check from one that refuses everything — CLAUDE.md finding #16 — so the
// allow case comes first and the refusals are the weaker half.
//
// ── WHAT IT DOES NOT ASK ────────────────────────────────────────────────
// It does not render `<WorklistRows>` and it cannot see whether that component
// still CALLS this function. That half is held by the type — `<ResolveForm>`'s
// prop is `ResolvableRow`, and the call site's `row as ResolvableRow` cast is
// the hole, which is why the cast is now made only inside the `isResolvable`
// branch. A component test would close it; this repo has no DOM test setup and
// adding one is not this phase's work. Named here rather than implied.

import { describe, it, expect } from 'vitest'
import { isResolvable, WORKLIST_KINDS } from './resolvable'
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

describe('only a journal entry may reach the resolve write', () => {
  // Anti-vacuous. If the kind list is ever emptied or narrowed, every
  // assertion below becomes a statement about nothing.
  it('knows about every kind the worklist serves', () => {
    expect(WORKLIST_KINDS.length, 'the kind list shrank — this file is stale').toBeGreaterThan(2)
    expect([...WORKLIST_KINDS]).toContain('piece')
  })

  // THE POSITIVE CASE, FIRST. A guard that says no to everything passes every
  // refusal below and protects nothing.
  it('ALLOWS an entry — the case that makes the refusals mean something', () => {
    expect(isResolvable(row('entry'))).toBe(true)
  })

  it('refuses every other kind, whatever the worklist grows', () => {
    for (const kind of WORKLIST_KINDS) {
      if (kind === 'entry') continue
      expect(isResolvable(row(kind)), `${kind} reached the resolve write`).toBe(false)
    }
  })

  // The specific two, named, so a failure says which bug came back rather than
  // "one of them".
  it('refuses an ri_entry — ticket #51: it would rewrite an unrelated entry', () => {
    expect(isResolvable(row('ri_entry'))).toBe(false)
  })

  it('refuses a pièce — resolving one would rewrite the entry of the same number', () => {
    expect(isResolvable(row('piece'))).toBe(false)
  })
})
