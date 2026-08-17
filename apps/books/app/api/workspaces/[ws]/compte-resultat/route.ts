// GET /api/workspaces/{ws}/compte-resultat — `bk books cr`
//
// Compte de résultat par nature, art. 959b. Ten lines, fixed order, each with its
// `sign`: +1 produit, -1 charge.
//
// Computed from MOVEMENT and never from balances. A trading year starts at zero by
// definition, which is what closing an exercice means, so a CR account has no
// opening balance to carry.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getCr, resolveScope } from '@/lib/db/queries/statutory'

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
  return NextResponse.json({
    entity: scope.entity.slug,
    exercice: scope.exercice.year,
    ...cr,
  })
})
