// `verdict: null` means NEVER CHECKED, not clean — asserted, because it is one
// `verdict?.verdict === 'blocked'` in JSX away from being wrong for every entry
// in the product that nothing has ever looked at.
//
// The phase-5 brief names this shape by name, carried over from 4B: *"`verdict`
// is `Verdict | null` and null means never checked, not clean … put those guards
// somewhere a test can reach."* It is F-2's `undefined !== null` mistake one
// field over, and the consequence is an assurance nobody gave.
//
// Every case was watched fail before it was kept.

import { DICTIONARY } from './dictionary'
import { describe, it, expect } from 'vitest'
import { blocksPosting, citedRules, resolutionText, verdictFace, worstCaseText } from './verdict'
import type { Verdict } from './types'

const filed = (over: Partial<Verdict> = {}): Verdict => ({
  verdict: 'accepted',
  rules: ['vat-008'],
  worst_case: null,
  resolves: null,
  at: '2026-08-19T10:00:00.000Z',
  by: 'devils-advocate',
  ...over,
})

describe('the absence is its own state, and it is not an assurance', () => {
  // Mutation watched: made the null branch return the `accepted` face. Green on
  // every other case in this file and red here — which is what the shape of this
  // bug looks like: everything else keeps working.
  it('null and undefined are never_checked, and say what that does not mean', () => {
    for (const nothing of [null, undefined]) {
      const face = verdictFace(nothing)
      expect(face.state).toBe('never_checked')
      expect(DICTIONARY.en[face.meaningKey]).toMatch(/not the same as a clean one/i)
    }
  })

  // ── CALM, NOT WARN ────────────────────────────────────────────────────
  // Most entries in this product have never been through a compliance pass,
  // because the pass is an external agent run nobody has scheduled. Drawing
  // every one amber would make the state meaningless.
  //
  // Mutation watched: set it to `'warn'`. Red — and on the seeded workspace it
  // would have put a warning on all thirteen of blackcode's entries.
  it('never_checked is calm, because it is the ordinary case', () => {
    expect(verdictFace(null).tone).toBe('calm')
  })

  it('the three filed verdicts each carry their own tone', () => {
    expect(verdictFace(filed({ verdict: 'accepted' })).tone).toBe('good')
    expect(verdictFace(filed({ verdict: 'accepted_with_warning' })).tone).toBe('warn')
    expect(verdictFace(filed({ verdict: 'blocked' })).tone).toBe('bad')
  })

  // ── A FOURTH VALUE ARRIVES WITHOUT A RELEASE ─────────────────────────
  // `verdict` is jsonb, served verbatim. Falling into `accepted` would be an
  // invented assurance; falling into `blocked` would be an invented refusal.
  //
  // Mutation watched: `?? FACES.accepted`. Red, and the screen then reported a
  // pass for a verdict it had never seen.
  it('a verdict this build does not know is named, not read either way', () => {
    const face = verdictFace(filed({ verdict: 'quarantined' as Verdict['verdict'] }))
    expect(face.state).toBe('unknown')
    expect(DICTIONARY.en[face.meaningKey]).toMatch(/rather than read as a pass or a refusal/i)
  })
})

describe('blocksPosting matches what the SERVER enforces, and nothing else', () => {
  // `postEntry` tests `v?.verdict === 'blocked'`. This must test the same thing:
  // a screen that also hid the form for `unknown` would withhold a write the
  // server allows, and one that hid it for `never_checked` would withhold it from
  // almost every entry in the product.
  //
  // Mutation watched: made it `verdict?.verdict !== 'accepted'`. Red on three of
  // the five — including null, which is every unchecked entry in the app.
  it('only a filed `blocked` blocks', () => {
    expect(blocksPosting(filed({ verdict: 'blocked' }))).toBe(true)
    expect(blocksPosting(filed({ verdict: 'accepted' }))).toBe(false)
    expect(blocksPosting(filed({ verdict: 'accepted_with_warning' }))).toBe(false)
    expect(blocksPosting(filed({ verdict: 'quarantined' as Verdict['verdict'] }))).toBe(false)
    expect(blocksPosting(null)).toBe(false)
    expect(blocksPosting(undefined)).toBe(false)
  })
})

describe('the way out is the agent’s own text, on the route’s own terms', () => {
  // `postEntry` uses `resolves` only when `typeof v.resolves === 'string'`, and
  // this reads it the same way — so the panel shows the sentence the server
  // would show, and never `[object Object]` in a recovery instruction.
  //
  // Mutation watched: made it `String(r)`. Red on the object case, which
  // produced exactly that string as the only guidance on a blocked entry.
  it('a plain string comes through; anything else is null', () => {
    expect(resolutionText(filed({ resolves: 'attach the receipt, then re-run' }))).toBe(
      'attach the receipt, then re-run'
    )
    for (const bad of [null, undefined, '', '  ', { en: 'x' }, 42, ['a']]) {
      expect(resolutionText(filed({ resolves: bad }))).toBeNull()
    }
    expect(resolutionText(null)).toBeNull()
  })

  it('worst_case is read on the same terms', () => {
    expect(worstCaseText(filed({ worst_case: 'CHF 4,500 disallowed' }))).toBe(
      'CHF 4,500 disallowed'
    )
    expect(worstCaseText(filed({ worst_case: { en: 'x' } }))).toBeNull()
  })
})

describe('citedRules — a verdict with no rules is malformed, not clean', () => {
  // `recordVerdict` refuses `missing_rules`: *"a verdict names the rules that
  // triggered — flags are facts, not moods"*. So an empty array means the row
  // did not come through that route, and the panel says so rather than drawing a
  // verdict with no basis as though it had one.
  //
  // Mutation watched: dropped the `Array.isArray` test and returned `r as
  // string[]`. Red — a non-array `rules` then reached `.map` in the component.
  it('reads the ids, and survives a rules field that is not an array', () => {
    expect(citedRules(filed({ rules: ['vat-008', 'ret-001'] }))).toEqual(['vat-008', 'ret-001'])
    for (const bad of [[], null, undefined, 'vat-008', {}]) {
      expect(citedRules(filed({ rules: bad as string[] }))).toEqual([])
    }
  })

  // Mutation watched: dropped the per-element filter. Red — a null inside the
  // array became a link with no text and an `href` ending in `/compliance#`.
  it('drops an element that is not a usable id', () => {
    expect(citedRules(filed({ rules: ['vat-008', '', '   ', null, 7] as string[] }))).toEqual([
      'vat-008',
    ])
  })

  it('nothing at all cites nothing', () => {
    expect(citedRules(null)).toEqual([])
  })
})
