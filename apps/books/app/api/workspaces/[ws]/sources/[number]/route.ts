// GET /api/workspaces/{ws}/sources/{number} — `bk books source show`
//
// One source in full: the computed status, the raw files pulled from it, and
// the runbook that says how to pull the next one. `credential_ref` in the
// runbook is a vault reference; if a real secret ever appears in this payload,
// the bug is in whoever wrote the runbook, and the fix is rotation, not CSS.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import {
  getSourceBySeq,
  pullsOf,
  runbookOf,
  publicSource,
  publicPull,
  publicRunbook,
  entitySlugsById,
  reconcileSource,
} from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string; number: string }> }

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  const src = await getSourceBySeq(ctx.workspace.id, n)
  if (!src) throw Errors.notFound('source_not_found', `no source #${n} in this workspace`, 'bk books source list shows the register')

  const today = new Date().toISOString().slice(0, 10)
  const [pulls, runbook, slugs, reconciliation] = await Promise.all([
    pullsOf(src.id),
    runbookOf(src.id),
    entitySlugsById(ctx.workspace.id),
    reconcileSource(src),
  ])
  return NextResponse.json({
    ...publicSource(src, today, src.entity_id === null ? null : (slugs.get(src.entity_id) ?? null)),
    pulls: pulls.map(publicPull),
    runbook: runbook ? publicRunbook(runbook) : null,
    // The ledger against what the bank last reported. Derived at read time and
    // stored nowhere, like every other statement in this app.
    reconciliation,
  })
})

// PATCH /api/workspaces/{ws}/sources/{number} — `bk books source edit`
//
// Cadence changes, the method line moves, a feed retires. Register upkeep;
// the pulls under it are records and stay untouched.
export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books source edit')

  const { updateSource, SourceRefused } = await import('@/lib/db/queries/sources')
  try {
    const s = await updateSource(ctx.workspace.id, n, {
      name: typeof body.name === 'string' ? body.name : undefined,
      expected: body.expected === null || typeof body.expected === 'string' ? (body.expected as string | null) : undefined,
      ledgerAccounts: Array.isArray(body.ledger_accounts) ? (body.ledger_accounts as string[]) : undefined,
      method: body.method === null || typeof body.method === 'string' ? (body.method as string | null) : undefined,
      notes: (body.notes as Record<string, unknown> | undefined) ?? undefined,
      retired: typeof body.retired === 'boolean' ? body.retired : undefined,
    })
    return NextResponse.json({ number: s.seq, name: s.name, retired: s.retired })
  } catch (e) {
    if (e instanceof SourceRefused) {
      if (e.code === 'source_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
