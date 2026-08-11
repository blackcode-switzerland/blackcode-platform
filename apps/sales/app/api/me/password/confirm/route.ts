// POST /api/me/password/confirm — mounted from the shared factory.
//
// Class A. Verifies the code and sets the new password; a success bumps
// `password_changed_at`, which invalidates every session issued before it —
// including the one that made this request, and including sessions held by
// every OTHER app, because it is one credential.

import { passwordConfirmRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = passwordConfirmRoute(appContext)
