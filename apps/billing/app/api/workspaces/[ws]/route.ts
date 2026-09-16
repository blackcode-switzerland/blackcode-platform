// GET /api/workspaces/{ws} — one workspace.
//
// **`bk workspace use <slug>` RESOLVES THROUGH THIS ROUTE.** That makes it the
// single most load-bearing platform route for a new app: almost every other
// command needs an active workspace, so an app that does not serve this one
// fails at the second command an agent types and every command after it.
//
// It was the first thing to break in the sales north-star run.
import { workspaceShowRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceShowRoute(appContext)
