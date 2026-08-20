'use client'

// The writes that are NOT writes to the books.
//
// ===========================================================================
// WHY THIS IS NOT IN lib/mutations.ts
// ===========================================================================
// `lib/mutations.ts` is about RECORD writes — the five buttons that change
// b/books' own data (resolve an entry, create a rule, post a staged entry,
// approve a compliance rule). Every one of them is built on `useRecordMutation`,
// which gates on `useCanWrite()`, and that file's whole argument is "there are
// four, and here they are".
//
// These are a different thing wearing the same clothes:
//
//   create an account   POST /api/auth/register         no session exists yet
//   edit your profile   PATCH /api/me                   `platform.users`, one
//                                                       row across every app
//   reset a password    POST /api/auth/password-reset/* logged out, by email
//   change a password   POST /api/me/password/*         logged in, by session
//   mint a token        POST /api/tokens                `platform.api_tokens`
//   revoke a token      DELETE /api/tokens/{id}         the same rows
//   authorize the CLI   POST /api/cli/authorize         mints the same token
//   set your language   PATCH /api/me                   `platform.users.locale`,
//                                                       one row across every app
//
// ── THE LIST GREW ON 2026-08-19, AND A WIDENED GUARD OWES ITS REASON ───────
// It was two. b/books took fullstack ownership and gained the account surface
// the other two apps already had — forgot-password, change-password, API tokens,
// and the browser half of `bk login`. Every one of them is an ACCOUNT write:
// `platform.users`, `platform.password_reset_otps`, `platform.api_tokens`. Not
// one of them touches `books.*`.
//
// **The guard's claim is unchanged in strength.** `lib/read-only.test.ts` still
// says a write comes from a named module or the suite is red, and this file is
// still one of exactly two names. What would weaken it is putting these in
// `lib/mutations.ts` — they would become "one of the five writes", which they
// are not — or letting a component call `apiSend`, which deletes the guard
// outright. If you are about to add something here, the test is the one below:
// does it touch `books.*`? Then it belongs in the other file.
//
// None of them touches `books.*`. None is a bookkeeping decision. And putting them
// behind `useCanWrite()` would be actively wrong the moment that hook becomes
// real: phase 2 replaces it with the WORKSPACE ROLE, at which point "may this
// person post an entry" would be deciding whether a stranger may create an
// account and whether you may change your own name. Two different questions with
// one answer is how a gate ends up either useless or locking people out.
//
// So: separate module, separate name, and `lib/read-only.test.ts` names it as
// the second — and last — module permitted to send a write.
//
// ── AND NEITHER OF THESE IS A SECURITY CONTROL EITHER ──────────────────────
// The register route checks the platform whitelist server-side before any write,
// and `PATCH /api/me` resolves the caller from the session. This module is
// transport plus a loading flag. It refuses nothing.

import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from '@blackcode/platform-i18n'
import { useLocaleContext } from '@blackcode/platform-i18n/client'
import { apiSend, ApiRequestError } from './client'
import { booksGlobalKey } from './query-keys'
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

/**
 * The one primitive in this file, mirroring `useRecordMutation`'s shape so a
 * component written against one reads the same as a component written against
 * the other.
 *
 * It resolves to a result and rethrows anything that is not an `ApiRequestError`.
 * The server's `suggestion` survives on that error object and is folded into
 * `message` — for the register route that is the whitelist sentence, and for the
 * password routes it is "ask an administrator to configure RESEND_API_KEY",
 * which is the difference between a dead end and a next step.
 */
function useAccountWrite<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string
): AccountWriteState<T> {
  return useAccountWriteAt<T>(method, () => path)
}

/**
 * The same primitive for a path that is only known when the button is pressed.
 *
 * Revoking a token is `DELETE /api/tokens/{id}`, and the id is the row the
 * reader just clicked. A hook cannot be called per row — that is the rules of
 * hooks — so the path is a function of the argument instead, and there is still
 * exactly one place in this app that sends a write to the account.
 */
