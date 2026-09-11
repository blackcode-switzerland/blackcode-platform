// POST /api/workspaces/{ws}/transfer — `bk sales workspace transfer`.
//
// New 2026-09-11, alongside POST/PATCH/DELETE on the parent route — the D-3
// reversal that gives sales the same workspace administration `apps/issues`
// has. Ported from `apps/issues/app/api/workspaces/[ws]/transfer/route.ts`;
// this app's own because `transferOwnership` writes `sales.workspace_members`
// and records the event through this app's own spine (`sales.events`), which
// is not extracted to shared code.
//
// `getUserByEmail` is the platform's own (`@blackcode/platform-db`), the same
// one `lib/auth.ts` already imports for sign-in — there is no sales-local
// copy, and there should not be one: resolving an email to a `platform.users`
// row is an identity question, not a tenancy one.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { getUserByEmail } from '@blackcode/platform-db'
import { apiHandler, resolveWorkspace, requireOwner } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { transferOwnership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  let targetUserId: number | null = null
  if (typeof body.new_owner_user_id === 'number') {
    targetUserId = body.new_owner_user_id
  } else if (typeof body.new_owner_email === 'string') {
    const u = await getUserByEmail(getDb(), body.new_owner_email.trim())
    if (!u) throw Errors.notFound('user')
    targetUserId = u.id
  }
  if (!targetUserId) {
    throw Errors.badRequest(
      'missing_target',
      'provide new_owner_user_id or new_owner_email'
    )
  }

  if (targetUserId === ctx.user.id) {
    throw Errors.badRequest('already_owner', 'you are already the owner')
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  try {
    await transferOwnership(ctx.workspace.id, targetUserId, actor)
  } catch (err) {
    const message = (err as Error)?.message
    if (message === 'not_a_member') {
      throw Errors.badRequest('not_a_member', 'target user is not a member of this workspace')
    }
    if (message === 'workspace_not_found') throw Errors.notFound('workspace')
    throw err
  }

  return NextResponse.json({ ok: true, new_owner_user_id: targetUserId })
})
