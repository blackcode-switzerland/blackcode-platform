// POST /api/workspaces/{ws}/transfer — `bk billing workspace transfer --to <user>`.
//
// Phase 2 (2026-09-21). Ported from `apps/sales`' route of the same name; this
// app's own because `transferOwnership` writes `billing.workspace_members` and
// `billing.workspaces.owner_id`. No event row: `billing.audit` admits only the
// legal records (invoice, company, recurrence) — see the note above
// `updateWorkspace` in `lib/db/queries/workspaces.ts`.
//
// `getUserByEmail` is the platform's own: resolving an address to a
// `platform.users` row is an identity question, not a tenancy one.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { getUserByEmail } from '@blackcode/platform-db'
import { apiHandler, requireOwner, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { transferOwnership } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  requireOwner(ctx)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected a JSON object', 'POST { "new_owner_user_id": 12 }')
  }

  let targetUserId: number | null = null
  if (typeof body.new_owner_user_id === 'number') {
    targetUserId = body.new_owner_user_id
  } else if (typeof body.new_owner_email === 'string') {
    const u = await getUserByEmail(getDb(), body.new_owner_email.trim())
    if (!u) {
      throw Errors.notFound('user_not_found', 'no account with that email', 'run `bk billing member list` for the members')
    }
    targetUserId = u.id
  }
  if (!targetUserId) {
    throw Errors.badRequest(
      'missing_target',
      'provide new_owner_user_id or new_owner_email',
      'bk billing workspace transfer --to <user_id> — ids are in `bk billing member list`'
    )
  }
  if (targetUserId === ctx.user.id) {
    throw Errors.badRequest('already_owner', 'you are already the owner', null)
  }

  try {
    await transferOwnership(ctx.workspace.id, targetUserId)
  } catch (err) {
    const message = (err as Error)?.message
    if (message === 'not_a_member') {
      throw Errors.badRequest(
        'not_a_member',
        'the new owner must already be a member of this workspace',
        'invite them first (bk billing invite send <email>), then transfer once they have accepted'
      )
    }
    if (message === 'workspace_not_found') throw Errors.notFound('workspace')
    throw err
  }

  return NextResponse.json({ ok: true, new_owner_user_id: targetUserId })
})
