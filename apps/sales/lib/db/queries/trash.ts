// This app's recycle bin — `bk sales trash list | restore | purge | empty`.
//
// ---------------------------------------------------------------------------
// WHY SALES SERVES ITS OWN TRASH ROUTES INSTEAD OF MOUNTING A SHARED FACTORY
// ---------------------------------------------------------------------------
// There is no `trashRoute` in `@blackcode/platform-api/routes`, and there should
// not be. A recycle bin lists ONE APP'S entities: the query is over `sales.*`,
// the types are this app's vocabulary, and a restore has to invert this app's
// cascade. Nothing about it generalises except the URL, and two deployments
// serving the same path over their own tables is exactly what the per-app model
// means (D-11: `bk sales trash` and `bk issues trash` are different answers to
// the same question, which is why the app name is in the command).
//
// ---------------------------------------------------------------------------
// D-19 ITEM 1 — 90-DAY RETENTION, AND WHAT THE PURGE OWES
// ---------------------------------------------------------------------------
// A binned record sits here for 90 days and is then destroyed. The horizon is
// this app's honest control on the data it holds (`docs/backend.md` §2), and it
// covers the free-text notes about people at other companies that no redaction
// rule can reach.
//
// **A purge reports WHAT it destroyed** — type, #number and name, captured
// BEFORE the delete — to the caller and to `platform.events`. A count alone is
// the difference between a wrong purge somebody catches in a minute and one
// nobody notices for a month. That is why `purgeItems` returns rows rather than
// a number, and why it reads them first.
//
// ---------------------------------------------------------------------------
// RESTORE INVERTS THE CASCADE, AND THE LIST IS THE SAME ONE
// ---------------------------------------------------------------------------
// Binning a prospect bins its contacts, meetings and communications by predicate
// (`softDeleteProspect`). Restoring it must bring back exactly those, and only
// the ones that went down WITH it — a meeting binned last week on its own must
// stay binned. That is what `deleted_at = <the prospect's own timestamp>` is
// for: the cascade stamps one instant, so the inverse is exact rather than
// approximate.

import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  communications,
  contacts,
  documents,
  meetings,
  products,
  prospects,
  strategies,
  templates,
} from '../schema'
import { recordEvent } from './events'
import type { SalesEntityType } from '@/lib/entity-address'
import type { Actor } from '@/lib/actor'

/**
 * The binnable types, and their tables.
 *
 * `contact` is absent and that is the whole of the reason it is worth a comment:
 * a contact has no #number, so `contact:12` is not an address a caller could
 * type. Contacts are binned and restored WITH their prospect and are never
 * addressed on their own. The Go side declares the same list in
 * `appverbs.Config.TrashTypes`; `trash-types.test.ts` holds the two together.
 *
 * `prospect_note` is absent for `contact`'s reason and for one more besides: a
 * note has no #number, and its delete is HARD by design (migration 0009) —
 * there is no `deleted_at` for a bin to find. `strategy` IS here, because it
 * has a #number and retiring a segment is exactly the reversible act a bin is
 * for.
 */
const BINNABLE = {
  prospect: prospects,
  meeting: meetings,
  communication: communications,
  product: products,
  template: templates,
  document: documents,
  strategy: strategies,
} as const

export type TrashType = keyof typeof BINNABLE
export const TRASH_TYPES = Object.keys(BINNABLE) as TrashType[]
export const isTrashType = (t: string): t is TrashType => t in BINNABLE

/** How long a binned record survives. D-19 item 1. */
export const RETENTION_DAYS = 90

export interface TrashItem {
  type: TrashType
  number: number
  title: string
  deleted_at: string
  /** Days left before automatic purge. Negative means already past the horizon. */
  expires_in_days: number
}

const titleColumn = (type: TrashType) =>
  type === 'meeting' || type === 'document' ? sql`title` : type === 'communication'
    ? sql`coalesce(subject, concat(channel, ' · ', direction))`
    : sql`name`

