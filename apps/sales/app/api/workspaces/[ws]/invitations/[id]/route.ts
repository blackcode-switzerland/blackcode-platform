// DELETE /api/workspaces/{ws}/invitations/{id} — `bk invite revoke`.
//
// This app's own since Phase 2, for the same reason as its sibling: the row is
// in `sales.invitations`, and the shared factory's event write would carry this
// workspace's id into `platform.events`.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { revokeInvitation } from '@/lib/db/queries/invitations'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: raw } = await params
  const id = parseInt(raw, 10)
  if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  // Scoped to this workspace, so an id from another workspace is a 404 rather
  // than a revocation somebody else notices later.
  const ok = await revokeInvitation(id, ctx.workspace.id)
  if (!ok) throw Errors.notFound('invitation')
  return NextResponse.json({ revoked: true })
})
