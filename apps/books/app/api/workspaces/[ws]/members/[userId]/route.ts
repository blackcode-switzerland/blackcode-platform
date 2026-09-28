// DELETE /api/workspaces/{ws}/members/{userId} — `bk books member remove <user_id>`.
//
// 2026-09-28, ported from `apps/billing`. This app's own rather than the shared
// `workspaceMemberRoute`, for the reason `../route.ts`'s neighbour
// `invitations/route.ts` gives about factories: that one deletes a
// `platform.workspace_members` row, which is `apps/issues`' table.
//
// ---------------------------------------------------------------------------
// WHO MAY CALL IT: THE OWNER FOR ANYONE, A MEMBER FOR THEMSELVES
// ---------------------------------------------------------------------------
// Removing yourself is LEAVING, and this is the one route for both. There is
// no `POST …/leave` here (so `bk books member leave` is not built —
// `MemberLeave` stays off in `cli/internal/commands/books/books.go`); the
// CLI spelling of leaving is `bk books member remove <your id>`, and the web's
// "Leave workspace" button calls exactly this. All three of billing,
// books and (since 2026-09-28) sales accept a member removing themselves.
//
// ---------------------------------------------------------------------------
// THE OWNER CANNOT BE REMOVED — BY ANYONE, INCLUDING THEMSELVES
// ---------------------------------------------------------------------------
// They are the only person who can invite anybody back, and a workspace with no
// owner is one whose books nobody can administer. Transfer first.
//
// What a removed member recorded STAYS, attributed: `created_by` columns point
// at `platform.users`, not at the membership row this deletes.
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
    throw Errors.badRequest('invalid_user_id', 'userId must be a positive integer', 'run `bk books member list` for the ids')
  }

  const ctx = await resolveWorkspace(req, ws)
  const self = targetId === ctx.user.id
  if (!self && ctx.role !== 'owner') {
    throw Errors.forbidden(
      'Only the workspace owner can remove other members',
      'you can remove yourself (leave): bk books member remove <your user id>'
    )
  }

  if (targetId === ctx.workspace.owner_id) {
    throw Errors.badRequest(
      'cannot_remove_owner',
      'The workspace owner cannot be removed or leave — nobody else could invite anyone back.',
      'Transfer ownership first: bk books workspace transfer --to <user_id>'
    )
  }

  const removed = await removeMember(ctx.workspace.id, targetId)
  if (!removed) {
    throw Errors.notFound('member_not_found', 'that user is not a member of this workspace', 'run `bk books member list`')
  }
  return NextResponse.json({ removed: true, left: self })
})
