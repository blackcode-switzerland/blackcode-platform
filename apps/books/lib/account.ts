'use client'

// The two writes that are NOT writes to the books.
//
// ===========================================================================
// WHY THIS IS NOT IN lib/mutations.ts
// ===========================================================================
// `lib/mutations.ts` is about RECORD writes — the four buttons that change
// b/books' own data (resolve an entry, create a rule, post a staged entry,
// approve a compliance rule). Every one of them is built on `useRecordMutation`,
// which gates on `useCanWrite()`, and that file's whole argument is "there are
// four, and here they are".
//
// These two are a different thing wearing the same clothes:
//
//   create an account    POST /api/auth/register   no session exists yet
//   edit your profile    PATCH /api/me             `platform.users`, one row
//                                                  across every blackcode app
//
// Neither touches `books.*`. Neither is a bookkeeping decision. And putting them
// behind `useCanWrite()` would be actively wrong the moment that hook becomes
// real: phase 2 replaces it with the WORKSPACE ROLE, at which point "may this
// person post an entry" would be deciding whether a stranger may create an
// account and whether you may change your own name. Two different questions with
// one answer is how a gate ends up either useless or locking people out.
//
// So: separate module, separate name, and `lib/read-only.test.ts` names it as
// the second — and last — module permitted to send a write. The claim the guard
// makes is unchanged in strength ("writes come from exactly these modules") and
// gains a distinction it was missing.
//
// ── AND NEITHER OF THESE IS A SECURITY CONTROL EITHER ──────────────────────
// The register route checks the platform whitelist server-side before any write,
// and `PATCH /api/me` resolves the caller from the session. This module is
// transport plus a loading flag. It refuses nothing.

import { useCallback, useState } from 'react'
import { apiSend, ApiRequestError } from './client'
import type { MeRow } from './hooks'

/**
 * What a write gives back.
 *
 * ── WHY THIS IS A RETURNED RESULT AND NOT `error` ON THE HOOK ──────────────
 * `run` used to return `T | null` and record the failure in React state, and
 * both callers did this:
 *
 *     const created = await register.run(...)
 *     if (!created) setError(register.error?.message ?? 'Could not create…')
 *
 * `register.error` is state. It is not readable in the same tick the setter ran
 * — the component has not re-rendered — so it was **always null there**, and
 * every failure showed the generic fallback. Signing up with an email that
 * already has a blackcode account produced "Could not create your account."
 * while the server had sent "Email already registered. Sign in instead, or use
 * a different email."
 *
 * The route wrote a recovery, the client threw it away, and the reader got a
 * dead end. Found 2026-08-17 by a human trying to sign up with their own
 * address; both agents missed it because the failure path was never exercised —
 * one verified only that the success path worked.
 *
 * So the failure is now part of the RETURN VALUE, available in the same tick,
 * and there is nothing to read out of state at the wrong moment.
 * `apps/sales/components/login-form.tsx` reaches the same place by letting the
 * error throw and catching it; a returned result is that discipline made
 * un-forgettable, because the caller cannot get at the data without going past
 * the failure case.
 */
export type AccountWriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiRequestError; message: string }

export interface AccountWriteState<T> {
  run: (body: unknown) => Promise<AccountWriteResult<T>>
  pending: boolean
  /**
   * The last failure, for anything that RENDERS it.
   *
   * Do not read this straight after awaiting `run` — see the note above. The
   * result is what a submit handler wants.
   */
  error: ApiRequestError | null
}

/**
 * The one primitive in this file, mirroring `useRecordMutation`'s shape so a
 * component written against one reads the same as a component written against
 * the other.
 *
 * It resolves to a result and rethrows anything that is not an `ApiRequestError`.
 * The server's `suggestion` survives on that error object and is folded into
 * `message` — for the register route that is the whitelist sentence, which is the
 * one a rejected person most needs to be able to act on, and inventing a shorter
 * version here would be a second copy of a policy nothing checks.
 */
/**
 * Join the server's reason and its recovery into something a person reads.
 *
 * Routes write these as two fragments — "Email already registered" and "Sign in
 * instead, or use a different email" — neither ending in a full stop, so
 * concatenating them with a space produces one run-on line. The punctuation is
 * added here rather than in the routes, because the CLI prints the same two
 * fields as separate lines and does not want it.
 */
function sentence(message: string, suggestion?: string): string {
  if (!suggestion) return message
  const end = /[.!?]$/.test(message) ? '' : '.'
  return `${message}${end} ${suggestion}`
}

function useAccountWrite<T>(method: 'POST' | 'PATCH', path: string): AccountWriteState<T> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const run = useCallback(
    async (body: unknown): Promise<AccountWriteResult<T>> => {
      setPending(true)
      setError(null)
      try {
        return { ok: true, data: await apiSend<T>(method, path, body) }
      } catch (e) {
        if (e instanceof ApiRequestError) {
          setError(e)
          // `client.ts` synthesises a message for a body it could not parse, so
          // this is never blank and no caller needs a fallback string.
          return { ok: false, error: e, message: sentence(e.message, e.suggestion) }
        }
        throw e
      } finally {
        setPending(false)
      }
    },
    [method, path]
  )

  return { run, pending, error }
}

/**
 * Create a blackcode account.
 *
 * **The account is shared with every other blackcode app**, which is why the
 * gate is not here: `isEmailAllowed` (SUPER_ADMINS + `platform.email_whitelist`)
 * is checked inside `POST /api/auth/register` before any write, because an
 * ungated sign-up on books would be an ungated sign-up on issues and sales too.
 * This form only renders what the server refused.
 *
 * The route mints a workspace through `ensureWorkspaceForUser` before it
 * answers, so somebody who signs up here lands somewhere that works.
 */
export function useRegisterAccount() {
  return useAccountWrite<{ id: number }>('POST', '/api/auth/register')
}

/**
 * Edit your own profile — name, tagline, photo.
 *
 * `platform.users` is one row per person across every app, so a name changed
 * here is the name b/issues shows. The settings page says so; it is a surprise
 * otherwise, and the surprise lands on somebody else's screen.
 *
 * `avatar_url` is refused by the server for Google-connected accounts (it
 * re-syncs on each Google sign-in). `GET /api/me` carries `avatar_editable` so
 * the field can be disabled rather than the write failing after the fact.
 */
export function useUpdateProfile() {
  return useAccountWrite<MeRow>('PATCH', '/api/me')
}

// Re-exported so a component never reaches into lib/client.ts for it.
export { ApiRequestError }