/**
 * What a binned row is CALLED, from a row already read into JS.
 *
 * ---------------------------------------------------------------------------
 * THE SAME QUESTION AS `titleColumn`, ASKED WHERE THERE IS NO QUERY TO ADD TO
 * ---------------------------------------------------------------------------
 * `purgeTrash` names each destroyed item from the `.returning()` rows of the
 * DELETE — there is no SELECT to put `titleColumn` in. It used to inline
 * `row.name ?? row.title ?? row.subject ?? ''`, which is `titleColumn` minus the
 * one branch that matters: a communication with no subject fell through to the
 * empty string.
 *
 * So `bk sales trash purge communication:17` printed
 *
 *     destroyed communication:17
 *
 * with nothing after it, while `bk sales comm rm 17` — the SOFT delete, the
 * recoverable one — printed "note · out". **The irreversible command was the
 * one with no record of what it destroyed**, which inverts CLAUDE.md's rule
 * exactly: "Irreversible commands report WHAT they did, not just how many. A
 * count alone is the difference between a wrong purge someone catches
 * immediately and one nobody notices for a month."
 *
 * Two spellings of one question, and the destructive path had the weaker one.
 * Keep them in step: a new binnable type needs a branch in BOTH, and the two
 * sit together here so that is visible.
 */
export function trashTitleOf(type: TrashType, row: Record<string, unknown>): string {
  if (type === 'communication') {
    const subject = row.subject == null ? '' : String(row.subject)
    if (subject) return subject
    return `${String(row.channel ?? '')} · ${String(row.direction ?? '')}`.trim()
  }
  return String(row.name ?? row.title ?? '')
}

export async function listTrash(
  workspaceId: number,
  opts: { types?: TrashType[] } = {}
): Promise<TrashItem[]> {
  const db = getDb()
  const wanted = opts.types?.length ? opts.types : TRASH_TYPES
  const parts = wanted.map(
    (t) => sql`
      SELECT ${t} AS type, seq AS number, ${titleColumn(t)} AS title, deleted_at
      FROM sales.${sql.raw(tableName(t))}
      WHERE workspace_id = ${workspaceId} AND deleted_at IS NOT NULL`
  )
  const res = await db.execute(sql`
    SELECT * FROM (${sql.join(parts, sql` UNION ALL `)}) t ORDER BY deleted_at DESC`)

  const now = Date.now()
  return res.rows.map((r) => {
    const deletedAt = new Date(String(r.deleted_at))
    const age = (now - deletedAt.getTime()) / 86_400_000
    return {
      type: String(r.type) as TrashType,
      number: Number(r.number),
      title: String(r.title ?? ''),
      deleted_at: deletedAt.toISOString(),
      expires_in_days: Math.ceil(RETENTION_DAYS - age),
    }
  })
}

/** `sales.<table>` for a type. One map, so a seventh type is one line above. */
function tableName(t: TrashType): string {
  return t === 'prospect'
    ? 'prospects'
    : t === 'meeting'
      ? 'meetings'
      : t === 'communication'
        ? 'communications'
        : t === 'product'
          ? 'products'
          : t === 'template'
            ? 'templates'
            : 'documents'
}

/**
 * Bring a binned record back, and its children with it.
 *
 * Returns null when there is no binned record at that (type, #number) — which
 * covers both "no such row" and "it was never binned", deliberately: the caller
 * asked for a restore and nothing needed restoring, and distinguishing those two
 * would mean a 404 for a state that is already what was asked for.
 */
