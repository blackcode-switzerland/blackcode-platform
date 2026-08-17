// The four things that live INSIDE a prospect: contacts, the deal journey,
// objections and matches.
//
// ---------------------------------------------------------------------------
// WHY THESE FOUR ARE ONE FILE
// ---------------------------------------------------------------------------
// They share the one property that decides everything about how they are
// addressed: **none of them has a #number.** A contact is always reached through
// its prospect, a journey step is a rung of one prospect's ladder, an objection
// belongs to the conversation it was raised in, and a match is a verdict about a
// (prospect, product) pair. `lib/entity-address.ts` explains why projecting one
// would be worse than not being findable — it would advertise an address `bk`
// cannot resolve.
//
// ---------------------------------------------------------------------------
// SO THEY ARE ADDRESSED BY ROW ID, AND THAT IS NOT A BREACH OF THE RULE
// ---------------------------------------------------------------------------
// CLAUDE.md's rule is that an ADDRESSABLE entity carries a workspace #number and
// its serial id is never exposed. A child with no independent identity is not
// addressable, and `apps/issues` already settled the shape: a comment is reached
// at `/api/workspaces/{ws}/comments/{id}` and `bk issues issue delete-comment`
// takes that id. §6.1 of the plan writes `{cid}` and `{oid}` for exactly this.
//
// The distinction that matters, stated once so nobody has to re-derive it:
//
//   HAS A URN      prospect, meeting, communication, product, template, document
//                  → #number in every route, every command, every URL
//   HAS NO URN     contact, stage entry, objection, match
//                  → reached through the parent, by row id
//
// Giving a contact a #number would mean `bc:sales:{ws}/contact/12` had to
// resolve, and nothing serves it.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  contacts,
  matches,
  objections,
  products,
  prospectNotes,
  prospects,
  stageEntries,
  templates,
} from '../schema'
import type { Contact, Match, Objection, ProspectNote, StageEntry } from '../schema'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'

/**
 * A prospect's row id, from its #number. Null when there is no such prospect.
 *
 * Every function below starts here, and that is the boundary: #numbers come in,
 * row ids stay inside. Binned prospects are included deliberately — reading the
 * history of something in the recycle bin has to work, or `bk sales trash` shows
 * a name and nothing else.
 */
export async function prospectIdBySeq(workspaceId: number, seq: number): Promise<number | null> {
  const db = getDb()
  const [row] = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.workspace_id, workspaceId), eq(prospects.seq, seq)))
    .limit(1)
  return row?.id ?? null
}

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------

export async function listContacts(prospectId: number): Promise<Contact[]> {
  const db = getDb()
  return await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.prospect_id, prospectId), isNull(contacts.deleted_at)))
    // Primary first, then alphabetical: the decision maker is the row a reader
    // is looking for, and "whoever was entered first" is not an ordering.
    .orderBy(desc(contacts.is_primary), asc(contacts.name))
}

export interface ContactInput {
  name?: string
  role?: string | null
  email?: string | null
  phone?: string | null
  isPrimary?: boolean
  notes?: string | null
  /** Migration 0008 — the identity card (#34) and #33's structured half. */
  linkedin?: string | null
  decisionPower?: string | null
}

export async function addContact(
  workspaceId: number,
  prospectId: number,
  input: ContactInput & { name: string },
  actor: Actor
): Promise<Contact> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    if (input.isPrimary) await demoteOtherPrimaries(tx, prospectId, 0)
    const [row] = await tx
      .insert(contacts)
      .values({
        workspace_id: workspaceId,
        prospect_id: prospectId,
        name: input.name,
        role: input.role ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        is_primary: input.isPrimary ?? false,
        notes: input.notes ?? null,
        linkedin: input.linkedin ?? null,
        decision_power: input.decisionPower ?? null,
      })
      .returning()
    if (!row) throw new Error('contact insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'contact',
      entityId: row.id,
      action: 'created',
      // The event's subject is the CONTACT, which has no URN — so the prospect's
      // #number goes in `meta` instead. Without it the activity feed says "a
      // contact was added" and cannot say to what.
      meta: { name: row.name, prospect_id: prospectId },
    })
    return row
  })
}

