// The ONLY module that sends `apiSend` at a record path.
//
// ===========================================================================
// THE FIVE WRITES, AND WHY THERE ARE ONLY FIVE
// ===========================================================================
// b/books has thirteen screens and five buttons that change data:
//
//   1. resolve an entry        say what a transaction means      (phase 2)
//   2. create a rule           teach it, so the next one is automatic (phase 2)
//   3. post a staged entry     move it into the books            (phase 1 route, phase 4A UI)
//   4. approve a rule          fiduciary sign-off on a check     (phase 5)
//   5. match a pièce           say what a document proves        (phase 3)
//
// ── IT WAS FOUR UNTIL 2026-08-18, AND THE FIFTH IS A RECORDED DECISION ────
// `apps/books/docs/frontend.md` §5 and this header both said four, and phase 3
// forced the question rather than answering it (DECISIONS.md D-G): either the
// count becomes five and both files say so, or matching stays a CLI act. **A
// fifth write appearing while two files still claim four is how a documented
// invariant quietly stops being one**, so the two moved together, in this
// change, and this paragraph is the record.
//
// What decided it was CLAUDE.md's START-ANYWHERE-FINISH-IN-SYNC rule rather
// than the count. `POST /pieces/{n}/match` and `bk books piece match` both
// shipped with phase 3's backend. A capability that exists in `bk` and not in
// the web UI is a gap unless it is a deliberate, recorded decision — and the
// two that ARE recorded (`DELETE /api/me`, the board-ordering reorders) are
// both destruction the product keeps human. This is the opposite: it is the
// judgment the inbox exists to collect.
//
// And it is the same CLASS as resolve, which is what makes it safe to add
// rather than merely consistent to add. It writes no amount, no account and no
// balance; it fills the entry's `piece_*` interpretation columns and
// **deliberately does not touch the evidence tier**, because whether a receipt
// turns `partial` into `full` is a sufficiency judgment and judgments stay
// human. Nothing derived reads `books.piece_inbox`.
//
// Everything else on every screen is read. That is not minimalism for its own
// sake: the app is a tool an agent drives from outside, and the human surface is
// visibility, history and intervention. A form that lets somebody retype a
// balance is a form that lets somebody break the books.
//
// ===========================================================================
// ONE `useMutation`, AND THAT IS WHAT MAKES THE SHAPE CHECKABLE
// ===========================================================================
// Every hook below is built on `useRecordMutation`, the single mutation
// primitive in this file, which reads `useCanWrite()`. Add a second
// `useMutation(` here and the read-only guard goes red — deliberately, because
// two primitives means two places for the gate to be forgotten.
//
// Components call these hooks. Components never call `apiSend` and never hold a
// method string. See lib/client.ts.
//
// ── THE GATE IS NOT A SECURITY CONTROL (and never present it as one) ──────
// `useCanWrite()` is client-side and the user owns the client. Authorisation is
// workspace membership and the workspace role, enforced on the server, which
// refuses a write the UI allowed exactly as readily as one it did not. What the
// gate buys is that a missed affordance FAILS LOUDLY instead of writing.
//
// ===========================================================================
// ALL FIVE ARE REAL SINCE 2026-08-19. THE FIFTH IS THE COMPLIANCE REVIEW.
// ===========================================================================
// `useResolveEntry` and `useCreateRule` landed with phase 2; `useMatchPiece`
// with phase 3, both on 2026-08-18. **`usePostEntry` landed with phase 4A on
// 2026-08-19** — the route and `bk books entry post` have both existed since
// phase 1, so this was a capability in the CLI and not in the web UI, which is
// a gap under START-ANYWHERE-FINISH-IN-SYNC unless it is a recorded decision.
// It is not recorded as one; it is on the documented five. So it is built.
//
// `useReviewComplianceRule` closed the set on 2026-08-19, with phase 5.
//
// ── AND THE STUB IT REPLACED HAD THE WRONG ROUTE IN IT ───────────────────
// It stood commented out for two phases as
// `('PATCH', '/api/workspaces/{ws}/compliance-rules/{ruleId}')`, and the rules
// are NOT workspace-scoped — the route is `/api/compliance-rules/{rule}`,
// global, because the same law binds every book. A commented stub is still a
// claim about the wire, and this one was wrong the whole time with nothing to
// contradict it. **That is the argument for commenting rather than stubbing,
// arriving from a direction nobody expected**: a stub that returned success
// would have been a lie a component built on, and a stub that returns nothing
// was a lie a component would have been WIRED to. Neither is free; what a
// comment buys is that it is read when it is finally used.
//
// `MATCH_WRITE_ENABLED` in `components/pieces-inbox.tsx` still switches the
// third one off in the UI — see decision D-G's correction, and ticket #53.
//
// ===========================================================================
// A WRITE ANSWERS WITH A RESULT. IT DOES NOT ANSWER WITH `null` AND A FLAG.
// ===========================================================================
// `run` used to return `T | null` and put the failure in React state, and that
// is the exact shape of the bug `lib/account.ts` was rewritten to kill on
// 2026-08-17:
//
//     const saved = await resolve.run(...)
//     if (!saved) setError(resolve.error?.message ?? 'Could not save…')
//
// `resolve.error` is state. It is not readable in the tick its setter ran — the
// component has not re-rendered — so it is **always null there**, and every
// failure shows the generic fallback while the server's own sentence is thrown
// away. On the register form that turned "Email already registered. Sign in
// instead, or use a different email." into "Could not create your account."
//
// On THIS screen the same defect is worse, because every refusal resolve can
// raise is one a person can act on and none of them is generic:
//
//   bad_recognition      unrecognized and inferred are the states resolve moves AWAY from
//   bad_rule             rule: { counterparty: "IMMOREGIE" }
//   posted_lines_frozen  a correction is a reversing entry; resolve may still set
//                        explanation, counterparty and recognition
//
// A screen that renders "Could not save" over the third one has told an
// accountant that the app is broken when what happened is that the books are
// working exactly as the law requires.
//
// So `run` resolves to `WriteResult<T>` — the failure is IN THE RETURN VALUE,
// available in the same tick, and the caller cannot reach the data without going
// past it. `error` stays on the state for anything that RENDERS the last
// failure; it is not what a submit handler reads.

