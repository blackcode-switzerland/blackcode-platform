// POST /api/workspaces/{ws}/sources/{number}/pulls — `bk books source record-pull`
//
// Record a pull the import door did not make itself: the Stripe CSV, the PDF
// the Companion parked in Drive. camt.053 imports record their own pull; this
// is for every other format the register tracks. Idempotent on (source, file)
// — the first delivery is the record, a retry converges. `last_import` moves,
// so the completeness status goes green without anyone touching it.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { recordPull, publicPull, SourceRefused } from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string; number: string }> }

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const file = typeof body?.file === 'string' && body.file.trim() ? body.file.trim() : null
  if (!file) throw Errors.badRequest('missing_file', 'file is required — it is the idempotency key', 'bk books source record-pull <n> --file <name>')

  try {
    const r = await recordPull(ctx.workspace.id, n, {
      file,
      period: typeof body?.period === 'string' ? body.period : null,
      format: typeof body?.format === 'string' ? body.format : null,
      hash: typeof body?.hash === 'string' ? body.hash : null,
      driveRef: typeof body?.drive_ref === 'string' ? body.drive_ref : null,
      pulled: typeof body?.pulled === 'string' ? body.pulled : null,
    })
    return NextResponse.json({ ...publicPull(r.pull), created: r.created }, { status: r.created ? 201 : 200 })
  } catch (e) {
    if (e instanceof SourceRefused) {
      if (e.code === 'source_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
