// GET  /api/workspaces/{ws}/prospects/{n}/contacts — the decision makers
// POST /api/workspaces/{ws}/prospects/{n}/contacts — add one
//
// A contact is reached THROUGH its prospect and has no #number of its own; the
// reasoning is in `lib/db/queries/prospect-children.ts`, once, for all four
// child types. The `id` in the sub-route below is a row id and that is correct
// for a row with no independent identity — `apps/issues` addresses comments the
// same way.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { addContact, listContacts, prospectIdBySeq } from '@/lib/db/queries/prospect-children'
import { publicContact } from '@/lib/views'
import { CONTACT_NAME_MAX, CONTACT_URL_MAX } from '@/lib/limits'
import {
  requireDecisionPower,
  requireHttpUrl,
  requireMaxLength,
  requireNumberParam,
  str,
} from '@/lib/http-input'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

async function requireProspect(workspaceId: number, raw: string): Promise<number> {
  const seq = requireNumberParam(raw, 'prospect')
  const id = await prospectIdBySeq(workspaceId, seq)
  if (id == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${seq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }
  return id
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  return jsonList((await listContacts(prospectId)).map(publicContact), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const prospectId = await requireProspect(ctx.workspace.id, n)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const name = str(body?.name)
  if (!name) throw Errors.badRequest('missing_name', 'name is required', 'pass --name "<person>"')
  requireMaxLength(name, CONTACT_NAME_MAX, 'name')

  // Migration 0008 — #34's LinkedIn and #33's structured half. Both optional;
  // `linkedin` gets the scheme edge because the web app renders it as an anchor.
  const linkedin = str(body?.linkedin)
  if (linkedin) {
    requireMaxLength(linkedin, CONTACT_URL_MAX, 'linkedin')
    requireHttpUrl(linkedin, 'linkedin', 'a LinkedIn profile', 'pass the full url including https://')
  }
  const decisionPower = str(body?.decision_power)
  if (decisionPower) requireDecisionPower(decisionPower)

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await addContact(
    ctx.workspace.id,
    prospectId,
    {
      name,
      role: str(body?.role) ?? null,
      email: str(body?.email) ?? null,
      phone: str(body?.phone) ?? null,
      isPrimary: body?.is_primary === true,
      notes: str(body?.notes) ?? null,
      linkedin: linkedin ?? null,
      decisionPower: decisionPower ?? null,
    },
    actor
  )
  return NextResponse.json(publicContact(row), { status: 201 })
})
