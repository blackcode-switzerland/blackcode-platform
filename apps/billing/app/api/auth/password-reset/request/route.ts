// POST /api/auth/password-reset/request — public "forgot password", step 1.
//
// The route the login page's "Forgot password?" link needs. An app has its own
// login, so it owes its own recovery: `apps/sales` used to send people to
// `apps/issues` to change a password both apps share, which is a dead end
// dressed up as a cross-reference.
//
// Always answers `{ ok: true }` when it can deliver, whether or not the address
// has an account — see the factory. Whether an email is registered is exactly
// the fact an unauthenticated caller must not be able to probe for, and it is
// the same reasoning the login form's single "email and password do not match"
// message carries.

import { publicPasswordResetRequestRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { canDeliverEmail, sendPasswordResetEmail } from '@/lib/email/send'

export const POST = publicPasswordResetRequestRoute(appContext, {
  canDeliverEmail,
  sendPasswordResetEmail,
})
