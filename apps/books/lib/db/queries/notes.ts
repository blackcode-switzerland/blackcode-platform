// The query layer: the ONLY place that touches the database.
//
// Routes stay thin — they authenticate, validate, call one of these, and shape
// the JSON. Business logic that lives in a route is logic the CLI, a future UI
// and a background job each have to reimplement.
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import { noteCounters, notes, type Note } from '../schema'

export async function listNotes(workspaceId: number, limit = 50): Promise<Note[]> {
  return getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.workspace_id, workspaceId), isNull(notes.deleted_at)))
    .orderBy(desc(notes.seq))
    .limit(Math.min(Math.max(limit, 1), 200))
}

export async function getNoteByNumber(workspaceId: number, number: number): Promise<Note | null> {
  const [row] = await getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.workspace_id, workspaceId), eq(notes.seq, number)))
    .limit(1)
  return row ?? null
}

/**
 * Create a note, allocating its workspace #number.
 *
 * ONE TRANSACTION, and the counter is bumped with `RETURNING` rather than
 * read-then-write: two concurrent creates otherwise both read the same value and
 * collide on the unique index. This is the single most-copied piece of an app's
 * schema and the easiest to get subtly wrong.
 *
 * ── THERE IS NO CROSS-APP PROJECTION HERE ANY MORE (Phase 7, 2026-08-11) ────
 * This transaction used to end with `projectEntity(tx, …)`, writing the note
 * into `platform.entities` so a shared index could resolve its URN. That index
 * has ONE writer now: multiAppFinalRefactor Phase 3 stopped `apps/sales`
 * projecting, and `bk link` — the feature the index existed for — was removed in
 * Phase 4. A new app projecting into it would be joining an index nothing reads
 * on its behalf and that its own Postgres role has no business writing.
 *
 * **The URN did not go away and does not need the index.** It is built from this
 * app's OWN slug and the `seq` allocated above —
 * `bc:books:<workspace-slug>/note/<seq>` — so every app can still print and
 * resolve one. `platform.entities` was where a URN was LOOKED UP; it was never
 * what made one true.
 *
 * If your app wants cross-app search, the settled design is a CLI fan-out over
 * each app's own server (PLAN.md Phase 6), never a shared table.
 */
export async function createNote(
  workspaceId: number,
  data: { title: string; body?: string | null; createdBy?: number | null }
): Promise<Note> {
  return getDb().transaction(async (tx) => {
    const counter = await tx.execute(sql`
      INSERT INTO ${noteCounters} (workspace_id, last_note_seq)
      VALUES (${workspaceId}, 1)
      ON CONFLICT (workspace_id)
        DO UPDATE SET last_note_seq = ${noteCounters}.last_note_seq + 1
      RETURNING last_note_seq
    `)
    const seq = Number((counter.rows[0] as { last_note_seq: number }).last_note_seq)

    const [row] = await tx
      .insert(notes)
      .values({
        workspace_id: workspaceId,
        seq,
        title: data.title,
        body: data.body ?? null,
        created_by: data.createdBy ?? null,
      })
      .returning()

    return row
  })
}

/**
 * Soft delete — into `bk <app> trash`, not gone.
 *
 * `deleted_at` and nothing else, since Phase 7 removed the cross-app projection
 * (see `createNote`). What makes soft-delete load-bearing rather than polite is
 * `platform.blob_references`: a hard DELETE fires this table's trigger and drops
 * the row's references, so a file referenced only here becomes deletable the
 * instant somebody presses delete. Two steps, two decisions.
 */
export async function softDeleteNote(workspaceId: number, number: number): Promise<Note | null> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(notes)
      .set({ deleted_at: now, updated_at: now })
      .where(
        and(
          eq(notes.workspace_id, workspaceId),
          eq(notes.seq, number),
          isNull(notes.deleted_at)
        )
      )
      .returning()
    if (!row) return null
    return row
  })
}
