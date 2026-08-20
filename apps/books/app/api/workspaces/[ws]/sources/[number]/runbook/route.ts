// PUT /api/workspaces/{ws}/sources/{number}/runbook — `bk books source runbook-set`
//
// One runbook per source, versioned in place — the register answers "how do I
// pull this TODAY", history belongs to git (0008's header). The door refuses
// anything that does not look like a credential REFERENCE: this table must
// never hold a secret, and "must never" is checked, not hoped.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { setRunbook, publicRunbook, SourceRefused } from '@/lib/db/queries/sources'

interface Params { params: Promise<{ ws: string; number: string }> }

export const PUT = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, number } = await params
  const ctx = await resolveWorkspace(req, ws)
  const n = Number(number)
  if (!Number.isInteger(n) || n < 1) {
    throw Errors.badRequest('bad_number', `"${number}" is not a source number`, 'from `bk books source list`')
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books source runbook-set <n> --file runbook.json')

  try {
    const r = await setRunbook(ctx.workspace.id, n, {
      version: typeof body.version === 'string' ? body.version : undefined,
      updated: typeof body.updated === 'string' ? body.updated : null,
      loginUrl: typeof body.login_url === 'string' ? body.login_url : null,
      credentialRef: typeof body.credential_ref === 'string' ? body.credential_ref : null,
      steps: Array.isArray(body.steps) ? body.steps : undefined,
      output: typeof body.output === 'string' ? body.output : null,
    })
    return NextResponse.json(publicRunbook(r))
  } catch (e) {
    if (e instanceof SourceRefused) {
      if (e.code === 'source_not_found') throw Errors.notFound(e.code, e.message, e.suggestion)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
