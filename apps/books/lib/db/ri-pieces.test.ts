// A pièce can prove an RI entry — the match flow's second journal.
//
// Found by the first real RI use (2026-08-18): a personal book's coffee
// expense and its receipt. `ri_entry` had carried the piece_* columns from
// the start, but candidatesFor and matchPiece only read the grand livre, so
// an RI book's documents could be ingested and never attached. Migration
// 0010 added `matched_ri_entry_id`; the piece's BOOK decides which journal
// an entry number names.
//
//   1. A receipt attributed to a simplified book gets its candidates from
//      the recettes-dépenses journal (amount to the rappen, ±3 days).
//   2. Matching writes the RI entry's piece_* columns and the piece's
//      matched_ri_entry_id — and leaves the evidence tier alone.
//   3. A piece matches once, whichever journal it matched into.
//   4. 0010's CHECK: a piece can never claim an entry in BOTH journals.
//
// Isolation by unique workspace slug, nothing deleted — pieces.test.ts's
// discipline, for its measured reason.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Extraction } from '../validate/extraction'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/ri-pieces.test.ts SKIPPED: no DATABASE_URL. RI piece matching was NOT verified.\n')
}

// A plausible café receipt: sums exactly, Swiss rate, in-window date.
const CAFE: Extraction = {
  document_type: 'receipt',
  merchant: { name: 'Café du Commerce' },
  transaction: { date: '2026-08-10', currency: 'CHF', total: 9.5, payment_method: 'card' },
  lines: [{ description: 'Café renversé + croissant', amount: 9.5, vat_rate: 8.1 }],
  confidence: 0.96,
}

d('a pièce against the recettes-dépenses journal', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0
  let pieceSeq = 0
  let riEntryId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'rp-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('ri-pieces@example.test', 'ri-pieces')
      ON CONFLICT (email) DO UPDATE SET name = 'ri-pieces' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('ri-pieces', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'rp', name: 'RP', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id

    // The expense this receipt documents: 9.50, same day, in the RI journal.
    const r = await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, '2026-08-10', 'depense', '9.50', 'CARTE CAFE DU COMMERCE', 'known_one_off', 'bare')
      RETURNING id`)
    riEntryId = Number(r.rows[0].id)

    // A decoy at another amount, same window: must never be suggested.
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 2, '2026-08-11', 'depense', '24.00', 'TWINT AUTRE CHOSE', 'known_one_off', 'bare')`)
  })

  it('suggests the RI entry as the candidate: same rappen, three days', async () => {
    const { ingestPiece, candidatesFor } = await import('./queries/pieces')
    const r = await ingestPiece(
      ws,
      entityId,
      { file_id: 'ri-cafe-001', file_name: 'cafe.jpg', md5_checksum: 'cafe9950' },
      CAFE,
      '2026-08-12',
      'test-worker'
    )
    expect(r.created).toBe(true)
    expect(r.validation.passed, 'the café receipt is arithmetically sound').toBe(true)
    pieceSeq = r.piece.seq

    const candidates = await candidatesFor(ws, r.piece)
    expect(candidates.map((c) => c.number), 'the 9.50 dépense, not the 24.00 decoy').toEqual([1])
    expect(candidates[0].status, 'an RI candidate shows its recognition state, having no posting lifecycle').toBe('known_one_off')
  })

  it('matching writes the RI entry piece_* columns, the piece matched_ri_entry_id, and nothing else', async () => {
    const { matchPiece } = await import('./queries/pieces')
    const r = await matchPiece(ws, pieceSeq, 1)
    expect(r.journal).toBe('recettes_depenses')
    expect(r.entryNumber).toBe(1)
    expect(r.piece.status).toBe('matched')
    expect(r.piece.matched_ri_entry_id).toBe(riEntryId)
    expect(r.piece.matched_entry_id, 'the grand livre column stays empty').toBeNull()

    const e = await db.execute(sql`SELECT piece_drive_ref, piece_hash, piece_captured::text AS captured, evidence_tier FROM books.ri_entry WHERE id = ${riEntryId}`)
    expect(e.rows[0].piece_drive_ref).toBe('drive://ri-cafe-001')
    expect(e.rows[0].piece_hash).toBe('md5:cafe9950')
    expect(e.rows[0].captured).toBe('2026-08-12')
    expect(e.rows[0].evidence_tier, 'sufficiency is a human judgment: the tier is untouched').toBe('bare')
  })

  it('a piece matches once, whichever journal it matched into', async () => {
    const { matchPiece, MatchRefused } = await import('./queries/pieces')
    await expect(matchPiece(ws, pieceSeq, 2)).rejects.toThrow(MatchRefused)
  })

  it('records the match in the RI entry history, and refuses to replace the document', async () => {
    const h = await db.execute(sql`SELECT history FROM books.ri_entry WHERE id = ${riEntryId}`)
    const history = h.rows[0].history
    expect(Array.isArray(history), 'the RI journal keeps the same trail').toBe(true)
    expect(history[history.length - 1]).toMatchObject({
      event: 'piece_matched',
      piece: pieceSeq,
      was: { piece_drive_ref: null },
    })

    const { ingestPiece, matchPiece } = await import('./queries/pieces')
    const r = await ingestPiece(ws, entityId, { file_id: 'ri-cafe-003', md5_checksum: 'cafe9952' }, CAFE, '2026-08-12', 'test-worker')
    await expect(matchPiece(ws, r.piece.seq, 1)).rejects.toMatchObject({ code: 'entry_documented' })
    const e = await db.execute(sql`SELECT piece_hash FROM books.ri_entry WHERE id = ${riEntryId}`)
    expect(e.rows[0].piece_hash, 'the first document is still the record').toBe('md5:cafe9950')
  })

  it('refuses an entry number the RI journal does not hold', async () => {
    const { ingestPiece, matchPiece } = await import('./queries/pieces')
    const r = await ingestPiece(
      ws,
      entityId,
      { file_id: 'ri-cafe-002', md5_checksum: 'cafe9951' },
      CAFE,
      '2026-08-12',
      'test-worker'
    )
    await expect(matchPiece(ws, r.piece.seq, 99)).rejects.toThrow(/recettes-dépenses/)
  })

  it("0010's CHECK: a piece can never claim an entry in both journals", async () => {
    // Drizzle wraps the pg error; the constraint's name sits in the cause
    // chain. It must be the CHECK that refuses, not a lucky FK.
    let seen = ''
    try {
      await db.execute(sql`
        UPDATE books.piece_inbox
        SET matched_entry_id = 1
        WHERE workspace_id = ${ws} AND seq = ${pieceSeq}`)
    } catch (e) {
      for (let x = e as { message?: string; cause?: unknown } | undefined; x; x = x.cause as typeof x) {
        seen += x.message ?? ''
      }
    }
    expect(seen, 'the update must be refused by piece_inbox_one_journal_check').toContain('one_journal')
  })
})
