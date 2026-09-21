// GET /api/me/pending-invitations — `bk billing invite pending`.
//
// Phase 2 (2026-09-21): the invitations waiting for you IN THIS APP, from
// `billing.invitations`. Not the shared factory, which reads
// `platform.workspace_invitations` — invitations into another app's
// workspaces, which accepting here would grant nothing this app can see.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import { listPendingInvitationsForEmail } from '@/lib/db/queries/invitations'

export const GET = apiHandler(async (req: NextRequest) => {
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized()
  return NextResponse.json({ data: await listPendingInvitationsForEmail(user.email), next_cursor: null })
})
