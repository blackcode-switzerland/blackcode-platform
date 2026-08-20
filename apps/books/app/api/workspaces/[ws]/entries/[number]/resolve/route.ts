// POST /api/workspaces/{ws}/entries/{number}/resolve — `bk books resolve`
//
// The first write path in the app. A human (or an agent a human runs) says what
// the money was; the entry keeps its old state in `history` forever, and the
// resolution may teach a rule so the next matching payment explains itself.
//
// The refusals are typed and mapped here: attempting to set an account on a
// POSTED entry answers 400 with "a correction is a reversing entry" rather than
// surfacing the freeze trigger's constraint error — same fact, said where the
// caller can act on it.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveEntry, resolveRiEntry, ResolveRefused } from '@/lib/db/queries/resolve'
import { TvaRefused } from '@/lib/db/queries/tva'
import { getEntityBySlug } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string; number: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not an entry number`, 'the workspace #number, from the worklist')
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const explanation = body?.explanation
  if (!explanation || typeof explanation !== 'object') {
    throw Errors.badRequest(
      'missing_explanation',
      'a resolution IS an explanation; there is nothing to save without one',
      'pass --explanation "what this money was"'
    )
  }

  const recognition = body?.recognition
  if (recognition !== undefined && recognition !== 'known_one_off' && recognition !== 'known_recurring') {
    throw Errors.badRequest(
      'bad_recognition',
      'resolve can only conclude known_one_off or known_recurring',
      'unrecognized and inferred are the states resolve moves AWAY from'
    )
  }

  const rule = body?.rule as { counterparty?: unknown } | null | undefined
  if (rule && (typeof rule.counterparty !== 'string' || !rule.counterparty.trim())) {
    throw Errors.badRequest('bad_rule', 'a taught rule needs a counterparty fragment', 'rule: { counterparty: "IMMOREGIE" }')
  }

  // Which journal does the number name? Bare, it is the grand livre. A
  // simplified book's rows are addressed WITH their book: body.entity names
  // it, and the resolution runs against the recettes-dépenses journal.
  let riEntityId: number | null = null
  const entitySlug = typeof body?.entity === 'string' ? body.entity.trim() : null
  if (entitySlug) {
    const e = await getEntityBySlug(ctx.workspace.id, entitySlug)
    if (!e) throw Errors.badRequest('bad_entity', `no book with slug "${entitySlug}"`, 'bk books entity list')
    if (e.bookkeeping_regime === 'simplified') riEntityId = e.id
  }

  try {
    const doResolve = (data: Parameters<typeof resolveEntry>[2]) =>
      riEntityId !== null ? resolveRiEntry(ctx.workspace.id, riEntityId, n, data) : resolveEntry(ctx.workspace.id, n, data)
    const result = await doResolve({
      explanation: explanation as Record<string, unknown>,
      recognition: recognition as 'known_one_off' | 'known_recurring' | undefined,
      counterparty: typeof body?.counterparty === 'string' ? body.counterparty : undefined,
      account: typeof body?.account === 'string' ? body.account : undefined,
      evidenceNote: (body?.evidence_note as Record<string, unknown> | undefined) ?? undefined,
      tva: tvaFromBody((body ?? {}) as Record<string, unknown>),
      rule: rule
        ? {
            counterparty: (rule.counterparty as string).trim(),
            amount_chf: typeof (rule as Record<string, unknown>).amount_chf === 'number' ? ((rule as Record<string, unknown>).amount_chf as number) : null,
            tolerance_chf: typeof (rule as Record<string, unknown>).tolerance_chf === 'number' ? ((rule as Record<string, unknown>).tolerance_chf as number) : null,
            interval: typeof (rule as Record<string, unknown>).interval === 'string' ? ((rule as Record<string, unknown>).interval as string) : null,
            learnedFrom: typeof (rule as Record<string, unknown>).learned_from === 'string' ? ((rule as Record<string, unknown>).learned_from as string) : null,
          }
        : null,
    })
    return NextResponse.json({
      number: result.entry.seq,
      recognition: result.entry.recognition,
      explanation: result.entry.explanation,
      history: result.entry.history,
      taught_rule: result.taughtRuleSeq,
    })
  } catch (e) {
    if (e instanceof ResolveRefused) {
      if (e.code === 'not_found') throw Errors.notFound('entry_not_found', e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    if (e instanceof TvaRefused) throw Errors.badRequest(e.code, e.message, e.suggestion)
    throw e
  }
})

/** The VAT half of the payload. Same reading as the declare door. */
function tvaFromBody(body: Record<string, unknown>) {
  const tva = (body.tva ?? {}) as Record<string, unknown>
  const rate = tva.rate ?? body.tva_rate
  const amount = tva.amount ?? body.tva_amount
  const claimed = tva.input_claimed ?? body.tva_input_claimed
  const tier = tva.evidence_tier ?? body.evidence_tier
  // The explicit clear (#67). Silence leaves the row's VAT alone, so removing
  // one has to be said out loud.
  const clear = tva.clear === true || body.tva_clear === true
  if (clear) return { clear: true }
  if (rate == null && amount == null && claimed == null && tier == null) return undefined
  return {
    rate: rate as number | string | null,
    amount: typeof amount === 'string' ? amount : amount == null ? null : String(amount),
    inputClaimed: claimed === true,
    evidenceTier: typeof tier === 'string' ? tier : null,
  }
}
