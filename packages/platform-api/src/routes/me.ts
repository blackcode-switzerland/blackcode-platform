// /api/me, /api/me/active-workspace, /api/me/pending-invitations — the caller's
// own account.
//
// There is one login for every app (docs/platform-architecture.md §6), so every
// app serves the same answers here. Only the ORIGIN differs, and it has to: a
// page on sales.blackcode.ch calling /api/me must not have to reach the issues
// deployment to find out who is signed in.
//
// `/api/me/inbox/*` is NOT here. It is Tier 2 in docs/sales-app-plan.md D-2 —
// worth writing down, because "/api/me/*" as a single line is how the inbox gets
// mounted by an app that has no inbox UI.

import { NextRequest, NextResponse } from 'next/server'
import {
  deleteAccountReport,
  getUserById,
  listPendingInvitationsForEmail,
  softDeleteUser,
  updateUserProfile,
} from '@blackcode/platform-db'
import { isSuperAdmin } from '@blackcode/platform-auth'
import type { AppContext } from '../app-context'
import { Errors } from '../errors'
import { createApiHandler } from '../handler'
import { PROFILE_NAME_MAX, PROFILE_TAGLINE_MAX } from '../limits'

/**
 * Which credential the caller used.
 *
 * Derived from the request rather than plumbed through a third resolver: the
 * app's own resolver already branches on exactly this test (a `Bearer` header
 * means token, anything else means session), so asking the question here gives
 * the same answer without a new AppContext field for one string.
 */
function authVia(req: NextRequest): 'session' | 'token' {
  const header = req.headers.get('authorization')
  return header && /^Bearer\s+/i.test(header) ? 'token' : 'session'
}

export function meRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  const GET = apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()
    // Re-read rather than trusting the resolved row: this route absorbed the
    // former /api/users/me auth-probe that `bk` calls, and a stale profile is
    // the one thing it must not return.
    const fresh = await getUserById(app.db, user.id)
    if (!fresh) throw Errors.notFound('user')
    return NextResponse.json({
      id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      tagline: fresh.tagline,
      avatar_url: fresh.avatar_url,
      active_workspace_id: fresh.active_workspace_id,
      created_at: fresh.created_at,
      // Google-connected accounts get their avatar from Google and can't change
      // it here — it re-syncs on each Google sign-in.
      connected_google: !!fresh.google_id,
      avatar_editable: !fresh.google_id,
      via: authVia(req),
      is_super_admin: isSuperAdmin(fresh.email),
    })
  })

  const PATCH = apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      throw Errors.badRequest('invalid_body', 'expected JSON object')
    }

    const patch: { name?: string | null; tagline?: string | null; avatar_url?: string | null } = {}

    if ('name' in body) {
      if (body.name !== null && typeof body.name !== 'string') {
        throw Errors.badRequest('invalid_name', 'name must be a string or null')
      }
      const trimmed = typeof body.name === 'string' ? body.name.trim() : body.name
      if (typeof trimmed === 'string' && trimmed.length > 255) {
        throw Errors.badRequest('name_too_long', `name max ${PROFILE_NAME_MAX} chars`)
      }
      patch.name = trimmed
    }
    if ('tagline' in body) {
      if (body.tagline !== null && typeof body.tagline !== 'string') {
        throw Errors.badRequest('invalid_tagline', 'tagline must be a string or null')
      }
      const trimmed = typeof body.tagline === 'string' ? body.tagline.trim() : body.tagline
      if (typeof trimmed === 'string' && trimmed.length > 140) {
        throw Errors.badRequest('tagline_too_long', `tagline max ${PROFILE_TAGLINE_MAX} chars`)
      }
      patch.tagline = trimmed
    }
    if ('avatar_url' in body) {
      // Google-connected accounts can't change their avatar — it's synced from
      // Google.
      if (user.google_id) {
        throw Errors.forbidden('Your photo is synced from Google and cannot be changed here')
      }
      if (body.avatar_url !== null && typeof body.avatar_url !== 'string') {
        throw Errors.badRequest('invalid_avatar_url', 'avatar_url must be a string or null')
      }
      patch.avatar_url = body.avatar_url
    }

    const updated = await updateUserProfile(app.db, user.id, patch)
    if (!updated) throw Errors.notFound('user')
    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      tagline: updated.tagline,
      avatar_url: updated.avatar_url,
      active_workspace_id: updated.active_workspace_id,
    })
  })

  /**
   * Close the account.
   *
   * Deliberately NOT reachable from `bk` (it is in every app's
   * EXCLUDED_OPERATIONS): an agent must never be able to delete its owner's
   * account. It stays a route because the web UI needs it, behind a confirmation.
   *
   * ── THE DRY RUN ANSWERS FOR ONE APP, AND SAYS SO SINCE 2026-08-11 ──────────
   * `deleteAccountReport` enumerates `platform.workspaces`, which is
   * `apps/issues`' own table. It cannot see `sales.workspaces` and no query from
   * this deployment can — an app's Postgres role has no grant on another app's
   * schema. So the report carries the app it covers, and the UI renders it.
   * That is honesty about scope, not the fix: see PLAN.md §9 item 8.
   */
  const DELETE = apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    // Dry-run: report what would happen.
    const url = new URL(req.url)
    const report = await deleteAccountReport(app.db, user.id, app.appSlug)
    if (url.searchParams.get('dry_run') === 'true') {
      return NextResponse.json(report)
    }
    if (report.blocked_by.length > 0) {
      throw Errors.conflict(
        'owner_with_members',
        'You must transfer ownership of these workspaces before deleting your account',
        report.blocked_by
      )
    }
    await softDeleteUser(app.db, user.id)
    return NextResponse.json({ deleted: true, hard_deleted_workspaces: report.will_hard_delete })
  })

  return { GET, PATCH, DELETE }
}

