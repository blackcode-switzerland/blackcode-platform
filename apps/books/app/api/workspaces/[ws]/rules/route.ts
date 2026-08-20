// GET  /api/workspaces/{ws}/rules — `bk books rule list`
// POST /api/workspaces/{ws}/rules — `bk books rule create`
//
// A rule is a remembered judgment: "payments to this landlord from this account
// mean office rent". The match key is the PAIR (source, counterparty), never the
// merchant name alone — the route accepts nothing that would loosen that.
//
// Most rules are not created here but by `POST /entries/{n}/resolve` teaching
// one from a resolution, which also records the teaching entry. This POST exists
// for rules that predate any entry: a signed contract or a subscription is
// knowledge before the first franc moves, and `learned_from` says which.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { resolveScope } from '@/lib/db/queries/statutory'
import { listRules, createRule, publicRule, teachingSeqs, sourceSeqs } from '@/lib/db/queries/rules'
import { getSourceBySeq } from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const activeOnly = q.get('active') === 'true'
  const rows = await listRules(scope.entity.id, activeOnly ? { active: true } : {})
  const [seqs, srcSeqs] = await Promise.all([teachingSeqs(rows), sourceSeqs(rows)])
  return jsonList(
    rows.map((r) => publicRule(r, seqs.get(r.id) ?? null, r.source_id === null ? null : (srcSeqs.get(r.source_id) ?? null))),
    null
  )
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim() : ''
  if (!counterparty) {
    throw Errors.badRequest('missing_counterparty', 'a rule needs a counterparty fragment', 'pass --counterparty IMMOREGIE')
  }

  const num = (k: string): number | null => (typeof body?.[k] === 'number' ? (body[k] as number) : null)
  const str = (k: string): string | null => (typeof body?.[k] === 'string' ? (body[k] as string) : null)

  // ── #66: THE NUMBER IS NOT THE ID ──────────────────────────────────────
  // `--source 1` sends the # column `bk books source list` prints. This route
  // put it straight into a FK expecting the row id, the constraint violation
  // surfaced as a bare 500, and there was no way through bk to learn the real
  // id — so the flag could not be used correctly by anyone.
  //
  // Resolving it here (scoped to the workspace, so one tenant cannot key a rule
  // to another's feed) is also what makes the refusal possible: an agent can
  // act on `unknown_source` with a suggestion, and can do nothing whatever with
  // an internal_error. `publicRule` now serves the #number back, so what
  // `rule list` shows is what `rule create --source` takes.
  let sourceId: number | null = null
  const sourceSeq = num('source')
  if (sourceSeq !== null) {
    const src = await getSourceBySeq(ctx.workspace.id, sourceSeq)
    if (!src) {
      throw Errors.badRequest(
        'unknown_source',
        `no source #${sourceSeq} in this workspace`,
        'bk books source list shows the numbers — pass the # column, not a database id'
      )
    }
    if (src.entity_id !== null && src.entity_id !== scope.entity.id) {
      throw Errors.badRequest(
        'source_other_book',
        `source #${sourceSeq} belongs to another book`,
        'a rule is keyed to the (source, counterparty) pair and both must be this book\'s'
      )
    }
    sourceId = src.id
  }

  const row = await createRule(ctx.workspace.id, {
    entityId: scope.entity.id,
    sourceId,
    pattern: {
      counterparty,
      amount_chf: num('amount_chf'),
      tolerance_chf: num('tolerance_chf'),
      interval: str('interval'),
    },
    explanation: (body?.explanation as Record<string, unknown> | undefined) ?? null,
    accountNo: str('account'),
    learnedFrom: str('learned_from') ?? 'manual',
  })
  return NextResponse.json(publicRule(row, null, sourceSeq), { status: 201 })
})