'use client'

import { useCallback, useState } from 'react'
import { apiSend, ApiRequestError } from './client'
import type { ComplianceRule, RecognitionRule, ResolveResult } from './types'

/**
 * Whether this session may write.
 *
 * ── IT STILL RETURNS TRUE, AND THAT IS NOW A STATEMENT RATHER THAN A STUB ──
 * Phase 0 wrote "phase 2 replaces this with the workspace role". Phase 2 read
 * the wire and could not: **no route this app serves tells the browser what the
 * signed-in person's role in this workspace is.** `GET /api/workspaces/{ws}`
 * serves the workspace, `GET /api/me` serves the account, and neither carries a
 * membership role. `books.workspace_members.role` exists in migration 0001 and
 * is read only on the server, inside `resolveWorkspace`.
 *
 * The options were to invent a role client-side (a gate that guesses is worse
 * than no gate), to add a route (out of this phase's scope, and the backend owns
 * routes), or to say so here and ask for the field. **The report asks for
 * `role` on `GET /api/workspaces/{ws}`.** Until it lands, everyone who can reach
 * a workspace can write in it — which is what the SERVER already enforces, so
 * this hook is not currently hiding anything the server would allow.
 *
 * ── AND IT IS STILL WORTH GATING ON, EVEN AT `true` ───────────────────────
 * Not because it refuses anything today, but because every affordance on the
 * recognition screen reads it, so the day it can return false there is one place
 * to change and no call sites to find. That was phase 0's argument for making it
 * a hook and it is still the right one.
 *
 * ── IT IS NOT A SECURITY CONTROL AND MUST NEVER BE PRESENTED AS ONE ───────
 * Client-side, and the user owns the client. Authorisation is workspace
 * membership and the workspace role, on the server, which refuses a write the UI
 * allowed exactly as readily as one it did not. What the gate buys is that a
 * missed affordance FAILS LOUDLY instead of writing.
 */
export function useCanWrite(): boolean {
  return true
}

/**
 * What a write gives back. **Read the failure off THIS, never off `error`.**
 *
 * Deliberately the same shape as `AccountWriteResult` in `lib/account.ts`, so a
 * component written against one reads the same as a component written against
 * the other, and the discipline is one thing to learn rather than two.
 */
export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiRequestError; message: string }

export interface MutationState<T> {
  run: (body?: unknown) => Promise<WriteResult<T>>
  pending: boolean
  /**
   * The last failure, for anything that RENDERS it across a re-render.
   *
   * **Not readable in the tick `run` resolved** — that is the whole reason the
   * result exists. A submit handler reads the result; a banner that survives may
   * read this.
   */
  error: ApiRequestError | null
}

