// Public "forgot password" — step 1. Emails a 6-digit OTP if an account
// exists. Always returns { ok: true } regardless, so the endpoint can't be
// used to enumerate which emails have accounts.

import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors } from '@/lib/api'
import { validateEmail } from '@/lib/auth/password'
import {
  OTP_EXPIRES_IN_MINUTES,
  requestPasswordOtp,
} from '@/lib/db/queries/password-reset'
import { canDeliverEmail, sendPasswordResetEmail } from '@/lib/email/send'

export const POST = apiHandler(async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const emailErr = validateEmail(email)
  if (emailErr) throw Errors.badRequest('invalid_email', emailErr)

  // Honest degradation (Phase 10). A deployment that cannot deliver a code must
  // say so; the generic `{ ok: true }` below would otherwise leave the person
  // waiting for mail that was never sent. `canDeliverEmail` is not
  // `emailEnabled` — outside production the OTP goes to the server log instead,
  // which is why the block below still exists.
  //
  // Safe to answer before the account lookup, and deliberately BEFORE it: this
  // says something about the DEPLOYMENT, not about whether the address has an
  // account, so it cannot be used to enumerate. Putting it after the lookup is
  // what would make it an oracle.
  if (!canDeliverEmail()) {
    throw Errors.serviceUnavailable(
      'email_not_configured',
      'This deployment cannot send email, so it cannot deliver a reset code.',
      'Ask an administrator to configure RESEND_API_KEY and RESEND_FROM_EMAIL for this app.'
    )
  }

  const result = await requestPasswordOtp(email)

  if (result.status === 'sent') {
    const send = await sendPasswordResetEmail(email, {
      otp: result.otp,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      name: result.user.name,
    })
    // Dev affordance: when email isn't actually delivered (Resend not
    // configured, or test-mode restriction), surface the code in the server
    // log so local testing works. Never in production.
    if (!send.sent && process.env.NODE_ENV !== 'production') {
      console.log(`[password-reset] OTP for ${email}: ${result.otp}`)
    }
  }

  // Generic response in every case (no_account / rate_limited included).
  return NextResponse.json({ ok: true })
})