export async function restoreItem(
  workspaceId: number,
  type: TrashType,
  number: number,
  actor: Actor
): Promise<{ type: TrashType; number: number; title: string; children: number } | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const table = BINNABLE[type]
    const rows = await tx
      .select()
      .from(table)
      .where(
        and(
          eq(table.workspace_id, workspaceId),
          eq(table.seq, number),
          sql`${table.deleted_at} IS NOT NULL`
        )
      )
      .limit(1)
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return null
    const binnedAt = row.deleted_at as Date

    await tx
      .update(table)
      .set({ deleted_at: null, updated_at: new Date() })
      .where(and(eq(table.workspace_id, workspaceId), eq(table.seq, number)))

    let children = 0
    if (type === 'prospect') {
      // Only the rows binned in the SAME instant as this prospect. A meeting
      // binned on its own last week stays binned — restoring a prospect must not
      // quietly undo a decision somebody made separately.
      for (const child of [contacts, meetings, communications]) {
        const restored = await tx
          .update(child)
          .set({ deleted_at: null, updated_at: new Date() })
          .where(
            and(
              eq(child.prospect_id, Number(row.id)),
              gte(child.deleted_at, binnedAt),
              lte(child.deleted_at, binnedAt)
            )
          )
          .returning({ id: child.id })
        children += restored.length
      }
    }

    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: type,
      entityId: Number(row.id),
      action: 'restored',
      meta: { number, children },
    })
    return {
      type,
      number,
      title: trashTitleOf(type, row as Record<string, unknown>),
      children,
    }
  })
}

export interface PurgedItem {
  type: TrashType
  number: number
  title: string
}

/**
 * Destroy binned records for good.
 *
 * READS THEM FIRST. Everything returned here was captured before the DELETE, and
 * it is the only remaining record of what was destroyed — the row is gone and
 * `platform.entities` goes with it. `bk sales trash purge` prints it and
 * `platform.events` keeps it.
 *
 * `olderThanDays` is how the D-19 retention sweep will call this; a caller
 * naming explicit items ignores it.
 */
export async function purgeItems(
  workspaceId: number,
  opts: { items?: Array<{ type: TrashType; number: number }>; olderThanDays?: number },
  actor: Actor
): Promise<PurgedItem[]> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const purged: PurgedItem[] = []

    const targets = opts.items?.length
      ? opts.items
      : (await listTrash(workspaceId))
          .filter((i) =>
            opts.olderThanDays == null
              ? true
              : i.expires_in_days <= RETENTION_DAYS - opts.olderThanDays
          )
          .map((i) => ({ type: i.type, number: i.number }))

    for (const t of targets) {
      const table = BINNABLE[t.type]
      const rows = await tx
        .delete(table)
        .where(
          and(
            eq(table.workspace_id, workspaceId),
            eq(table.seq, t.number),
            sql`${table.deleted_at} IS NOT NULL`
          )
        )
        .returning()
      const row = rows[0] as Record<string, unknown> | undefined
      if (!row) continue
      const title = trashTitleOf(t.type, row)
      purged.push({ type: t.type, number: t.number, title })
      await recordEvent(tx, {
        workspaceId,
        actorUserId: actor.userId,
        actorTokenId: actor.tokenId,
        entityType: t.type,
        entityId: Number(row.id),
        action: 'purged',
        // The row is gone; this meta is the record.
        meta: { type: t.type, number: t.number, title },
        // Nothing left to derive a URN from. `null` is the answer, and passing
        // it explicitly is what stops `resolveSubjectUrn` running a query
        // against a row that no longer exists.
        subjectUrn: null,
      })
    }

    return purged
  })
}

/** Every binned record in the workspace, gone. Same reporting contract. */
export async function emptyTrash(workspaceId: number, actor: Actor): Promise<PurgedItem[]> {
  return await purgeItems(workspaceId, {}, actor)
}

/** How many are binned right now, per type — for the confirmation prompt. */
export async function trashCounts(workspaceId: number): Promise<Record<string, number>> {
  const items = await listTrash(workspaceId)
  const out: Record<string, number> = {}
  for (const i of items) out[i.type] = (out[i.type] ?? 0) + 1
  return out
}

/** The projected types, re-exported so a caller can check a trash type is one. */
export type { SalesEntityType }