/**
 * Join the server's reason and its recovery into one sentence a person reads.
 *
 * Routes write these as two fragments — "a taught rule needs a counterparty
 * fragment" and "rule: { counterparty: \"IMMOREGIE\" }" — neither ending in a
 * full stop. The punctuation is added here rather than in the routes, because
 * `bk` prints the same two fields as separate lines and does not want it. Same
 * function, same reason, as `lib/account.ts`; kept local because these two files
 * are deliberately independent of each other.
 */
function sentence(message: string, suggestion?: string): string {
  if (!suggestion) return message
  const end = /[.!?]$/.test(message) ? '' : '.'
  return `${message}${end} ${suggestion}`
}

/**
 * THE mutation primitive. Every write in this app is built on this one function.
 *
 * It refuses when `useCanWrite()` is false rather than silently no-opping: a
 * button that appears to work and changes nothing is worse than one that errors,
 * because the user believes the write happened. That refusal THROWS — it is not
 * an `ok: false` result — because it is not a failed write, it is a bug in this
 * app's own rendering, and a caller that handled it as an ordinary refusal would
 * show the user a message about a problem the user cannot have caused.
 */
function useRecordMutation<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string
): MutationState<T> {
  const canWrite = useCanWrite()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const run = useCallback(
    async (body?: unknown): Promise<WriteResult<T>> => {
      if (!canWrite) {
        throw new Error(
          'This session is read-only. A write affordance was rendered that should not have been — ' +
            'see lib/mutations.ts.'
        )
      }
      setPending(true)
      setError(null)
      try {
        return { ok: true, data: await apiSend<T>(method, path, body) }
      } catch (e) {
        if (e instanceof ApiRequestError) {
          setError(e)
          // `client.ts` synthesises a message for a body it could not parse, so
          // this is never blank and no caller needs a fallback string. THE
          // SERVER'S OWN SENTENCE IS WHAT THE READER SEES.
          return { ok: false, error: e, message: sentence(e.message, e.suggestion) }
        }
        throw e
      } finally {
        setPending(false)
      }
    },
    [canWrite, method, path]
  )

  return { run, pending, error }
}

// ---------------------------------------------------------------------------
// The five writes. Each lands with its phase.
//
// It was four until 2026-08-18, when `useMatchPiece` landed with phase 3.
// The count is stated in `apps/books/docs/frontend.md` too, and both were
// moved in the same change — a fifth write appearing while a file still says
// four is how a documented invariant quietly stops being one.
// ---------------------------------------------------------------------------

/**
 * The body `POST /entries/{n}/resolve` accepts, typed from the ROUTE.
 *
 * `explanation` is an OBJECT, not a string — the route refuses anything else
 * (`typeof explanation !== 'object'` → `missing_explanation`), and `bk books
 * resolve` sends `{"en": text}`. This app is English chrome (D-A), so it sends
 * the same one key. A French side would be a translation nobody wrote.
 *
 * Omitting `recognition` is meaningful: the server then concludes
 * `known_recurring` when a rule is taught and `known_one_off` when one is not.
 * The form sends it explicitly anyway, because "the button I pressed decided
 * this" is a worse story than "the box I ticked decided this".
 */
export interface ResolveBody {
  explanation: { en: string }
  recognition?: 'known_one_off' | 'known_recurring'
  /**
   * **Which BOOK, and therefore which JOURNAL the #number is read in.**
   *
   * Added by phase 4A's backend and it is ticket #51's fix. The route looks the
   * slug up: when it names a SIMPLIFIED book the resolution runs against that
   * book's `books.ri_entry` rows, scoped by `(workspace_id, entity_id, seq)`.
   * Omitted — or naming a double-entry book — the number is read in the grand
   * livre, which is the behaviour that has always existed.
   *
   * ── OMITTING IT ON AN RI ROW IS STILL THE ORIGINAL BUG ───────────────────
   * Verified against the seeded workspace on 2026-08-19, both ways, on two rows
   * that share the number 5:
   *
   *     bk books resolve 5 --entity ri --explanation …  → ri_entry #5 resolved,
   *                                                       entry #5 UNTOUCHED
   *     bk books resolve 5 --explanation …              → entry #5 (the January
   *                                                       payroll) REWRITTEN, exit 0
   *
   * So the field is not optional in the sense that it does not matter; it is
   * optional in the sense that the grand livre is what "unqualified" means.
   * `<ResolveForm>` sends it on the recettes-dépenses arm and only there, and
   * `resolveTargetFor` in `lib/resolvable.ts` is what decides which arm exists.
   */
  entity?: string
  counterparty?: string
  /** Fills the staged line that has none. **Refused on a posted entry.** */
  account?: string
  evidence_note?: { en: string }
  rule?: {
    counterparty: string
    amount_chf?: number | null
    tolerance_chf?: number | null
    interval?: string | null
    learned_from?: string | null
  }
}

