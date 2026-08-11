// POST /api/auth/password-reset/confirm — public "forgot password", step 2.
//
// Class A: it touches `platform.users` and `platform.password_reset_otps` only,
// which is why it needs no email binding. Success bumps `password_changed_at`
// and so ends every session on every app — it is one credential.

import { publicPasswordResetConfirmRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = publicPasswordResetConfirmRoute(appContext)
