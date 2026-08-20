// GET /api/workspaces/{ws}/compte-resultat — `bk books cr`
//
// Compte de résultat par nature, art. 959b. Ten lines, fixed order, each with its
// `sign`: +1 produit, -1 charge.
//
// Computed from MOVEMENT and never from balances. A trading year starts at zero by
// definition, which is what closing an exercice means, so a CR account has no
// opening balance to carry.
//
// ── `?by=month` — THE SAME STATEMENT, TWELVE TIMES (ticket #64) ────────────
// The annual statement answers "the year lost 10'993.60" and cannot answer
// "and almost all of it was March". `by=month` adds a `months` array carrying
// the real statutory line structure per month, derived through the same
// `crFor` the annual figure uses, so the two can never disagree and the months
// sum to the year exactly.
//
// The annual body is returned ALONGSIDE it, unchanged, rather than replaced: a
// screen showing a monthly grid still has a total to show, and making it ask
// twice for two views of one statement would invite them to be read from
// different moments.
//
// A monthly compte de résultat is a READING AID. art. 959b defines the annual
// statement; a month is not a legal reporting period and no column here is
// filable.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getCr, resolveScope } from '@/lib/db/queries/statutory'
import { getCrByMonth } from '@/lib/db/queries/management'

interface Params { params: Promise<{ ws: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams
  const scope = await resolveScope(ctx.workspace.id, q.get('entity'), q.get('exercice') ? Number(q.get('exercice')) : null)
  if ('error' in scope) throw Errors.badRequest('bad_scope', scope.error, scope.suggestion)

  if (scope.entity.bookkeeping_regime === 'simplified') {
    throw Errors.badRequest(
      'no_cr_for_simplified',
      `"${scope.entity.slug}" keeps simplified books (art. 957 al. 2 CO) and has no compte de résultat`,
      'use `bk books overview` for its recettes/dépenses totals'
    )
  }

  const cr = await getCr(scope.entity.id, scope.exercice.id)

  const by = q.get('by')
  if (by !== null && by !== 'month') {
    throw Errors.badRequest(
      'bad_breakdown',
      `"${by}" is not a breakdown this statement has`,
      'the only one is `by=month`; the statement itself is annual (art. 959b)'
    )
  }
  const months = by === 'month' ? await getCrByMonth(scope.entity, scope.exercice) : undefined

  return NextResponse.json({
    entity: scope.entity.slug,
    exercice: scope.exercice.year,
    ...cr,
    ...(months ? { months } : {}),
  })
})
