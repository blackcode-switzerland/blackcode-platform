// WHAT THIS APP HOLDS FOR A PERSON.
//
// The interface is `packages/platform-api/src/account-footprint.ts`. Read it
// before changing anything here; the two rules it states are load-bearing.
//
// ---------------------------------------------------------------------------
// WHY YOUR COPY OF THIS APP MUST GET THIS RIGHT
// ---------------------------------------------------------------------------
// `AppContext.footprint` is REQUIRED. It is required because, until 2026-08-11,
// closing a blackcode account soft-deleted `platform.users` and deleted one
// app's workspaces — and every other app's data survived, owned by an account
// that could no longer sign in. Not lost: **stranded**, invisible to its owner
// and unrecoverable by them, because there was no sign-in left to recover with.
//
// A new app that could not answer "what do I hold?" would be silently skipped by
// the account close, which is that bug reintroduced. So this field has no
// default, and the honest answer for an app holding nothing per person is
// `UNKNOWN_FOOTPRINT` explicitly — not an omission.
//
// ---------------------------------------------------------------------------
// TWO THINGS TO KEEP WHEN YOU ADAPT IT
// ---------------------------------------------------------------------------
//   1. **`purge` must never touch `platform.users`, `platform.api_tokens` or
//      `platform.inbox_messages`.** Those are the ACCOUNT — the one thing every
//      app shares — and closing it is a separate, louder act that happens once,
//      from `DELETE /api/me`, after every app reports empty.
//   2. **`purge` returns a FRESH read, not an optimistic construction.** The
//      account close asserts on it before it soft-deletes the user. A 200 says
//      the request was handled; the return value says the app is empty, and only
//      the second one is what makes it safe to proceed (CLAUDE.md finding #16:
//      assert the positive, treat the refusals as the weaker half).

import { inArray, eq, sql } from 'drizzle-orm'
import type { AppFootprint, FootprintSource } from '@blackcode/platform-api'
import { getDb } from '../client'
import { billingCompany, billingHistory, billingInvoice, billingRecurrence, billingWorkspaceMembers, billingWorkspaces } from '../schema'
import { APP_SLUG } from '@/lib/app'
import { describeHoldings, holdsRetainedRecords, workspaceHoldings } from './workspaces'

export const billingFootprintSource: FootprintSource = {
  read: (userId) => readFootprint(userId),

  async purge(userId) {
    const before = await readFootprint(userId)
    if (before.blocked_by.length > 0) {
      // Refused here as well as at the route, because `purge` is also reached
      // from ANOTHER app's account close over HTTP. A workspace with other
      // people in it is not one app's to destroy.
      throw new Error(
        `refusing to purge ${APP_SLUG}: ${before.blocked_by.length} workspace(s) have other members or are under a retention hold`
      )
    }
    const ids = before.will_delete.map((w) => w.workspace_id)
    if (ids.length > 0) {
      // One DELETE. Every table cascades from the workspace, and the
      // `platform.blob_references` triggers on the content tables maintain the
      // blob index as the cascade runs — reproducing any of that by hand would
      // be a second implementation of the thing nobody may get wrong.
      await getDb().delete(billingWorkspaces).where(inArray(billingWorkspaces.id, ids))
    }
    return readFootprint(userId)
  },
}

async function readFootprint(userId: number): Promise<AppFootprint> {
  const owned = await getDb().execute<{
    workspace_id: number
    name: string
    member_count: number
  }>(sql`
    SELECT w.id AS workspace_id, w.name, COUNT(m.id)::int AS member_count
    FROM ${billingWorkspaces} w
    LEFT JOIN ${billingWorkspaceMembers} m ON m.workspace_id = w.id
    WHERE w.owner_id = ${userId}
    GROUP BY w.id, w.name
  `)

  const blocked: AppFootprint['blocked_by'] = []
  const willDelete: AppFootprint['will_delete'] = []
  for (const r of owned.rows) {
    if (Number(r.member_count) > 1) {
      blocked.push({
        workspace_id: r.workspace_id,
        name: r.name,
        member_count: Number(r.member_count),
        reason: 'members',
      })
      continue
    }
    // ── A SOLE-OWNED WORKSPACE THAT HOLDS RETAINED RECORDS IS BLOCKED TOO ──
    // (2026-09-21.) It used to go into `will_delete`, and `purge` then issued
    // the DELETE — which cascades into company/invoice/audit/history/recurrence,
    // each with a BEFORE DELETE trigger that raises (0005, 0010, 0012). So the
    // erase answered 500 with a trigger message, half-way through what the
    // settings page had promised would delete "your invoices". It can never
    // succeed, for anybody: ten-year retention (art. 958f CO). Reported as
    // `reason: 'retention'` so the refusal is a 409 naming the records, and so
    // `DELETE /api/workspaces/{ws}` and this purge agree on one rule
    // (`holdsRetainedRecords`).
    const h = await workspaceHoldings(r.workspace_id)
    if (holdsRetainedRecords(h)) {
      blocked.push({
        workspace_id: r.workspace_id,
        name: r.name,
        member_count: Number(r.member_count),
        reason: 'retention',
        detail: `holds ${describeHoldings(h)}`,
      })
    } else {
      willDelete.push({ workspace_id: r.workspace_id, name: r.name })
    }
  }

  const memberships = await getDb()
    .select({ id: billingWorkspaceMembers.id })
    .from(billingWorkspaceMembers)
    .where(eq(billingWorkspaceMembers.user_id, userId))
    .limit(1)

  return {
    // "You have nothing here" and "you have never been here" are different
    // answers — the same distinction `/api/meta`'s `workspaces: []` carries.
    known: memberships.length > 0 || blocked.length > 0,
    blocked_by: blocked,
    will_delete: willDelete,
    holds: willDelete.length === 0 ? [] : await countIn(willDelete.map((w) => w.workspace_id)),
  }
}

