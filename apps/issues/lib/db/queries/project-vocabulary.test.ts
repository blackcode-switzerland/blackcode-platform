// The SERVER refuses a project priority or status outside the vocabulary.
//
// ---------------------------------------------------------------------------
// WHY THIS TEST EXISTS
// ---------------------------------------------------------------------------
// `issues.projects.priority` is a `varchar(10)` with no CHECK constraint, and
// until 2026-08-12 the route did this:
//
//     priority: typeof body.priority === 'string' ? body.priority : undefined
//
// so `--priority urgent` — the spelling the CLI's own help INSTRUCTED, in every
// version of the CLI that has ever shipped — wrote the literal string 'urgent'.
// `PROJECT_PRIORITIES` is P0–P4, and `projectPriorityLabel` falls through to
// "No priority" for anything else, so the project read as unprioritised in the
// listing, the detail page, `bk meta` and analytics. Nothing errored. One such
// row exists in local dev (verified 2026-08-12, `SELECT priority, count(*)`).
//
// Phase 2 fixed the CLI's help, which is NOT the fix: every older binary
// already installed keeps writing corrupt rows until the forced release lands,
// and a direct HTTP call always would. The server is the only place that can
// close it.
//
// ---------------------------------------------------------------------------
// WHY IT ASSERTS THE POSITIVE CASE FIRST
// ---------------------------------------------------------------------------
// CLAUDE.md finding #16: a guard built only on "was this refused?" cannot tell
// a working boundary from a subject that refuses everything. A validator that
// threw on EVERY priority would satisfy every rejection case below while being
// strictly worse than no validator at all — it would break the web UI.
//
// So the accepted values are asserted FIRST, and the refusals are the weaker
// half. Per finding #21 the positive case asserts the OUTCOME — the validator
// returned — rather than a side effect seen on the way to it.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE DOES *NOT* COVER
// ---------------------------------------------------------------------------
// That `createProject` and `updateProject` actually CALL the validator. A pure
// unit test of a pure function cannot see the wiring, and a validator nobody
// invokes passes every case here. That half is asserted against a real database
// in project-vocabulary.integration.test.ts, and neither file is sufficient
// alone.

import { describe, expect, it } from 'vitest'
import { PROJECT_PRIORITY_VALUES, PROJECT_STATUS_VALUES } from '@/lib/work-items'
import { assertProjectVocabulary } from './project-vocabulary'

/** Returns the vocabulary error `assertProjectVocabulary` raised, or null. */
function vocabularyErrorOf(input: { status?: string; priority?: string }): string | null {
  try {
    assertProjectVocabulary(input)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

describe('project priority is validated on the server', () => {
  it('POSITIVE: every value in the vocabulary is accepted', () => {
    // First, and load-bearing. Without it, a validator that threw on
    // everything would satisfy every rejection case below.
    for (const priority of PROJECT_PRIORITY_VALUES) {
      expect(vocabularyErrorOf({ priority })).toBeNull()
    }
    // Assert the input: an empty vocabulary would make the loop vacuous, and
    // pin the spelling — P0-P4, not the labels.
    expect(PROJECT_PRIORITY_VALUES).toEqual(['P4', 'P0', 'P1', 'P2', 'P3'])
  })

  it('POSITIVE: omitting priority entirely is still accepted', () => {
    // The common case by far, and the one a too-eager validator breaks.
    expect(vocabularyErrorOf({})).toBeNull()
  })

  it('rejects `urgent` — the exact string the CLI used to instruct', () => {
    expect(vocabularyErrorOf({ priority: 'urgent' })).toBe('invalid_priority')
  })

  it('rejects the other label spellings, and a lowercase p0', () => {
    // These are the values a caller reaches for from the UI's own labels, and
    // every one of them used to be written verbatim into the column.
    for (const bad of ['high', 'medium', 'low', 'none', 'p0']) {
      expect(vocabularyErrorOf({ priority: bad })).toBe('invalid_priority')
    }
  })

  it('rejects a near-miss the column itself would have stored intact', () => {
    // varchar(10): 'P5' fits, so the database would have accepted it happily.
    // The column's width was never the guard.
    expect(vocabularyErrorOf({ priority: 'P5' })).toBe('invalid_priority')
  })
})

describe('project status is validated on the server', () => {
  // The same route passed `body.status` through untouched. It is not in the
  // phase plan and it is the same hole, one line up from the priority one.
  it('POSITIVE: every value in the vocabulary is accepted', () => {
    for (const status of PROJECT_STATUS_VALUES) {
      expect(vocabularyErrorOf({ status })).toBeNull()
    }
    expect(PROJECT_STATUS_VALUES).toEqual([
      'backlog',
      'planned',
      'in_progress',
      'completed',
      'cancelled',
    ])
  })

  it('rejects `done` — the ISSUE vocabulary, which projects do not share', () => {
    // A real confusion, not a synthetic one: issues end at done/cancelled,
    // projects at completed/cancelled.
    expect(vocabularyErrorOf({ status: 'done' })).toBe('invalid_status')
  })

  it('rejects `active` — the vestigial TASK column default', () => {
    expect(vocabularyErrorOf({ status: 'active' })).toBe('invalid_status')
  })

  it('priority is checked even when status is valid, and vice versa', () => {
    // A validator that returned after the first check would pass everything
    // above and still let half of it through.
    expect(vocabularyErrorOf({ status: 'backlog', priority: 'urgent' })).toBe('invalid_priority')
    expect(vocabularyErrorOf({ status: 'done', priority: 'P0' })).toBe('invalid_status')
  })
})
