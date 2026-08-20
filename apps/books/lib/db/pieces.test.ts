// The pièces pipeline against the real database — phase 3's acceptance
// criteria, each as a test.
//
//   1. A real extraction lands STAGED in the inbox and shows on the worklist.
//   2. Posting the same file twice creates one row.
//   3. A tampered payload fails server validation even though the worker's own
//      embedded verdict says it passed.
//   4. Balances are unchanged by anything in this phase.
//
// Plus the two rules that are easy to lose in a rewrite: duplicates are
// flagged and never dropped, and matching writes the ENTRY's interpretation
// columns without touching its evidence tier.
//
// Isolation by unique workspace slug, nothing deleted, no trigger toggling —
// guards.test.ts's discipline, for its measured reason.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fixture from '../../fixtures/mockup.json'
import type { Extraction } from '../validate/extraction'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/pieces.test.ts SKIPPED: no DATABASE_URL. The ingest pipeline was NOT verified.\n')
}

interface FxPiece {
  received: string
  source: { file_id: string; file_name?: string; md5_checksum?: string; web_view_link?: string }
  extraction: Record<string, unknown> & { tx: Record<string, unknown>; validation: { passed: boolean } }
}
const REAL = (fixture as unknown as { PIECE_INBOX: FxPiece[] }).PIECE_INBOX[0] // Philfruits, 79.05

const payload = (): { source: FxPiece['source']; x: Extraction } => ({
  // Own file id per test workspace so the seeded copy's idempotency row is
  // never the one this file collides with.
  source: { ...REAL.source, file_id: 'test-' + REAL.source.file_id, md5_checksum: 'cafe0123' },
  x: { ...(REAL.extraction as object), transaction: REAL.extraction.tx } as unknown as Extraction,
})

