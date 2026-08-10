// The workspace-scoped reads every app needs unchanged: the workspace list, its
// members, who can be invited into it, and which apps it runs.
//
// One module because they are four small factories over the same three platform
// tables; splitting them into four files would be four headers saying the same
// thing. The write halves of these resources are NOT here — see the note on
// `workspacesRoute` for why `POST /api/workspaces` is deliberately absent.

import { NextRequest, NextResponse } from 'next/server'
import {
  appsReachableByUser,
  listInviteCandidates,
  listWorkspaceApps,
} from '@blackcode/platform-db'
import { isSuperAdmin } from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler, createResolveWorkspace } from '../handler'
import { jsonList } from '../responses'

interface WsParams {
  params: Promise<{ ws: string }>
}

/**
 * GET /api/workspaces — by default, the workspaces you can use THIS app in.
 *
 * `?all=1` widens it to every workspace you are a member of, and adds an `apps`
 * array per row: which apps you can reach there. That is what
 * `bk workspace list --all` renders as per-app badges, and it is the only way to
 * see a workspace this app is not enabled in — without it, "where did my
 * workspace go?" has no answer from inside the app that hid it.
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

    const all = ['1', 'true', 'yes'].includes(
      (req.nextUrl.searchParams.get('all') ?? '').toLowerCase()
    )

    if (!all) {
      return jsonList(await app.workspaces.listForUser(user.id, { scopedToApp: true }))
    }

    const [workspaces, reachable] = await Promise.all([
      app.workspaces.listForUser(user.id, { scopedToApp: false }),
      appsReachableByUser(app.db, user.id),
    ])
    const appsByWorkspace = new Map<number, string[]>()
    for (const reachableApp of reachable) {
      for (const wsId of reachableApp.workspace_ids) {
        appsByWorkspace.set(wsId, [...(appsByWorkspace.get(wsId) ?? []), reachableApp.slug])
      }
    }
    return jsonList(workspaces.map((w) => ({ ...w, apps: appsByWorkspace.get(w.id) ?? [] })))
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

/**
 * GET /api/workspaces/{ws}/apps — which apps this workspace runs, and how each
 * hands out access.
 *
 * Readable by any member: you should be able to see why a colleague can reach
 * something you cannot. Changing any of it is owner-only and lives elsewhere.
 */
export function workspaceAppsRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)
  const resolveWorkspace = createResolveWorkspace(app)

  return apiHandler(async (req: NextRequest, { params }: WsParams) => {
    const { ws } = await params
    const ctx = await resolveWorkspace(req, ws)
    return jsonList(await listWorkspaceApps(app.db, ctx.workspace.id))
  })
}
