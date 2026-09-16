// The dashboard's aggregates.
//
// ===========================================================================
// PER CURRENCY, NEVER MERGED (invariant I8)
// ===========================================================================
// Adding CHF to EUR produces a number that is not money in any currency. A
// dashboard that shows one is worse than a dashboard that shows nothing, because
// somebody will read it and act on it.
//
// So `by_currency` is an array and there is deliberately no `total_outstanding`
// field anywhere in this module. If a caller wants one number it has to pick a
// currency, which is the decision this app refuses to make on their behalf.
//
// ── THE TOTALS ARE DERIVED, WHICH IS WHY THIS IS NOT ONE SQL SUM ───────────
// Nothing stores an invoice total, so the outstanding figure cannot be
// `SUM(total)`. It is computed per invoice from the lines, the price mode and
// the company's rounding policy, then summed in integer rappen here.
//
// That is slower than a stored column and it is the correct trade at this
// volume: a stored total disagrees with its lines the first time somebody edits
// one, and because the rounding policy is a COMPANY setting (D-B7) a stored
// total would also need rewriting across history whenever that setting moved.
//
// If this ever becomes slow, the fix is a materialised view the database
// maintains — not a column the app writes.

import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { billingCompany, billingInvoice, billingInvoiceLine } from '../schema'
import { getDb } from '../client'
import { computeTotalsRappen, type TotalsLine } from '@/lib/derive/totals'
import { formatRappen, type Rappen } from '@/lib/derive/money'
import { listAudit } from './audit'
import { listInvoices } from './invoices'
import type { CurrencyTotal, Overview, RoundingPolicy } from '@/types'

/** How many invoices the two lists carry. Small on purpose: this is a summary. */
const RECENT = 10

export async function getOverview(workspaceId: number, company?: string): Promise<Overview> {
  const today = new Date().toISOString().slice(0, 10)

  // One pass over the workspace's invoices with their lines, because every
  // figure below needs the derived total and deriving it needs the lines.
  const where = [eq(billingInvoice.workspace_id, workspaceId)]
  if (company) where.push(eq(billingCompany.slug, company))

  const invoices = await getDb()
    .select({
      id: billingInvoice.id,
      status: billingInvoice.status,
      currency: billingInvoice.currency,
      due_date: billingInvoice.due_date,
      prices_include_vat: billingInvoice.prices_include_vat,
      rounding: billingCompany.rounding,
    })
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .where(and(...where))

  const lineRows =
    invoices.length === 0
      ? []
      : await getDb()
          .select({
            invoice_id: billingInvoiceLine.invoice_id,
            qty: billingInvoiceLine.qty,
            unit_price: billingInvoiceLine.unit_price,
            vat_rate: billingInvoiceLine.vat_rate,
          })
          .from(billingInvoiceLine)
          .where(
            inArray(
              billingInvoiceLine.invoice_id,
              invoices.map((i) => i.id)
            )
          )

  const linesByInvoice = new Map<number, TotalsLine[]>()
  for (const l of lineRows) {
    const list = linesByInvoice.get(l.invoice_id) ?? []
    list.push({ qty: l.qty, unit_price: l.unit_price, vat_rate: l.vat_rate })
    linesByInvoice.set(l.invoice_id, list)
  }

  // Rappen, in a Map keyed by currency. Integers all the way, and formatted once
  // at the end.
  const buckets = new Map<string, { outstanding: Rappen; paid: Rappen; overdue: Rappen; count: number }>()
  for (const inv of invoices) {
    const total = computeTotalsRappen(
      linesByInvoice.get(inv.id) ?? [],
      inv.prices_include_vat,
      inv.rounding as RoundingPolicy
    ).total

    const b = buckets.get(inv.currency) ?? { outstanding: 0, paid: 0, overdue: 0, count: 0 }
    b.count += 1

    // A VOID invoice counts toward nothing. It is a record that the bill was
    // cancelled, not a receivable and not revenue — and including it in either
    // figure is how a dashboard comes to overstate both.
    if (inv.status === 'paid') {
      b.paid += total
    } else if (inv.status === 'sent') {
      b.outstanding += total
      // Overdue is a SUBSET of outstanding, not a third disjoint bucket. A bill
      // that is late is still owed, and a reader who saw them as separate would
      // have to add them to learn what is owed — which is exactly the sum this
      // module refuses to make them compute.
      if (inv.due_date && inv.due_date < today) b.overdue += total
    }
    // A DRAFT counts toward neither: it has not been sent, so nobody owes it.
    buckets.set(inv.currency, b)
  }

  const by_currency: CurrencyTotal[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, b]) => ({
      currency,
      outstanding: formatRappen(b.outstanding),
      paid: formatRappen(b.paid),
      overdue: formatRappen(b.overdue),
      count: b.count,
    }))

  // ── NEEDS ACTION: what a person should look at, not "everything open" ────
  // Two kinds: a sent bill that is past its due date, and a draft that was never
  // sent. Both are things somebody has to DO something about; an on-time sent
  // bill is not.
  const overdueIds = await getDb()
    .select({ seq: billingInvoice.seq })
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .where(
      and(
        ...where,
        eq(billingInvoice.status, 'sent'),
        lt(billingInvoice.due_date, today)
      )
    )
    .orderBy(billingInvoice.due_date)
    .limit(RECENT)

  const draftIds = await getDb()
    .select({ seq: billingInvoice.seq })
    .from(billingInvoice)
    .innerJoin(billingCompany, eq(billingCompany.id, billingInvoice.company_id))
    .where(and(...where, eq(billingInvoice.status, 'draft')))
    .orderBy(desc(billingInvoice.seq))
    .limit(RECENT)

  const needsActionSeqs = [...overdueIds, ...draftIds].map((r) => r.seq).slice(0, RECENT)

  const [recent, audit] = await Promise.all([
    listInvoices(workspaceId, { company, limit: RECENT }),
    listAudit(workspaceId, { limit: RECENT }),
  ])

  // Re-read the needs-action set through the same shaping path as every other
  // invoice read, rather than assembling it here. One shaping function means the
  // frontend cannot get a differently-shaped invoice depending on which list it
  // came from — which is the `{data, next_cursor}` mistake in miniature.
  const needs_action = recent.data
    .filter((i) => needsActionSeqs.includes(i.seq))
    .concat(
      // Any needs-action invoice not already in the recent page has to be fetched
      // too, or the list silently truncates to "recent AND needing action".
      await fetchMissing(workspaceId, needsActionSeqs, recent.data.map((i) => i.seq))
    )
    .slice(0, RECENT)

  return {
    by_currency,
    needs_action,
    recent_invoices: recent.data,
    recent_audit: audit.data,
  }
}

async function fetchMissing(
  workspaceId: number,
  wanted: number[],
  have: number[]
): Promise<Overview['needs_action']> {
  const missing = wanted.filter((s) => !have.includes(s))
  if (missing.length === 0) return []
  const { data } = await listInvoices(workspaceId, { limit: LIST_CAP })
  return data.filter((i) => missing.includes(i.seq))
}

/**
 * The ceiling on the fallback read above.
 *
 * It exists because the alternative is `limit: undefined`, which would read the
 * whole workspace to find at most ten invoices. Capped rather than paginated
 * because this is a summary panel: if a workspace has more than this many
 * invoices needing action, the panel's job is to say "look at the list", not to
 * page through them.
 */
const LIST_CAP = 200
