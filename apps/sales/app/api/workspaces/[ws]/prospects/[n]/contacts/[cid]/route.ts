// PATCH  /api/workspaces/{ws}/prospects/{n}/contacts/{cid} — edit one
// DELETE /api/workspaces/{ws}/prospects/{n}/contacts/{cid} — bin one
//
// `{cid}` is a row id. See the sibling route's header and
// `lib/db/queries/prospect-children.ts` for why that is right here and wrong for
// a prospect.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import {
  prospectIdBySeq,
  removeContact,
  updateContact,
} from '@/lib/db/queries/prospect-children'
import { publicContact } from '@/lib/views'
import { CONTACT_NAME_MAX, CONTACT_URL_MAX } from '@/lib/limits'
import {
  nullableStr,
  requireDecisionPower,
  requireHttpUrl,
  requireMaxLength,
  requireNumberParam,
  str,
} from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string; cid: string }>
}

async function resolveIds(workspaceId: number, n: string, cid: string) {
  const seq = requireNumberParam(n, 'prospect')
  const prospectId = await prospectIdBySeq(workspaceId, seq)
  if (prospectId == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  const contactId = Number(cid)
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw Errors.notFound(
      'contact_not_found',
      `${JSON.stringify(cid)} is not a contact id`,
      `run \`bk sales contact list ${seq}\` for the ids`
    )
  }
  return { seq, prospectId, contactId }
}

const notFound = (seq: number, cid: number) =>
  Errors.notFound(
    'contact_not_found',
    `no contact ${cid} on prospect #${seq}`,
    `run \`bk sales contact list ${seq}\` for the ids`
  )

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, cid } = await params
  const ctx = await resolveWorkspace(req, ws)
  const ids = await resolveIds(ctx.workspace.id, n, cid)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (name) requireMaxLength(name, CONTACT_NAME_MAX, 'name')

  // Migration 0008. Three-way like the rest, so `--linkedin ""` clears one.
  const linkedin = nullableStr(body?.linkedin)
  if (linkedin) {
    requireMaxLength(linkedin, CONTACT_URL_MAX, 'linkedin')
    requireHttpUrl(linkedin, 'linkedin', 'a LinkedIn profile', 'pass the full url including https://')
  }
  const decisionPower = nullableStr(body?.decision_power)
  if (decisionPower) requireDecisionPower(decisionPower)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateContact(
    ctx.workspace.id,
    ids.prospectId,
    ids.contactId,
    {
      name,
      role: nullableStr(body?.role),
      email: nullableStr(body?.email),
      phone: nullableStr(body?.phone),
      notes: nullableStr(body?.notes),
      linkedin,
      decisionPower,
      isPrimary: body?.is_primary === undefined ? undefined : body.is_primary === true,
    },
    actor
  )
  if (!row) throw notFound(ids.seq, ids.contactId)
  return NextResponse.json(publicContact(row))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n, cid } = await params
  const ctx = await resolveWorkspace(req, ws)
  const ids = await resolveIds(ctx.workspace.id, n, cid)
  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await removeContact(ctx.workspace.id, ids.prospectId, ids.contactId, actor)
  if (!row) throw notFound(ids.seq, ids.contactId)
  return NextResponse.json({ deleted: true, type: 'contact', id: row.id, name: row.name })
})
