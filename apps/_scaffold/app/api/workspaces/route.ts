// GET /api/workspaces — the workspaces this caller belongs to IN THIS APP.
//
// Membership IS the answer. It used to be narrowed by `platform.app_access`,
// which gated an app inside a shared workspace; both that table and the idea
// went on 2026-08-10, because a workspace now belongs to exactly one app.
import { workspacesRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspacesRoute(appContext)