/**
 * What is inside the workspaces that would be destroyed, in THIS APP'S NOUNS.
 *
 * One entry per thing a person would recognise losing. Counts, not workspaces —
 * "3 workspaces" tells somebody nothing about what is in them.
 *
 * Scoped to `will_delete`, not to everything the person authored: an invoice
 * they raised in a colleague's workspace is not lost, and overstating the damage
 * on a confirmation screen is its own kind of dishonesty.
 *
 * ===========================================================================
 * PHASE 1 FILLED THIS IN, AND THE GUARD IS WHY
 * ===========================================================================
 * Through phase 0 this returned `[]`, correctly: the app had tenancy and a
 * counter and no entities. From phase 1 that answer would be a LIE, and nothing
 * about the shape of the code changes when it becomes one — which is exactly the
 * failure `AppContext.footprint` exists to prevent. An app that under-reports is
 * an app the whole-account close silently SKIPS, leaving its data owned by an
 * account that can no longer sign in.
 *
 * So the obligation is guarded rather than remembered.
 * `holds-covers-entities.test.ts` reads the table list out of `lib/db/schema.ts`
 * and fails when a table is neither counted here nor explicitly exempt. It went
 * red the moment migration 0004's tables were mirrored, which is how this
 * function came to be written rather than forgotten.
 *
 * ── AND THE GUARD ITSELF HAD FINDING #11's DEFECT ──────────────────────────
 * Its first version scanned this whole file and therefore accepted a COMMENT
 * naming a table. The header that used to sit here promised phase 1 would add
 * `company` and `invoice`, and that promise satisfied the check for it — so the
 * guard reported three of the five new tables and stayed quiet about those two.
 * It strips comments now. Worth knowing before adding a table: the mention has
 * to be in the CODE.
 *
 * Note this is NOT the same question as `known`. An app with no entities still
 * has workspaces to report and members that would block a purge, which is why
 * `known` is computed from memberships above and not from this array.
 */
async function countIn(workspaceIds: number[]): Promise<Array<{ label: string; count: number }>> {
  // Every element came from `billing.workspaces.id` — a serial — and the array
  // is non-empty at the one call site (the caller checks `will_delete.length`
  // first). Interpolated through `inArray` rather than `sql.raw` regardless,
  // because the next person to add a table here will copy this shape.
  const [companies, invoices, history, series] = await Promise.all([
    getDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(billingCompany)
      .where(inArray(billingCompany.workspace_id, workspaceIds)),
    getDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(billingInvoice)
      .where(inArray(billingInvoice.workspace_id, workspaceIds)),
    getDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(billingHistory)
      .where(inArray(billingHistory.workspace_id, workspaceIds)),
    getDb()
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(billingRecurrence)
      .where(inArray(billingRecurrence.workspace_id, workspaceIds)),
  ])

  const out: Array<{ label: string; count: number }> = []
  // Plurals a person would recognise LOSING, which is the confirmation screen's
  // job. "4 companies" and "182 invoices", not "2 workspaces".
  const company = Number(companies[0]?.n ?? 0)
  const invoice = Number(invoices[0]?.n ?? 0)
  if (company > 0) out.push({ label: company === 1 ? 'company' : 'companies', count: company })
  if (invoice > 0) out.push({ label: invoice === 1 ? 'invoice' : 'invoices', count: invoice })
  // Its own line, not added to the invoices: an imported bill is a record of
  // another system's document, and "182 invoices" should mean the ones issued here.
  const imported = Number(history[0]?.n ?? 0)
  if (imported > 0) out.push({ label: imported === 1 ? 'imported bill' : 'imported bills', count: imported })
  // A series is an agreement ("bill Junod quarterly, eight times"), and losing
  // one is losing the record of what was agreed, not only its invoices.
  const recurring = Number(series[0]?.n ?? 0)
  if (recurring > 0) out.push({ label: 'recurring series', count: recurring })
  return out
}