/**
 * Phase 2. Explain an entry, and optionally teach a rule from it.
 *
 * The write PRESERVES provenance: `history` records what the entry was, in the
 * same transaction, before anything changes. Confirmation answers the question;
 * it does not erase where the answer came from.
 *
 * ── `number` NAMES A JOURNAL ONLY TOGETHER WITH `entity` ──────────────────
 * The worklist serves three kinds of row and their #number series OVERLAP.
 * `resolveEntry` looks the row up as `(workspace_id, seq)` in `books.entry`;
 * `resolveRiEntry` — added by phase 4A — looks it up as
 * `(workspace_id, entity_id, seq)` in `books.ri_entry`, and the ROUTE chooses
 * between them by reading `body.entity`. So the number alone is ambiguous and
 * always was: handing this hook an `ri_entry` row's number with no `entity`
 * rewrites an unrelated journal entry and answers 200, on 2026-08-19 exactly as
 * on 2026-08-18. Ticket #51 is fixed, and the fix is a field the caller has to
 * send — see `ResolveBody.entity` for the two commands that prove both halves.
 *
 * **The screen must never construct a body this hook cannot address.** It is
 * held by the type: `<ResolveForm>` takes a `ResolveTarget`, which is produced
 * only by `resolveTargetFor(row, journal)` and carries the journal with the row,
 * and it is the only thing in the app that calls this.
 */
export function useResolveEntry(ws: string | undefined, number: number) {
  return useRecordMutation<ResolveResult>(
    'POST',
    `/api/workspaces/${ws}/entries/${number}/resolve`
  )
}

/**
 * Phase 2. Create a recognition rule that predates any entry.
 *
 * A lease or a subscription is knowledge before the first franc moves, and this
 * is how that knowledge gets in. Rules taught BY a resolution do not come
 * through here — `useResolveEntry`'s `rule` field does that, inside the same
 * transaction as the resolution, so the rule and the entry that taught it cannot
 * exist without each other.
 *
 * The book is a query parameter (`?entity=`), not a body field, because that is
 * what the route reads. Sending it in the body silently creates the rule against
 * the FIRST book in the workspace.
 */
export function useCreateRule(ws: string | undefined, entity: string | null) {
  return useRecordMutation<RecognitionRule>(
    'POST',
    `/api/workspaces/${ws}/rules${entity ? `?entity=${encodeURIComponent(entity)}` : ''}`
  )
}

/**
 * Phase 3. Say what a document proves.
 *
 * ── THE #NUMBER IS DISAMBIGUATED BY THE PIÈCE'S OWN BOOK ──────────────────
 * This is the thing ticket #51 got wrong and this route got right, and it is
 * worth understanding rather than merely using. `matchPiece` asks
 * `journalOf(piece.entity_id)` FIRST: a simplified book's entries are
 * `ri_entry` rows, a double-entry book's are the grand livre's, and an
 * unattributed pièce reads as the grand livre — *"until somebody says whose it
 * is, it cannot reach a personal recettes-dépenses book."*
 *
 * So `entry` is resolved against context the CALLER ALREADY SUPPLIED, rather
 * than against a number the caller had to get right. `useResolveEntry` above
 * has the opposite shape and that is exactly why it can rewrite an unrelated
 * journal entry. **The screen still has to say which journal the number will be
 * read in**, because the caller cannot see `journalOf` and a number typed
 * against the wrong journal is a refusal, not a wrong write — the route answers
 * `entry_not_found`.
 *
 * ── THE REFUSALS ARE ALL ACTIONABLE, SO THE SCREEN MUST PRINT THEM ────────
 *   missing_entry     no `entry` in the body, or not a positive integer
 *   piece_not_found   no pièce with that #number
 *   entry_not_found   no entry #n — **in this pièce's journal**, which is the
 *                     half a generic "not found" throws away
 *   entry_deleted     the entry is deleted
 *   already_matched   a pièce documents one entry; unmatching is not built
 *
 * Read them off the `WriteResult`, never off `mutation.error` — see this file's
 * header. `already_matched` is the one a person is most likely to hit and its
 * suggestion says why there is no undo.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 * It does not change the entry's `evidence_tier`, and no screen may offer to.
 * A matched receipt may or may not be sufficient evidence, that is a judgment,
 * and the pièce reference is what gives a human the material to make it.
 */
