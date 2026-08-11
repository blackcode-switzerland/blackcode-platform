// WHAT THIS APP HOLDS FOR A PERSON — b/sales' answer.
//
// The interface, and why the account close cannot ask the database this question
// centrally, is `packages/platform-api/src/account-footprint.ts`. Read that
// first.
//
// ---------------------------------------------------------------------------
// THIS FILE IS THE HALF OF THE STRANDING BUG THAT LIVED HERE
// ---------------------------------------------------------------------------
// Until 2026-08-11, closing a blackcode account from `apps/issues` soft-deleted
// `platform.users` and deleted the person's `platform.workspaces` rows. Their
// `sales.workspaces` row — and every prospect, meeting, communication and
// document in it — survived, owned by an account that could no longer
// authenticate by password or by Google and whose tokens had been revoked.
//
// `sales.workspaces.owner_id` carries `ON DELETE RESTRICT`, which reads like
// protection and is not: the account close is an UPDATE setting `deleted_at`,
// and **an UPDATE does not fire a delete rule**. Nothing refused, nothing
// cascaded, nothing was reported. The FK is still there and still cannot fire;
// what actually protects this data now is that `DELETE /api/me` calls THIS
// function first and refuses to touch the account if it does not come back
// empty. See the note on the FK in `lib/db/schema.ts`.
//
// ---------------------------------------------------------------------------
// `purge` DELETES WORKSPACE ROWS AND NOTHING ELSE
// ---------------------------------------------------------------------------
// Every sales table cascades from `sales.workspaces`, and the
// `platform.blob_references` triggers on the content tables maintain the blob
// index as the cascade runs. That machinery is what stands between a code change
// and unrecoverable data loss (CLAUDE.md); a hand-written delete order here
// would be a second implementation of it. One DELETE, and let the catalog do
// what it was built to do.
//
// It does NOT touch `platform.users` or `platform.api_tokens`. Those are the
// ACCOUNT, which is shared, and no app closes it from a button that says
// "delete my b/sales data".

import { eq, inArray, sql } from 'drizzle-orm'
import type { AppFootprint, FootprintSource } from '@blackcode/platform-api'
import { getDb } from '../client'
import { salesWorkspaceMembers, salesWorkspaces } from '../schema'
import { APP_SLUG } from '@/lib/app'

export const salesFootprintSource: FootprintSource = {
  read: (userId) => readFootprint(userId),

  async purge(userId) {
    const before = await readFootprint(userId)
    if (before.blocked_by.length > 0) {
      // The route refuses before reaching here; this is the second line of the
      // same rule, because `purge` is also reached from another app's account
      // close over HTTP. A workspace with other people in it is not one app's
      // to destroy, and this app must say so whoever is asking.
      throw new Error(
        `refusing to purge ${APP_SLUG}: ${before.blocked_by.length} workspace(s) still have other members`
      )
    }
    const ids = before.will_delete.map((w) => w.workspace_id)
    if (ids.length > 0) {
      await getDb().delete(salesWorkspaces).where(inArray(salesWorkspaces.id, ids))
    }
    // A FRESH read, not `{ ...before, will_delete: [] }`. The caller asserts on
    // this to decide whether it is safe to close the account, and an optimistic
    // construction would assert on our own intention rather than on the
    // database.
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
    FROM ${salesWorkspaces} w
    LEFT JOIN ${salesWorkspaceMembers} m ON m.workspace_id = w.id
    WHERE w.owner_id = ${userId}
    GROUP BY w.id, w.name
  `)

  const blocked: AppFootprint['blocked_by'] = []
  const willDelete: AppFootprint['will_delete'] = []
  for (const r of owned.rows) {
    // The same rule `deleteAccountReport` has always applied to issues: a
    // workspace they own alone is theirs to destroy; one with other people in
    // it blocks until ownership moves.
    if (Number(r.member_count) > 1) {
      blocked.push({ workspace_id: r.workspace_id, name: r.name, member_count: Number(r.member_count) })
    } else {
      willDelete.push({ workspace_id: r.workspace_id, name: r.name })
    }
  }

  const memberships = await getDb()
    .select({ id: salesWorkspaceMembers.id })
    .from(salesWorkspaceMembers)
    .where(eq(salesWorkspaceMembers.user_id, userId))
    .limit(1)

  return {
    // "You have nothing here" and "you have never been here" are different
    // answers, and the deletion screen says them differently.
    known: memberships.length > 0 || blocked.length > 0,
    blocked_by: blocked,
    will_delete: willDelete,
    holds: willDelete.length === 0 ? [] : await countIn(willDelete.map((w) => w.workspace_id)),
  }
}

/**
 * What is inside the workspaces that would be destroyed, in this app's nouns.
 *
 * Scoped to `will_delete` rather than to everything the person touched: this
 * answers "what am I about to lose", and a meeting they logged in somebody
 * else's workspace is not lost. Overstating the damage on a confirmation screen
 * is its own kind of dishonesty.
 */
async function countIn(workspaceIds: number[]): Promise<Array<{ label: string; count: number }>> {
  const ids = sql.raw(`(${workspaceIds.join(',')})`)
  const res = await getDb().execute<{
    prospects: number
    meetings: number
    communications: number
    documents: number
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM sales.prospects      WHERE workspace_id IN ${ids}) AS prospects,
      (SELECT COUNT(*)::int FROM sales.meetings       WHERE workspace_id IN ${ids}) AS meetings,
      (SELECT COUNT(*)::int FROM sales.communications WHERE workspace_id IN ${ids}) AS communications,
      (SELECT COUNT(*)::int FROM sales.documents      WHERE workspace_id IN ${ids}) AS documents
  `)
  const row = res.rows[0]
  if (!row) return []
  return [
    { label: 'prospects', count: Number(row.prospects) },
    { label: 'meetings', count: Number(row.meetings) },
    { label: 'communications', count: Number(row.communications) },
    { label: 'documents', count: Number(row.documents) },
  ].filter((h) => h.count > 0)
}
