// WHAT THIS APP HOLDS FOR A PERSON — `apps/issues`' answer.
//
// The interface, and why the account close cannot ask the database this
// question centrally, is `packages/platform-api/src/account-footprint.ts`. Read
// that first.
//
// ---------------------------------------------------------------------------
// THIS APP'S TENANCY IS `platform.workspaces`, AND THAT IS NOT A SHORTCUT
// ---------------------------------------------------------------------------
// Renaming those tables to `issues.*` would mean moving production data for a
// cosmetic gain, and PLAN.md §2 says not to. So this source reads the platform
// tables — as `apps/issues`' OWN tables, which is what they have been since
// Phase 2 — while `apps/sales` reads `sales.*`. Both are answering the same
// question about themselves.
//
// ---------------------------------------------------------------------------
// `purge` DELETES WORKSPACES AND NOTHING ELSE, DELIBERATELY
// ---------------------------------------------------------------------------
// The twelve `ON DELETE CASCADE` foreign keys on `platform.workspaces` sweep the
// content, and the `platform.blob_references` triggers on the content tables
// maintain the blob index as they go. That machinery is what stands between a
// code change and unrecoverable data loss (CLAUDE.md), and reproducing any part
// of it here — a second delete order, a hand-written reference cleanup — would
// be a second implementation of the thing nobody may get wrong. One DELETE, and
// let the catalog do what it was built to do.
//
// It does NOT touch `platform.users`, `platform.api_tokens` or
// `platform.inbox_messages`. Those are the ACCOUNT, not this app's data, and
// they belong to `softDeleteUser` — which runs last, from `DELETE /api/me`,
// after every app has been emptied.

import { sql } from 'drizzle-orm'
import { deleteAccountReport } from '@blackcode/platform-db'
import type { AppFootprint, FootprintSource } from '@blackcode/platform-api'
import { db } from '../client'
import { APP_SLUG } from '@/lib/app'

export const issuesFootprintSource: FootprintSource = {
  read: (userId) => readFootprint(userId),

  async purge(userId) {
    const before = await readFootprint(userId)
    if (before.blocked_by.length > 0) {
      // The route refuses before reaching here; this is the second line of the
      // same rule, because `purge` is also called directly by the account close.
      // A workspace with other people in it is not one app's to destroy.
      throw new Error(
        `refusing to purge ${APP_SLUG}: ${before.blocked_by.length} workspace(s) still have other members`
      )
    }
    const ids = before.will_delete.map((w) => w.workspace_id)
    if (ids.length > 0) {
      await db.execute(sql`DELETE FROM platform.workspaces WHERE id IN ${sql.raw(`(${ids.join(',')})`)}`)
    }
    // A FRESH read, not `{ ...before, will_delete: [] }`. The caller asserts on
    // this to decide whether it is safe to close the account, and an optimistic
    // construction would assert on our own intention rather than on the
    // database. That is the difference between a check and a comment.
    return readFootprint(userId)
  },
}

async function readFootprint(userId: number): Promise<AppFootprint> {
  const report = await deleteAccountReport(db, userId, APP_SLUG)
  const memberOf = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM platform.workspace_members WHERE user_id = ${userId}`
  )
  const ids = report.will_hard_delete.map((w) => w.workspace_id)

  return {
    // Known here if they are in ANY workspace, not only ones they own. Somebody
    // who was invited into a colleague's workspace holds nothing of their own
    // and is still a person this app knows — and the screen says the two
    // differently.
    known: (memberOf.rows[0]?.n ?? 0) > 0 || report.blocked_by.length > 0,
    blocked_by: report.blocked_by,
    will_delete: report.will_hard_delete,
    holds: ids.length === 0 ? [] : await countIn(ids),
  }
}

/**
 * What is inside the workspaces that would be destroyed.
 *
 * Scoped to `will_delete` rather than to everything the person authored: this
 * number is answering "what am I about to lose", and a comment they left in a
 * colleague's workspace is not lost — it stays, marked as from a deleted user.
 * Counting it here would overstate the damage, which on a confirmation screen is
 * its own kind of dishonesty.
 */
async function countIn(workspaceIds: number[]): Promise<Array<{ label: string; count: number }>> {
  const ids = sql.raw(`(${workspaceIds.join(',')})`)
  const res = await db.execute<{ issues: number; tasks: number; projects: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM issues.issues   WHERE workspace_id IN ${ids}) AS issues,
      (SELECT COUNT(*)::int FROM issues.tasks    WHERE workspace_id IN ${ids}) AS tasks,
      (SELECT COUNT(*)::int FROM issues.projects WHERE workspace_id IN ${ids}) AS projects
  `)
  const row = res.rows[0]
  if (!row) return []
  return [
    { label: 'issues', count: Number(row.issues) },
    { label: 'tasks', count: Number(row.tasks) },
    { label: 'projects', count: Number(row.projects) },
  ].filter((h) => h.count > 0)
}
