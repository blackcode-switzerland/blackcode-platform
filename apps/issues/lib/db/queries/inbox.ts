// Inbox queries — user-scoped projection of events.
//
// createInboxMessage MUST be called inside the same transaction as the source
// event. This keeps the inbox consistent with activity.

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../client'
import { inboxMessages, issues, tasks, type InboxMessage } from '../schema'
import {
  createInboxMessage as platformCreateInboxMessage,
  type CreateInboxInput,
} from '@blackcode/platform-db'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

type Tx = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete' | 'execute'>

// The WRITE moved to @blackcode/platform-db on 2026-08-06 with the platform half
// of the event fan-out (docs/sales-app-plan.md D-23). `platform.inbox_messages`
// is a platform table and always was: being added to a workspace is not an
// issues fact, and a person invited from the sales deployment must see it in the
// same inbox. Re-exported here rather than re-pointed at the call sites, so the
// next person adding an inbox write still finds it in the file called `inbox`.
//
// Reading the inbox — everything below — did NOT move. It is Tier 2 and goes
// when `/api/me/inbox/*` becomes a shared route.
export type { CreateInboxInput }

export function createInboxMessage(tx: Tx, input: CreateInboxInput): Promise<InboxMessage> {
  return platformCreateInboxMessage(tx, input)
}

// ---------- listing / read state ----------

// ---------------------------------------------------------------------------
// WHAT AN INBOX ROW ACTUALLY CARRIES, AND THEREFORE WHAT CAN BE FILTERED
// ---------------------------------------------------------------------------
// `platform.inbox_messages` holds: user_id, workspace_id, type, entity_type,
// entity_id, actor_user_id, payload, read_at, archived_at, created_at.
//
// So workspace, type, actor and time are filterable DIRECTLY — they are columns.
//
// PROJECT AND TASK ARE NOT ON THE ROW. `entity_id` is the referenced record's
// INTERNAL id (verified against the local database 2026-08-12: an `assigned`
// row carries `entity_type='issue'`, `entity_id=15`, and `payload.issue_seq` is
// null), so a project filter has to reach through to `issues.*`. It is done as a
// UNION of the three ways a row can be about a project — the project itself, a
// task in it, an issue in it — because the tempting one-line version
// (`entity_type='issue' AND entity_id IN (issues of P)`) silently drops every
// notification about the project record and about its tasks, and a filter that
// returns too little is indistinguishable from an empty inbox.
//
// Rows that are about NEITHER (a workspace invitation, a member being added) are
// correctly absent from a project-filtered feed: they are not about a project.
//
// The reach into `issues.*` is legitimate here and only here: `/api/me/inbox` is
// served by this app alone (`apps/sales` mounts no inbox — see
// cli/internal/commands/sales/appverbs.go), and this file is already the
// app-local read half of the inbox, with only the WRITE living in platform-db.
export interface ListInboxFilter {
  userId: number
  workspaceId?: number | null
  type?: string | null
  unreadOnly?: boolean
  includeArchived?: boolean
  archivedOnly?: boolean
  /** Only messages caused by this user (`actor_user_id`). */
  actorUserId?: number
  /** Only messages created at or after this instant. */
  since?: Date
  /**
   * Internal project id. Selects rows about the project, about a task in it, or
   * about an issue in it — see the header for why all three.
   */
  projectId?: number
  /** Internal task id. Selects rows about the task or about an issue in it. */
  taskId?: number
  cursor?: number | null
  limit?: number
}

export interface InboxPage {
  data: InboxMessage[]
  next_cursor: number | null
  unread_count: number
}

const DEFAULT_LIMIT = PAGE_SIZE_DEFAULT
const MAX_LIMIT = PAGE_SIZE_MAX

/**
 * The narrowing clauses — everything except read/archived state, the cursor and
 * the limit. ONE definition, used by the listing and by the unread count beside
 * it: a filtered list carrying an unfiltered "Unread: 47" is a number that
 * answers a question nobody asked, sitting where the answer should be.
 */
