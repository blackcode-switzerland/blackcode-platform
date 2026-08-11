// POST /api/me/password/request-otp — mounted from the shared factory.
//
// Class B (D-22). Everything about the OTP is platform — one login serves every
// app, so it is one password — but SENDING it is not: the message carries this
// app's name, from-address and branding, and there is no such thing as a
// platform-branded email. So the sender is a named second argument.

import { passwordRequestOtpRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { canDeliverEmail, sendPasswordResetEmail } from '@/lib/email/send'

export const POST = passwordRequestOtpRoute(appContext, {
  canDeliverEmail,
  sendPasswordResetEmail,
})
