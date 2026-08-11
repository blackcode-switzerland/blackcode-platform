// Lazy Resend client. We construct it only when RESEND_API_KEY is set so an app
// runs fine in local/dev without email configured.
//
// ---------------------------------------------------------------------------
// `emailEnabled()` IS A DEPLOYMENT FACT, NOT AN APP ONE
// ---------------------------------------------------------------------------
// It reads the environment, so it answers for THIS deployment. Two apps with
// different `RESEND_API_KEY` settings are two deployments with two answers, and
// that is correct: whether a box can send mail is a property of the box.
//
// **Callers must branch on it BEFORE doing work, not after.** Phase 10's rule:
// an app without a key must degrade HONESTLY. A reset that reports success and
// delivers nothing is worse than one that refuses, because the person waits for
// an email that was never going to arrive and has no way to tell that from a
// slow one. The route factories check this first and answer 503
// `email_not_configured`; see `send.ts` for why the sender itself still cannot
// throw.

import { Resend } from 'resend'

let cached: Resend | null = null

/** True when this deployment has both halves of the Resend configuration. */
export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_FROM_EMAIL
}

export function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!cached) cached = new Resend(process.env.RESEND_API_KEY)
  return cached
}

/**
 * Whether a code this deployment mints can actually reach a person — the
 * question the honest-degradation rule turns on, and NOT the same question as
 * `emailEnabled()`.
 *
 * **The difference is the dev carve-out, and it is deliberate.** Outside
 * production, a deployment with no Resend key still delivers: the request
 * routes print `[password-reset] OTP for …` to the server log, and the only
 * person who could read that mailbox is the developer already reading that log.
 * Refusing there would make the reset flow untestable locally without a Resend
 * account, which is a worse outcome than the one the rule exists to prevent.
 *
 * In production there is no such channel, so an unconfigured app must refuse
 * (503 `email_not_configured`) rather than accept the request and deliver
 * nothing — "no email arrived" and "the email is slow" are indistinguishable to
 * the person waiting, which is the whole failure.
 *
 * This lives here, once, so the shared `/api/me/password/request-otp` factory
 * and each app's `/api/auth/password-reset/request` cannot answer differently.
 */
export function canDeliverEmail(): boolean {
  return emailEnabled() || process.env.NODE_ENV !== 'production'
}

/**
 * Test seam: drop the memoised client so a changed `RESEND_API_KEY` is picked
 * up. Production never calls this — the key does not change within a process.
 */
export function resetResendClient(): void {
  cached = null
}
