// PATCH /api/workspaces/{ws}/analytique/categories/{number} — `bk books category retire`
//
// The only edit a cost bucket takes, and it is one-way. See
// `retireCategory` in lib/db/queries/management.ts for why a retired bucket is
// kept rather than deleted (a filed analysis may cite it), and why this verb had
// to ship alongside the default template.
//
// There is no un-retire and no rename: a bucket whose meaning changed is a
// different bucket, and `bk books category create` makes it — the accounts the
// retired one held are free the moment it is retired.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { retireCategory, publicCategory, ManagementRefused } from '@/lib/db/queries/management'
import { listEntities } from '@/lib/db/queries/statutory'

interface Params { params: Promise<{ ws: string; number: string }> }

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not a category number`, 'from `bk books category list`')
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (body?.retired !== true) {
    throw Errors.badRequest(
      'unsupported_edit',
      'retiring is the only edit a cost bucket takes',
      'send {"retired": true}; to change what a bucket collects, retire it and create the replacement — the accounts are free at once'
    )
  }

  try {
    const row = await retireCategory(ctx.workspace.id, n)
    const entities = await listEntities(ctx.workspace.id)
    const entity = entities.find((e) => e.id === row.entity_id)
    return NextResponse.json(publicCategory(row, entity?.slug ?? ''))
  } catch (e) {
    if (e instanceof ManagementRefused) {
      if (e.code === 'category_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
