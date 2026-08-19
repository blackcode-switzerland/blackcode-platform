// The pièces pipeline: the robot door, the inbox, and the match.
//
// ===========================================================================
// INGEST IS THE ONE ROUTE AN OUTSIDE PROCESS CALLS
// ===========================================================================
// The Drive worker holds a bk_live_ token and POSTs here like any caller —
// membership-checked, nothing special. What IS special is what this module
// refuses to trust: the worker's validation verdict (recomputed server-side),
// the worker's retry behaviour (idempotent on the file/checksum pair), and
// the worker's deduplication — suspects are FLAGGED here, never dropped, by
// two detectors: identical bytes (same checksum, new file id) and identical
// facts (same date and total for the same book — an EFT slip and the receipt
// of one purchase, or a refund, or a split payment; a human decides which).
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
  booksRiEntry,
  booksEntity,
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
  /** Drive's own checksum: the worker's cross-check, and the legacy dedupe key. */
  md5_checksum?: string | null
  /** The worker's SHA-256 of the bytes it captured (0015). What the books cite. */
  sha256?: string | null
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
    // Duplicate suspects under a DIFFERENT file id: flag, never drop. Two
    // detectors, in strength order.
    //
    // IDENTICAL BYTES — the same checksum (sha256 when both sides carry one,
    // Drive's md5 otherwise): a copied or re-uploaded file.
    //
    // SAME FACTS — an earlier piece for the same book whose extraction names
    // the same date and the same total: the mockup's own 9605/9601 pair, an
    // EFT card slip and the itemized receipt of ONE purchase — different
    // bytes, same money. A refund and a split payment look exactly like this
    // too, which is why a suspect is flagged for a human and never dropped,
    // and why a flagged piece is `needs_review` from the moment it lands.
    let duplicateOf: BooksPieceInbox | null = null
    if (source.sha256) {
      const [dup] = await tx
        .select()
        .from(booksPieceInbox)
        .where(
          and(
            eq(booksPieceInbox.workspace_id, workspaceId),
            eq(booksPieceInbox.sha256, source.sha256),
            sql`${booksPieceInbox.drive_file_id} <> ${source.file_id}`
          )
        )
        .orderBy(asc(booksPieceInbox.id))
        .limit(1)
      duplicateOf = dup ?? null
    }
    if (!duplicateOf && source.md5_checksum) {
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
    if (!duplicateOf) {
      const txn = extraction.transaction ?? (extraction as unknown as { tx?: Extraction['transaction'] }).tx
      const total = toCentimes(txn?.total ?? 0)
      const date = txn?.date ?? null
      if (total !== 0n && date) {
        const earlier = await tx
          .select()
          .from(booksPieceInbox)
          .where(
            and(
              eq(booksPieceInbox.workspace_id, workspaceId),
              sql`${booksPieceInbox.entity_id} IS NOT DISTINCT FROM ${entityId}`,
              sql`${booksPieceInbox.drive_file_id} <> ${source.file_id}`
            )
          )
          .orderBy(asc(booksPieceInbox.id))
        for (const p of earlier) {
          const px = p.extraction as unknown as Extraction & { tx?: Extraction['transaction'] }
          const ptx = px.transaction ?? px.tx
          if (ptx?.date === date && toCentimes(ptx?.total ?? 0) === total) {
            duplicateOf = p
            break
          }
        }
      }
    }

    const seqRow = await tx.execute(sql`
      INSERT INTO ${booksCounters} (workspace_id, entity_type, last_value)
      VALUES (${workspaceId}, 'piece', 1)
      ON CONFLICT (workspace_id, entity_type)
        DO UPDATE SET last_value = ${booksCounters}.last_value + 1
      RETURNING last_value
    `)
    const seq = Number((seqRow.rows[0] as { last_value: number }).last_value)

    // A duplicate suspect needs a human whatever its own arithmetic said:
    // "probably the same money twice" is exactly the judgment call this
    // pipeline exists to surface rather than make.
    const flagged = review || duplicateOf !== null

    const inserted = await tx.execute(sql`
      INSERT INTO books.piece_inbox
        (workspace_id, entity_id, seq, status, received, pipeline,
         drive_file_id, file_name, mime_type, md5_checksum, sha256, drive_created_time, web_view_link,
         extraction, validation, needs_review, duplicate_of_id)
      VALUES
        (${workspaceId}, ${entityId}, ${seq}, 'staged', ${receivedOn}, ${pipeline},
         ${source.file_id}, ${source.file_name ?? null}, ${source.mime_type ?? null},
         ${source.md5_checksum ?? null}, ${source.sha256 ?? null}, ${source.created_time ?? null}, ${source.web_view_link ?? null},
         ${JSON.stringify(extraction)}::jsonb, ${JSON.stringify(validation)}::jsonb,
         ${flagged}, ${duplicateOf?.id ?? null})
      ON CONFLICT (workspace_id, drive_file_id, COALESCE(sha256, md5_checksum, '')) DO NOTHING
      RETURNING *
    `)

    let piece: BooksPieceInbox
    let created = true
    if (inserted.rows.length > 0) {
      piece = inserted.rows[0] as unknown as BooksPieceInbox
    } else {
      created = false
      // The retry delivered the identical payload, so the row it converged on
      // is the one whose dedupe key matches — sha256 when the delivery
      // carried one, Drive's md5 otherwise.
      const key = source.sha256 ?? source.md5_checksum ?? ''
      const candidates = await tx
        .select()
        .from(booksPieceInbox)
        .where(
          and(
            eq(booksPieceInbox.workspace_id, workspaceId),
            eq(booksPieceInbox.drive_file_id, source.file_id)
          )
        )
      piece = candidates.find((p) => (p.sha256 ?? p.md5_checksum ?? '') === key) ?? candidates[0]
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
             ${piece.id}, ${flagged ? 'needs_review' : 'validated_staged'})
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
      needs_review: flagged,
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
 * Which journal a piece's book keeps. A simplified book's entries are
 * `ri_entry` rows; a double-entry book's are the grand livre's. An
 * UNATTRIBUTED piece (entity NULL) reads as the grand livre — same doctrine
 * as the worklist: until somebody says whose it is, it cannot reach a
 * personal recettes-dépenses book.
 */
type Journal = 'grand_livre' | 'recettes_depenses'
async function journalOf(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  entityId: number | null
): Promise<Journal> {
  if (entityId === null) return 'grand_livre'
  const [e] = await tx.select().from(booksEntity).where(eq(booksEntity.id, entityId)).limit(1)
  return e?.bookkeeping_regime === 'simplified' ? 'recettes_depenses' : 'grand_livre'
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

  // A simplified book's candidates come from ITS journal: amount is a column,
  // not a sum over lines, and `status` shows the recognition state instead —
  // an RI entry has no draft/staged/posted lifecycle.
  if ((await journalOf(getDb(), piece.entity_id)) === 'recettes_depenses') {
    const rows = await getDb()
      .select()
      .from(booksRiEntry)
      .where(
        and(
          eq(booksRiEntry.workspace_id, workspaceId),
          eq(booksRiEntry.entity_id, piece.entity_id as number),
          isNull(booksRiEntry.deleted_at),
          sql`${booksRiEntry.date} BETWEEN ${date}::date - 3 AND ${date}::date + 3`
        )
      )
      .orderBy(asc(booksRiEntry.date))
    return rows
      .filter((r) => toCentimes(r.amount) === total)
      .map((r) => ({ number: r.seq, date: r.date, raw_label: r.raw_label, amount: fromCentimes(total), status: r.recognition }))
  }

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
 * The hash an entry cites as proof of its pièce: SHA-256 when the worker
 * captured one (0015), Drive's MD5 as the legacy fallback, prefixed so a
 * reader always knows which algorithm proved the file.
 */
function pieceHashOf(piece: BooksPieceInbox): string | null {
  if (piece.sha256) return `sha256:${piece.sha256}`
  if (piece.md5_checksum) return `md5:${piece.md5_checksum}`
  return null
}

/** History is append-only; a pre-existing narrative object becomes the first element — resolve.ts's rule. */
function appendHistory(prior: unknown, event: Record<string, unknown>): unknown[] {
  return Array.isArray(prior) ? [...prior, event] : prior ? [prior, event] : [event]
}

/**
 * Attach a piece to an entry. The entry's `piece_*` columns are interpretation
 * — open on posted entries by design — and the piece leaves the inbox count.
 *
 * The number must live in the piece's OWN book. `entry.seq` is
 * workspace-unique, so any book's number resolves here — but two legal
 * entities' records never mix, and an attributed piece reaches only its own
 * entity's journal. An UNATTRIBUTED piece may match any grand-livre entry,
 * and the match is what attributes it: saying which entry a document proves
 * is saying whose it is.
 *
 * An entry that already carries a pièce refuses a second one: evidence is
 * never replaced silently. And the match lands in the entry's history — the
 * same append-only trail resolveEntry keeps — so an attached document has a
 * when and a record of what was there before (nothing, the guard proves).
 *
 * The evidence TIER is deliberately not touched: whether a matched receipt
 * upgrades `partial` to `full` is a judgment about sufficiency, and judgments
 * are a human's. The piece reference gives them the material.
 */
export async function matchPiece(
  workspaceId: number,
  pieceSeq: number,
  entrySeq: number
): Promise<{ piece: BooksPieceInbox; entryNumber: number; journal: Journal }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [piece] = await tx
      .select()
      .from(booksPieceInbox)
      .where(and(eq(booksPieceInbox.workspace_id, workspaceId), eq(booksPieceInbox.seq, pieceSeq)))
      .limit(1)
    if (!piece) throw new MatchRefused('piece_not_found', `no piece #${pieceSeq}`, 'bk books piece list shows the numbers')
    if (piece.status === 'matched' && (piece.matched_entry_id !== null || piece.matched_ri_entry_id !== null)) {
      throw new MatchRefused(
        'already_matched',
        `piece #${pieceSeq} is already matched`,
        'a piece documents one entry; unmatching is not built until somebody needs it, on purpose'
      )
    }

    // The piece's book decides which journal `entrySeq` names. 0010's CHECK
    // makes the two match columns mutually exclusive; this decision is why
    // they can never race.
    const journal = await journalOf(tx, piece.entity_id)

    if (journal === 'recettes_depenses') {
      const [ri] = await tx
        .select()
        .from(booksRiEntry)
        .where(
          and(
            eq(booksRiEntry.workspace_id, workspaceId),
            eq(booksRiEntry.entity_id, piece.entity_id as number),
            eq(booksRiEntry.seq, entrySeq)
          )
        )
        .limit(1)
      if (!ri) {
        throw new MatchRefused('entry_not_found', `no entry #${entrySeq} in this book's recettes-dépenses journal`, 'the worklist shows the numbers')
      }
      if (ri.deleted_at) throw new MatchRefused('entry_deleted', `entry #${entrySeq} is deleted`, 'match against a live entry')
      if (ri.piece_drive_ref !== null) {
        throw new MatchRefused(
          'entry_documented',
          `entry #${entrySeq} already carries a pièce`,
          'an entry cites one document; replacing evidence is not built until somebody needs it, on purpose'
        )
      }

      const [updatedPiece] = await tx
        .update(booksPieceInbox)
        .set({ status: 'matched', matched_ri_entry_id: ri.id, matched_at: new Date() })
        .where(eq(booksPieceInbox.id, piece.id))
        .returning()

      await tx
        .update(booksRiEntry)
        .set({
          piece_drive_ref: piece.web_view_link ?? `drive://${piece.drive_file_id}`,
          piece_hash: pieceHashOf(piece),
          piece_captured: piece.received,
          history: appendHistory(ri.history, {
            at: new Date().toISOString(),
            event: 'piece_matched',
            piece: piece.seq,
            was: { piece_drive_ref: ri.piece_drive_ref, piece_hash: ri.piece_hash, piece_captured: ri.piece_captured },
          }),
        })
        .where(eq(booksRiEntry.id, ri.id))

      await tx
        .update(booksDriveManifest)
        .set({ state: 'ingested', updated_at: new Date() })
        .where(
          and(eq(booksDriveManifest.workspace_id, workspaceId), eq(booksDriveManifest.file_id, piece.drive_file_id))
        )

      return { piece: updatedPiece, entryNumber: ri.seq, journal }
    }

    const [entry] = await tx
      .select()
      .from(booksEntry)
      .where(and(eq(booksEntry.workspace_id, workspaceId), eq(booksEntry.seq, entrySeq)))
      .limit(1)
    if (!entry) throw new MatchRefused('entry_not_found', `no entry #${entrySeq}`, 'bk books entry list shows the numbers')
    if (entry.deleted_at) throw new MatchRefused('entry_deleted', `entry #${entrySeq} is deleted`, 'match against a live entry')

    // The boundary. `seq` is workspace-unique, so another book's number
    // resolves to a row right here — and an attributed piece must refuse it.
    if (piece.entity_id !== null && entry.entity_id !== piece.entity_id) {
      throw new MatchRefused(
        'entry_other_book',
        `entry #${entrySeq} belongs to another book: two legal entities' records never mix`,
        "the worklist suggests candidates from the piece's own book"
      )
    }
    if (entry.piece_drive_ref !== null) {
      throw new MatchRefused(
        'entry_documented',
        `entry #${entrySeq} already carries a pièce`,
        'an entry cites one document; replacing evidence is not built until somebody needs it, on purpose'
      )
    }

    const [updatedPiece] = await tx
      .update(booksPieceInbox)
      .set({
        status: 'matched',
        matched_entry_id: entry.id,
        matched_at: new Date(),
        // Matching an unattributed piece IS the attribution.
        entity_id: piece.entity_id ?? entry.entity_id,
      })
      .where(eq(booksPieceInbox.id, piece.id))
      .returning()

    // The entry's pièce reference: the Drive link a human clicks, the checksum
    // that proves the file, the day it was captured.
    await tx
      .update(booksEntry)
      .set({
        piece_drive_ref: piece.web_view_link ?? `drive://${piece.drive_file_id}`,
        piece_hash: pieceHashOf(piece),
        piece_captured: piece.received,
        history: appendHistory(entry.history, {
          at: new Date().toISOString(),
          event: 'piece_matched',
          piece: piece.seq,
          was: { piece_drive_ref: entry.piece_drive_ref, piece_hash: entry.piece_hash, piece_captured: entry.piece_captured },
        }),
      })
      .where(eq(booksEntry.id, entry.id))

    await tx
      .update(booksDriveManifest)
      .set({ state: 'ingested', updated_at: new Date() })
      .where(
        and(eq(booksDriveManifest.workspace_id, workspaceId), eq(booksDriveManifest.file_id, piece.drive_file_id))
      )

    return { piece: updatedPiece, entryNumber: entry.seq, journal }
  })
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

export function publicPiece(
  p: BooksPieceInbox,
  entitySlug: string | null,
  matched: { seq: number; journal: Journal } | null
) {
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
    matched_entry: matched?.seq ?? null,
    /** Which journal that number lives in — `null` until matched. */
    matched_journal: matched?.journal ?? null,
    extraction: p.extraction,
    note: p.note,
  }
}
