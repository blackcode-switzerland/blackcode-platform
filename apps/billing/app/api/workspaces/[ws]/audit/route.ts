// GET /api/workspaces/{ws}/audit — `bk billing audit list`
//
// ===========================================================================
// TWO READERS, TWO ORDERINGS, AND THE DIFFERENCE IS DELIBERATE
// ===========================================================================
// **No `?since=`** → newest first. That is what a human panel wants: the last
// thing that happened, at the top.
//
// **`?since=<seq>`** → rows ASCENDING from that cursor. That is what a poller
// wants, and it is this app's event feed
// (`docs/billing-app-plan/integration-surface.md` §4): how an outside system
// learns a bill was sent, paid or voided by somebody in the browser.
//
// Reversing a feed's order would make a poller re-read the same page forever, so
// the two orderings are a contract rather than a convenience.
//
// ── WHY A POLLER CANNOT MISS A ROW ─────────────────────────────────────────
// `seq` comes from the counter upsert in `lib/db/queries/seq.ts`, which takes a
// row lock. A second writer blocks until the first commits or rolls back, so
// **sequence order IS commit order** — no row can be committed with a `seq`
// below one a poller has already passed.
//
// That property is the whole feed. Replace the counter with anything that does
// not serialise — a sequence, a client-side max+1, an advisory lock released
// early — and the feed silently starts dropping rows, with nothing to say so.
import { NextRequest } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { listAudit } from '@/lib/db/queries/audit'
import { getInvoiceRow } from '@/lib/db/queries/invoices'
import { LIST_LIMIT_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const sinceRaw = q.get('since')
  if (sinceRaw !== null && !/^\d+$/.test(sinceRaw)) {
    throw Errors.badRequest(
      'invalid_since',
      'since is the `seq` of the last row you saw',
      'pass the next_cursor the previous page returned, or drop it for newest-first'
    )
  }

  const limitRaw = q.get('limit')
  if (limitRaw !== null && !/^\d+$/.test(limitRaw)) {
    throw Errors.badRequest('invalid_limit', 'limit is a whole number', `1 to ${LIST_LIMIT_MAX}`)
  }

  // `?subject=invoice:7` — the panel on one invoice's page. Resolved through the
  // invoice's own read so an unknown reference is a 404 naming the invoice,
  // rather than an empty page that reads as "nothing ever happened to it".
  let subjectType: 'invoice' | 'company' | 'recurrence' | undefined
  let subjectId: number | undefined
  const subject = q.get('subject')
  if (subject) {
    const [type, ref] = subject.split(':')
    if (type !== 'invoice' || !ref) {
      throw Errors.badRequest(
        'invalid_subject',
        'subject is `invoice:<ref>`',
        'company and recurrence subjects arrive with their own screens'
      )
    }
    const row = await getInvoiceRow(ctx.workspace.id, ref)
    if (!row) throw Errors.notFound('invoice', 'bk billing invoice list')
    subjectType = 'invoice'
    subjectId = Number(row.id)
  }

  const page = await listAudit(ctx.workspace.id, {
    since: sinceRaw !== null ? Number(sinceRaw) : undefined,
    subjectType,
    subjectId,
    limit: limitRaw ? Number(limitRaw) : undefined,
  })
  return jsonList(page.data, page.next_cursor === null ? null : Number(page.next_cursor))
})