export function useMatchPiece(ws: string | undefined, number: number) {
  return useRecordMutation<MatchResult>(
    'POST',
    `/api/workspaces/${ws}/pieces/${number}/match`
  )
}

/**
 * What `POST /pieces/{n}/match` answers with.
 *
 * ── BUILT INLINE IN THE ROUTE, SO `wire-parity` CANNOT SEE IT ─────────────
 * There is no `publicMatch` to import, exactly like the resolve response — and
 * that is the payload where renaming a field server-side left 194/194 green
 * while the screen rendered a false statement (F-2). `lib/wire-parity.test.ts`
 * reads this route's SOURCE for its field list, which is a weaker check than
 * calling a function and is said plainly there.
 *
 * `matched_journal` is the field to respect: it says which journal
 * `matched_entry` lives in, and a screen that linked to `/ledger/{n}` for a
 * `recettes_depenses` number would open a DIFFERENT record.
 */
export interface MatchResult {
  /** The pièce's #number. */
  number: number
  /** `matched`. */
  status: string
  matched_entry: number
  matched_journal: 'grand_livre' | 'recettes_depenses'
}

/**
 * What `POST /entries/{n}/post` answers with.
 *
 * ── BUILT INLINE IN THE ROUTE, SO `wire-parity` CANNOT CALL A FUNCTION ────
 * Third payload of this kind, after resolve's and match's — the route returns
 * `postEntry`'s object directly and there is no `publicPost` to import. So
 * `lib/wire-parity.test.ts` reads the QUERY LAYER's declared return type for
 * this one, which is a declaration rather than a value and is weaker than
 * calling a shaping function; that is said plainly there. F-2 is what happens
 * without any pin at all: renaming `taught_rule` server-side left 194/194 green
 * while the screen rendered "rule # taught" for a rule nobody taught.
 *
 * ── `already` IS THE FIELD THAT DECIDES WHAT THE SCREEN SAYS ──────────────
 * `true` means the entry was ALREADY posted and this call changed nothing. It is
 * not an error and must never be drawn as one — the route is idempotent
 * deliberately, *"because the Companion retries and a retry is not an error"* —
 * and a red box over it would tell a person their books are broken when what
 * happened is that a robot pressed the same button twice.
 *
 * **A `boolean`, so `typeof === 'boolean'` is how a screen tests it**, never
 * truthiness of a possibly-missing field. `undefined` is falsy and would render
 * a re-post as a fresh post — the exact `undefined !== null` mistake F-2 was.
 */
export interface PostResult {
  /** The entry's workspace #number. */
  number: number
  /** The statutory journal number, gapless within (entity, exercice). */
  entry_no: number
  /** `posted`. */
  status: string
  /** Was it already posted before this call? Not an error. See above. */
  already: boolean
}

/**
 * Phase 1's write, built in phase 4A. Post a staged entry.
 *
 * ===========================================================================
 * THIS IS THE DEEPEST WRITE IN THE PRODUCT AND IT IS NOT ANOTHER BUTTON
 * ===========================================================================
 * The onion the backend sent settles it: **writes get harder as they travel
 * inward.** Every other write this app makes lands in ring 2 — rules and
 * meaning, the only ring that takes free rewrites, each one appending its old
 * state to `history`. Resolve, teach a rule, match a pièce: all interpretation,
 * all revisable, none of them touching the record.
 *
 * Posting is the transition INTO ring 0. From here on **nobody, human or agent,
 * can modify or delete the line**, and a correction is a new reversing entry
 * beside the old one rather than a change to it. Migration 0004's triggers are
 * what make that true, and `lib/db/queries/resolve.ts` refuses to set an account
 * on a posted entry rather than letting the trigger do it.
 *
 * So `<PostEntryForm>` requires the caller to REPEAT THE TARGET BACK, the way
 * `bk workspace delete <slug> --confirm <slug>` does. `useConfirm()` is not
 * enough for a thing that cannot be undone — CLAUDE.md: *"`Confirm()` is not a
 * guard for agents"*, and the same reasoning applies to a human reflex on a
 * dialog. The form says what becomes immutable, in the reader's words, before
 * the box appears.
 *
 * ── THE REFUSALS, AND WHO HAS THE LAST WORD ──────────────────────────────
 *   entry_not_found   404 — no entry #n. **Its message is destroyed at the
 *                     boundary**: the route calls `Errors.notFound('entry',
 *                     String(n))`, which reaches the THREE-argument overload, so
 *                     `code` becomes `entry` and `message` becomes the bare
 *                     number. Same defect as the match route's 404 (see
 *                     `<MatchPieceForm>`), and it is a backend ask. This form
 *                     cannot reach it in practice — it is rendered from an entry
 *                     already loaded — so nothing is worked around here.
 *   unresolved_lines  400 — "entry #n has N line(s) with no account", raised by
 *                     `postEntry` BEFORE the update. Recoverable: resolve it.
 *   guard_refused     400 — **migration 0004's deferred constraint, speaking at
 *                     COMMIT**, translated out of Postgres's words by the route.
 *                     Balanced, at least two lines, every line mapped. This is
 *                     the database having the last word and it is shown
 *                     VERBATIM, because a paraphrase of a constraint is a
 *                     paraphrase of the law the constraint encodes.
 *
 * Read them off the `WriteResult`, never off `mutation.error` — see this file's
 * header for the bug that rule exists because of.
 */
