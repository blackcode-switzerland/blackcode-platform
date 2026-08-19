// The compliance screen's vocabulary, and the three rules it can break silently.
//
// Every case was watched fail before it was kept and the mutation is recorded
// beside it. Two of these assertions look like they are testing a colour. They
// are not: `draft`'s tone is a claim about what a reader should conclude from
// nineteen unreviewed rules, and it is the difference between a screen that says
// "this product is waiting for you" and one that says "something is wrong here".

import { describe, it, expect } from 'vitest'
import {
  REVIEW_CHOICES,
  appliesToText,
  canSubmitReview,
  countByState,
  effectiveLogic,
  isReviewed,
  provenanceOf,
  reviewStateFace,
  severityFace,
  severityRank,
} from './compliance'

describe('draft is the resting state, not a warning', () => {
  // ── THE ONE THAT MATTERS MOST ON THIS SCREEN ──────────────────────────
  // All nineteen rules are born draft; research against Fedlex is not a
  // fiduciary's sign-off. Nineteen rules waiting for a human is what the page
  // looks like when NOTHING IS WRONG.
  //
  // Mutation watched: set draft's tone to `'warn'`. Red, naming the state.
  it('draft is calm — the quietest tone the screen has', () => {
    expect(reviewStateFace('draft')?.tone).toBe('calm')
  })

  it('rejected is the loud one, and the two sign-offs are not', () => {
    expect(reviewStateFace('rejected')?.tone).toBe('bad')
    expect(reviewStateFace('approved')?.tone).toBe('good')
    expect(reviewStateFace('edited')?.tone).toBe('good')
  })

  // ── AN UNKNOWN STATE IS NAMED, NEVER BINNED ───────────────────────────
  // `review_state` is a `varchar`, not an enum this bundle owns. Falling into
  // draft's calm treatment would hide a rejection; falling into rejected's would
  // invent one.
  //
  // Mutation watched: made the lookup `?? REVIEW_STATE_FACES.draft`. Red — a
  // state this build has never seen then rendered as "Draft", which is a
  // confident wrong answer about whether anybody has looked.
  it('a state this build does not know returns null rather than a default', () => {
    expect(reviewStateFace('withdrawn')).toBeNull()
    expect(reviewStateFace('')).toBeNull()
  })

  // Mutation watched: made it `state === 'approved' || state === 'edited'`. Red
  // — a rejected rule then reported as never looked at, and the register hid the
  // reviewer's name on the one outcome a reader most needs attributed.
  it('isReviewed asks only whether it is still draft', () => {
    expect(isReviewed('draft')).toBe(false)
    for (const s of ['approved', 'edited', 'rejected', 'withdrawn']) {
      expect(isReviewed(s)).toBe(true)
    }
  })

  // The route refuses `draft` as a review verdict — *"draft is where rules are
  // born, not a state a review sets"* — so the form must not offer it.
  // Mutation watched: added `'draft'` to REVIEW_CHOICES. Red here, and the route
  // answers `bad_state` for it, which is the pair this asserts.
  it('the form offers exactly the three the route accepts, and never draft', () => {
    expect([...REVIEW_CHOICES]).toEqual(['approved', 'edited', 'rejected'])
    expect(REVIEW_CHOICES).not.toContain('draft')
  })
})

describe('source confidence is PROVENANCE, and all three are calm', () => {
  // `needs_fiduciary_check` is a fact about the SOURCE, not about the rule: the
  // article behind it is not settled, which is not the same as the rule being
  // doubtful. A disclosure drawn as a defect is a disclosure people stop reading.
  it('the three seeded values each say something about the SOURCE', () => {
    expect(provenanceOf('verified_fedlex')?.meaning).toMatch(/read the cited article/i)
    expect(provenanceOf('doctrine_inferred')?.meaning).toMatch(/reading .* rather than a quotation/i)
    expect(provenanceOf('needs_fiduciary_check')?.meaning).toMatch(/source itself is not settled/i)
  })

  // Mutation watched: added `tone: 'warn'` to `needs_fiduciary_check` and had
  // the page read it. The seeded `audit-001` — a perfectly good rule whose
  // opt-out mechanics need a fiduciary — then drew amber beside eighteen calm
  // ones, which reads as "this rule is wrong".
  it('provenance carries no tone at all, so it cannot be drawn as a defect', () => {
    expect(Object.keys(provenanceOf('needs_fiduciary_check')!)).toEqual(['label', 'meaning'])
  })

  it('a confidence this build does not know returns null rather than a default', () => {
    expect(provenanceOf('vibes')).toBeNull()
  })
})

