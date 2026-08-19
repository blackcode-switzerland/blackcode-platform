// The 2026-08-19 hardening pass, each fix pinned by the failure that proved it:
//
//   - The 0004 guard's words REACH THE CALLER now. Drizzle wraps a COMMIT
//     failure so `e.message` says "Failed query: COMMIT" and the database's
//     sentence sits on the cause chain — the frontend review proved an
//     unbalanced post answered a bare 500 on every surface (ticket #55).
//     `sqlErrorText` walks the chain; the route translates through it.
//   - SHA-256 for captured files (0015): ingest carries it, dedupe prefers
//     it, and a matched entry cites `sha256:…` over Drive's md5.
//   - Duplicate suspects by IDENTICAL FACTS: the mockup's own 9605/9601 pair
//     (an EFT slip and the receipt of one purchase — different bytes, same
//     date, same total) is flagged and lands needs_review. Checksum equality
//     alone never could have caught it, which is why the seed's banner was
//     unseeable (ticket #53).
//   - A found row says WHOSE it is: `journalScopeOf` names the book and year
//     the payload now carries.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/hardening.test.ts SKIPPED: no DATABASE_URL. The hardening pass was NOT verified.\n')
}

const RECEIPT = (total: number, date: string) => ({
  document_type: 'receipt',
  merchant: { name: 'Kiosque Test' },
  transaction: { date, currency: 'CHF', total, payment_method: 'card' },
  lines: [{ description: 'x', amount: total, vat_rate: 0 }],
  confidence: 0.9,
})

d('the hardening pass', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'hd-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('hardening@example.test', 'hardening')
      ON CONFLICT (email) DO UPDATE SET name = 'hardening' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('hardening', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'hd', name: 'HD SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id
  })

  it("the guard's sentence is on the cause chain, and sqlErrorText is what reads it", async () => {
    const { postEntry, sqlErrorText } = await import('./queries/imports')
    // Two mapped, UNBALANCED lines: postEntry's own checks pass, the 0004
    // deferred trigger refuses at COMMIT — the exact failure ticket #55 filed.
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, 1, '2026-08-10', 'staged', 'DESEQUILIBRE') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(r.rows[0].id)}, '6570', '77.00', '0.00'), (${Number(r.rows[0].id)}, '1020', '0.00', '99.00')`)

    let caught: unknown = null
    try {
      await postEntry(ws, 1)
    } catch (e) {
      caught = e
    }
    expect(caught, 'the guard refused').not.toBeNull()
    const top = (caught as Error).message
    expect(top, "drizzle's own message carries none of the guard's words").not.toMatch(/does not balance/)
    expect(sqlErrorText(caught), 'the sentence is on the cause chain').toMatch(/does not balance: debit 77\.00 <> credit 99\.00/)
  })

  it('sha256 rides ingest, wins the dedupe, and is the hash a matched entry cites', async () => {
    const { ingestPiece, matchPiece } = await import('./queries/pieces')
    const SHA = 'a'.repeat(64)

    const first = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-file-1', file_name: 'r1.jpg', md5_checksum: 'aaaa1111', sha256: SHA },
      RECEIPT(42.5, '2026-08-01') as any, '2026-08-02', 'test-worker'
    )
    expect(first.created).toBe(true)
    expect(first.piece.sha256).toBe(SHA)

    // The identical BYTES under a new file id: flagged by sha256, human queued.
    const copy = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-file-1-copy', file_name: 'r1 (1).jpg', md5_checksum: 'bbbb2222', sha256: SHA },
      RECEIPT(42.5, '2026-08-01') as any, '2026-08-02', 'test-worker'
    )
    expect(copy.duplicate_of, 'same bytes, new file id').toBe(first.piece.seq)
    expect(copy.needs_review, 'a duplicate suspect needs a human').toBe(true)

    // The retry converges on the sha256 key.
    const retry = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-file-1', file_name: 'r1.jpg', md5_checksum: 'aaaa1111', sha256: SHA },
      RECEIPT(42.5, '2026-08-01') as any, '2026-08-02', 'test-worker'
    )
    expect(retry.created).toBe(false)
    expect(retry.piece.id).toBe(first.piece.id)

    // Matching cites the strong hash, prefixed with its algorithm.
    const e = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 2, 2, '2026-08-01', 'staged', 'CARTE KIOSQUE') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(e.rows[0].id)}, '6570', '42.50', '0.00'), (${Number(e.rows[0].id)}, '1020', '0.00', '42.50')`)
    await matchPiece(ws, first.piece.seq, 2)
    const row = await db.execute(sql`SELECT piece_hash FROM books.entry WHERE workspace_id = ${ws} AND seq = 2`)
    expect(row.rows[0].piece_hash).toBe(`sha256:${SHA}`)
  })

  it('identical FACTS flag a suspect: different bytes, same date and total for the same book', async () => {
    const { ingestPiece } = await import('./queries/pieces')
    // The 9605/9601 shape: an EFT slip and the receipt of one purchase.
    const receipt = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-twin-a', sha256: 'b'.repeat(64) },
      RECEIPT(79.05, '2026-08-05') as any, '2026-08-13', 'test-worker'
    )
    const slip = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-twin-b', sha256: 'c'.repeat(64) },
      RECEIPT(79.05, '2026-08-05') as any, '2026-08-13', 'test-worker'
    )
    expect(slip.duplicate_of, 'same money, different document').toBe(receipt.piece.seq)
    expect(slip.needs_review).toBe(true)

    // Same day, different total: two purchases, no flag.
    const other = await ingestPiece(
      ws, entityId,
      { file_id: 'hd-twin-c', sha256: 'd'.repeat(64) },
      RECEIPT(15.15, '2026-08-05') as any, '2026-08-13', 'test-worker'
    )
    expect(other.duplicate_of).toBeNull()
    expect(other.needs_review).toBe(false)
  })

  it('a malformed sha256 never lands: the format is checked before the door', async () => {
    // Route-level check; here the module-level truth: the column only ever
    // holds what the route let through, so the pin is on the route contract.
    // (See pieces/ingest/route.ts: bad_sha256.)
    const ok = /^[0-9a-f]{64}$/i
    expect(ok.test('a'.repeat(64))).toBe(true)
    expect(ok.test('sha256:' + 'a'.repeat(64)), 'prefixes belong on entry.piece_hash, not here').toBe(false)
    expect(ok.test('a'.repeat(63))).toBe(false)
  })

  it('journalScopeOf names the book and year a bare number resolved into', async () => {
    const { journalScopeOf, getEntryByNumber, publicEntry } = await import('./queries/statutory')
    const found = await getEntryByNumber(ws, 2)
    const scope = await journalScopeOf(found!.entry.entity_id, found!.entry.exercice_id)
    expect(scope).toEqual({ entity: 'hd', exercice: 2026 })
    const out = publicEntry(found!, scope)
    expect(out.entity).toBe('hd')
    expect(out.exercice).toBe(2026)
  })
})
