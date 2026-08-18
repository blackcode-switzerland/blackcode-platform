// DELETE /api/workspaces/{ws}/invitations/{id} — `bk books invite revoke`
//
// Served by this app rather than by the shared factory, for the reason in the
// sibling `../route.ts`: the factory writes `platform.workspace_invitations`.
//
// Scoped by workspace in the WHERE clause and not only by id. An id is a global
// integer; without the workspace an owner of one workspace could revoke
// another's by guessing a number. `revokeInvitation` takes both.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, requireOwner } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { revokeInvitation } from '@/lib/db/queries/invitations'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const invitationId = Number(id)
  if (!Number.isInteger(invitationId) || invitationId <= 0) {
    throw Errors.badRequest('invalid_id', 'the invitation id must be a positive integer', null)
  }

  const done = await revokeInvitation(ctx.workspace.id, invitationId)
  if (!done) {
    // 404 covers "no such invitation", "not this workspace's" and "already
    // revoked or accepted" — one answer on purpose, so the route cannot be used
    // to enumerate other workspaces' invitation ids.
    throw Errors.notFound(
      'invitation_not_found',
      'no pending invitation with that id in this workspace',
      'run `bk books invite list` for the ids'
    )
  }
  return NextResponse.json({ deleted: true })
})