export async function updateContact(
  workspaceId: number,
  prospectId: number,
  contactId: number,
  input: ContactInput,
  actor: Actor
): Promise<Contact | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.prospect_id, prospectId)))
      .limit(1)
    if (!existing) return null
    if (input.isPrimary) await demoteOtherPrimaries(tx, prospectId, contactId)

    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.name !== undefined) values.name = input.name
    if (input.role !== undefined) values.role = input.role
    if (input.email !== undefined) values.email = input.email
    if (input.phone !== undefined) values.phone = input.phone
    if (input.notes !== undefined) values.notes = input.notes
    if (input.linkedin !== undefined) values.linkedin = input.linkedin
    if (input.decisionPower !== undefined) values.decision_power = input.decisionPower
    if (input.isPrimary !== undefined) values.is_primary = input.isPrimary

    const [row] = await tx
      .update(contacts)
      .set(values)
      .where(eq(contacts.id, contactId))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'contact',
      entityId: row.id,
      action: 'updated',
      meta: { name: row.name, prospect_id: prospectId },
    })
    return row
  })
}

/** Bin a contact. Soft, like everything else — `bk sales trash` is the only hard delete. */
export async function removeContact(
  workspaceId: number,
  prospectId: number,
  contactId: number,
  actor: Actor
): Promise<Contact | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(contacts)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.prospect_id, prospectId),
          isNull(contacts.deleted_at)
        )
      )
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'contact',
      entityId: row.id,
      action: 'deleted',
      meta: { name: row.name, prospect_id: prospectId },
    })
    return row
  })
}

/**
 * At most one primary contact per prospect.
 *
 * Enforced here rather than by a partial unique index because the fix is
 * "demote the other one", not "refuse the write": an agent naming a new primary
 * means the old one is no longer it, and making that a 409 the caller has to
 * resolve in two calls is a worse product than doing the obvious thing.
 */
async function demoteOtherPrimaries(
  tx: Parameters<typeof recordEvent>[0],
  prospectId: number,
  keepId: number
) {
  await tx
    .update(contacts)
    .set({ is_primary: false })
    .where(
      and(
        eq(contacts.prospect_id, prospectId),
        eq(contacts.is_primary, true),
        sql`${contacts.id} <> ${keepId}`
      )
    )
}

// ---------------------------------------------------------------------------
// the deal journey
// ---------------------------------------------------------------------------

export async function listStageEntries(prospectId: number): Promise<StageEntry[]> {
  const db = getDb()
  return await db
    .select()
    .from(stageEntries)
    .where(eq(stageEntries.prospect_id, prospectId))
    .orderBy(asc(stageEntries.occurred_at), asc(stageEntries.id))
}

/**
 * Add a journey step WITHOUT moving the deal.
 *
 * This is not `prospect stage` with a different name, and the difference is the
 * whole reason both exist. `prospect stage` moves the deal and records the move.
 * This records a step that did not move it — the `upcoming` rungs the mockup
 * renders ahead of where a deal actually is, and a retroactive note about a stage
 * that was passed through before the record existed.
 *
 * So it never touches `prospects.stage`. A command that silently did would be a
 * second, undocumented way to move a deal.
 */
export async function addStageEntry(
  workspaceId: number,
  prospectId: number,
  input: { stage: string; status?: string; note?: string | null; occurredAt?: Date | null },
  actor: Actor
): Promise<StageEntry> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const status = input.status ?? 'done'
    const [row] = await tx
      .insert(stageEntries)
      .values({
        workspace_id: workspaceId,
        prospect_id: prospectId,
        stage: input.stage,
        status,
        // An `upcoming` step has no date, actor or note — it has not happened.
        // Writing `now()` on one would date a thing that did not occur.
        occurred_at: status === 'upcoming' ? null : (input.occurredAt ?? new Date()),
        actor_user_id: status === 'upcoming' ? null : actor.userId,
        actor_label: status === 'upcoming' ? null : actor.label,
        note: input.note ?? null,
      })
      .returning()
    if (!row) throw new Error('stage entry insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'stage_entry',
      entityId: row.id,
      action: 'created',
      meta: { stage: row.stage, status: row.status, prospect_id: prospectId },
    })
    return row
  })
}

// ---------------------------------------------------------------------------
// objections
// ---------------------------------------------------------------------------

export async function listObjections(prospectId: number): Promise<Objection[]> {
  const db = getDb()
  return await db
    .select()
    .from(objections)
    .where(eq(objections.prospect_id, prospectId))
    .orderBy(desc(objections.raised_at), desc(objections.id))
}

/** One objection, by its row id, scoped to its prospect. */
export async function getObjection(
  prospectId: number,
  objectionId: number
): Promise<Objection | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(objections)
    .where(and(eq(objections.id, objectionId), eq(objections.prospect_id, prospectId)))
    .limit(1)
  return row ?? null
}

