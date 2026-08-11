// /api/me/password/request-otp and /api/me/password/confirm — changing the
// password of the account you are signed in as.
//
// ---------------------------------------------------------------------------
// TWO STEPS, AND ONE OF THEM IS CLASS B (D-22)
// ---------------------------------------------------------------------------
// `confirm` is Class A: everything it touches is `platform.users` and
// `platform.password_reset_otps`.
//
// `request-otp` needs one thing this package must not have — the ability to SEND
// AN EMAIL. A message carries an app's name, its from-address and its branding,
// and there is no such thing as a platform-branded email; a sales user receiving
// "Blackcode Issues: here is your code" is the failure that would cause. So the
// sender arrives as a named, typed second argument rather than as a field on
// AppContext, which no other route would read.
//
//     export const POST = passwordRequestOtpRoute(appContext, {
//       canDeliverEmail,
//       sendPasswordResetEmail,
//     })
//
// ---------------------------------------------------------------------------
// WHY THESE ARE SHARED AT ALL
// ---------------------------------------------------------------------------
// One login serves every app. A person signed into sales who wants to change
// their password changes THE password — the same `platform.users` row that lets
// them into issues. Leaving each app to write its own would mean each app
// choosing its own OTP length, expiry and attempt cap against one shared
// credential, with the weakest one setting the real floor.
//
// ---------------------------------------------------------------------------
// THE LOGGED-OUT PAIR IS HERE TOO, SINCE 2026-08-11, AND THAT IS A REVERSAL
// ---------------------------------------------------------------------------
// This header used to say `/api/auth/password-reset/*` was "not here —
// everything under `/api/auth` is per-app by design". The ROUTES still are:
// each app mounts them under its own `app/api/auth/`, beside its NextAuth
// handler. What is no longer per-app is their BODIES.
//
// The reversal happened when b/sales needed the same pair. Writing them there
// would have produced two copies of the OTP shape — which digits are accepted,
// which failure maps to which code, which message a person reads when a code
// expires — and `packages/platform-auth`'s own header is explicit that letting
// each app choose its own OTP policy means the weakest app sets the real floor
// for ONE shared credential. `docs/adding-an-app.md` open item 8 says the same
// thing about the templates that occasioned this phase: the second copy goes
// stale silently, because nothing renders both.
//
// So the same rule that put `requestPasswordOtp` in platform-auth applies one
// layer up. What stays app-local is the two things that genuinely are an app's:
// where the route file sits, and the sender it binds.

import { NextRequest, NextResponse } from 'next/server'
import {
  OTP_EXPIRES_IN_MINUTES,
  hashNewPassword,
  requestPasswordOtp,
  validateEmail,
  validatePassword,
  verifyOtpAndResetPassword,
} from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'

/** What only the app can do: put a code in front of a person. */
export interface PasswordOtpSender {
  /**
   * Can a code this deployment mints actually reach a person.
   *
   * Checked FIRST, before the OTP is minted, because an app that cannot
   * deliver must degrade honestly (Phase 10). Accepting the request, burning a
   * rate-limit slot and returning `{ ok: true }` while nothing is delivered
   * leaves the person watching an inbox for a code that was never sent — and
   * they cannot tell that from a slow one.
   *
   * **Not `emailEnabled()`.** Outside production an unconfigured deployment
   * still delivers, to the server log; the carve-out is argued in
   * `@blackcode/platform-email`'s client.ts, and `canDeliverEmail` from that
   * package satisfies this field. The app's binding re-exports it.
   */
  canDeliverEmail(): boolean

  /**
   * Send the code. MUST NOT throw — a delivery failure is not a reason to
   * refuse a password change, and the caller has already spent the rate-limit
   * slot. Return whether it went.
   */
  sendPasswordResetEmail(
    to: string,
    input: { otp: string; expiresInMinutes: number; name: string | null }
  ): Promise<{ sent: boolean }>
}

/**
 * Mask the address when echoing it back, so the UI can say "we sent a code to
 * b•••@example.com" without putting the whole thing on screen.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const head = local.slice(0, 1)
  return `${head}${'•'.repeat(Math.max(1, local.length - 1))}@${domain}`
}

/**
 * `POST /api/me/password/request-otp` — step 1.
 *
 * Sends a code to the signed-in user's own address to confirm ownership before
 * they set a new password. Works whether or not they currently have one (a
 * Google user setting a password for the first time is the common case).
 */
export function passwordRequestOtpRoute(app: AppContext, contribution: PasswordOtpSender) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    // Honest degradation, before anything is written. See PasswordOtpSender.
    if (!contribution.canDeliverEmail()) {
      throw Errors.serviceUnavailable(
        'email_not_configured',
        'This deployment cannot send email, so it cannot deliver a reset code.',
        'Ask an administrator to configure RESEND_API_KEY and RESEND_FROM_EMAIL for this app.'
      )
    }

    const result = await requestPasswordOtp(app.db, user.email)

    if (result.status === 'rate_limited') {
      throw Errors.tooManyRequests('Too many codes requested. Try again in a few minutes.')
    }
    if (result.status === 'sent') {
      const send = await contribution.sendPasswordResetEmail(user.email, {
        otp: result.otp,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
        name: result.user.name,
      })
      if (!send.sent && process.env.NODE_ENV !== 'production') {
        console.log(`[password-reset] OTP for ${user.email}: ${result.otp}`)
      }
    }

    return NextResponse.json({ ok: true, email: maskEmail(user.email) })
  })
}

