// GET  /api/workspaces/{ws}/entries — `bk books entry list`
// POST /api/workspaces/{ws}/entries — `bk books entry declare`
//
// The GET is the journal, and since phase 4A it serves BOTH journals: the
// grand livre for a double-entry book, the recettes-dépenses journal for a
// simplified one. The caller named the book (or accepted the default), so the
// caller knows which shape it gets — context explicit, no marker field.
// Filters `?status=` and `?account=` mean nothing to an RI journal and are
// refused there rather than silently ignored.
//
// The POST is the write path for money no feed will ever deliver: a cash
// coffee, the owner's CHF 20 note. It lands STAGED like everything else;
// the declarer's name goes into history as provenance.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace, appContext } from '@/lib/api'
import { listEntries, listRiEntries, publicEntry, publicRiEntry, resolveScope } from '@/lib/db/queries/statutory'
import { declareEntry, DeclareRefused } from '@/lib/db/queries/declare'
import { TvaRefused } from '@/lib/db/queries/tva'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  if (scope.entity.bookkeeping_regime === 'simplified') {
    if (q.get('status') || q.get('account')) {
      throw Errors.badRequest(
        'ri_no_such_filter',
        'an RI journal has no posting status and no accounts to filter by',
        'drop --status/--account; --recognition works on both journals'
      )
    }
    let rows = await listRiEntries(scope.entity.id, scope.exercice.id)
    const rec = q.get('recognition')
    if (rec) rows = rows.filter((r) => r.recognition === rec)
    const names = { entity: scope.entity.slug, exercice: scope.exercice.year }
    return jsonList(rows.map((r) => publicRiEntry(r, names)), null)
  }

  const rows = await listEntries(scope.entity.id, scope.exercice.id, {
    status: q.get('status') ?? undefined,
    recognition: q.get('recognition') ?? undefined,
    account: q.get('account') ?? undefined,
    limit: q.get('limit') ? Number(q.get('limit')) : undefined,
  })
  const names = { entity: scope.entity.slug, exercice: scope.exercice.year }
  return jsonList(rows.map((r) => publicEntry(r, names)), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const user = await appContext.resolveUser(req)

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books entry declare')
  const need = (k: string): string => {
    const v = body[k]
    if (typeof v !== 'string' || !v.trim()) {
      throw Errors.badRequest('missing_field', `${k} is required`, 'bk books entry declare --help shows the shape')
    }
    return v.trim()
  }
  const explanation = body.explanation
  if (!explanation || typeof explanation !== 'object') {
    throw Errors.badRequest('missing_explanation', 'a declaration IS an explanation; there is nothing to save without one', 'pass --explanation')
  }

  try {
    const r = await declareEntry(ctx.workspace.id, {
      entitySlug: need('entity'),
      date: need('date'),
      amount: need('amount'),
      label: need('label'),
      explanation: explanation as Record<string, unknown>,
      counterparty: typeof body.counterparty === 'string' ? body.counterparty : null,
      direction: body.direction as 'recette' | 'depense' | 'neutral' | undefined,
      account: typeof body.account === 'string' ? body.account : undefined,
      contra: typeof body.contra === 'string' ? body.contra : undefined,
      tva: tvaFromBody(body),
      declaredBy: user?.email ?? 'unknown caller',
    })
    return NextResponse.json(r, { status: 201 })
  } catch (e) {
    if (e instanceof DeclareRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    if (e instanceof TvaRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})

/**
 * The VAT half of the payload, or `undefined` when the caller said nothing.
 *
 * `undefined` and "all fields absent" have to stay distinct: an entry with no
 * VAT story stores NULLs, and passing an empty object would look like a claim
 * of 0%. See `queries/tva.ts`.
 */
function tvaFromBody(body: Record<string, unknown>) {
  const tva = (body.tva ?? {}) as Record<string, unknown>
  const rate = tva.rate ?? body.tva_rate
  const amount = tva.amount ?? body.tva_amount
  const claimed = tva.input_claimed ?? body.tva_input_claimed
  const tier = tva.evidence_tier ?? body.evidence_tier
  if (rate == null && amount == null && claimed == null && tier == null) return undefined
  return {
    rate: rate as number | string | null,
    amount: typeof amount === 'string' ? amount : amount == null ? null : String(amount),
    inputClaimed: claimed === true,
    evidenceTier: typeof tier === 'string' ? tier : null,
  }
}