/**
 * POST /api/me/active-workspace — remember which workspace this user was last
 * in.
 *
 * The workspace is resolved through the caller's membership, so setting it to
 * one they are not in is a 404 rather than a stored value nobody can use.
 */
export function activeWorkspaceRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      throw Errors.badRequest('invalid_body', 'expected JSON object')
    }

    let target: string | null = null
    if (typeof body.workspace_id === 'number') target = String(body.workspace_id)
    else if (typeof body.slug === 'string') target = body.slug
    else if (typeof body.workspace === 'string') target = body.workspace
    if (target === null) {
      throw Errors.badRequest('missing_workspace', 'provide workspace_id (number) or slug (string)')
    }

    // Membership, not app access: this is "which workspace was I looking at",
    // and a workspace you belong to but cannot use THIS app in is still a legal
    // answer for another app's UI.
    //
    // Resolved through THIS APP'S workspaces (`app.workspaces`), which is what
    // stops `bk workspace use <a-sales-slug>` from 404ing against a sales-homed
    // CLI — and, more importantly, stops a sales workspace id from being written
    // into the one `platform.users.active_workspace_id` column that issues
    // reads. See `WorkspaceSource.getDefaultForUser`.
    const ws = await app.workspaces.getForUser(target, user.id)
    if (!ws) throw Errors.notFound('workspace')

    await app.workspaces.setDefaultForUser(user.id, ws.id)
    return NextResponse.json({ active_workspace_id: ws.id, slug: ws.slug })
  })
}

/** GET /api/me/pending-invitations — invitations waiting for this address. */
export function pendingInvitationsRoute(app: AppContext) {
  const apiHandler = createApiHandler(app)

  return apiHandler(async (req: NextRequest) => {
    const user = await app.resolveUser(req)
    if (!user) throw Errors.unauthorized()
    return NextResponse.json({ data: await listPendingInvitationsForEmail(app.db, user.email) })
  })
}
