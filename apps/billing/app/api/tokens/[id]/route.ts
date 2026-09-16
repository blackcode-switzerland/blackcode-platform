// DELETE /api/tokens/{id} — mounted from the shared factory.
// Session-only, same rationale and same mount-time enforcement as /api/tokens.
//
// Revoking works from any deployment, and that is the point rather than a
// coincidence: a token is one credential, so the answer to "where do I turn this
// off?" must not be "in the app you happened to create it in".

import { tokenRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

const handlers = tokenRoute(appContext)

export const DELETE = handlers.DELETE