export interface RaiseObjectionInput {
  type: string
  raisedBy?: string | null
  raisedAt?: Date | null
  spoken?: string | null
  realFear?: string | null
}

export async function raiseObjection(
  workspaceId: number,
  prospectId: number,
  input: RaiseObjectionInput,
  actor: Actor
): Promise<Objection> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(objections)
      .values({
        workspace_id: workspaceId,
        prospect_id: prospectId,
        type: input.type,
        raised_by: input.raisedBy ?? null,
        raised_at: input.raisedAt ?? new Date(),
        status: 'open',
        spoken: input.spoken ?? null,
        real_fear: input.realFear ?? null,
      })
      .returning()
    if (!row) throw new Error('objection insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'objection',
      entityId: row.id,
      action: 'created',
      meta: { type: row.type, prospect_id: prospectId },
    })
    return row
  })
}

/**
 * Move an objection along: counter it, resolve it, or edit what was said.
 *
 * `status` is set by the caller rather than inferred from which fields arrived.
 * Inferring — "a counter was written, so it is countered" — would make editing a
 * typo in the counter of a RESOLVED objection silently reopen it.
 */
export async function updateObjection(
  workspaceId: number,
  prospectId: number,
  objectionId: number,
  input: {
    status?: string
    spoken?: string | null
    realFear?: string | null
    counter?: string | null
    type?: string
  },
  actor: Actor
): Promise<Objection | null> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.status !== undefined) values.status = input.status
    if (input.spoken !== undefined) values.spoken = input.spoken
    if (input.realFear !== undefined) values.real_fear = input.realFear
    if (input.counter !== undefined) values.counter = input.counter
    if (input.type !== undefined) values.type = input.type

    const [row] = await tx
      .update(objections)
      .set(values)
      .where(and(eq(objections.id, objectionId), eq(objections.prospect_id, prospectId)))
      .returning()
    if (!row) return null
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'objection',
      entityId: row.id,
      action: 'updated',
      meta: { type: row.type, status: row.status, prospect_id: prospectId },
    })
    return row
  })
}

/**
 * The three answers `deleteObjection` can give. A mismatch is NOT a delete.
 */
export type DeleteObjectionResult =
  | { status: 'deleted'; row: Objection }
  | { status: 'mismatch'; type: string }
  | { status: 'not_found' }

/**
 * Remove an objection — HARD, and it is the one hard delete in this app.
 *
 * `sales.objections` carries no `deleted_at`: it is a note about a conversation,
 * not an addressable record, and there is nothing for a recycle bin to list it
 * under. `bk sales objection rm` therefore destroys it, which is why the command
 * requires a confirmation like the other irreversible ones.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRMATION IS CHECKED **BEFORE** THE DELETE. IT DID NOT USED TO BE.
 * ---------------------------------------------------------------------------
 * Until 2026-08-07 the route deleted the row and compared `--confirm` against
 * the value it got back, throwing a 409 on a mismatch. So a caller who named the
 * wrong type got a "that does not name objection 4" conflict — **and the
 * objection was already permanently gone.** The route's own comment called that
 * branch an assertion that "cannot happen", which is true only of a caller who
 * passes the right value; it is precisely the wrong-value caller the guard
 * exists for.
 *
 * That is the inert-guard shape CLAUDE.md's standing rule is written for, on the
 * one operation in this app with no recycle bin behind it. The check moved in
 * here, inside the transaction and under `FOR UPDATE`, rather than into the
 * route as a read-then-delete pair: two statements outside a transaction can be
 * separated by a concurrent edit, and a confirmation that was true a moment ago
 * is not a confirmation.
 *
 * `confirmType` is required rather than optional. An optional one is a parameter
 * a future call site forgets, and the failure would be silent.
 */
export async function deleteObjection(
  workspaceId: number,
  prospectId: number,
  objectionId: number,
  confirmType: string,
  actor: Actor
): Promise<DeleteObjectionResult> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(objections)
      .where(and(eq(objections.id, objectionId), eq(objections.prospect_id, prospectId)))
      .limit(1)
      .for('update')
    if (!existing) return { status: 'not_found' as const }
    if (existing.type !== confirmType) return { status: 'mismatch' as const, type: existing.type }

    const [row] = await tx
      .delete(objections)
      .where(and(eq(objections.id, objectionId), eq(objections.prospect_id, prospectId)))
      .returning()
    if (!row) return { status: 'not_found' as const }
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'objection',
      entityId: row.id,
      action: 'purged',
      // The row is gone, so the event is the only remaining record of what it
      // said. `bk sales objection rm` echoes the same thing back to the caller.
      meta: { type: row.type, spoken: row.spoken, prospect_id: prospectId },
      // Nothing to derive a subject URN from, and this is the one call site
      // where that is a fact rather than an omission.
      subjectUrn: null,
    })
    return { status: 'deleted' as const, row }
  })
}

