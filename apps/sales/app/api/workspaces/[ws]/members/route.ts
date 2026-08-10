// GET /api/workspaces/{ws}/members — `bk member list`.
//
// Serves `sales.workspace_members`, not `platform.workspace_members`, since
// Phase 2. The route file is unchanged in shape because the factory reads
// `AppContext.workspaces` rather than a table — see
// `packages/platform-api/src/workspace-source.ts`.
import { workspaceMembersRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const GET = workspaceMembersRoute(appContext)