d('the pièces pipeline', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0
  let entrySeq = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'pz-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('pieces@example.test', 'pieces')
      ON CONFLICT (email) DO UPDATE SET name = 'pieces' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('pieces-pipeline', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'pz', name: 'Pz SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id

    // A drive_folder source, so ingest has a manifest to keep.
    await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type)
      VALUES (${ws}, ${entityId}, 1, 'Drive inbox', 'drive_folder')`)

    // The transaction this receipt could document: card debit, 79.05, in
    // window. Posted, so the match test also proves interpretation stays open.
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, 1, '2026-08-05', 'staged', 'CARTE PHILFRUITS BOVERNIER') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(r.rows[0].id)}, '6000', 79.05, 0), (${Number(r.rows[0].id)}, '1020', 0, 79.05)`)
    await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${Number(r.rows[0].id)}`)
    entrySeq = 1
  })

  it('lands a real extraction staged, and the worklist lists it with its candidate', async () => {
    const { ingestPiece } = await import('./queries/pieces')
    const { getWorklist } = await import('./queries/worklist')
    const { source, x } = payload()

    const r = await ingestPiece(ws, entityId, source, x, REAL.received, 'test-worker')
    expect(r.created).toBe(true)
    expect(r.piece.status, 'rule 1: always staged').toBe('staged')
    expect(r.validation.passed, 'the Philfruits receipt is genuine').toBe(true)
    expect(r.needs_review).toBe(false)

    const wl = await getWorklist(entityId, exerciceId)
    const row = wl.find((w) => w.kind === 'piece' && w.number === r.piece.seq)
    expect(row, 'the piece sits on the worklist, not in a second queue').toBeTruthy()
    expect(row!.amount).toBe('79.05')
    expect(row!.suggested_entries, 'same rappen, three days: the candidate is found').toEqual([entrySeq])
  })

  it('creates one row however many times the worker retries', async () => {
    const { ingestPiece } = await import('./queries/pieces')
    const { source, x } = payload()
    const before = await db.execute(sql`SELECT count(*)::int AS n FROM books.piece_inbox WHERE workspace_id = ${ws}`)
    const r = await ingestPiece(ws, entityId, source, x, REAL.received, 'test-worker')
    expect(r.created, 'the retry converged on the existing row').toBe(false)
    const after = await db.execute(sql`SELECT count(*)::int AS n FROM books.piece_inbox WHERE workspace_id = ${ws}`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('catches a tampered total the worker swore was fine, and stages it for review', async () => {
    const { ingestPiece } = await import('./queries/pieces')
    const { source, x } = payload()
    const tampered = {
      ...x,
      transaction: { ...x.transaction, total: 790.5 },
    } as Extraction
    expect((REAL.extraction.validation as { passed: boolean }).passed, "the worker's embedded claim").toBe(true)

    const r = await ingestPiece(ws, entityId, { ...source, file_id: 'test-tampered', md5_checksum: 'dead0456' }, tampered, REAL.received, 'test-worker')
    expect(r.validation.passed, 'the server recomputed and disagreed').toBe(false)
    expect(r.needs_review).toBe(true)
    expect(r.created, 'flagged, never dropped: the document still landed').toBe(true)
    expect(r.piece.status).toBe('staged')
  })

  it('flags the same checksum under a new file id instead of dropping it', async () => {
    const { ingestPiece } = await import('./queries/pieces')
    const { source, x } = payload()
    const rescan = await ingestPiece(ws, entityId, { ...source, file_id: 'test-rescan-of-' + source.file_id }, x, REAL.received, 'test-worker')
    expect(rescan.created, 'a different file id is a new document').toBe(true)
    expect(rescan.duplicate_of, 'pointing at the piece it duplicates').not.toBeNull()
    expect(rescan.piece.duplicate_of_id).not.toBeNull()
  })

  it('changes no balance whatever arrives', async () => {
    const { getBilan } = await import('./queries/statutory')
    const { ingestPiece } = await import('./queries/pieces')
    const before = await getBilan(entityId, exerciceId)
    const { source, x } = payload()
    await ingestPiece(ws, entityId, { ...source, file_id: 'test-balance-probe', md5_checksum: 'beef0789' }, x, REAL.received, 'test-worker')
    const after = await getBilan(entityId, exerciceId)
    expect(after.totalActif).toBe(before.totalActif)
    expect(after.totalPassif).toBe(before.totalPassif)
    expect(after.resultat).toBe(before.resultat)
  })

  it('matches a piece to a POSTED entry: piece fields set, tier untouched, manifest ingested', async () => {
    const { matchPiece } = await import('./queries/pieces')
    const { getWorklist } = await import('./queries/worklist')

    const first = await db.execute(sql`
      SELECT seq, drive_file_id FROM books.piece_inbox
      WHERE workspace_id = ${ws} AND drive_file_id = ${'test-' + REAL.source.file_id}`)
    const pieceSeq = Number(first.rows[0].seq)

    const tierBefore = await db.execute(sql`SELECT evidence_tier FROM books.entry WHERE workspace_id = ${ws} AND seq = ${entrySeq}`)
    const r = await matchPiece(ws, pieceSeq, entrySeq)
    expect(r.piece.status).toBe('matched')

    const e = await db.execute(sql`
      SELECT piece_drive_ref, piece_hash, piece_captured, evidence_tier
      FROM books.entry WHERE workspace_id = ${ws} AND seq = ${entrySeq}`)
    expect(e.rows[0].piece_drive_ref, 'the human-clickable reference').toContain(REAL.source.file_id)
    expect(e.rows[0].piece_hash).toBe('md5:cafe0123')
    expect(String(e.rows[0].piece_captured)).toContain(REAL.received)
    expect(e.rows[0].evidence_tier, 'sufficiency is a judgment; the tier did not move').toBe(tierBefore.rows[0].evidence_tier)

    const m = await db.execute(sql`
      SELECT state FROM books.drive_manifest WHERE workspace_id = ${ws} AND file_id = ${'test-' + REAL.source.file_id}`)
    expect(m.rows[0].state).toBe('ingested')

    const wl = await getWorklist(entityId, exerciceId)
    expect(wl.find((w) => w.kind === 'piece' && w.number === pieceSeq), 'a matched piece has left the worklist').toBeUndefined()

    await expect(matchPiece(ws, pieceSeq, entrySeq)).rejects.toMatchObject({ code: 'already_matched' })
  })

  it('records the match in the entry history: which piece, when, what was there before', async () => {
    const p = await db.execute(sql`
      SELECT seq FROM books.piece_inbox
      WHERE workspace_id = ${ws} AND drive_file_id = ${'test-' + REAL.source.file_id}`)
    const h = await db.execute(sql`SELECT history FROM books.entry WHERE workspace_id = ${ws} AND seq = ${entrySeq}`)
    const history = h.rows[0].history
    expect(Array.isArray(history), 'an append-only trail, like resolve keeps').toBe(true)
    const ev = history[history.length - 1]
    expect(ev.event).toBe('piece_matched')
    expect(ev.piece, 'the piece that documents it, by workspace number').toBe(Number(p.rows[0].seq))
    expect(ev.was.piece_drive_ref, 'there was nothing there before: the history proves it').toBeNull()
  })

  it("refuses another book's entry: the number resolves, the boundary does not", async () => {
    // The review's repro: a second legal entity in the SAME workspace, whose
    // posted entry already carries full evidence. `seq` is workspace-unique,
    // so #2 resolves from entity A's piece — and must be refused, not reached.
    const { matchPiece } = await import('./queries/pieces')
    const { createEntity, createExercice } = await import('./queries/statutory')
    const b = await createEntity(ws, { slug: 'pz-b', name: 'Pz-B SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    const xb = await createExercice(ws, { entityId: b.id, year: 2026 })
    const eb = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label,
                               piece_drive_ref, piece_hash, evidence_tier)
      VALUES (${ws}, ${b.id}, ${xb.id}, 2, 1, '2026-08-05', 'staged', 'VIREMENT AIOS',
              'https://drive.google.com/file/d/aios-proof', 'sha256:aios0deadbeef', 'full') RETURNING id`)
    // 3400, not 3200: this book was created through `createEntity`, so its
    // chart is the PME template, and 0016's `trg_line_account_in_chart` refuses
    // a line naming an account the book does not carry. The account was never
    // the point of this test — the entity boundary is.
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(eb.rows[0].id)}, '1020', 12000, 0), (${Number(eb.rows[0].id)}, '3400', 0, 12000)`)
    await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${Number(eb.rows[0].id)}`)

    const p = await db.execute(sql`
      SELECT seq FROM books.piece_inbox
      WHERE workspace_id = ${ws} AND drive_file_id = ${'test-rescan-of-test-' + REAL.source.file_id}`)
    const rescanSeq = Number(p.rows[0].seq)

    await expect(matchPiece(ws, rescanSeq, 2)).rejects.toMatchObject({ code: 'entry_other_book' })

    const e = await db.execute(sql`
      SELECT piece_drive_ref, piece_hash, evidence_tier, history FROM books.entry WHERE workspace_id = ${ws} AND seq = 2`)
    expect(e.rows[0].piece_hash, "the other book's proof is exactly as it was").toBe('sha256:aios0deadbeef')
    expect(e.rows[0].piece_drive_ref).toBe('https://drive.google.com/file/d/aios-proof')
    expect(e.rows[0].history, 'nothing happened, so nothing is recorded').toBeNull()
    const st = await db.execute(sql`SELECT status FROM books.piece_inbox WHERE workspace_id = ${ws} AND seq = ${rescanSeq}`)
    expect(st.rows[0].status, 'the piece never left the inbox').toBe('staged')
  })

  it('refuses to replace evidence an entry already carries', async () => {
    // Entry 1 was documented two tests ago; the tampered piece is still staged.
    const { matchPiece } = await import('./queries/pieces')
    const p = await db.execute(sql`
      SELECT seq FROM books.piece_inbox WHERE workspace_id = ${ws} AND drive_file_id = 'test-tampered'`)
    await expect(matchPiece(ws, Number(p.rows[0].seq), entrySeq)).rejects.toMatchObject({ code: 'entry_documented' })
    const e = await db.execute(sql`SELECT piece_hash FROM books.entry WHERE workspace_id = ${ws} AND seq = ${entrySeq}`)
    expect(e.rows[0].piece_hash, 'the first document is still the record').toBe('md5:cafe0123')
  })

  it('an unattributed piece may match the grand livre, and the match is the attribution', async () => {
    const { ingestPiece, matchPiece } = await import('./queries/pieces')
    const { source, x } = payload()
    const r = await ingestPiece(ws, null, { ...source, file_id: 'test-unattributed', md5_checksum: 'f00d1122' }, x, REAL.received, 'test-worker')
    expect(r.piece.entity_id, 'nobody has said whose it is').toBeNull()

    await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 3, 2, '2026-08-05', 'staged', 'CARTE PHILFRUITS ENCORE')`)

    const m = await matchPiece(ws, r.piece.seq, 3)
    expect(m.piece.status).toBe('matched')
    expect(m.piece.entity_id, 'saying which entry it documents says whose it is').toBe(entityId)
  })
})
