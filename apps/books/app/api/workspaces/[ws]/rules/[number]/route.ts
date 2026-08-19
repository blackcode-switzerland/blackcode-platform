// PATCH /api/workspaces/{ws}/rules/{number} — `bk books rule deactivate`
//
// ===========================================================================
// A RULE TAUGHT WRONGLY WAS PERMANENT
// ===========================================================================
// Teaching a rule is the core loop: `bk books resolve --rule-counterparty …`
// says "this is what these payments are", and every later import matches
// against it, marking a line `inferred` with the rule cited. That loop is the
// product's main promise and an agent drives it hard.
//
// `deactivateRule` has existed in `queries/resolve.ts` the whole time. No route
// imported it. So a rule taught against the wrong fragment, or against an
// amount that later changed, kept matching future imports for ever and nothing
// could stop it — the one write in this app that could quietly get worse over
// time.
//
// ── DEACTIVATED, NEVER DELETED ──────────────────────────────────────────────
// `books.entry.matched_rule_id` is a real foreign key and a posted entry may
// cite a rule for the ten years art. 958f keeps it. So the rule stays, its
// `active` flag goes false, and `listRules(entityId, { active: true })` — what
// the importer reads — stops seeing it. What it already explained keeps its
// explanation.
//
// There is no reactivate. Teaching it again is one `resolve` away, and the new
// rule records what it was learned from and when, which a flag flipped back
// would not.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { deactivateRule } from '@/lib/db/queries/resolve'

interface Params { params: Promise<{ ws: string; number: string }> }

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n <= 0) {
    throw Errors.badRequest('bad_number', `"${number}" is not a rule number`, 'bk books rule list')
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (body?.active !== false) {
    throw Errors.badRequest(
      'only_deactivation',
      'a rule can be switched off and not back on',
      'pass { "active": false }; to teach it again, resolve an entry with --rule-counterparty, which records what it was learned from'
    )
  }

  const done = await deactivateRule(ctx.workspace.id, n)
  if (!done) {
    throw Errors.notFound('rule_not_found', `no rule #${n}`, 'bk books rule list')
  }
  return NextResponse.json({ number: n, active: false })
})
