// POST /api/me/active-workspace — the write half of `bk <app> workspace use`.
//
// Pairs with GET /api/workspaces. Mounting one without the other gives a CLI
// that can list this app's workspaces and not select one — and since Phase 4
// every other command in `bk scaffold …` resolves its tenancy from that
// selection, an app without this route has a group that cannot address anything.
// Added 2026-08-10, when the verb move made the gap visible.
//
// The factory resolves the target through `AppContext.workspaces`, i.e. THIS
// app's table, so it cannot store another app's workspace id.
import { activeWorkspaceRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'

export const POST = activeWorkspaceRoute(appContext)
