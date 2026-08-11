// POST /api/auth/password-reset/request — public "forgot password", step 1.
//
// This is the route the login page's "Forgot password?" link needs, and b/sales
// could not have it until `packages/platform-email` existed: the step IS
// sending a code, so an app that cannot send cannot serve it.
//
// Always answers `{ ok: true }` when it can deliver, whether or not the address
// has an account — see the factory.

import { publicPasswordResetRequestRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
import { canDeliverEmail, sendPasswordResetEmail } from '@/lib/email/send'

export const POST = publicPasswordResetRequestRoute(appContext, {
  canDeliverEmail,
  sendPasswordResetEmail,
})
