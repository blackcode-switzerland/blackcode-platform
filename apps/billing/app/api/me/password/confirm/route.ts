// POST /api/me/password/confirm — Settings → Account, step 2.
//
// Verifies the code and sets the new password. A success bumps
// `password_changed_at`, which invalidates every session issued before it —
// including the one that made this request, and including sessions held by every
// OTHER blackcode app. A person signed out of four apps by a change they made in
// one is owed that warning before the form opens.

import { passwordConfirmRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = passwordConfirmRoute(appContext)
