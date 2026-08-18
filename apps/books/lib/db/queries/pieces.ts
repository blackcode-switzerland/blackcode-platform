// The pièces pipeline: the robot door, the inbox, and the match.
//
// ===========================================================================
// INGEST IS THE ONE ROUTE AN OUTSIDE PROCESS CALLS
// ===========================================================================
// The Drive worker holds a bk_live_ token and POSTs here like any caller —
// membership-checked, nothing special. What IS special is what this module
// refuses to trust: the worker's validation verdict (recomputed server-side),
// the worker's retry behaviour (idempotent on the file/checksum pair), and
// the worker's deduplication (same checksum under a new file id is FLAGGED,
// because a refund and a re-scan look identical and mean different money).
//
// A piece never touches a balance. No derivation reads this table; matching
// one to an entry writes the ENTRY's piece_* interpretation columns, which
// are open on posted entries by 0004's design.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../client'
import {
  booksPieceInbox,
  booksDriveManifest,
  booksEntry,
  booksEntryLine,
  booksSource,
  booksCounters,
  type BooksPieceInbox,
} from '../schema'
import {
  validateExtraction,
  needsReview,
  type Extraction,
  type Validation,
} from '../../validate/extraction'
import { toCentimes, fromCentimes } from '../../derive'

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface IngestSource {
  file_id: string
  file_name?: string | null
  mime_type?: string | null
  md5_checksum?: string | null
  created_time?: string | null
  web_view_link?: string | null
}

export interface IngestResult {
  piece: BooksPieceInbox
  /** False when the (file_id, checksum) pair had already landed: the retry converged. */
  created: boolean
  validation: Validation
  needs_review: boolean
  /** Workspace #number of an earlier piece with the same checksum, if any. */
  duplicate_of: number | null
}

/**
 * Land one ExtractionResult, staged, whatever the worker claimed about it.
 *
 * Idempotency is the database's, not a SELECT-then-INSERT: the unique index
 * over (drive_file_id, COALESCE(md5, '')) settles the race two retries would
 * otherwise win together. On conflict the existing row is returned with
 * `created: false` and NOTHING is updated — the first delivery is the record.
 */
