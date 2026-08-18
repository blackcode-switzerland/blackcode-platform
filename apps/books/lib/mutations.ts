// The ONLY module that sends `apiSend` at a record path.
//
// ===========================================================================
// THE FOUR WRITES, AND WHY THERE ARE ONLY FOUR
// ===========================================================================
// b/books has thirteen screens and four buttons that change data:
//
//   1. resolve an entry        say what a transaction means      (phase 2)
//   2. create a rule           teach it, so the next one is automatic (phase 2)
//   3. post a staged entry     move it into the books            (phase 1)
//   4. approve a rule          fiduciary sign-off on a check     (phase 5)
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
// PHASE 2 LANDED THE FIRST TWO. THE OTHER TWO ARE STILL COMMENTED.
// ===========================================================================
// `useResolveEntry` and `useCreateRule` are real as of 2026-08-18. Posting and
// compliance approval are not, and they stay COMMENTED rather than stubbed for
// the reason that has not changed: a stub that returns success is a lie a
// component builds on.
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
import type { RecognitionRule, ResolveResult } from './types'

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
// The four writes. Each lands with its phase.
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
 * ── `number` IS A `books.entry` #NUMBER AND NOTHING ELSE ──────────────────
 * The worklist serves two kinds of row and their #number series OVERLAP.
 * `resolveEntry` looks the row up as `(workspace_id, seq)` in `books.entry`
 * only — there is no RI path anywhere in `lib/db/queries/resolve.ts` — so
 * handing this hook an `ri_entry` row's number rewrites an unrelated journal
 * entry and answers 200. Reproduced on 2026-08-18: resolving RI #5 overwrote
 * the January payroll. Raised on ticket #51.
 *
 * **The screen must never construct this hook from an RI row.** It is held by
 * the type: `<ResolveForm>` takes a `WorklistRow` narrowed to `kind: 'entry'`,
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
 * Phase 1. Post a staged entry.
 *
 * The server checks that the lines balance, that every account maps, and that the
 * compliance pass did not return `blocked`. Posting is one-way: a posted entry is
 * immutable and a correction is a reversing entry.
 */
// export function usePostEntry(ws: string, number: number) {
//   return useRecordMutation<Entry>('POST', `/api/workspaces/${ws}/entries/${number}/post`)
// }

/** Phase 5. Fiduciary sign-off on a compliance rule. */
// export function useApproveComplianceRule(ws: string, ruleId: string) {
//   return useRecordMutation<void>('PATCH', `/api/workspaces/${ws}/compliance-rules/${ruleId}`)
// }

// Re-exported so a component never reaches into lib/client.ts for it.
export { ApiRequestError }
