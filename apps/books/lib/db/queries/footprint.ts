// WHAT THIS APP HOLDS FOR A PERSON — and why most of it CANNOT BE REMOVED.
//
// The interface is `packages/platform-api/src/account-footprint.ts`. Read it
// before changing anything here; the two rules it states are load-bearing.
//
// ---------------------------------------------------------------------------
// B/BOOKS IS THE APP THE CLOSE FLOW HAS NEVER MET: ONE THAT REFUSES
// ---------------------------------------------------------------------------
// Art. 958f CO: books, vouchers and business records are retained TEN YEARS.
// A workspace whose books hold statutory records — écritures, RI entries,
// pièces, pull records, filed analyses — is not this person's to destroy, and
// not this app's either. So:
//
//   - `read` reports such workspaces under `blocked_by`, EXTENDING that
//     field's meaning: the platform's own case is "other people are in it",
//     and books adds "the law is in it". Both mean the same operational
//     thing — the whole-account close must not proceed by deleting this.
//   - `purge` REFUSES (throws, naming art. 958f) while any such workspace
//     exists. No force flag. The account close reads the refusal and keeps
//     `platform.users` untouched — a person can leave, and their books stay
//     until the law is done with them.
//
// The line is RECORDS, not structures: a workspace whose books hold no
// écriture, no RI entry, no pièce, no pull and no analysis has recorded
// nothing the law retains, and purging it is legal and honest. That is also
// the only thing `will_delete` can ever contain here.
//
// The scaffold's version of this file deleted whole workspaces whenever the
// caller was their only member, and counted `books.notes` — a table 0007
// dropped. Phase 5 replaced it; the census had never actually met this app.

import { inArray, eq, sql } from 'drizzle-orm'
import type { AppFootprint, FootprintSource } from '@blackcode/platform-api'
import { getDb } from '../client'
import { booksWorkspaceMembers, booksWorkspaces } from '../schema'
import { APP_SLUG } from '@/lib/app'

export const booksFootprintSource: FootprintSource = {
  read: (userId) => readFootprint(userId),

  async purge(userId) {
    const before = await readFootprint(userId)
    if (before.blocked_by.length > 0) {
      // Refused here as well as at the route, because `purge` is also reached
      // from ANOTHER app's account close over HTTP. Statutory records are
      // retained ten years (art. 958f CO); a workspace with other members is
      // not one app's to destroy either.
      throw new Error(
        `refusing to purge ${APP_SLUG}: ${before.blocked_by.length} workspace(s) hold statutory records retained under art. 958f CO or still have other members. ` +
          `b/books keeps books ten years; the account may close, the books stay.`
      )
    }
    const ids = before.will_delete.map((w) => w.workspace_id)
    if (ids.length > 0) {
      // Only workspaces the read PROVED record-free reach this line. One
      // DELETE: every table cascades from the workspace, and the
      // `platform.blob_references` triggers maintain the blob index as the
      // cascade runs.
      await getDb().delete(booksWorkspaces).where(inArray(booksWorkspaces.id, ids))
    }
    return readFootprint(userId)
  },
}

async function readFootprint(userId: number): Promise<AppFootprint> {
  const owned = await getDb().execute<{
    workspace_id: number
    name: string
    member_count: number
    records: number
  }>(sql`
    SELECT w.id AS workspace_id, w.name,
           (SELECT COUNT(*)::int FROM ${booksWorkspaceMembers} m WHERE m.workspace_id = w.id) AS member_count,
           (
             (SELECT COUNT(*)::int FROM books.entry       e WHERE e.workspace_id = w.id)
           + (SELECT COUNT(*)::int FROM books.ri_entry    r WHERE r.workspace_id = w.id)
           + (SELECT COUNT(*)::int FROM books.piece_inbox p WHERE p.workspace_id = w.id)
           + (SELECT COUNT(*)::int FROM books.source_pull s WHERE s.workspace_id = w.id)
           + (SELECT COUNT(*)::int FROM books.analysis    a WHERE a.workspace_id = w.id)
           ) AS records
    FROM ${booksWorkspaces} w
    WHERE w.owner_id = ${userId}
  `)

  const blocked: AppFootprint['blocked_by'] = []
  const willDelete: AppFootprint['will_delete'] = []
  for (const r of owned.rows) {
    if (Number(r.member_count) > 1 || Number(r.records) > 0) {
      // Other people, or the law. Either way: not deletable from here.
      blocked.push({
        workspace_id: r.workspace_id,
        name: r.name,
        member_count: Number(r.member_count),
      })
    } else {
      willDelete.push({ workspace_id: r.workspace_id, name: r.name })
    }
  }

  const memberships = await getDb()
    .select({ id: booksWorkspaceMembers.id })
    .from(booksWorkspaceMembers)
    .where(eq(booksWorkspaceMembers.user_id, userId))
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
 * What is inside the workspaces that WOULD be destroyed, in this app's nouns.
 *
 * By construction these workspaces hold no statutory records — a workspace
 * with any lands in `blocked_by` instead — so the honest report here is what
 * remains: the books themselves (structure, not records) and their register.
 * Usually empty, and empty is the point: nothing a person would recognise
 * losing survives to this list.
 */
async function countIn(workspaceIds: number[]): Promise<Array<{ label: string; count: number }>> {
  const ids = sql.raw(`(${workspaceIds.join(',')})`)
  const res = await getDb().execute<{ books: number; sources: number }>(sql`
    SELECT (SELECT COUNT(*)::int FROM books.entity WHERE workspace_id IN ${ids}) AS books,
           (SELECT COUNT(*)::int FROM books.source WHERE workspace_id IN ${ids}) AS sources
  `)
  const out: Array<{ label: string; count: number }> = []
  const books = Number(res.rows[0]?.books ?? 0)
  const sources = Number(res.rows[0]?.sources ?? 0)
  if (books > 0) out.push({ label: 'empty books (no écritures)', count: books })
  if (sources > 0) out.push({ label: 'register sources (no pulls)', count: sources })
  return out
}
