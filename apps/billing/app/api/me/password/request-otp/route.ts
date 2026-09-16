// POST /api/me/password/request-otp — Settings → Account, step 1.
//
// Everything about the OTP is platform — one login serves every app, so it is
// one password — but SENDING it is not: the message carries this app's name,
// From address and colour, and there is no such thing as a platform-branded
// email. So the sender is a named second argument rather than something the
// factory reaches for.
//
// Session-only, and that is what keeps it out of `bk`: `Confirm()` is not a
// guard for an agent, and a bearer token that could change the password behind
// itself is a credential that can lock its owner out.

import { passwordRequestOtpRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { canDeliverEmail, sendPasswordResetEmail } from '@/lib/email/send'

export const POST = passwordRequestOtpRoute(appContext, {
  canDeliverEmail,
  sendPasswordResetEmail,
})
