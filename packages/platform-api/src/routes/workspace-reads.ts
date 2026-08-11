// The workspace-scoped reads every app needs unchanged: the workspace list, one
// workspace, its members, and who can be invited into it.
//
// One module because they are four small factories over the same two platform
// tables; splitting them into four files would be four headers saying the same
// thing. The write halves of these resources are NOT here — see the note on
// `workspacesRoute` for why `POST /api/workspaces` is deliberately absent.
//
// A fifth factory, `workspaceAppsRoute` (`GET /api/workspaces/{ws}/apps`), was
// removed on 2026-08-10 with `platform.workspace_apps` — "which apps does this
// workspace run" is not a question a workspace answers any more, because a
// workspace belongs to exactly one app. The address book is `bk app list`.

import { NextRequest, NextResponse } from 'next/server'
import { listInviteCandidates } from '@blackcode/platform-db'
import { isSuperAdmin } from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace } from '../handler'
import { jsonList } from '../responses'

interface WsParams {
  params: Promise<{ ws: string }>
}

/**
 * GET /api/workspaces — the workspaces you are a member of in THIS app.
 *
 * ── `?all=1` WAS REMOVED ON 2026-08-10 (refactor Phase 5) ───────────────────
 * It widened the list to every workspace you belonged to regardless of app, and
 * tagged each row with the apps you could reach there, so that a workspace this
 * app was not enabled in still had somewhere to show up — "where did my
 * workspace go?" needed an answer from inside the app that hid it.
 *
 * Nothing hides a workspace any more. This table is the calling app's own, the
 * grants that used to narrow it are dropped, and the per-row `apps` array was
 * derived from those grants. `?all=1` and the default returned the same rows,
 * and the extra field was the false one — it named workspace ids in apps that
 * had since moved their workspaces elsewhere. An unknown `?all=` is ignored
 * rather than rejected, so an older CLI keeps working and simply gets the list.
 *
 * ── WHY THERE IS NO POST HERE, AND WHY THAT IS A DECISION ───────────────────
 * Creating a workspace goes through `createWorkspace`, which records events
 * through an app's own event spine (`recordEvent` → `fanOutEvent`), and that
 * spine is not extracted. It is also not needed: D-3 gives the sales app no
 * create-workspace flow at all, and `bk workspace` is a NEUTRAL verb under D-11,
 * so it reaches the home server. An app that genuinely needs to mint workspaces
 * on its own origin keeps its own POST beside this mount — as `apps/issues`
 * does — rather than this factory growing a half-generic write path.
 */
export function workspacesRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    return jsonList(await app.workspaces.listForUser(user.id))
  })
}

/** GET /api/workspaces/{ws}/members — everyone in the workspace. */
/**
 * GET /api/workspaces/{ws} — one workspace, the caller's role in it, and its
 * members. What `bk workspace show` prints, and what `bk workspace use`
 * VALIDATES A SLUG AGAINST before writing it to the config.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS BECAME A FACTORY ON 2026-08-07, WHEN PATCH AND DELETE DID NOT
 * ---------------------------------------------------------------------------
 * It lived in `apps/issues` with PATCH and DELETE beside it, and the three
 * looked like one unit. They are not: **this GET touches only platform data** —
 * `resolveWorkspace` and `listWorkspaceMembers`, both already shared — while
 * PATCH and DELETE call `updateWorkspace` / `deleteWorkspace`, which are still
 * app-local and carry a cascade. Splitting on that line costs nothing and moves
 * nothing risky.
 *
 * The reason it had to move at all is sharper than "sales wanted it".
 * `bk workspace use <slug>` resolves the slug through this route before saving
 * it. Unmounted, a CLI homed on the sales deployment could LIST workspaces and
 * not SELECT one — so the north-star script died at its second command, and
 * every command after it reported "no active workspace" instead of the real
 * cause. A read that another verb silently depends on is not optional surface.
 */
export function workspaceShowRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  return apiHandler(async (req: NextRequest, { params }: WsParams) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    // NOT jsonList: this is a single resource with its members attached, and the
    // shape is pinned by every existing client. `{ data, next_cursor }` here
    // would be a silent breaking change to `bk workspace show`.
    return NextResponse.json({
      workspace: ctx.workspace,
      role: ctx.role,
      members: await app.workspaces.listMembers(ctx.workspace.id),
    })
  })
}

export function workspaceMembersRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  return apiHandler(async (req: NextRequest, { params }: WsParams) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    return jsonList(await app.workspaces.listMembers(ctx.workspace.id))
  })
}

/**
 * GET /api/workspaces/{ws}/invite-candidates — people the owner can invite
 * without retyping an email.
 *
 * Owner-only, the same gate as POST /invitations: this answers "who do you
 * already share a workspace with", which is a question a non-owner has no
 * reason to be able to ask.
 */
export function inviteCandidatesRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  return apiHandler(async (req: NextRequest, { params }: WsParams) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    if (ctx.role !== 'owner') {
      throw Errors.forbidden('Only the workspace owner can perform this action')
    }

    const includePlatform = isSuperAdmin(ctx.user.email)
    const data = await listInviteCandidates(app.db, {
      userId: ctx.user.id,
      currentWorkspaceId: ctx.workspace.id,
      includePlatform,
    })

    return NextResponse.json({ data, is_super_admin: includePlatform })
  })
}

