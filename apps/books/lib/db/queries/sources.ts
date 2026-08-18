// The sources register: reads, and the wire shapes.
//
// Status is computed at read time from cadence against `last_import` — see
// `lib/derive/sources.ts` for why there is deliberately no status column.
// `today` travels in from the route so the derivation stays pure and the tests
// stay honest; a route passes the real date, a test passes a fixed one.

import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksSource,
  booksSourcePull,
  booksRunbook,
  booksDriveManifest,
  booksEntity,
  type BooksSource,
  type BooksSourcePull,
  type BooksRunbook,
  type BooksDriveManifest,
} from '../schema'
import { sourceStatus, sourceWindows } from '../../derive/sources'

export async function listSources(workspaceId: number, entityId?: number): Promise<BooksSource[]> {
  const conds = [eq(booksSource.workspace_id, workspaceId)]
  if (entityId) conds.push(eq(booksSource.entity_id, entityId))
  return getDb()
    .select()
    .from(booksSource)
    .where(and(...conds))
    .orderBy(asc(booksSource.seq))
}

export async function getSourceBySeq(workspaceId: number, seq: number): Promise<BooksSource | null> {
  const [row] = await getDb()
    .select()
    .from(booksSource)
    .where(and(eq(booksSource.workspace_id, workspaceId), eq(booksSource.seq, seq)))
    .limit(1)
  return row ?? null
}

export async function pullsOf(sourceId: number): Promise<BooksSourcePull[]> {
  return getDb()
    .select()
    .from(booksSourcePull)
    .where(eq(booksSourcePull.source_id, sourceId))
    .orderBy(desc(booksSourcePull.pulled))
}

export async function runbookOf(sourceId: number): Promise<BooksRunbook | null> {
  const [row] = await getDb()
    .select()
    .from(booksRunbook)
    .where(eq(booksRunbook.source_id, sourceId))
    .limit(1)
  return row ?? null
}

export async function manifestOf(sourceId: number): Promise<BooksDriveManifest[]> {
  return getDb()
    .select()
    .from(booksDriveManifest)
    .where(eq(booksDriveManifest.source_id, sourceId))
    .orderBy(desc(booksDriveManifest.drive_created_time))
}

/** Slug of the entity a source belongs to, or null for the unattributed one. */
export async function entitySlugsById(workspaceId: number): Promise<Map<number, string>> {
  const rows = await getDb()
    .select({ id: booksEntity.id, slug: booksEntity.slug })
    .from(booksEntity)
    .where(eq(booksEntity.workspace_id, workspaceId))
  return new Map(rows.map((r) => [r.id, r.slug]))
}

// ===========================================================================
// THE WIRE SHAPES
// ===========================================================================

export function publicSource(s: BooksSource, today: string, entitySlug: string | null) {
  return {
    number: s.seq,
    name: s.name,
    type: s.type,
    layer: s.layer,
    entity: entitySlug,
    method: s.method,
    expected: s.expected,
    last_import: s.last_import,
    retired: s.retired,
    ledger_accounts: s.ledger_accounts,
    /** Computed, never stored. The register's whole point. */
    status: sourceStatus(s, today),
    windows: sourceWindows(s.expected),
    notes_freeform: s.notes_freeform,
  }
}

export function publicPull(p: BooksSourcePull) {
  return {
    file: p.file,
    period: p.period,
    format: p.format,
    hash: p.hash,
    drive_ref: p.drive_ref,
    pulled: p.pulled,
  }
}

export function publicRunbook(r: BooksRunbook) {
  return {
    version: r.version,
    updated: r.updated,
    login_url: r.login_url,
    /** A vault reference. If a real secret ever appears here, that is the bug. */
    credential_ref: r.credential_ref,
    steps: r.steps,
    output: r.output,
  }
}

export function publicManifestRow(m: BooksDriveManifest, pieceSeq: number | null) {
  return {
    file_id: m.file_id,
    name: m.name,
    mime_type: m.mime_type,
    created_time: m.drive_created_time,
    fetched: m.fetched,
    state: m.state,
    archived: m.archived,
    archive_ref: m.archive_ref,
    /** The piece this file became, as its workspace #number. */
    piece: pieceSeq,
  }
}
