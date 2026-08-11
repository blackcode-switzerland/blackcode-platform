// The workspace-scoped WRITE routes: membership and invitations.
//
// ---------------------------------------------------------------------------
// THESE WERE THE LAST THING BLOCKING TIER 1
// ---------------------------------------------------------------------------
// Their reads became factories on 2026-08-06 and their writes did not, for one
// reason: every one records an event, and the only recorder was an app's. D-23
// cut that seam (`recordPlatformEvent`), and these are what it was cut for.
//
// Nothing here is Class B. The app-specific part of each was always the same
// thing — which app is writing — and that is `AppContext.appSlug`, not a
// contribution. The one exception is the invitations POST, which has to put a
// link in an email; that lives in `./invitations.ts` because it IS Class B.
//
// ---------------------------------------------------------------------------
// THE PER-APP ACCESS ROUTES WERE HERE, AND WENT ON 2026-08-10 (Phase 5)
// ---------------------------------------------------------------------------
// `workspaceAppRoute`, `workspaceAppAccessRoute` and
// `workspaceAppAccessMemberRoute` served `platform.workspace_apps` and
// `platform.app_access` — turning an app on inside a workspace and granting
// people access to it. Both tables are dropped: apps do not share workspaces any
// more, so "which apps is this workspace running" has no subject. A workspace in
// this table IS an issues workspace, and its members are issues' members.
//
// The elaborate refusal that used to live here — you may not disable the app you
// are calling from, because it locks the whole team out with no way back — is
// gone with the toggle it guarded. If a per-app gate ever comes back, it comes
// back inside ONE app, over that app's own membership table, and that refusal is
// worth re-reading in the git history first.

import { NextRequest, NextResponse } from 'next/server'
// `recordPlatformEvent` was imported here until 2026-08-10 and is not any more:
// the three app-gate routes were its only direct callers. The two routes left
// still record their events — inside `removeMember` and `revokeInvitation`,
// which take the `{ db, app }` write context and do it in the same transaction
// as the mutation, which is where it belongs.
import { removeMember, revokeInvitation } from '@blackcode/platform-db'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace, requireOwner } from '../handler'

interface WsUserParams {
  params: Promise<{ ws: string; userId: string }>
}
interface WsIdParams {
  params: Promise<{ ws: string; id: string }>
}

/** `DELETE /api/workspaces/{ws}/members/{userId}` — remove a member. Owner only. */
export function workspaceMemberRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: WsUserParams) => {
    const { ws, userId: userIdRaw } = await params
    const targetId = parseInt(userIdRaw)
    if (Number.isNaN(targetId)) {
      throw Errors.badRequest('invalid_user_id', 'userId must be an integer')
    }

    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    if (targetId === ctx.workspace.owner_id) {
      throw Errors.badRequest(
        'cannot_remove_owner',
        'Transfer ownership before removing the owner'
      )
    }

    const ok = await removeMember(
      { db: app.db, app: app.appSlug },
      ctx.workspace.id,
      targetId,
      ctx.user.id
    )
    if (!ok) throw Errors.notFound('member')
    return NextResponse.json({ removed: true })
  })

  return { DELETE }
}

/** `DELETE /api/workspaces/{ws}/invitations/{id}` — revoke a pending invite. */
export function workspaceInvitationRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  const DELETE = apiHandler(async (req: NextRequest, { params }: WsIdParams) => {
    const { ws, id: idRaw } = await params
    const id = parseInt(idRaw)
    if (Number.isNaN(id)) throw Errors.badRequest('invalid_id', 'id must be an integer')

    const ctx = await resolveWorkspace(req, ws)
    requireOwner(ctx)

    const ok = await revokeInvitation(
      { db: app.db, app: app.appSlug },
      id,
      ctx.workspace.id,
      ctx.user.id
    )
    if (!ok) throw Errors.notFound('invitation')
    return NextResponse.json({ revoked: true })
  })

  return { DELETE }
}
