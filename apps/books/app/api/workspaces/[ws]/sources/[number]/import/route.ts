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
import { importCamt, ImportRefused } from '@/lib/db/queries/imports'

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
  const xml = typeof body?.xml === 'string' ? body.xml : null
  if (!file || !xml) {
    throw Errors.badRequest('missing_payload', 'pass { file, xml }: the statement file name and its camt.053 content', 'bk books source import <n> --file statement.xml')
  }

  const sha256 = createHash('sha256').update(xml).digest('hex')

  try {
    const summary = await importCamt(ctx.workspace.id, n, file, xml, sha256)
    return NextResponse.json(summary)
  } catch (e) {
    if (e instanceof ImportRefused) {
      if (e.code === 'source_not_found') throw Errors.notFound('source', String(n))
      throw Errors.badRequest(e.code, e.message, e.problems.join(' · ') || 'fix the file and import again — nothing landed')
    }
    throw e
  }
})
