// Meetings and communications — the two LEDGERS.
//
// ---------------------------------------------------------------------------
// A LEDGER, NOT A CALENDAR AND NOT AN INBOX
// ---------------------------------------------------------------------------
// Both tables record that something HAPPENED (or is going to). Neither sends
// anything and neither syncs with anything: Google Calendar owns scheduling and
// Gmail owns mail, and integration with either is an explicit non-goal (§2). The
// `external_ref` columns exist so that can be added later without a migration of
// meaning.
//
// The consequence for these functions is that a "schedule" and a "log" are the
// same insert with a different `status` — which is why `bk sales meeting
// schedule` and `bk sales meeting log` share one route. The app is not doing two
// different things; the caller is telling it about two different moments.
//
// Both are PROJECTED entities: `seq`, a URN, an entities row, and every write
// therefore owes allocateSeq + recordEvent + projectEntity in one transaction.

import { and, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { getDb } from '../client'
import { communications, contacts, meetings, prospects } from '../schema'
import type { Communication, Meeting } from '../schema'
import { allocateSeq } from './counters'
import { recordEvent } from './events'
import type { Actor } from '@/lib/actor'
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@/lib/limits'

const clampLimit = (n: number | undefined) =>
  Math.min(Math.max(n ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX)

/** Every ledger row carries the prospect it belongs to, by #number and name. */
export interface WithProspect {
  prospect_number: number
  prospect_name: string
}

// ---------------------------------------------------------------------------
// meetings
// ---------------------------------------------------------------------------

export interface ListMeetingsFilter {
  workspaceId: number
  /** Prospect #number, not row id. */
  prospectSeq?: number
  statuses?: string[]
  from?: Date
  to?: Date
  includeDeleted?: boolean
  limit?: number
  cursor?: number | null
}

export type MeetingRow = Meeting & WithProspect

export async function listMeetings(
  filter: ListMeetingsFilter
): Promise<{ data: MeetingRow[]; next_cursor: number | null }> {
  const db = getDb()
  const limit = clampLimit(filter.limit)
  const where: SQL[] = [eq(meetings.workspace_id, filter.workspaceId)]
  if (!filter.includeDeleted) where.push(isNull(meetings.deleted_at))
  if (filter.prospectSeq != null) where.push(eq(prospects.seq, filter.prospectSeq))
  if (filter.statuses?.length) {
    where.push(sql`${meetings.status} IN (${sql.join(filter.statuses.map((s) => sql`${s}`), sql`, `)})`)
  }
  if (filter.from) where.push(gte(meetings.starts_at, filter.from))
  if (filter.to) where.push(lte(meetings.starts_at, filter.to))
  if (filter.cursor != null) where.push(sql`${meetings.seq} < ${filter.cursor}`)

  const rows = await db
    .select({ m: meetings, prospect_number: prospects.seq, prospect_name: prospects.name })
    .from(meetings)
    .innerJoin(prospects, eq(prospects.id, meetings.prospect_id))
    .where(and(...where))
    // Most recent FIRST, including future meetings: the question a reader has is
    // "what is next / what just happened", and both live at this end of the list.
    .orderBy(desc(meetings.starts_at), desc(meetings.seq))
    .limit(limit + 1)

  const page: MeetingRow[] = rows.slice(0, limit).map((r) => ({
    ...r.m,
    prospect_number: r.prospect_number,
    prospect_name: r.prospect_name,
  }))
  const next = rows.length > limit ? (page[page.length - 1]?.seq ?? null) : null
  return { data: page, next_cursor: next }
}

export async function getMeetingBySeq(
  workspaceId: number,
  seq: number
): Promise<MeetingRow | null> {
  const db = getDb()
  const [row] = await db
    .select({ m: meetings, prospect_number: prospects.seq, prospect_name: prospects.name })
    .from(meetings)
    .innerJoin(prospects, eq(prospects.id, meetings.prospect_id))
    .where(and(eq(meetings.workspace_id, workspaceId), eq(meetings.seq, seq)))
    .limit(1)
  if (!row) return null
  return { ...row.m, prospect_number: row.prospect_number, prospect_name: row.prospect_name }
}

export interface CreateMeetingInput {
  workspaceId: number
  prospectId: number
  actor: Actor
  startsAt: Date
  type: string
  status: string
  title: string
  durationMin?: number | null
  attendees?: string[] | null
  agenda?: string | null
  outcome?: string | null
  /** The online-meeting link. Null for a call or an in-person meeting. */
  meetingUrl?: string | null
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, input.workspaceId, 'meeting')
    const [row] = await tx
      .insert(meetings)
      .values({
        workspace_id: input.workspaceId,
        seq,
        prospect_id: input.prospectId,
        starts_at: input.startsAt,
        duration_min: input.durationMin ?? null,
        type: input.type,
        status: input.status,
        title: input.title,
        attendees: input.attendees ?? null,
        agenda: input.agenda ?? null,
        outcome: input.outcome ?? null,
        meeting_url: input.meetingUrl ?? null,
        created_by: input.actor.userId,
      })
      .returning()
    if (!row) throw new Error('meeting insert returned nothing')
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actor.userId,
      actorTokenId: input.actor.tokenId,
      entityType: 'meeting',
      entityId: row.id,
      action: 'created',
      meta: { title: row.title, status: row.status, prospect_id: input.prospectId },
    })
    return row
  })
}

