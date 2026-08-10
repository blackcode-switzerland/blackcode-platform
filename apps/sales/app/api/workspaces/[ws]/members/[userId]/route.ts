// DELETE /api/workspaces/{ws}/members/{userId} — `bk member remove`.
//
// ---------------------------------------------------------------------------
// THIS APP'S OWN, AS OF PHASE 2 — the shared factory could not be reused
// ---------------------------------------------------------------------------
// `workspaceMemberRoute` in platform-api removes a `platform.workspace_members`
// row and records the event through `recordPlatformEvent`, which writes
// `platform.events`. Neither is right here: the membership lives in
// `sales.workspace_members`, and an event for it would carry a sales workspace
// id into a table whose foreign key still points at `platform.workspaces`.
//
// So this is nine lines of this app's own, and the event is deliberately NOT
// recorded yet — see the note below.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
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

  // NO EVENT ROW, and that is a Phase 2 constraint rather than a decision.
  // `recordEvent` still writes `platform.events`, whose `workspace_id` foreign
  // key points at `platform.workspaces` — so an event carrying this workspace's
  // id would either fail loudly or, worse, land against a DIFFERENT app's
  // workspace that happens to share the number. Phase 3 points the event spine
  // at `sales.events`, and this is the first call site to add back.
  const removed = await removeMember(ctx.workspace.id, targetId)
  if (!removed) throw Errors.notFound('member')
  return NextResponse.json({ removed: true })
})
