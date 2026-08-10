// GET    /api/workspaces/{ws}/prospects/{n} — one prospect, with its journey
// PATCH  /api/workspaces/{ws}/prospects/{n} — edit, and assign
// DELETE /api/workspaces/{ws}/prospects/{n} — bin it (soft), with a confirmation
//                                             the caller must repeat back
//
// `{n}` is the workspace #number, never the row id.
//
// ---------------------------------------------------------------------------
// WHY DELETE TAKES `?confirm=<name>` AND WHY IT IS ENFORCED HERE
// ---------------------------------------------------------------------------
// CLAUDE.md, *Writing commands agents can survive*: `Confirm()` is not a guard
// for agents, because it auto-approves under `BK_NO_PROMPT=1` and on a non-TTY —
// which is exactly how an agent runs. The guard that works is making the caller
// repeat the target back.
//
// It is checked on the SERVER, not only in the CLI, and that is the half that
// matters. A client-side check is a check the caller can skip: an agent that
// shells out to curl, a stale binary, or a future web action would all bypass
// it, and the failure is unrecoverable data. `bk workspace delete` compares
// `--confirm` against the argument the caller typed, which catches a mis-scoped
// loop; this compares against the NAME OF THE ROW THAT WOULD DIE, which also
// catches the wrong #number. That is the case an agent actually hits.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  findUserIdByEmail,
  getProspectBySeq,
  listJourney,
  softDeleteProspect,
  updateProspect,
} from '@/lib/db/queries/prospects'
import { publicProspect } from '@/lib/views'
import { PROSPECT_NAME_MAX } from '@/lib/limits'
import {
  nullableStr,
  requireMaxLength,
  requireMoney,
  requireNumberParam,
  str,
} from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')

  const row = await getProspectBySeq(ctx.workspace.id, seq)
  if (!row) throw prospectNotFound(seq)

  const journey = await listJourney(row.id)

  return NextResponse.json({
    ...publicProspect(row, ctx.workspace.slug),
    // The journey is part of the prospect, not a sub-resource: the mockup's
    // detail page renders the whole ladder and there is no view that wants one
    // without the other. `bk sales journey list` (Phase 5) reads the same field.
    journey: journey.map((s) => ({
      stage: s.stage,
      status: s.status,
      occurred_at: s.occurred_at?.toISOString() ?? null,
      actor: s.actor_label,
      note: s.note,
    })),
    // `links` is GONE from this response (2026-08-10, Phase 3). It read
    // `platform.links`, the shared cross-app index this app no longer writes —
    // so after the split it could only ever have returned another app's rows or,
    // as now, nothing. D-18's requirement was that a relationship be VISIBLE
    // rather than merely storable; the URN in a prospect's own summary is
    // visible in exactly the same way and belongs to this app.
  })
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (name) requireMaxLength(name, PROSPECT_NAME_MAX, 'name')

  const value = nullableStr(body?.value)
  if (value) requireMoney(value)

  // `owner` is three-way. `null` unassigns; a string assigns; absent leaves it.
  // Unassigning has to be expressible — a deal whose owner left the company must
  // not be stuck with them.
  let ownerUserId: number | null | undefined
  const owner = nullableStr(body?.owner)
  if (owner === null) {
    ownerUserId = null
  } else if (owner !== undefined) {
    ownerUserId = owner === 'me' ? ctx.user.id : await findUserIdByEmail(owner)
    if (ownerUserId == null) {
      throw Errors.badRequest(
        'unknown_owner',
        `no user with email ${owner}`,
        'run `bk member list` for the people in this workspace, or use --owner me'
      )
    }
  }

  // `stage` is NOT accepted here, and the refusal is explicit rather than a
  // silent ignore. Moving a deal writes a journey step and may close it; a PATCH
  // that did half of that would leave a ladder disagreeing with the stage column
  // and nothing would say so.
  if (body?.stage !== undefined) {
    throw Errors.badRequest(
      'stage_not_patchable',
      'stage is not editable here — moving a deal writes a journey entry',
      `use \`bk sales prospect stage ${seq} <stage>\``
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const updated = await updateProspect(
    ctx.workspace.id,
    seq,
    {
      name,
      city: nullableStr(body?.city),
      sector: nullableStr(body?.sector),
      value,
      currency: str(body?.currency)?.toUpperCase(),
      ownerUserId,
      source: nullableStr(body?.source),
      summary: nullableStr(body?.summary),
    },
    actor
  )
  if (!updated) throw prospectNotFound(seq)
  return NextResponse.json(publicProspect(updated, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'prospect')

  const existing = await getProspectBySeq(ctx.workspace.id, seq)
  if (!existing) throw prospectNotFound(seq)

  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'deleting a prospect requires the company name repeated back',
      `pass --confirm ${JSON.stringify(existing.name)}`
    )
  }
  if (confirm !== existing.name) {
    // The expected name IS echoed, and that is deliberate. Secrecy is not the
    // point — the point is that the caller must have looked at the row it is
    // about to destroy. An agent operating on a wrong #number learns here that
    // the company it believed it was deleting is not the one at that number,
    // which is the whole recovery.
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name prospect #${seq}`,
      `#${seq} is ${JSON.stringify(existing.name)} — pass --confirm ${JSON.stringify(existing.name)} if that is the one you meant`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const deleted = await softDeleteProspect(ctx.workspace.id, seq, actor)
  if (!deleted) throw prospectNotFound(seq)

  // WHAT was destroyed, not how many — captured before the delete and echoed
  // back so the CLI can print it. A count alone is the difference between a
  // wrong delete caught in a minute and one found in a month.
  //
  // There is deliberately no `restore_with` hint yet: `bk sales trash` lands
  // later in Phase 5, and a response that names a command the binary does not
  // have is a dead end dressed as a recovery. It goes in with the command.
  return NextResponse.json({
    deleted: true,
    type: 'prospect',
    number: deleted.seq,
    name: deleted.name,
  })
})

function prospectNotFound(seq: number) {
  return Errors.notFound(
    'prospect_not_found',
    `no prospect #${seq} in this workspace`,
    'run `bk sales prospect list --q <name>` to find it'
  )
}