function useAccountWriteAt<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  pathOf: (body: unknown) => string
): AccountWriteState<T> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiRequestError | null>(null)

  const run = useCallback(
    async (body: unknown): Promise<AccountWriteResult<T>> => {
      setPending(true)
      setError(null)
      try {
        return { ok: true, data: await apiSend<T>(method, pathOf(body), body) }
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
    [method, pathOf]
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

/* ------------------------------------------------------------------ password */

/**
 * Ask for a 6-digit code, so a password can be set.
 *
 * Two routes, one shape, and which one you want depends on whether a session
 * exists — that is the whole difference between "I forgot my password" and "I
 * would like to change my password":
 *
 *   authenticated = false   `/api/auth/password-reset/request`, takes an email
 *   authenticated = true    `/api/me/password/request-otp`, takes the session
 *
 * ── THE LOGGED-OUT ONE ANSWERS `{ ok: true }` FOR AN UNKNOWN ADDRESS ───────
 * Deliberately, in the route. Whether an email has a blackcode account is
 * precisely the fact an unauthenticated caller must not be able to probe for,
 * and it is the same reasoning behind the login form's single "that email and
 * password do not match an account" message.
 *
 * A deployment with no `RESEND_API_KEY` answers **503 `email_not_configured`**
 * instead of a cheerful 200 — that status exists so this app never tells anybody
 * to watch an inbox nothing was sent to. The refusal carries a `suggestion`, and
 * `sentence()` above folds it into the message the form renders.
 */
export function useRequestPasswordCode(authenticated: boolean) {
  return useAccountWrite<{ ok: true; email?: string }>(
    'POST',
    authenticated ? '/api/me/password/request-otp' : '/api/auth/password-reset/request'
  )
}

/**
 * Verify the code and set the new password.
 *
 * **A success signs you out of every blackcode app, including this session.**
 * `password_changed_at` moves, and `getValidatedSessionUser` rejects any session
 * issued before it — which is the point (a reset is how you lock out whoever had
 * the old one) and is a surprise if nobody says it first. Both callers say it
 * before the form opens.
 */
export function useConfirmPassword(authenticated: boolean) {
  return useAccountWrite<{ ok: true }>(
    'POST',
    authenticated ? '/api/me/password/confirm' : '/api/auth/password-reset/confirm'
  )
}

/* -------------------------------------------------------------------- tokens */

/** A token as `GET /api/tokens` lists it. The secret is not in this shape. */
export interface TokenSummary {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  created_at: string | null
}

/** What `POST /api/tokens` answers — the summary, plus the one look at the secret. */
export interface MintedToken extends TokenSummary {
  /** Returned ONCE, at creation. Nothing can show it again, including the database. */
  plaintext: string
}

/**
 * Mint an API token.
 *
 * **It is not a b/books token.** `platform.api_tokens` is one table for the whole
 * suite, so this credential reaches every app the account can reach, and one
 * revoked here stops working in all of them. That is the thing a reader is most
 * likely to assume otherwise, so the page says it rather than leaving it to be
 * discovered by a command failing somewhere else.
 */
export function useCreateToken() {
  return useAccountWrite<MintedToken>('POST', '/api/tokens')
}

/**
 * Revoke one, by id.
 *
 * `run({ id })` — the id is in the BODY only so this hook can read it back out
 * for the path; the route takes it from the URL. See `useAccountWriteAt`.
 */
export function useRevokeToken() {
  return useAccountWriteAt<{ deleted: true }>(
    'DELETE',
    (body) => `/api/tokens/${Number((body as { id: number }).id)}`
  )
}

/**
 * Authorize `bk login` — the browser half, posted by `/cli/authorize`.
 *
 * It mints the same platform-wide token as the page above and hands it to a
 * localhost callback the SERVER re-validates. Nothing about the callback is
 * trusted from the query string; `parseCallbackURL` refuses anything that is not
 * a loopback address, in the page and again in the route.
 */
export function useAuthorizeCli() {
  return useAccountWrite<{ redirect_url?: string }>('POST', '/api/cli/authorize')
}

/* -------------------------------------------------------------------- locale */

/**
 * Choose the interface language — or clear the choice.
 *
 * ===========================================================================
 * THE ONE HOOK BOTH SWITCHES USE
 * ===========================================================================
 * There are two places to change the language: **Settings → Preferences** and
 * the **sidebar**. They call this, and only this. Two switches with two code
 * paths is how they end up disagreeing about what the stored value is, and in
 * this app the disagreement would be ON SCREEN AT THE SAME TIME — the sidebar
 * is mounted on the settings page.
 *
 * It is here rather than in `lib/mutations.ts` for this file's standing reason:
 * it touches `platform.users`, one row across every blackcode app, and nothing
 * in `books.*`. `lib/read-only.test.ts` names this module as one of exactly two
 * allowed to send a write.
 *
 * ── THREE THINGS MOVE, AND EACH ANSWERS A DIFFERENT REQUEST ────────────────
 *
 *   1. **`PATCH /api/me`** — the durable choice. It is what makes the language
 *      follow the person to another machine and to another blackcode app.
 *   2. **The context** — the tree re-renders in the new language immediately.
 *      Without it the reader clicks EN and nothing happens until a navigation.
 *   3. **The `bk_locale` cookie** — what the SERVER reads on the next request,
 *      before React exists. It is what keeps the first paint correct after a
 *      hard reload, and it is the only source that works on `/login` and the
 *      marketing page, where there is no session row to read.
 *
 * The `/api/me` cache is invalidated rather than patched: the settings page
 * renders `me.data.locale` to decide whether "Follow my browser" is the current
 * state, and the server is the only thing that knows what the column now says.
 *
 * ── `null` IS A REAL ARGUMENT AND MEANS "UNDO MY CHOICE" ───────────────────
 * Not "choose English". It clears the column and the cookie, handing the reader
 * back to `Accept-Language`. The route accepts it explicitly for this.
 */
export function useSetLocale() {
  const write = useAccountWrite<MeRow>('PATCH', '/api/me')
  const { setLocale } = useLocaleContext()
  const queryClient = useQueryClient()

  const run = useCallback(
    async (locale: Locale | null) => {
      const saved = await write.run({ locale })
      if (!saved.ok) return saved
      // The context takes the EFFECTIVE locale. Clearing the preference does not
      // mean "render nothing" — it means "render what the browser asks for", and
      // the server's answer to that arrives on the next request. Until then the
      // honest thing on screen is what the reader was already reading, so a
      // cleared preference leaves the current language alone rather than
      // guessing at `navigator.language` in a second, different resolution order
      // from the package's.
      if (locale) setLocale(locale)
      writeLocaleCookie(locale)
      await queryClient.invalidateQueries({ queryKey: booksGlobalKey('me') })
      return saved
    },
    [write, setLocale, queryClient]
  )

  return { run, pending: write.pending, error: write.error }
}

/**
 * The cookie half, written from the browser rather than by the route.
 *
 * `PATCH /api/me` is shared by three apps and a `Set-Cookie` from it would put a
 * books-shaped concern into `packages/platform-api` — the thing §7 of the phase
 * brief warns about. The cookie is a client-side cache of a server-side fact;
 * the server-side fact is the column, and it is already written above.
 *
 * `SameSite=Lax` and no `Secure` flag, because this has to work on
 * `http://localhost:3200`. It carries a language name and nothing else — there
 * is no session value here to protect.
 */
function writeLocaleCookie(locale: Locale | null) {
  if (typeof document === 'undefined') return
  document.cookie = locale
    ? `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`
    : `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`
}