function scopeClauses(filter: ListInboxFilter) {
  const wheres = [eq(inboxMessages.user_id, filter.userId)]
  if (filter.workspaceId != null) wheres.push(eq(inboxMessages.workspace_id, filter.workspaceId))
  if (filter.type) wheres.push(eq(inboxMessages.type, filter.type))
  if (filter.actorUserId != null) wheres.push(eq(inboxMessages.actor_user_id, filter.actorUserId))
  if (filter.since) wheres.push(gte(inboxMessages.created_at, filter.since))

  // The three ways a row can be about a project, and the two for a task. See the
  // header on ListInboxFilter for why this is a union and not the one-liner.
  if (filter.projectId != null) {
    const p = filter.projectId
    wheres.push(sql`(
      (${inboxMessages.entity_type} = 'project' AND ${inboxMessages.entity_id} = ${p})
      OR (${inboxMessages.entity_type} = 'task' AND ${inboxMessages.entity_id} IN (
            SELECT t.id FROM ${tasks} t WHERE t.project_id = ${p}))
      OR (${inboxMessages.entity_type} = 'issue' AND ${inboxMessages.entity_id} IN (
            SELECT i.id FROM ${issues} i WHERE i.project_id = ${p}))
    )`)
  }
  if (filter.taskId != null) {
    const t = filter.taskId
    wheres.push(sql`(
      (${inboxMessages.entity_type} = 'task' AND ${inboxMessages.entity_id} = ${t})
      OR (${inboxMessages.entity_type} = 'issue' AND ${inboxMessages.entity_id} IN (
            SELECT i.id FROM ${issues} i WHERE i.task_id = ${t}))
    )`)
  }
  return wheres
}

export async function listInbox(filter: ListInboxFilter): Promise<InboxPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const wheres = scopeClauses(filter)
  if (filter.archivedOnly) {
    wheres.push(isNotNull(inboxMessages.archived_at))
  } else if (!filter.includeArchived) {
    wheres.push(isNull(inboxMessages.archived_at))
  }
  if (filter.unreadOnly) wheres.push(isNull(inboxMessages.read_at))
  if (filter.cursor) wheres.push(lt(inboxMessages.id, filter.cursor))

  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(...wheres))
    .orderBy(desc(inboxMessages.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = rows.slice(0, limit)
  const next_cursor = hasMore ? data[data.length - 1].id : null

  const unread = await countUnread(filter)

  return { data, next_cursor, unread_count: unread }
}

/**
 * Unread, unarchived messages within the SAME scope the listing used.
 *
 * It takes the filter object rather than a workspace id because the two must not
 * be able to drift: the count sits directly under the list it describes.
 */
export async function countUnread(filter: ListInboxFilter): Promise<number> {
  const wheres = scopeClauses(filter)
  wheres.push(isNull(inboxMessages.read_at), isNull(inboxMessages.archived_at))
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inboxMessages)
    .where(and(...wheres))
  return rows[0]?.count ?? 0
}

export async function markRead(
  userId: number,
  options: { ids?: number[]; all?: boolean; workspaceId?: number }
): Promise<number> {
  const wheres = [eq(inboxMessages.user_id, userId), isNull(inboxMessages.read_at)]
  if (options.ids && options.ids.length > 0) wheres.push(inArray(inboxMessages.id, options.ids))
  else if (!options.all) return 0
  if (options.workspaceId !== undefined) wheres.push(eq(inboxMessages.workspace_id, options.workspaceId))
  const result = await db
    .update(inboxMessages)
    .set({ read_at: new Date() })
    .where(and(...wheres))
  return result.rowCount ?? 0
}

export async function archiveMessages(
  userId: number,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db
    .update(inboxMessages)
    .set({ archived_at: new Date() })
    .where(
      and(
        eq(inboxMessages.user_id, userId),
        inArray(inboxMessages.id, ids),
        isNull(inboxMessages.archived_at)
      )
    )
  return result.rowCount ?? 0
}

export async function unarchiveMessages(
  userId: number,
  ids: number[]
): Promise<number> {
  if (ids.length === 0) return 0
  const result = await db
    .update(inboxMessages)
    .set({ archived_at: null })
    .where(
      and(
        eq(inboxMessages.user_id, userId),
        inArray(inboxMessages.id, ids),
        isNotNull(inboxMessages.archived_at)
      )
    )
  return result.rowCount ?? 0
}
