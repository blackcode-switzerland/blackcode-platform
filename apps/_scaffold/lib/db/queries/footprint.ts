// WHAT THIS APP HOLDS FOR A PERSON — the scaffold's answer, and the shape to
// copy.
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
import { scaffoldWorkspaceMembers, scaffoldWorkspaces } from '../schema'
import { APP_SLUG } from '@/lib/app'

export const scaffoldFootprintSource: FootprintSource = {
  read: (userId) => readFootprint(userId),

  async purge(userId) {
    const before = await readFootprint(userId)
    if (before.blocked_by.length > 0) {
      // Refused here as well as at the route, because `purge` is also reached
      // from ANOTHER app's account close over HTTP. A workspace with other
      // people in it is not one app's to destroy.
      throw new Error(
        `refusing to purge ${APP_SLUG}: ${before.blocked_by.length} workspace(s) still have other members`
      )
    }
    const ids = before.will_delete.map((w) => w.workspace_id)
    if (ids.length > 0) {
      // One DELETE. Every table cascades from the workspace, and the
      // `platform.blob_references` triggers on the content tables maintain the
      // blob index as the cascade runs — reproducing any of that by hand would
      // be a second implementation of the thing nobody may get wrong.
      await getDb().delete(scaffoldWorkspaces).where(inArray(scaffoldWorkspaces.id, ids))
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
    FROM ${scaffoldWorkspaces} w
    LEFT JOIN ${scaffoldWorkspaceMembers} m ON m.workspace_id = w.id
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
      })
    } else {
      willDelete.push({ workspace_id: r.workspace_id, name: r.name })
    }
  }

  const memberships = await getDb()
    .select({ id: scaffoldWorkspaceMembers.id })
    .from(scaffoldWorkspaceMembers)
    .where(eq(scaffoldWorkspaceMembers.user_id, userId))
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
 * One entry per thing a person would recognise losing. The scaffold has one
 * entity, so it has one line; your copy will have several. Counts, not
 * workspaces — "3 workspaces" tells somebody nothing about what is in them.
 *
 * Scoped to `will_delete`, not to everything the person authored: a note they
 * wrote in a colleague's workspace is not lost, and overstating the damage on a
 * confirmation screen is its own kind of dishonesty.
 */
async function countIn(workspaceIds: number[]): Promise<Array<{ label: string; count: number }>> {
  const ids = sql.raw(`(${workspaceIds.join(',')})`)
  const res = await getDb().execute<{ notes: number }>(
    sql`SELECT (SELECT COUNT(*)::int FROM scaffold.notes WHERE workspace_id IN ${ids}) AS notes`
  )
  const notes = Number(res.rows[0]?.notes ?? 0)
  return notes > 0 ? [{ label: 'notes', count: notes }] : []
}
