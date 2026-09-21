// GET /api/workspaces/{ws}/invite-candidates — `bk billing invite candidates`.
//
// Phase 2 (2026-09-21), ported from `apps/sales`, whose route header argues the
// whole shape — read it there. In short:
//
//   - owner-only, the same gate as POST /invitations: "who do you already share
//     a workspace with" is not a question a member needs answered;
//   - an ordinary owner sees people they share a BILLING workspace with, never
//     another app's colleagues — the join in `listInviteCandidates` is the
//     privacy guard;
//   - a super admin additionally sees every live account, flagged
//     `from_platform` so the UI can keep "somebody you work with" and "somebody
//     with a blackcode login" in separate sections.
import { NextRequest, NextResponse } from 'next/server'
import { isSuperAdmin } from '@blackcode/platform-auth'
import { apiHandler, requireOwner, resolveWorkspace } from '@/lib/api'
import { listInviteCandidates } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  // Asked ONCE and used for both, so the list and the flag cannot disagree.
  const superAdmin = isSuperAdmin(ctx.user.email)
  const data = await listInviteCandidates({
    userId: ctx.user.id,
    currentWorkspaceId: ctx.workspace.id,
    includePlatform: superAdmin,
  })
  return NextResponse.json({ data, next_cursor: null, is_super_admin: superAdmin })
})
