// The compliance screen's vocabulary, as pure functions.
//
// ===========================================================================
// THREE RULES THIS SCREEN CAN BREAK SILENTLY, HELD HERE SO A TEST CAN REACH THEM
// ===========================================================================
//   1. **`draft` is the resting state, not a warning.** All nineteen rules are
//      born draft; research against Fedlex is not a fiduciary's sign-off and the
//      seed says so in capitals. Nineteen rules awaiting a human is what this
//      screen looks like when NOTHING IS WRONG. Drawn in red it says the
//      opposite, and a reader who learns to ignore red here will ignore it on
//      `rejected` too.
//   2. **`source_confidence` is a fact about the SOURCE, not about the rule.**
//      `needs_fiduciary_check` does not mean the rule is doubtful; it means the
//      article behind it is not settled. It is provenance and it renders as
//      provenance.
//   3. **An edit without corrected wording is refused by the route**, and the
//      form must not be able to send one. `edited_needs_logic`: *"an edit
//      without the corrected wording is an approval wearing a different name"*.
//
// Every one of those is a `className` or a `disabled` away from being wrong in
// JSX, where nothing but a browser can see it — the `accountsLabel` lesson.
//
// ===========================================================================
// EVERY MAPPING BELOW IS TOTAL, AND AN UNKNOWN VALUE IS NAMED RATHER THAN BINNED
// ===========================================================================
// `review_state`, `severity` and `source_confidence` are `varchar` columns, not
// enums this bundle owns. A value added server-side must not fall into a
// default: falling into `draft`'s calm treatment would hide a rejection, and
// falling into `blocker`'s would invent one. So each lookup returns `null` for a
// value it does not know and the screen renders the raw string beside a note
// that this build does not recognise it.

/** How loudly a state is drawn. NOT a severity — see `severityTone`. */
export type Tone = 'calm' | 'good' | 'warn' | 'bad'

export interface StateFace {
  /** What the reader is told the state means, in one phrase. */
  label: string
  tone: Tone
  /** One sentence of what it implies. Rendered under a filter or in a legend. */
  meaning: string
}

/**
 * The four review states.
 *
 * ── `draft` IS `calm`, AND THAT IS THE WHOLE POINT OF THIS TABLE ─────────
 * Mutation to watch it fire: change it to `'warn'` and
 * `lib/compliance.test.ts` goes red naming the state.
 *
 * ── AND THERE IS NO WAY BACK TO IT ───────────────────────────────────────
 * `reviewComplianceRule` refuses `draft` as a review verdict: *"draft is where
 * rules are born, not a state a review sets"* — un-reviewing would erase the
 * fact that somebody looked. `REVIEW_CHOICES` below is what the form offers and
 * it does not contain it.
 */
const REVIEW_STATE_FACES: Record<string, StateFace> = {
  draft: {
    label: 'Draft',
    tone: 'calm',
    meaning:
      'Researched against Fedlex and waiting for a human. This is where every rule starts; it is not a problem with the rule.',
  },
  approved: {
    label: 'Approved',
    tone: 'good',
    meaning: 'Signed off as written. The check logic below is the wording that stands.',
  },
  edited: {
    label: 'Edited',
    tone: 'good',
    meaning:
      'Signed off with corrected wording. The original is kept beside it — a review replaces nothing.',
  },
  rejected: {
    label: 'Rejected',
    tone: 'bad',
    meaning: 'Signed off as wrong. The rule is kept, because a verdict may cite it forever.',
  },
}

export function reviewStateFace(state: string): StateFace | null {
  return REVIEW_STATE_FACES[state] ?? null
}

/** Has a human looked at this rule at all? `draft` is the only "no". */
export function isReviewed(state: string): boolean {
  return state !== 'draft'
}

/**
 * The three severities, as the seed serves them.
 *
 * A severity is what the rule COSTS when it is violated, and it is served, never
 * derived here. `blocker` is drawn as the strongest and `info` as the calmest,
 * which is the one place on this screen colour is allowed to mean urgency —
 * because here it is the rule's own claim rather than this app's.
 */
const SEVERITY_FACES: Record<string, StateFace> = {
  blocker: {
    label: 'Blocker',
    tone: 'bad',
    meaning: 'Violating it makes the books or a filing wrong, not merely untidy.',
  },
  warning: {
    label: 'Warning',
    tone: 'warn',
    meaning: 'Violating it creates exposure that has to be explained.',
  },
  info: {
    label: 'Info',
    tone: 'calm',
    meaning: 'A permission or a threshold worth knowing. Nothing is violated by it.',
  },
}

export function severityFace(severity: string): StateFace | null {
  return SEVERITY_FACES[severity] ?? null
}

/** Sort order for the register: blockers first, unknown values last. */
export function severityRank(severity: string): number {
  return severity === 'blocker' ? 0 : severity === 'warning' ? 1 : severity === 'info' ? 2 : 3
}

