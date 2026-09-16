// THE TWO ALLOCATORS. Read this whole file before changing anything in it.
//
// ===========================================================================
// TWO NUMBERS PER INVOICE, AND THEY ARE NOT INTERCHANGEABLE
// ===========================================================================
// | | What it is | From | Printed where |
// |---|---|---|---|
// | `id` | the row | `serial` | nowhere. No surface prints it. |
// | `seq` | the workspace #number, the ADDRESS | `billing.counters` | `bk billing invoice show 7`, the URN `bc:billing:acme/invoice/7`, the route path |
// | `seq_no` → `number` | the per-company STATUTORY sequence | `company.next_seq` | the document itself, and inside the payment reference |
//
// Conflating them would be the worst bug this app could ship: the address on the
// document, or the document's number in a URL somebody bookmarked.
//
// ===========================================================================
// WHY `seq_no` IS GAPLESS AND A POSTGRES `SEQUENCE` IS NOT
// ===========================================================================
// Swiss bookkeeping requires the invoice sequence to be contiguous: no holes, no
// reuse. A hole is not an inconvenience, it is a finding in an audit, because a
// missing number is indistinguishable from a bill that was issued and then
// hidden.
//
// `nextval()` is explicitly NON-TRANSACTIONAL. A rollback consumes the value and
// leaves a hole, by design — that is what makes sequences fast and concurrent,
// and it is exactly the property that disqualifies them here.
//
// The `UPDATE … RETURNING` below takes a ROW LOCK on the company for the rest of
// the transaction. A second create waits on it. If the first transaction rolls
// back, its increment reverts BEFORE the waiter is released, so the waiter
// receives the same number and no gap appears.
//
// ── THREE CONSEQUENCES TO ACCEPT RATHER THAN OPTIMISE AWAY ─────────────────
// 1. **Invoice creation for ONE company is serialised.** That is the price of
//    gaplessness and it is the right trade at this volume. Different companies
//    do not contend: the lock is per row. Do not "improve" this into an advisory
//    lock, a sequence with gap-filling, or a batch allocator.
// 2. `UNIQUE(company_id, seq_no)` is the BACKSTOP, not the mechanism. If it ever
//    fires, somebody has changed the allocator to read-then-write and the
//    guarantee is already gone.
// 3. **A void does not free its number.** There is no code path that decrements
//    `next_seq`, and adding one would be the bug: the voided document exists,
//    carries that number, and has to keep it.

import { sql } from 'drizzle-orm'
import { getDb } from '../client'
import { billingCompany, billingCounters } from '../schema'

/**
 * A transaction handle, which is what both functions here demand.
 *
 * Neither takes a plain `db`, and that is deliberate rather than awkward: an
 * allocation that is not in the same transaction as the row it numbers is an
 * allocation that can be handed out and then lost, which is precisely the hole
 * the whole file exists to prevent. Requiring the handle makes that a type
 * error rather than a code review.
 */
// ── DERIVED FROM `getDb()`, NEVER HAND-WRITTEN ─────────────────────────────
// The first draft of this spelled the type out:
// `PgTransaction<NodePgQueryResultHKT, Record<string, never>, …>`. It compiled
// in isolation and every call site then needed an `as Tx` cast, because the real
// handle is parameterised on the driver AND on this app's schema — and the cast
// would have silently accepted a handle from a different database.
//
// So it is inferred from the function that produces it. A driver change (`pg` to
// Neon's serverless, which has already happened once on this platform) moves
// this type with it rather than leaving a lie that needs casting around.
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/**
 * The workspace `#number` for an entity type — the ADDRESS, not the statutory
 * number.
 *
 * ONE STATEMENT, so the read and the increment cannot interleave. An upsert
 * rather than a SELECT then an UPDATE: two concurrent creates would otherwise
 * both read the same `last_value` and collide on `uq_*_ws_seq`.
 *
 * Copied in shape from `apps/books/lib/db/queries/statutory.ts`, which is where
 * this pattern was first got right on this platform.
 *
 * ── AND IT IS WHAT MAKES THE AUDIT FEED ORDERED ────────────────────────────
 * The `DO UPDATE` takes a row lock on `(workspace_id, entity_type)`, so a second
 * writer blocks until the first commits or rolls back. **Sequence order is
 * therefore commit order**, which is the property `GET …/audit?since=<seq>`
 * rests on: no row can appear behind a cursor a poller has already passed.
 * `docs/billing-app-plan/integration-surface.md` §4.
 */
export async function allocateSeq(
  tx: Tx,
  workspaceId: number,
  entityType: 'company' | 'invoice' | 'audit' | 'recurrence' | 'history'
): Promise<number> {
  const rows = await tx.execute<{ last_value: number }>(sql`
    INSERT INTO ${billingCounters} (workspace_id, entity_type, last_value)
    VALUES (${workspaceId}, ${entityType}, 1)
    ON CONFLICT (workspace_id, entity_type)
      DO UPDATE SET last_value = ${billingCounters}.last_value + 1
    RETURNING last_value
  `)
  const v = rows.rows[0]?.last_value
  if (v === undefined) {
    // Unreachable through the upsert, and asserted anyway: a silent `undefined`
    // here would become an invoice with `seq: NaN`, which inserts, renders as
    // "#NaN" and cannot be addressed by any surface.
    throw new Error(`allocateSeq returned no row for workspace ${workspaceId}/${entityType}`)
  }
  return Number(v)
}

/**
 * The gapless STATUTORY number for one company.
 *
 * `next_seq` holds the value the NEXT invoice will take, so this returns
 * `next_seq - 1` after incrementing — i.e. the value that was there before.
 * Written that way rather than as "read, use, then bump" because the whole point
 * is that the read and the bump are one statement under one lock.
 *
 * Must be called inside the same transaction as the invoice insert. See the
 * file header for why that is a requirement rather than a preference.
 */
export async function allocateCompanySeqNo(tx: Tx, companyId: number): Promise<number> {
  const rows = await tx.execute<{ seq_no: number }>(sql`
    UPDATE ${billingCompany}
       SET next_seq = next_seq + 1
     WHERE id = ${companyId}
    RETURNING next_seq - 1 AS seq_no
  `)
  const v = rows.rows[0]?.seq_no
  if (v === undefined) {
    // The company was deleted between the caller's read and this statement —
    // which 0006's `REVOKE DELETE` makes impossible for the app role, so this
    // means somebody ran a DELETE as the owner. Failing loudly is the only
    // correct answer: the alternative is an invoice with no issuer.
    throw new Error(
      `company ${companyId} vanished mid-transaction, so no invoice number could be allocated`
    )
  }
  return Number(v)
}
