// `verdict: Verdict | null` — and **null means NEVER CHECKED, not clean.**
//
// ===========================================================================
// THIS IS THE PHASE-5 SHAPE THE PHASE-4B REVIEW WARNED ABOUT BY NAME
// ===========================================================================
// The brief: *"`verdict` is `Verdict | null` and null means never checked, not
// clean … put those guards somewhere a test can reach."* A screen that draws the
// absence of a verdict as an accepted one invents an assurance nobody gave — and
// in a bookkeeping product that assurance is the difference between "the Devil's
// Advocate looked at this entry and passed it" and "nothing has ever looked at
// this entry".
//
// It is exactly the `undefined !== null` mistake F-2 was, one field over, and it
// is a single `verdict?.verdict === 'blocked'` in JSX away from happening: every
// entry that was never checked would then render as though it were fine.
//
// So the four states are ENUMERATED and the function is total. There is no
// falsy branch anywhere.
//
// ===========================================================================
// AND THE APP COMPUTES NO COMPLIANCE JUDGMENT OF ITS OWN
// ===========================================================================
// `lib/db/queries/compliance.ts`'s header: flags are facts, the Devil's Advocate
// is an EXTERNAL agent pass, and `POST /entries/{n}/verdict` is its door — ring
// 0, not ours (decision D-H's rule). This module reads a stored verdict and
// nothing here derives one. The ONE enforced consequence lives on the server:
// `postEntry` refuses a `blocked` entry with `verdict_blocked`, carrying the
// agent's own `resolves` text as the suggestion.

import type { Verdict } from './types'

export type VerdictState = 'never_checked' | 'accepted' | 'accepted_with_warning' | 'blocked' | 'unknown'

export interface VerdictFace {
  state: VerdictState
  label: string
  /** What the reader is entitled to conclude. The whole reason this file exists. */
  meaning: string
  tone: 'calm' | 'good' | 'warn' | 'bad'
}

const FACES: Record<Exclude<VerdictState, 'never_checked' | 'unknown'>, VerdictFace> = {
  accepted: {
    state: 'accepted',
    label: 'Accepted',
    tone: 'good',
    meaning: 'A compliance pass read this entry against the rules and raised nothing.',
  },
  accepted_with_warning: {
    state: 'accepted_with_warning',
    label: 'Accepted with a warning',
    tone: 'warn',
    meaning:
      'A compliance pass raised something that does not stop the entry. It still posts; the warning stands on the record.',
  },
  blocked: {
    state: 'blocked',
    label: 'Blocked',
    tone: 'bad',
    // Enforced server-side in `postEntry`, not here. Saying so is what stops a
    // reader treating this as advice they may click past.
    meaning: 'This entry refuses to post until what the verdict flagged is resolved.',
  },
}

/**
 * What a screen may say about an entry's verdict.
 *
 * ── THE `null` BRANCH IS FIRST, AND IT IS NOT A NEGATIVE STATE ───────────
 * `never_checked` is `calm`, not `warn`. Most entries in this product have never
 * been through a compliance pass, because the pass is an external agent run that
 * nobody has scheduled — drawing every one of them as a warning would make the
 * state meaningless. What it must NOT do is read as an assurance, and the
 * `meaning` is what carries that.
 *
 * ── AND AN UNRECOGNISED VERDICT IS NAMED, NEVER BINNED ───────────────────
 * `verdict.verdict` is a jsonb field served verbatim, so a fourth value can
 * arrive without a frontend release. It falls to `unknown`, which the screen
 * renders beside the raw string. Falling into `accepted` would be an invented
 * assurance; falling into `blocked` would be an invented refusal.
 */
export function verdictFace(verdict: Verdict | null | undefined): VerdictFace {
  if (verdict === null || verdict === undefined) {
    return {
      state: 'never_checked',
      label: 'Never checked',
      tone: 'calm',
      meaning:
        'No compliance pass has looked at this entry. That is not the same as a clean one — nothing has been asserted about it either way.',
    }
  }
  const face = FACES[verdict.verdict as keyof typeof FACES]
  if (face) return face
  return {
    state: 'unknown',
    label: 'Unrecognised verdict',
    tone: 'warn',
    meaning:
      'A compliance pass filed a verdict this build does not know. It is shown as filed rather than read as a pass or a refusal.',
  }
}

/**
 * Is posting refused by a verdict?
 *
 * **POSITIVE, and only for the value the server enforces.** `postEntry` tests
 * `v?.verdict === 'blocked'` and nothing else, so this must test the same thing:
 * a screen that hid the post form for `unknown` too would withhold a write the
 * server allows, and one that hid it for `never_checked` would withhold it from
 * almost every entry in the product.
 */
export function blocksPosting(verdict: Verdict | null | undefined): boolean {
  return verdict?.verdict === 'blocked'
}

/**
 * The agent's own way out, when it filed one.
 *
 * `resolves` is `unknown` on the wire — jsonb, whatever the agent wrote. The
 * ROUTE uses it only when it is a plain string (`typeof v.resolves === 'string'`
 * in `postEntry`), and this reads it the same way so that the screen shows the
 * same sentence the server would put in its refusal. A `{fr, en}` pair or an
 * object is returned as null here rather than stringified: `[object Object]` in
 * a recovery instruction is worse than no instruction.
 */
export function resolutionText(verdict: Verdict | null | undefined): string | null {
  const r = verdict?.resolves
  return typeof r === 'string' && r.trim() !== '' ? r : null
}

/** The worst case the agent described, on the same terms as `resolutionText`. */
export function worstCaseText(verdict: Verdict | null | undefined): string | null {
  const w = verdict?.worst_case
  return typeof w === 'string' && w.trim() !== '' ? w : null
}

/**
 * The rule ids a verdict cited. **Never empty on a real one** — `recordVerdict`
 * refuses `missing_rules`: *"a verdict names the rules that triggered — flags
 * are facts, not moods"* — so an empty array here is a malformed record and the
 * screen says so rather than drawing a verdict with no basis.
 */
export function citedRules(verdict: Verdict | null | undefined): string[] {
  const r = verdict?.rules
  if (!Array.isArray(r)) return []
  return r.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}
