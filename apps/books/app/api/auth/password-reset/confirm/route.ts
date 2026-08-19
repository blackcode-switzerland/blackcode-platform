// POST /api/auth/password-reset/confirm — public "forgot password", step 2.
//
// It touches `platform.users` and `platform.password_reset_otps` only, which is
// why it needs no email binding: nothing is sent here, a code is checked.
//
// Success bumps `password_changed_at`, which ends every session on every app —
// it is one credential, and b/books is not a place it can be changed for b/books
// alone.

import { publicPasswordResetConfirmRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = publicPasswordResetConfirmRoute(appContext)
