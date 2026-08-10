// GET /api/workspaces/{ws}/invite-candidates — `bk invite candidates`.
//
// This app's own since Phase 2. The shared factory reads
// `platform.workspace_members`, so it suggested people you share an ISSUES
// workspace with — which is precisely the coupling this refactor removes: an
// issues colleague is not a sales colleague.
//
// Owner-only, the same gate as POST /invitations: this answers "who do you
// already share a workspace with", which a non-owner has no reason to be able
// to ask.
//
// `is_super_admin` is reported but no longer WIDENS the list. The platform
// version hands a super admin every account on the platform; here that would be
// a directory of everyone with an issues login, offered inside sales. A super
// admin who wants to invite somebody they share nothing with types the address,
// which is what the whitelist gate is for.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { isSuperAdmin } from '@blackcode/platform-auth'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { listInviteCandidates } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  if (ctx.role !== 'owner') {
    throw Errors.forbidden('Only the workspace owner can perform this action')
  }

  const data = await listInviteCandidates({
    userId: ctx.user.id,
    currentWorkspaceId: ctx.workspace.id,
  })
  return NextResponse.json({ data, is_super_admin: isSuperAdmin(ctx.user.email) })
})