describe('severity is the rule’s own claim, and it is served', () => {
  it('the three seeded severities map, loudest first', () => {
    expect(severityFace('blocker')?.tone).toBe('bad')
    expect(severityFace('warning')?.tone).toBe('warn')
    expect(severityFace('info')?.tone).toBe('calm')
    expect(severityFace('catastrophic')).toBeNull()
  })

  // Mutation watched: made the unknown rank `1`. Red — an unrecognised severity
  // then sorted into the middle of the register as though the app knew what it
  // was, instead of to the end where it is visible as unplaced.
  it('an unknown severity sorts last rather than into a known band', () => {
    expect(['info', 'blocker', 'catastrophic', 'warning'].sort((a, b) => severityRank(a) - severityRank(b)))
      .toEqual(['blocker', 'warning', 'info', 'catastrophic'])
  })
})

describe('an edit needs the corrected wording — the route’s refusal, mirrored', () => {
  // `edited_needs_logic`: *"an edit without the corrected wording is an approval
  // wearing a different name"*.
  //
  // Mutation watched: made it `editedLogic.length > 0`. Red on the
  // whitespace-only case — which would have passed the client check, been
  // refused by the route, and read to the user as the app being broken.
  it('whitespace is not wording', () => {
    expect(canSubmitReview('edited', '')).toBe(false)
    expect(canSubmitReview('edited', '   \n\t ')).toBe(false)
    expect(canSubmitReview('edited', 'IF x THEN flag')).toBe(true)
  })

  it('approve and reject need nothing typed', () => {
    expect(canSubmitReview('approved', '')).toBe(true)
    expect(canSubmitReview('rejected', '')).toBe(true)
  })
})

describe('effectiveLogic — the original survives a correction', () => {
  const rule = { check_logic: 'IF a THEN flag', edited_logic: null as string | null }

  it('an unedited rule’s own logic stands, and there is no original to show', () => {
    expect(effectiveLogic(rule)).toEqual({
      text: 'IF a THEN flag',
      corrected: false,
      original: null,
    })
  })

  // ── `edited_logic` IS A SEPARATE COLUMN SO `check_logic` IS NOT LOST ────
  // A screen showing only the correction would lose the record OF the
  // correction, which is the thing a fiduciary's sign-off consists of.
  //
  // Mutation watched: returned `original: null` on the corrected branch. Red —
  // the register then showed the new wording with nothing to compare it to.
  it('a correction supersedes it and the original comes back beside it', () => {
    expect(effectiveLogic({ ...rule, edited_logic: 'IF a AND b THEN flag' })).toEqual({
      text: 'IF a AND b THEN flag',
      corrected: true,
      original: 'IF a THEN flag',
    })
  })

  // Mutation watched: dropped the `.trim()`. Red — `edited_logic: "  "` then
  // rendered as an empty check, marked as a fiduciary's correction.
  it('a blank edited_logic is not a correction', () => {
    expect(effectiveLogic({ ...rule, edited_logic: '   ' }).corrected).toBe(false)
  })
})

describe('the register’s summary line', () => {
  it('counts every state present and invents none', () => {
    expect(
      countByState([
        { review_state: 'draft' },
        { review_state: 'draft' },
        { review_state: 'approved' },
      ])
    ).toEqual({ draft: 2, approved: 1 })
  })

  it('an empty register counts nothing rather than zeroes it does not know', () => {
    expect(countByState([])).toEqual({})
  })
})

describe('appliesTo is spelled for a reader, and an unknown form is shown raw', () => {
  it('maps the three the seed carries', () => {
    expect(appliesToText('both')).toBe('Every book')
    expect(appliesToText('SA')).toBe('SA / Sàrl')
    expect(appliesToText('RI')).toBe('Sole proprietorship')
  })

  // Mutation watched: made the fallback `'Every book'`. Red — a legal form added
  // server-side then claimed to bind every book, which is the widest possible
  // wrong answer.
  it('a legal form this build does not know is printed, not widened', () => {
    expect(appliesToText('SNC')).toBe('SNC')
  })
})
