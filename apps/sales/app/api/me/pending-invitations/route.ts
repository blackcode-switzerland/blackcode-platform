// GET /api/me/pending-invitations — `bk invite pending`.
//
// This app's own since Phase 2: the invitations waiting for you IN B/SALES,
// from `sales.invitations`. The shared factory reads
// `platform.workspace_invitations`, and after the split those are invitations
// into issues workspaces — accepting one from here would grant nothing sales
// can see.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { listPendingInvitationsForEmail } from '@/lib/db/queries/invitations'

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()
  return NextResponse.json({ data: await listPendingInvitationsForEmail(user.email) })
})
