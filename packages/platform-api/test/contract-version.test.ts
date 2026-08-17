// `contractVersion` — the poll-me value for sales #31.
//
// ===========================================================================
// THE POSITIVE CASE IS THE ONE THAT MATTERS, AND IT IS BOTH DIRECTIONS
// ===========================================================================
// CLAUDE.md finding #16: a check built only on "was this refused?" cannot tell a
// working boundary from an absent subject. The version-number equivalent is
// sharper, because BOTH of its failure modes look like success:
//
//   never changes    an agent skips the re-read forever and runs on a stale
//                    contract. Nothing says so. This is the hand-bumped-integer
//                    failure the implementation exists to avoid.
//   always changes   an agent re-reads everything on every run, which is the
//                    exact cost the value was added to remove — and it still
//                    LOOKS like a working version field.
//
// So there are two premise assertions here, not one, and neither is a denial:
// a contract change MUST move the value, and an identical contract MUST NOT.
//
// Watched fail 2026-08-17, three ways:
//   1. `return 'v1'` — the "never changes" case. Only the changed-contract
//      assertions go red; every stability assertion stays green, which is why
//      the stability ones alone are not the test.
//   2. `return randomBytes(8).toString('hex')` — the "always changes" case. The
//      mirror: every stability assertion goes red and every change assertion
//      stays green.
//   3. swap `stableStringify` back to plain `JSON.stringify` — only the
//      key-order case goes red, which is the one a reader would most likely
//      believe was already handled.

import { describe, expect, it } from 'vitest'
import { contractVersion } from '../src/contract-version'

/** A contract shaped like the real one — vocabularies, limits, type lists. */
const CONTRACT = {
  vocabulary: {
    stages: [
      { value: 'new_lead', label: 'New lead', color: '#8a8578' },
      { value: 'won', label: 'Won', color: '#10a37f' },
    ],
    channels: [{ value: 'email', label: 'Email', color: '#14b8a6' }],
  },
  limits: { prospect_name_max: 120, page_size_max: 200 },
  entity_types: ['prospect', 'meeting'],
  search_types: ['prospect', 'contact'],
  trash_types: ['prospect', 'meeting'],
  retention_days: 90,
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('contractVersion', () => {
  it('THE PREMISE 1: an identical contract gives an identical version', () => {
    // The "always changes" failure. Without this the whole thing could be a
    // random string and every other assertion below would still pass.
    expect(contractVersion(CONTRACT)).toBe(contractVersion(clone(CONTRACT)))
  })

  it('THE PREMISE 2: a changed contract gives a changed version', () => {
    // The "never changes" failure — the hand-bumped-integer disease, which is
    // the entire reason this is derived rather than typed.
    const withStage = clone(CONTRACT)
    withStage.vocabulary.stages.push({ value: 'lost', label: 'Lost', color: '#a8a29e' })
    expect(contractVersion(withStage)).not.toBe(contractVersion(CONTRACT))
  })

  it('moves when a LIMIT changes', () => {
    const c = clone(CONTRACT)
    c.limits.prospect_name_max = 200
    expect(contractVersion(c)).not.toBe(contractVersion(CONTRACT))
  })

  it('moves when a vocabulary value is RENAMED but the count is unchanged', () => {
    // A length check would miss this, and a naive implementation might well be
    // one. The label an agent prints is part of the contract.
    const c = clone(CONTRACT)
    c.vocabulary.stages[0]!.label = 'Fresh lead'
    expect(contractVersion(c)).not.toBe(contractVersion(CONTRACT))
  })

  it('moves when a type list gains a member', () => {
    const c = clone(CONTRACT)
    c.search_types.push('objection')
    expect(contractVersion(c)).not.toBe(contractVersion(CONTRACT))
  })

  it('moves when an ARRAY is reordered — order is meaningful here', () => {
    // The stages are a ladder and `trash_types`' first entry is what the CLI's
    // help text suggests. A reordered array IS a contract change, so this is an
    // assertion about intent rather than an accident of the serialiser.
    const c = clone(CONTRACT)
    c.entity_types = ['meeting', 'prospect']
    expect(contractVersion(c)).not.toBe(contractVersion(CONTRACT))
  })

  it('does NOT move when object KEYS are reordered', () => {
    // Reordering two keys in a source file is a refactor. If it invalidated
    // every agent's cache, the value would be noise and people would stop
    // trusting it — the "always changes" failure arriving by the back door.
    const reordered = {
      retention_days: CONTRACT.retention_days,
      trash_types: CONTRACT.trash_types,
      search_types: CONTRACT.search_types,
      entity_types: CONTRACT.entity_types,
      limits: { page_size_max: 200, prospect_name_max: 120 },
      vocabulary: {
        channels: CONTRACT.vocabulary.channels,
        stages: CONTRACT.vocabulary.stages,
      },
    }
    expect(contractVersion(reordered)).toBe(contractVersion(CONTRACT))
  })

  it('is short, stable in shape, and hex', () => {
    // It goes in a skill file's front matter and in log lines. A 64-character
    // digest there is a value nobody pastes twice.
    const v = contractVersion(CONTRACT)
    expect(v).toMatch(/^[0-9a-f]{16}$/)
  })

  it('handles the empty and null cases without throwing', () => {
    // An app mid-migration can serve `{}`. It must produce a version rather than
    // a 500 inside `/api/meta`, which is the bootstrap call.
    expect(contractVersion({})).toMatch(/^[0-9a-f]{16}$/)
    expect(contractVersion({ a: null, b: undefined })).toMatch(/^[0-9a-f]{16}$/)
  })
})