/**
 * `POST /api/me/password/confirm` — step 2.
 *
 * Verifies the code and sets the new password. A success bumps
 * `password_changed_at`, which invalidates every browser session issued before
 * it — including the one that made this request.
 */
export function passwordConfirmRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    const body = await req.json().catch(() => null)
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : ''
    const newPassword = typeof body?.new_password === 'string' ? body.new_password : ''

    if (!/^\d{6}$/.test(otp)) throw Errors.badRequest('invalid_otp', 'Enter the 6-digit code')
    const pwErr = validatePassword(newPassword)
    if (pwErr) throw Errors.badRequest('weak_password', pwErr)

    const hash = await hashNewPassword(newPassword)
    const result = await verifyOtpAndResetPassword(app.db, user.email, otp, hash)

    if (!result.ok) {
      switch (result.reason) {
        case 'no_pending_otp':
          throw Errors.badRequest('no_pending_otp', 'No active code. Request a new one.')
        case 'otp_expired':
          throw Errors.badRequest('otp_expired', 'This code has expired. Request a new one.')
        case 'too_many_attempts':
          throw Errors.badRequest('too_many_attempts', 'Too many attempts. Request a new code.')
        case 'invalid_otp':
          throw Errors.badRequest('invalid_otp', 'That code is incorrect.')
      }
    }

    return NextResponse.json({ ok: true })
  })
}


/**
 * `POST /api/auth/password-reset/request` — LOGGED-OUT step 1.
 *
 * Emails a code if an account exists. **Always returns `{ ok: true }`**
 * otherwise, including for `no_account` and `rate_limited`, so the endpoint
 * cannot be used to enumerate which addresses have accounts. That is why the
 * result of `requestPasswordOtp` is deliberately not reflected in the response.
 */
export function publicPasswordResetRequestRoute(app: AppContext, contribution: PasswordOtpSender) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const emailErr = validateEmail(email)
    if (emailErr) throw Errors.badRequest('invalid_email', emailErr)

    // Honest degradation, BEFORE the account lookup. Deliberately before: this
    // is a fact about the DEPLOYMENT, not about whether the address has an
    // account, so it cannot be used to enumerate. After the lookup it would be
    // an oracle.
    if (!contribution.canDeliverEmail()) {
      throw Errors.serviceUnavailable(
        'email_not_configured',
        'This deployment cannot send email, so it cannot deliver a reset code.',
        'Ask an administrator to configure RESEND_API_KEY and RESEND_FROM_EMAIL for this app.'
      )
    }

    const result = await requestPasswordOtp(app.db, email)

    if (result.status === 'sent') {
      const send = await contribution.sendPasswordResetEmail(email, {
        otp: result.otp,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
        name: result.user.name,
      })
      // Dev affordance: outside production, an unconfigured deployment puts the
      // code where the only person who could read that mailbox is already
      // looking. This is the channel `canDeliverEmail()` carves out for.
      if (!send.sent && process.env.NODE_ENV !== 'production') {
        console.log(`[password-reset] OTP for ${email}: ${result.otp}`)
      }
    }

    return NextResponse.json({ ok: true })
  })
}

/**
 * `POST /api/auth/password-reset/confirm` — LOGGED-OUT step 2.
 *
 * Verifies the code and sets the new password. Takes the email in the body
 * (there is no session), and is safe to do so because a correct code is the
 * proof of ownership; `verifyOtpAndResetPassword` consumes it atomically.
 */
export function publicPasswordResetConfirmRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : ''
    const newPassword = typeof body?.new_password === 'string' ? body.new_password : ''

    const emailErr = validateEmail(email)
    if (emailErr) throw Errors.badRequest('invalid_email', emailErr)
    if (!/^\d{6}$/.test(otp)) throw Errors.badRequest('invalid_otp', 'Enter the 6-digit code')
    const pwErr = validatePassword(newPassword)
    if (pwErr) throw Errors.badRequest('weak_password', pwErr)

    const hash = await hashNewPassword(newPassword)
    const result = await verifyOtpAndResetPassword(app.db, email, otp, hash)

    if (!result.ok) {
      switch (result.reason) {
        case 'no_pending_otp':
          throw Errors.badRequest('no_pending_otp', 'No active reset code. Request a new one.')
        case 'otp_expired':
          throw Errors.badRequest('otp_expired', 'This code has expired. Request a new one.')
        case 'too_many_attempts':
          throw Errors.badRequest('too_many_attempts', 'Too many attempts. Request a new code.')
        case 'invalid_otp':
          throw Errors.badRequest('invalid_otp', 'That code is incorrect.')
      }
    }

    return NextResponse.json({ ok: true })
  })
}