/**
 * PROVENANCE. Where the rule's source stands — not how sure the rule is.
 *
 * The three values the seed carries, each phrased as a claim about the SOURCE.
 * `needs_fiduciary_check` is the honest one and the reason this whole column
 * exists: a reader must be able to see which rules rest on statute the agent
 * read in Fedlex and which rest on something softer.
 *
 * **Tone `calm` on all three, deliberately.** A softer source is not an error;
 * it is a disclosure. Drawing `doctrine_inferred` in amber would make the
 * disclosure look like a defect and teach a reader to stop reading the column.
 */
export interface Provenance {
  label: string
  meaning: string
}

const PROVENANCE: Record<string, Provenance> = {
  verified_fedlex: {
    label: 'Verified in Fedlex',
    meaning: 'The agent read the cited article in the federal law collection.',
  },
  doctrine_inferred: {
    label: 'Inferred from doctrine',
    meaning:
      'A reading of the cited article rather than a quotation of it. The article says less than the rule does.',
  },
  needs_fiduciary_check: {
    label: 'Needs a fiduciary',
    meaning:
      'The source itself is not settled. A fiduciary has to confirm how the article applies before this rule is relied on.',
  },
}

export function provenanceOf(confidence: string): Provenance | null {
  return PROVENANCE[confidence] ?? null
}

/** Which legal form a rule binds, spelled for a reader. */
export function appliesToText(appliesTo: string): string {
  return appliesTo === 'both'
    ? 'Every book'
    : appliesTo === 'SA'
      ? 'SA / Sàrl'
      : appliesTo === 'RI'
        ? 'Sole proprietorship'
        : appliesTo
}

// ===========================================================================
// THE REVIEW — THE FIFTH WRITE, AND THE ONE WITH NO UNDO
// ===========================================================================

/** The three outcomes the route accepts. `draft` is not one; see above. */
export const REVIEW_CHOICES = ['approved', 'edited', 'rejected'] as const
export type ReviewChoice = (typeof REVIEW_CHOICES)[number]

/**
 * May this review be sent?
 *
 * ── IT MIRRORS THE ROUTE, IT DOES NOT REPLACE IT ─────────────────────────
 * `reviewComplianceRule` refuses `state === 'edited'` with no
 * `editedLogic?.trim()`. This is the same test, on the client, so the button is
 * not offered — and the server's refusal is still rendered verbatim when it
 * arrives, because a client-side test is a courtesy and the route is the rule.
 * The screen deliberately keeps a way to reach that refusal: see
 * `<ComplianceReviewForm>`'s note on the escape hatch.
 *
 * **Whitespace-only wording is nothing.** `.trim()` on both sides, because
 * `edited_logic: "   "` would pass a truthiness check here, be refused by the
 * route, and read to the user as the app being broken.
 */
export function canSubmitReview(choice: ReviewChoice, editedLogic: string): boolean {
  if (choice === 'edited') return editedLogic.trim().length > 0
  return true
}

/** The body `PATCH /api/compliance-rules/{rule}` reads. Typed from the route. */
export interface ReviewBody {
  state: ReviewChoice
  /** Required when `state` is `edited`; the route refuses an edit without it. */
  edited_logic?: string
  note?: string
}

/**
 * The body, built once so the form cannot send a field the route ignores.
 *
 * `edited_logic` is sent ONLY on an edit. The query layer writes
 * `data.state === 'edited' ? editedLogic : rule.edited_logic`, so sending it
 * alongside `approved` is silently discarded — and a field that is silently
 * discarded is a field somebody will believe was saved.
 */
export function reviewBody(choice: ReviewChoice, editedLogic: string, note: string): ReviewBody {
  const body: ReviewBody = { state: choice }
  if (choice === 'edited') body.edited_logic = editedLogic.trim()
  if (note.trim()) body.note = note.trim()
  return body
}

/**
 * The wording that STANDS for a rule — the edit if there is one, else the
 * original.
 *
 * ── AND THE ORIGINAL IS NEVER DISCARDED ──────────────────────────────────
 * `edited_logic` is a separate column precisely so `check_logic` survives an
 * edit. A screen showing only the edit would lose what the fiduciary corrected,
 * which is the record of the correction. So this returns which is which, and the
 * screen shows both when they differ.
 */
export interface EffectiveLogic {
  text: string
  /** True when a fiduciary's correction is what stands. */
  corrected: boolean
  /** The original, present only when a correction supersedes it. */
  original: string | null
}

export function effectiveLogic(rule: {
  check_logic: string
  edited_logic: string | null
}): EffectiveLogic {
  const edited = rule.edited_logic?.trim()
  if (edited) return { text: edited, corrected: true, original: rule.check_logic }
  return { text: rule.check_logic, corrected: false, original: null }
}

/** How many rules sit in each review state. The register's one summary line. */
export function countByState(rules: { review_state: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rules) out[r.review_state] = (out[r.review_state] ?? 0) + 1
  return out
}