// ---------------------------------------------------------------------------
// prospect_notes — the research log (#39). APPEND-ONLY: no update function
// ---------------------------------------------------------------------------
//
//   ┌────────────────────────────────────────────────────────────────────────┐
//   │ THERE IS NO `updateProspectNote`, AND ADDING ONE UNDOES THIS TABLE.    │
//   └────────────────────────────────────────────────────────────────────────┘
//
// `prospects.summary` is the field you overwrite; this is the one you add to.
// The issue that produced it was filed because there was only the former, and a
// researcher had to destroy a prior finding to record a new one. An editable log
// answers "what do we think now" — which `summary` already answers — and stops
// answering "what did we know, and when", which is the only thing it is for.
// `schema.ts` at `prospectNotes` has the rest.

export async function listProspectNotes(prospectId: number): Promise<ProspectNote[]> {
  const db = getDb()
  return await db
    .select()
    .from(prospectNotes)
    .where(eq(prospectNotes.prospect_id, prospectId))
    // Newest first: a research log is read from the top, and the reader wants
    // the most recent observation before the oldest one.
    .orderBy(desc(prospectNotes.created_at), desc(prospectNotes.id))
}

export async function addProspectNote(
  workspaceId: number,
  prospectId: number,
  input: { body: string; kind?: string | null },
  actor: Actor
): Promise<ProspectNote> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(prospectNotes)
      .values({
        workspace_id: workspaceId,
        prospect_id: prospectId,
        body: input.body,
        kind: input.kind ?? null,
        author_user_id: actor.userId,
        // Always the label, never only the FK — an agent writes most of these
        // and "Companion" is not a platform user.
        author_label: actor.label,
      })
      .returning()
    if (!row) throw new Error('prospect note insert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect_note',
      entityId: row.id,
      action: 'created',
      // The note has no URN of its own, so the prospect's id is what makes the
      // activity feed able to say what this was added TO.
      meta: { kind: row.kind, prospect_id: prospectId },
    })
    return row
  })
}

export type DeleteProspectNoteResult =
  | { status: 'not_found' }
  | { status: 'deleted'; row: ProspectNote }

/**
 * Destroy a note. HARD — this table has no `deleted_at` and no trash.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRMATION IS THE NOTE'S OWN id, AND THE ROUTE CHECKS IT BEFORE THIS
 * ---------------------------------------------------------------------------
 * `deleteObjection` above confirms on the objection's `type`, which is a value
 * the caller can only supply by having LOOKED at the row. That is the stronger
 * shape and it is not available here: `kind` is nullable, so on the common note
 * the confirmation would be `--confirm ""` — unconfirmable in practice, and a
 * guard nobody can satisfy gets removed rather than obeyed.
 *
 * So this takes CLAUDE.md's other documented shape — "require the caller to
 * repeat the target back", the same one `bk workspace delete <slug> --confirm
 * <slug>` uses. **It is honestly a weaker guard and it is worth saying what it
 * does and does not buy:** it stops `Confirm()` auto-approving under
 * `BK_NO_PROMPT=1` and on a non-TTY, which is exactly how agents run, and it
 * stops a bare `rm` typed by reflex. It does NOT catch a caller who has the
 * wrong id, because the wrong id is what they would repeat.
 *
 * What covers that gap is the RECEIPT rather than the guard: the delete returns
 * the row, the event records the whole body, and `bk` echoes what it destroyed.
 * A wrong `rm` is visible in the next line of output instead of in a month.
 *
 * The read is `FOR UPDATE` and the delete is in the same transaction, so a
 * concurrent write cannot slip between them.
 */
