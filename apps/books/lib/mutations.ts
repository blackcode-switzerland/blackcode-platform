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
// PHASE 0: THE SHAPE, NOT THE WRITES
// ===========================================================================
// None of the four exist yet — they arrive with the tables they act on. This file
// ships now, empty of them, so the frontend has the arrangement to build against
// from its first component rather than retrofitting it around a `fetch` that went
// in early.
//
// When you add the first real one, it looks like `useResolveEntry` below.

'use client'

import { useCallback, useState } from 'react'
import { apiSend, ApiRequestError } from './client'

/**
 * Whether this session may write.
 *
 * Phase 0 returns true: there are no writes to gate, and returning false would
 * make the first real mutation look broken. Phase 2 replaces this with the
 * workspace role and the user's own display preference, the way
 * `apps/sales/lib/ui-mode.ts` does it.
 *
 * Keep it a hook rather than a constant. Every affordance in the app reads it, so
 * making it a constant today means finding every call site later.
 */
export function useCanWrite(): boolean {
  return true
}

export interface MutationState<T> {
  run: (body?: unknown) => Promise<T | null>
  pending: boolean
  error: ApiRequestError | null
}

/**
 * THE mutation primitive. Every write in this app is built on this one function.
 *
 * It refuses when `useCanWrite()` is false rather than silently no-opping: a
 * button that appears to work and changes nothing is worse than one that errors,
 * because the user believes the write happened.
 */
function useRecordMutation<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string
): MutationState<T> {
  const canWrite = useCanWrite()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const run = useCallback(
    async (body?: unknown): Promise<T | null> => {
      if (!canWrite) {
        throw new Error(
          'This session is read-only. A write affordance was rendered that should not have been — ' +
            'see lib/mutations.ts.'
        )
      }
      setPending(true)
      setError(null)
      try {
        return await apiSend<T>(method, path, body)
      } catch (e) {
        if (e instanceof ApiRequestError) {
          setError(e)
          return null
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
 * Phase 2. Explain an entry, and optionally teach a rule from it.
 *
 * The write PRESERVES provenance: resolving records that the entry arrived
 * unrecognized and what it was resolved to, permanently. Confirmation answers
 * the question; it does not erase where the answer came from.
 *
 * Shipped commented rather than stubbed, because a stub that returns success is
 * a lie a component will build on.
 */
// export function useResolveEntry(ws: string, number: number) {
//   return useRecordMutation<Entry>('POST', `/api/workspaces/${ws}/entries/${number}/resolve`)
// }

/** Phase 2. Create a recognition rule, keyed on (source, counterparty). */
// export function useCreateRule(ws: string) {
//   return useRecordMutation<RecognitionRule>('POST', `/api/workspaces/${ws}/rules`)
// }

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