export async function ingestPiece(
  workspaceId: number,
  entityId: number | null,
  source: IngestSource,
  extraction: Extraction,
  receivedOn: string,
  pipeline: string | null
): Promise<IngestResult> {
  const db = getDb()
  const validation = validateExtraction(extraction, receivedOn)
  const review = needsReview(extraction, validation)

  return db.transaction(async (tx) => {
    // Duplicate content under a DIFFERENT file id: flag, never drop.
    let duplicateOf: BooksPieceInbox | null = null
    if (source.md5_checksum) {
      const [dup] = await tx
        .select()
        .from(booksPieceInbox)
        .where(
          and(
            eq(booksPieceInbox.workspace_id, workspaceId),
            eq(booksPieceInbox.md5_checksum, source.md5_checksum),
            sql`${booksPieceInbox.drive_file_id} <> ${source.file_id}`
          )
        )
        .orderBy(asc(booksPieceInbox.id))
        .limit(1)
      duplicateOf = dup ?? null
    }

    const seqRow = await tx.execute(sql`
      INSERT INTO ${booksCounters} (workspace_id, entity_type, last_value)
      VALUES (${workspaceId}, 'piece', 1)
      ON CONFLICT (workspace_id, entity_type)
        DO UPDATE SET last_value = ${booksCounters}.last_value + 1
      RETURNING last_value
    `)
    const seq = Number((seqRow.rows[0] as { last_value: number }).last_value)

    const inserted = await tx.execute(sql`
      INSERT INTO books.piece_inbox
        (workspace_id, entity_id, seq, status, received, pipeline,
         drive_file_id, file_name, mime_type, md5_checksum, drive_created_time, web_view_link,
         extraction, validation, needs_review, duplicate_of_id)
      VALUES
        (${workspaceId}, ${entityId}, ${seq}, 'staged', ${receivedOn}, ${pipeline},
         ${source.file_id}, ${source.file_name ?? null}, ${source.mime_type ?? null},
         ${source.md5_checksum ?? null}, ${source.created_time ?? null}, ${source.web_view_link ?? null},
         ${JSON.stringify(extraction)}::jsonb, ${JSON.stringify(validation)}::jsonb,
         ${review}, ${duplicateOf?.id ?? null})
      ON CONFLICT (workspace_id, drive_file_id, COALESCE(md5_checksum, '')) DO NOTHING
      RETURNING *
    `)

    let piece: BooksPieceInbox
    let created = true
    if (inserted.rows.length > 0) {
      piece = inserted.rows[0] as unknown as BooksPieceInbox
    } else {
      created = false
      const cs = source.md5_checksum ?? null
      const [existing] = await tx
        .select()
        .from(booksPieceInbox)
        .where(
          and(
            eq(booksPieceInbox.workspace_id, workspaceId),
            eq(booksPieceInbox.drive_file_id, source.file_id),
            cs === null ? isNull(booksPieceInbox.md5_checksum) : eq(booksPieceInbox.md5_checksum, cs)
          )
        )
        .limit(1)
      piece = existing
      // The counter advanced for a row that never landed. A gap in piece
      // numbers is harmless; a duplicate number never is.
    }

    // The manifest row for the Drive-inbox source, kept in step. Which source
    // the file belongs to is the workspace's drive_folder source for the
    // piece's entity, when one exists; a workspace without one just has no
    // manifest, which is honest.
    if (created) {
      const [driveSource] = await tx
        .select()
        .from(booksSource)
        .where(
          and(
            eq(booksSource.workspace_id, workspaceId),
            eq(booksSource.type, 'drive_folder'),
            entityId === null ? sql`TRUE` : eq(booksSource.entity_id, entityId)
          )
        )
        .orderBy(asc(booksSource.seq))
        .limit(1)
      if (driveSource) {
        await tx.execute(sql`
          INSERT INTO books.drive_manifest
            (workspace_id, source_id, file_id, name, mime_type, drive_created_time, fetched,
             extracted_piece_id, state)
          VALUES
            (${workspaceId}, ${driveSource.id}, ${source.file_id}, ${source.file_name ?? null},
             ${source.mime_type ?? null}, ${source.created_time ?? null}, ${receivedOn},
             ${piece.id}, ${review ? 'needs_review' : 'validated_staged'})
          ON CONFLICT (workspace_id, file_id) DO UPDATE
            SET extracted_piece_id = EXCLUDED.extracted_piece_id,
                state = EXCLUDED.state,
                fetched = EXCLUDED.fetched,
                updated_at = now()
        `)
      }
    }

    return {
      piece,
      created,
      validation,
      needs_review: review,
      duplicate_of: duplicateOf?.seq ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// The inbox, and the candidates a piece could match
// ---------------------------------------------------------------------------

export async function listPieces(
  workspaceId: number,
  opts: { status?: string; entityId?: number } = {}
): Promise<BooksPieceInbox[]> {
  const conds = [eq(booksPieceInbox.workspace_id, workspaceId)]
  if (opts.status) conds.push(eq(booksPieceInbox.status, opts.status))
  if (opts.entityId) conds.push(eq(booksPieceInbox.entity_id, opts.entityId))
  return getDb()
    .select()
    .from(booksPieceInbox)
    .where(and(...conds))
    .orderBy(desc(booksPieceInbox.received), asc(booksPieceInbox.seq))
}

export async function getPieceBySeq(workspaceId: number, seq: number): Promise<BooksPieceInbox | null> {
  const [row] = await getDb()
    .select()
    .from(booksPieceInbox)
    .where(and(eq(booksPieceInbox.workspace_id, workspaceId), eq(booksPieceInbox.seq, seq)))
    .limit(1)
  return row ?? null
}

export interface MatchCandidate {
  number: number
  date: string
  raw_label: string
  amount: string
  status: string
}

/**
 * Entries this piece could document: same amount to the rappen, dated within
 * three days either side. Computed live — document matching happens inside
 * phase 2's worklist, and a stored candidate list would rot the moment an
 * entry posts.
 */
export async function candidatesFor(workspaceId: number, piece: BooksPieceInbox): Promise<MatchCandidate[]> {
  const x = piece.extraction as unknown as Extraction
  const total = toCentimes(x.transaction?.total ?? (x as unknown as { tx?: { total?: number } }).tx?.total ?? 0)
  const date = x.transaction?.date ?? (x as unknown as { tx?: { date?: string } }).tx?.date ?? null
  if (total === 0n || !date) return []

  const conds = [eq(booksEntry.workspace_id, workspaceId), isNull(booksEntry.deleted_at)]
  if (piece.entity_id !== null) conds.push(eq(booksEntry.entity_id, piece.entity_id))

  const rows = await getDb()
    .select()
    .from(booksEntry)
    .where(
      and(...conds, sql`${booksEntry.date} BETWEEN ${date}::date - 3 AND ${date}::date + 3`)
    )
    .orderBy(asc(booksEntry.date))

  const out: MatchCandidate[] = []
  for (const e of rows) {
    const lines = await getDb().select().from(booksEntryLine).where(eq(booksEntryLine.entry_id, e.id))
    const debits = lines.reduce((s, l) => s + toCentimes(l.debit), 0n)
    if (debits === total) {
      out.push({ number: e.seq, date: e.date, raw_label: e.raw_label, amount: fromCentimes(debits), status: e.status })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export class MatchRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public suggestion: string
  ) {
    super(message)
  }
}

/**
 * Attach a piece to an entry. The entry's `piece_*` columns are interpretation
 * — open on posted entries by design — and the piece leaves the inbox count.
 *
 * The evidence TIER is deliberately not touched: whether a matched receipt
 * upgrades `partial` to `full` is a judgment about sufficiency, and judgments
 * are a human's. The piece reference gives them the material.
 */
export async function matchPiece(
  workspaceId: number,
  pieceSeq: number,
  entrySeq: number
): Promise<{ piece: BooksPieceInbox; entryNumber: number }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [piece] = await tx
      .select()
      .from(booksPieceInbox)
      .where(and(eq(booksPieceInbox.workspace_id, workspaceId), eq(booksPieceInbox.seq, pieceSeq)))
      .limit(1)
    if (!piece) throw new MatchRefused('piece_not_found', `no piece #${pieceSeq}`, 'bk books piece list shows the numbers')
    if (piece.status === 'matched' && piece.matched_entry_id !== null) {
      throw new MatchRefused(
        'already_matched',
        `piece #${pieceSeq} is already matched`,
        'a piece documents one entry; unmatching is not built until somebody needs it, on purpose'
      )
    }

    const [entry] = await tx
      .select()
      .from(booksEntry)
      .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, entrySeq)))
      .limit(1)
    if (!entry) throw new MatchRefused('entry_not_found', `no entry #${entrySeq}`, 'bk books entry list shows the numbers')
    if (entry.deleted_at) throw new MatchRefused('entry_deleted', `entry #${entrySeq} is deleted`, 'match against a live entry')

    const [updatedPiece] = await tx
      .update(booksPieceInbox)
      .set({ status: 'matched', matched_entry_id: entry.id, matched_at: new Date() })
      .where(eq(booksPieceInbox.id, piece.id))
      .returning()

    // The entry's pièce reference: the Drive link a human clicks, the checksum
    // that proves the file, the day it was captured.
    await tx
      .update(booksEntry)
      .set({
        piece_drive_ref: piece.web_view_link ?? `drive://${piece.drive_file_id}`,
        piece_hash: piece.md5_checksum ? `md5:${piece.md5_checksum}` : null,
        piece_captured: piece.received,
      })
      .where(eq(booksEntry.id, entry.id))

    await tx
      .update(booksDriveManifest)
      .set({ state: 'ingested', updated_at: new Date() })
      .where(
        and(eq(booksDriveManifest.workspace_id, workspaceId), eq(booksDriveManifest.file_id, piece.drive_file_id))
      )

    return { piece: updatedPiece, entryNumber: entry.seq }
  })
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

export function publicPiece(p: BooksPieceInbox, entitySlug: string | null, matchedEntrySeq: number | null) {
  const x = p.extraction as unknown as Extraction & { tx?: Extraction['transaction'] }
  const tx = x.transaction ?? x.tx
  return {
    number: p.seq,
    entity: entitySlug,
    status: p.status,
    received: p.received,
    pipeline: p.pipeline,
    source: {
      file_id: p.drive_file_id,
      file_name: p.file_name,
      mime_type: p.mime_type,
      md5_checksum: p.md5_checksum,
      created_time: p.drive_created_time,
      web_view_link: p.web_view_link,
    },
    document_type: x.document_type,
    merchant: x.merchant?.name ?? null,
    total: tx ? fromCentimes(toCentimes(tx.total)) : null,
    date: tx?.date ?? null,
    /** The server's verdict. The worker's own claim sits inside `extraction`. */
    validation: p.validation,
    needs_review: p.needs_review,
    duplicate_of: null as number | null, // filled by the route when set
    matched_entry: matchedEntrySeq,
    extraction: p.extraction,
    note: p.note,
  }
}