export async function deleteProspectNote(
  workspaceId: number,
  prospectId: number,
  noteId: number,
  actor: Actor
): Promise<DeleteProspectNoteResult> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(prospectNotes)
      .where(and(eq(prospectNotes.id, noteId), eq(prospectNotes.prospect_id, prospectId)))
      .limit(1)
      .for('update')
    if (!existing) return { status: 'not_found' as const }

    const [row] = await tx
      .delete(prospectNotes)
      .where(and(eq(prospectNotes.id, noteId), eq(prospectNotes.prospect_id, prospectId)))
      .returning()
    if (!row) return { status: 'not_found' as const }
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'prospect_note',
      entityId: row.id,
      action: 'purged',
      // The row is gone, so this event is the only surviving record of what it
      // said — see the receipt argument above. The route echoes the same body
      // back to the caller.
      meta: { kind: row.kind, body: row.body, prospect_id: prospectId },
      subjectUrn: null,
    })
    return { status: 'deleted' as const, row }
  })
}

/** One note, by its row id, scoped to its prospect — what the route reads to
 *  check the confirmation before calling the delete above. */
export async function getProspectNote(
  prospectId: number,
  noteId: number
): Promise<ProspectNote | null> {
  const [row] = await getDb()
    .select()
    .from(prospectNotes)
    .where(and(eq(prospectNotes.id, noteId), eq(prospectNotes.prospect_id, prospectId)))
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------
// matches — the triangulation, WRITTEN by the agent and never computed here
// ---------------------------------------------------------------------------
//
//   ┌────────────────────────────────────────────────────────────────────────┐
//   │ NOTHING IN THIS SECTION DERIVES A FIT SCORE. IF YOU ARE HERE TO ADD    │
//   │ "recompute matches", READ `schema.ts` AT `matches` FIRST.              │
//   └────────────────────────────────────────────────────────────────────────┘

/** One match, with the product and template it names resolved. */
export interface MatchRow extends Match {
  product_number: number
  product_name: string
  template_number: number | null
  template_name: string | null
}

export async function listMatches(
  workspaceId: number,
  prospectId: number
): Promise<MatchRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      m: matches,
      product_number: products.seq,
      product_name: products.name,
      template_number: templates.seq,
      template_name: templates.name,
    })
    .from(matches)
    .innerJoin(products, eq(products.id, matches.product_id))
    .leftJoin(templates, eq(templates.id, matches.template_id))
    .where(and(eq(matches.workspace_id, workspaceId), eq(matches.prospect_id, prospectId)))
    .orderBy(desc(matches.fit))
  return rows.map((r) => ({
    ...r.m,
    product_number: r.product_number,
    product_name: r.product_name,
    template_number: r.template_number ?? null,
    template_name: r.template_name ?? null,
  }))
}

/**
 * Record the agent's verdict for one (prospect, product) pair. An UPSERT.
 *
 * `uq_matches_prospect_product` is what makes it one, and the reason is in the
 * schema: the table must not be able to accumulate three contradictory scores
 * for the same pair. Re-running the triangulation replaces the answer.
 */
export async function setMatch(
  workspaceId: number,
  prospectId: number,
  input: { productId: number; fit?: number | null; templateId?: number | null; why?: string | null },
  actor: Actor
): Promise<Match> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      INSERT INTO sales.matches
        (workspace_id, prospect_id, product_id, fit, template_id, why, computed_at, computed_by_label)
      VALUES (${workspaceId}, ${prospectId}, ${input.productId}, ${input.fit ?? null},
              ${input.templateId ?? null}, ${input.why ?? null}, now(), ${actor.label})
      ON CONFLICT (prospect_id, product_id) DO UPDATE SET
        fit = EXCLUDED.fit,
        template_id = EXCLUDED.template_id,
        why = EXCLUDED.why,
        computed_at = now(),
        computed_by_label = EXCLUDED.computed_by_label
      RETURNING *`)
    const row = res.rows[0] as unknown as Match
    if (!row) throw new Error('match upsert returned nothing')
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'match',
      entityId: Number(row.id),
      action: 'updated',
      meta: { prospect_id: prospectId, product_id: input.productId, fit: input.fit ?? null },
    })
    return row
  })
}

export async function clearMatch(
  workspaceId: number,
  prospectId: number,
  productId: number,
  actor: Actor
): Promise<boolean> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(matches)
      .where(
        and(
          eq(matches.workspace_id, workspaceId),
          eq(matches.prospect_id, prospectId),
          eq(matches.product_id, productId)
        )
      )
      .returning()
    if (!row) return false
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'match',
      entityId: row.id,
      action: 'purged',
      meta: { prospect_id: prospectId, product_id: productId },
      subjectUrn: null,
    })
    return true
  })
}
