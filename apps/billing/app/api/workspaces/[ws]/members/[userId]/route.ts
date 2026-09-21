// DELETE /api/workspaces/{ws}/members/{userId} — `bk billing member remove <user_id>`.
//
// Phase 2 (2026-09-21). This app's own rather than the shared
// `workspaceMemberRoute`, for the reason `../route.ts`'s neighbour
// `invitations/route.ts` gives about factories: that one deletes a
// `platform.workspace_members` row, which is `apps/issues`' table.
//
// ---------------------------------------------------------------------------
// WHO MAY CALL IT: THE OWNER FOR ANYONE, A MEMBER FOR THEMSELVES
// ---------------------------------------------------------------------------
// Removing yourself is LEAVING, and this is the one route for both. There is
// no `POST …/leave` here (so `bk billing member leave` is not built —
// `MemberLeave` stays off in `cli/internal/commands/billing/billing.go`); the
// CLI spelling of leaving is `bk billing member remove <your id>`, and the web's
// "Leave workspace" button calls exactly this. `apps/sales` gates the route on
// ownership alone, which leaves a sales member no way out short of asking; that
// is the one deliberate difference from the port.
//
// ---------------------------------------------------------------------------
// THE OWNER CANNOT BE REMOVED — BY ANYONE, INCLUDING THEMSELVES
// ---------------------------------------------------------------------------
// They are the only person who can invite anybody back, and a workspace with no
// owner is one whose invoices nobody can administer. Transfer first.
//
// What a removed member created STAYS, attributed: invoices' `created_by` and
// the audit log's `actor_user_id` point at `platform.users`, not at the
// membership row this deletes.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { removeMember } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string; userId: string }>
}

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, userId: raw } = await params
  const targetId = Number(raw)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw Errors.badRequest('invalid_user_id', 'userId must be a positive integer', 'run `bk billing member list` for the ids')
  }

  const ctx = await resolveWorkspace(req, ws)
  const self = targetId === ctx.user.id
  if (!self && ctx.role !== 'owner') {
    throw Errors.forbidden(
      'Only the workspace owner can remove other members',
      'you can remove yourself (leave): bk billing member remove <your user id>'
    )
  }

  if (targetId === ctx.workspace.owner_id) {
    throw Errors.badRequest(
      'cannot_remove_owner',
      'The workspace owner cannot be removed or leave — nobody else could invite anyone back.',
      'Transfer ownership first: bk billing workspace transfer --to <user_id>'
    )
  }

  const removed = await removeMember(ctx.workspace.id, targetId)
  if (!removed) {
    throw Errors.notFound('member_not_found', 'that user is not a member of this workspace', 'run `bk billing member list`')
  }
  return NextResponse.json({ removed: true, left: self })
})
