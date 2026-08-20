// PATCH /api/workspaces/{ws}/entities/{slug} — `bk books entity edit`
//
// A book's own facts, after the day it was created. `queries/entity-edit.ts`
// carries the reasoning and the split between what may change and what may not.
//
// The field that made this urgent is `vat_registered`: it defaults to false,
// `entity create` never set it, nothing could update it, and `getTaxSnapshot`
// gates the whole VAT position on it. So every book a person created reported
// no VAT position at all, permanently, however its entries were booked.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { publicEntity } from '@/lib/db/queries/statutory'
import { updateEntity, refusePermanentFields, EntityEditRefused } from '@/lib/db/queries/entity-edit'

interface Params { params: Promise<{ ws: string; slug: string }> }

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, slug } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books entity edit')

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)

  try {
    // Named first, so somebody asking to change a legal form hears about the
    // legal form rather than about some other field they also passed.
    refusePermanentFields(body)

    const row = await updateEntity(ctx.workspace.id, slug, {
      name: str('name'),
      seat: 'seat' in body ? (str('seat') ?? null) : undefined,
      vat_registered: typeof body.vat_registered === 'boolean' ? body.vat_registered : undefined,
      vat_method: 'vat_method' in body ? (str('vat_method') ?? null) : undefined,
      vat_filing: 'vat_filing' in body ? (str('vat_filing') ?? null) : undefined,
      vat_note: 'vat_note' in body ? (body.vat_note as never) : undefined,
      audit_status: 'audit_status' in body ? (str('audit_status') ?? null) : undefined,
      regime_election: 'regime_election' in body ? (str('regime_election') ?? null) : undefined,
      fte_count: 'fte_count' in body ? (str('fte_count') ?? null) : undefined,
      accent: 'accent' in body ? (str('accent') ?? null) : undefined,
    })
    return NextResponse.json(publicEntity(row))
  } catch (e) {
    if (e instanceof EntityEditRefused) {
      if (e.code === 'entity_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
