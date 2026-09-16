// GET /api/workspaces/{ws}/members — `bk member list`. Platform data.
import { workspaceMembersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceMembersRoute(appContext)
