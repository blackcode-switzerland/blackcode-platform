// POST /api/workspaces/{ws}/sources/{number}/import — `bk books source import`
//
// THE BANK DOOR. Write path #1 of the spec's "deliberately few": the
// Companion (or a human) delivers one camt.053 statement and every booked
// line lands STAGED in the source's book — whole file or nothing.
//
// The server parses the XML itself: unlike the pièces door, where OCR is
// fallible judgment kept at arm's length, reading camt.053 is deterministic
// arithmetic, so one canonical golden-file-tested reader beats trusting a
// worker's parse. The file must reconcile against itself (opening + lines =
// closing, to the rappen) or it is refused with the arithmetic shown.
//
// Rules run at arrival — a clean hit lands `inferred`, never resolved: the
// machine suggests, a human confirms. The fx story is written when the bank
// converted. Idempotent per line on the bank's own reference, so overlapping
// statements converge instead of duplicating.
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { importCamt, importStatement, ImportRefused } from '@/lib/db/queries/imports'
import { getSourceBySeq } from '@/lib/db/queries/sources'
import { parseDelimited, DelimitedRefused, type DelimitedMapping } from '@/lib/import/delimited'

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
  // `xml` is the camt payload and keeps its name; `content` is the delimited
  // one. Both are the file verbatim — this door has never taken an upload.
  const xml = typeof body?.xml === 'string' ? body.xml : null
  const content = typeof body?.content === 'string' ? body.content : null
  if (!file || (!xml && !content)) {
    throw Errors.badRequest(
      'missing_payload',
      'pass { file, xml } for camt.053 or { file, content, opening, closing } for a delimited export',
      'bk books source import <n> --file statement.xml'
    )
  }

  const payload = (xml ?? content) as string
  const sha256 = createHash('sha256').update(payload).digest('hex')

  try {
    if (xml) {
      return NextResponse.json(await importCamt(ctx.workspace.id, n, file, xml, sha256))
    }

    // ── THE DELIMITED PATH ───────────────────────────────────────────────
    // The balances come from the CALLER because the file usually does not
    // carry them, and `verifyCamt` must still be able to prove the file is
    // whole — see `lib/import/delimited.ts`. Refusing them here rather than
    // defaulting to zero is the point: a default would make every truncated
    // download reconcile against itself.
    const opening = typeof body?.opening === 'string' ? body.opening : null
    const closing = typeof body?.closing === 'string' ? body.closing : null
    if (!opening || !closing) {
      throw Errors.badRequest(
        'missing_balances',
        'a delimited import needs the opening and closing balances this file should reconcile to',
        'read them off the statement and pass --opening and --closing. Without them nothing can tell a whole file from half of one, which is the check camt.053 gets for free'
      )
    }

    const src = await getSourceBySeq(ctx.workspace.id, n)
    if (!src) throw Errors.notFound('source_not_found', `no source #${n}`, 'bk books source list shows the register')
    const mapping = src.import_mapping as DelimitedMapping | null
    if (!mapping) {
      throw Errors.badRequest(
        'no_import_mapping',
        `source #${n} has no import mapping, so this file cannot be read`,
        'every issuer names its columns differently. Establish it once from a real export: bk books source mapping-set'
      )
    }

    let stmt
    try {
      stmt = parseDelimited(content as string, mapping, { opening, closing, closing_on: typeof body?.closing_on === 'string' ? body.closing_on : null }, `src${n}`)
    } catch (e) {
      if (e instanceof DelimitedRefused) {
        throw Errors.badRequest(e.code, e.message, e.problems.join(' · ') || 'fix the file or the mapping and import again — nothing landed')
      }
      throw e
    }
    return NextResponse.json(await importStatement(ctx.workspace.id, n, file, stmt, sha256, 'delimited'))
  } catch (e) {
    if (e instanceof ImportRefused) {
      if (e.code === 'source_not_found') throw Errors.notFound(e.code, e.message, 'bk books source list shows the register')
      throw Errors.badRequest(e.code, e.message, e.problems.join(' · ') || 'fix the file and import again — nothing landed')
    }
    throw e
  }
})