export function usePostEntry(ws: string | undefined, number: number) {
  return useRecordMutation<PostResult>(
    'POST',
    `/api/workspaces/${ws}/entries/${number}/post`
  )
}

/**
 * Phase 5. The fiduciary's sign-off on one compliance rule — **the fifth write,
 * and the last of the five to land.**
 *
 * ===========================================================================
 * IT IS `PATCH`, AND IT IS NOT UNDER `/api/workspaces/{ws}/`
 * ===========================================================================
 * The stub that stood here until 2026-08-19 said
 * `('PATCH', \`/api/workspaces/${ws}/compliance-rules/${ruleId}\`)` and took a
 * `ws` argument. **Both halves of that address are wrong**, and this is why the
 * file's own rule is that a write stays commented rather than stubbed: a stub is
 * a claim about a route, and this one had been carrying a wrong claim for two
 * phases with nothing to contradict it.
 *
 * The route is `/api/compliance-rules/{rule}` — global, like the rules
 * themselves. Its own header: *"The 19 statutory rules, global like the
 * vocabularies: the same law binds every book, so this is not under
 * /workspaces."* A workspace in the path would 404, and the screen would have
 * reported a missing rule.
 *
 * ── SO THIS HOOK TAKES NO WORKSPACE ─────────────────────────────────────
 * Deliberately, rather than accepting one and dropping it. Every other write in
 * this file is workspace-scoped and a reader will assume this one is too unless
 * the signature says otherwise.
 *
 * ===========================================================================
 * A REVIEW CANNOT BE TAKEN BACK, AND THE ROUTE HAS NO UNDO TO OFFER
 * ===========================================================================
 * There is no DELETE, no un-review, and `draft` is refused as a review verdict:
 * *"draft is where rules are born, not a state a review sets"* — reviewing
 * backwards would erase the fact that somebody looked. The row records WHO and
 * WHEN, from the session (`user.email`), and the client cannot set either.
 *
 * That puts this in the same class as `entry post` for the CONFIRMATION, and
 * `<ComplianceReviewForm>` says so before the button appears. It is NOT in the
 * same class for the RING: posting crosses into ring 0 and freezes amounts;
 * this is ring 2, it writes meaning, and it moves no franc. So it does not take
 * the typed-target ritual — what it takes is a confirmation that names what
 * becomes permanent.
 *
 * ── THE REFUSALS, EACH OF WHICH A PERSON CAN ACT ON ──────────────────────
 *   rule_not_found      404 — no rule with that id
 *   bad_state           400 — not one of approved/edited/rejected. Its
 *                       suggestion is the sentence about draft, above
 *   edited_needs_logic  400 — **the one this screen exists to render**: *"an
 *                       edit without the corrected wording is an approval
 *                       wearing a different name"*
 *   missing_reviewer    400 — cannot happen from here; the route reads the
 *                       session and 401s before this if there is none
 *
 * Read them off the `WriteResult`, never off `mutation.error` — this file's
 * header, and the reason it is a rule rather than a preference.
 */
export function useReviewComplianceRule(ruleId: string) {
  return useRecordMutation<ComplianceRule>('PATCH', `/api/compliance-rules/${ruleId}`)
}

// Re-exported so a component never reaches into lib/client.ts for it.
export { ApiRequestError }
