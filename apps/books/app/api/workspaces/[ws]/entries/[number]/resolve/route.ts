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
import { resolveEntry, ResolveRefused } from '@/lib/db/queries/resolve'

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

  try {
    const result = await resolveEntry(ctx.workspace.id, n, {
      explanation: explanation as Record<string, unknown>,
      recognition: recognition as 'known_one_off' | 'known_recurring' | undefined,
      counterparty: typeof body?.counterparty === 'string' ? body.counterparty : undefined,
      account: typeof body?.account === 'string' ? body.account : undefined,
      evidenceNote: (body?.evidence_note as Record<string, unknown> | undefined) ?? undefined,
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
      if (e.code === 'not_found') throw Errors.notFound('entry', String(n))
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
