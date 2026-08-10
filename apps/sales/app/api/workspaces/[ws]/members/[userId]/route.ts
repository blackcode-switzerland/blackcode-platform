// DELETE /api/workspaces/{ws}/members/{userId} — `bk member remove`.
//
// ---------------------------------------------------------------------------
// THIS APP'S OWN, AS OF PHASE 2 — the shared factory could not be reused
// ---------------------------------------------------------------------------
// `workspaceMemberRoute` in platform-api removes a `platform.workspace_members`
// row and records the event through `recordPlatformEvent`, which writes
// `platform.events`. Neither is right here: the membership lives in
// `sales.workspace_members`, and its event belongs in `sales.events`.
//
// So this is this app's own — and since Phase 3 it records its event too, in
// `sales.events`, beside everything else that happens in this workspace.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { removeMember } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string; userId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, userId: raw } = await params
  const targetId = parseInt(raw, 10)
  if (Number.isNaN(targetId)) {
    throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
  }

  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  // The owner cannot be removed, for the reason the platform route gives: they
  // are the only person who can grant anything back, and this route is behind a
  // check they would have just deleted. Sales has no `bk workspace transfer`,
  // so the suggestion names the one route out rather than a command that would
  // 404 against this host.
  if (targetId === ctx.workspace.owner_id) {
    throw Errors.badRequest(
      'cannot_remove_owner',
      'The workspace owner cannot be removed — nobody else could invite them back.',
      'Ownership transfer is not offered in b/sales; a super admin can move it in the database.'
    )
  }

  // The event is recorded inside `removeMember`'s transaction — Phase 2 left
  // this write without one because the spine was still `platform.events`.
  const actor = await resolveActor(getDb(), req, ctx.user)
  const removed = await removeMember(ctx.workspace.id, targetId, actor)
  if (!removed) throw Errors.notFound('member')
  return NextResponse.json({ removed: true })
})