/**
 * Record how a meeting went, cancel it, or fix its details.
 *
 * Writing an `outcome` moves the status to `done` unless the caller says
 * otherwise, because a meeting with an outcome has happened — but a caller that
 * passes `status` explicitly is believed. That is the opposite of the objection
 * rule two files over, and the difference is real: an outcome is EVIDENCE the
 * meeting occurred, while a counter is not evidence the objection is settled.
 */
export async function updateMeeting(
  workspaceId: number,
  seq: number,
  input: {
    status?: string
    outcome?: string | null
    agenda?: string | null
    title?: string
    startsAt?: Date
    durationMin?: number | null
    attendees?: string[] | null
    /** `null` CLEARS the link; `undefined` leaves it alone. */
    meetingUrl?: string | null
  },
  actor: Actor
): Promise<MeetingRow | null> {
  const db = getDb()
  const existing = await getMeetingBySeq(workspaceId, seq)
  if (!existing) return null

  await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updated_at: new Date() }
    if (input.title !== undefined) values.title = input.title
    if (input.agenda !== undefined) values.agenda = input.agenda
    if (input.startsAt !== undefined) values.starts_at = input.startsAt
    if (input.durationMin !== undefined) values.duration_min = input.durationMin
    if (input.attendees !== undefined) values.attendees = input.attendees
    if (input.meetingUrl !== undefined) values.meeting_url = input.meetingUrl
    if (input.outcome !== undefined) {
      values.outcome = input.outcome
      if (input.status === undefined && input.outcome) values.status = 'done'
    }
    if (input.status !== undefined) values.status = input.status

    const [row] = await tx
      .update(meetings)
      .set(values)
      .where(and(eq(meetings.workspace_id, workspaceId), eq(meetings.seq, seq)))
      .returning()
    if (!row) return
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'meeting',
      entityId: row.id,
      action: 'updated',
      meta: { title: row.title, status: row.status },
    })
  })
  return await getMeetingBySeq(workspaceId, seq)
}

export async function softDeleteMeeting(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<MeetingRow | null> {
  const db = getDb()
  const existing = await getMeetingBySeq(workspaceId, seq)
  if (!existing) return null
  if (existing.deleted_at) return existing

  await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(meetings)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(meetings.workspace_id, workspaceId), eq(meetings.seq, seq)))
      .returning()
    if (!row) return
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'meeting',
      entityId: row.id,
      action: 'deleted',
      meta: { title: row.title, number: row.seq },
    })
  })
  return await getMeetingBySeq(workspaceId, seq)
}

// ---------------------------------------------------------------------------
// communications
// ---------------------------------------------------------------------------

export interface ListCommsFilter {
  workspaceId: number
  prospectSeq?: number
  channels?: string[]
  direction?: string
  from?: Date
  to?: Date
  includeDeleted?: boolean
  limit?: number
  cursor?: number | null
}

export type CommRow = Communication & WithProspect & { contact_name: string | null }

export async function listCommunications(
  filter: ListCommsFilter
): Promise<{ data: CommRow[]; next_cursor: number | null }> {
  const db = getDb()
  const limit = clampLimit(filter.limit)
  const where: SQL[] = [eq(communications.workspace_id, filter.workspaceId)]
  if (!filter.includeDeleted) where.push(isNull(communications.deleted_at))
  if (filter.prospectSeq != null) where.push(eq(prospects.seq, filter.prospectSeq))
  if (filter.channels?.length) {
    where.push(
      sql`${communications.channel} IN (${sql.join(filter.channels.map((c) => sql`${c}`), sql`, `)})`
    )
  }
  if (filter.direction) where.push(eq(communications.direction, filter.direction))
  if (filter.from) where.push(gte(communications.occurred_at, filter.from))
  if (filter.to) where.push(lte(communications.occurred_at, filter.to))
  if (filter.cursor != null) where.push(sql`${communications.seq} < ${filter.cursor}`)

  const rows = await db
    .select({
      c: communications,
      prospect_number: prospects.seq,
      prospect_name: prospects.name,
      contact_name: contacts.name,
    })
    .from(communications)
    .innerJoin(prospects, eq(prospects.id, communications.prospect_id))
    .leftJoin(contacts, eq(contacts.id, communications.contact_id))
    .where(and(...where))
    .orderBy(desc(communications.occurred_at), desc(communications.seq))
    .limit(limit + 1)

  const page = rows.slice(0, limit).map((r) => ({
    ...r.c,
    prospect_number: r.prospect_number,
    prospect_name: r.prospect_name,
    contact_name: r.contact_name ?? null,
  }))
  const next = rows.length > limit ? (page[page.length - 1]?.seq ?? null) : null
  return { data: page, next_cursor: next }
}

export async function getCommBySeq(workspaceId: number, seq: number): Promise<CommRow | null> {
  const db = getDb()
  const [row] = await db
    .select({
      c: communications,
      prospect_number: prospects.seq,
      prospect_name: prospects.name,
      contact_name: contacts.name,
    })
    .from(communications)
    .innerJoin(prospects, eq(prospects.id, communications.prospect_id))
    .leftJoin(contacts, eq(contacts.id, communications.contact_id))
    .where(and(eq(communications.workspace_id, workspaceId), eq(communications.seq, seq)))
    .limit(1)
  if (!row) return null
  return {
    ...row.c,
    prospect_number: row.prospect_number,
    prospect_name: row.prospect_name,
    contact_name: row.contact_name ?? null,
  }
}

export interface LogCommInput {
  workspaceId: number
  prospectId: number
  actor: Actor
  channel: string
  direction: string
  occurredAt: Date
  subject?: string | null
  body?: string | null
  contactId?: number | null
}

export async function logCommunication(input: LogCommInput): Promise<Communication> {
  const db = getDb()
  return await db.transaction(async (tx) => {
    const seq = await allocateSeq(tx, input.workspaceId, 'communication')
    const [row] = await tx
      .insert(communications)
      .values({
        workspace_id: input.workspaceId,
        seq,
        prospect_id: input.prospectId,
        channel: input.channel,
        direction: input.direction,
        occurred_at: input.occurredAt,
        subject: input.subject ?? null,
        body: input.body ?? null,
        contact_id: input.contactId ?? null,
        logged_by_user_id: input.actor.userId,
        // The `_label` half of §3.4's pair — "Companion · auto-logged" rather
        // than a user id nobody can read in a list.
        logged_by_label: input.actor.label,
      })
      .returning()
    if (!row) throw new Error('communication insert returned nothing')
    await recordEvent(tx, {
      workspaceId: input.workspaceId,
      actorUserId: input.actor.userId,
      actorTokenId: input.actor.tokenId,
      entityType: 'communication',
      entityId: row.id,
      action: 'created',
      meta: { channel: row.channel, direction: row.direction, prospect_id: input.prospectId },
    })
    return row
  })
}

export async function softDeleteCommunication(
  workspaceId: number,
  seq: number,
  actor: Actor
): Promise<CommRow | null> {
  const db = getDb()
  const existing = await getCommBySeq(workspaceId, seq)
  if (!existing) return null
  if (existing.deleted_at) return existing

  await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(communications)
      .set({ deleted_at: now, updated_at: now })
      .where(and(eq(communications.workspace_id, workspaceId), eq(communications.seq, seq)))
      .returning()
    if (!row) return
    await recordEvent(tx, {
      workspaceId,
      actorUserId: actor.userId,
      actorTokenId: actor.tokenId,
      entityType: 'communication',
      entityId: row.id,
      action: 'deleted',
      meta: { channel: row.channel, number: row.seq },
    })
  })
  return await getCommBySeq(workspaceId, seq)
}
