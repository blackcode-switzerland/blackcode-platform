// The bank door against the real database — phase 4A's acceptance criteria.
//
//   1. A golden statement lands whole: every booked line staged in the right
//      journal, the bank side filled, the other side honestly NULL.
//   2. Rules fire at arrival: a clean hit is `inferred`, never resolved.
//   3. The fx story writes itself when the bank converted (0011's writer).
//   4. Idempotent per line on the bank's reference: re-imports and
//      overlapping statements converge, never duplicate.
//   5. A file that does not reconcile against itself is refused WHOLE.
//   6. An RI book's lines land in ITS journal with directions mapped.
//   7. Posting: staged -> posted after resolve; the guard refuses unmapped
//      lines; a retry is a no-op, not an error.
//
// Isolation by unique workspace slug, nothing deleted — the house discipline.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOLDEN, GOLDEN_OVERLAP, GOLDEN_TRUNCATED } from '../import/golden-camt053'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/imports.test.ts SKIPPED: no DATABASE_URL. The bank door was NOT verified.\n')
}

d('the bank import door', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let saEntity = 0
  let saExercice = 0
  let saSourceId = 0
  let riEntity = 0
  let riSourceSeq = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'bi-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('bank-import@example.test', 'bank-import')
      ON CONFLICT (email) DO UPDATE SET name = 'bank-import' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('bank-import', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const sa = await createEntity(ws, { slug: 'bi-sa', name: 'BI SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    saEntity = sa.id
    saExercice = (await createExercice(ws, { entityId: saEntity, year: 2026 })).id

    const ri = await createEntity(ws, { slug: 'bi-ri', name: 'BI RI', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    riEntity = ri.id
    await createExercice(ws, { entityId: riEntity, year: 2026 })

    // The SA book's bank feed, and the RI book's — the door needs to know
    // which account the feed IS (for the SA) and which book it belongs to.
    const s1 = await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type, ledger_accounts)
      VALUES (${ws}, ${saEntity}, 1, 'BCV camt.053', 'bank', ARRAY['1020']) RETURNING id`)
    saSourceId = Number(s1.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type, ledger_accounts)
      VALUES (${ws}, ${riEntity}, 2, 'Compte privé camt.053', 'bank', ARRAY[]::varchar[])`)
    riSourceSeq = 2

    // A rule that should FIRE at arrival: rent, keyed to THIS source (the
    // pair doctrine), exact amount.
    await db.execute(sql`
      INSERT INTO books.rule (workspace_id, entity_id, seq, source_id, active, pattern, account_no, learned_from)
      VALUES (${ws}, ${saEntity}, 1, ${saSourceId}, true,
              '{"counterparty": "LOYER", "amount_chf": 1800, "tolerance_chf": 0, "interval": "monthly"}'::jsonb,
              '6000', 'contract')`)

    // Pre-existing history, seed-style: one manual entry at seq 1 — the
    // counter must continue PAST it, not collide with it.
    const e = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${saEntity}, ${saExercice}, 1, 1, '2026-01-05', 'staged', 'LIBERATION CAPITAL', 'known_one_off', 'full') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit, position)
      VALUES (${Number(e.rows[0].id)}, '1020', 20000, 0, 1), (${Number(e.rows[0].id)}, '2800', 0, 20000, 2)`)
    await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${Number(e.rows[0].id)}`)
  })

  it('lands the golden statement whole, rules and fx firing at arrival', async () => {
    const { importCamt } = await import('./queries/imports')
    const r = await importCamt(ws, 1, 'golden.camt053.xml', GOLDEN, 'cafe'.repeat(16))

    expect(r.journal).toBe('grand_livre')
    expect(r.lines_total, 'four booked; the pending one is not a fact').toBe(4)
    expect(r.imported).toBe(4)
    expect(r.inferred, 'the rent rule fired at arrival').toBe(1)
    expect(r.unrecognized).toBe(3)
    expect(r.already_known).toBe(0)
    expect(r.with_fx).toBe(1)
    expect(r.staged, 'seq continues past the seeded entry').toEqual([2, 3, 4, 5])

    const rent = await db.execute(sql`
      SELECT recognition, matched_rule_id, bank_ref FROM books.entry
      WHERE workspace_id = ${ws} AND raw_label = 'LOYER AOUT REGIE DUBOIS'`)
    expect(rent.rows[0].recognition, 'inferred, never resolved by a machine').toBe('inferred')
    expect(rent.rows[0].matched_rule_id).not.toBeNull()
    expect(rent.rows[0].bank_ref).toBe('ASR-2026-0805-102')

    const hetzner = await db.execute(sql`
      SELECT fx FROM books.entry WHERE workspace_id = ${ws} AND raw_label LIKE 'HETZNER%'`)
    expect(hetzner.rows[0].fx).toEqual({ original: 'EUR 420.00', rate: '0.9494', source: 'camt.053' })

    // The credit's bank side is a DEBIT on 1020; the open side is NULL.
    const nova = await db.execute(sql`
      SELECT l.account_no, l.debit, l.credit FROM books.entry e
      JOIN books.entry_line l ON l.entry_id = e.id
      WHERE e.workspace_id = ${ws} AND e.raw_label LIKE 'VIREMENT NOVA%' ORDER BY l.position`)
    expect(nova.rows[0]).toMatchObject({ account_no: '1020', debit: '5000.00', credit: '0.00' })
    expect(nova.rows[1].account_no).toBeNull()

    const pull = await db.execute(sql`
      SELECT count(*) AS n FROM books.source_pull WHERE source_id = ${saSourceId}`)
    expect(Number(pull.rows[0].n)).toBe(1)
  })

  it('re-importing the same file converges: nothing lands twice', async () => {
    const { importCamt } = await import('./queries/imports')
    const r = await importCamt(ws, 1, 'golden.camt053.xml', GOLDEN, 'cafe'.repeat(16))
    expect(r.imported).toBe(0)
    expect(r.already_known).toBe(4)
    const n = await db.execute(sql`SELECT count(*) AS n FROM books.entry WHERE workspace_id = ${ws}`)
    expect(Number(n.rows[0].n), '1 seeded + 4 imported, still').toBe(5)
  })

  it('an overlapping statement adds only what is new', async () => {
    const { importCamt } = await import('./queries/imports')
    const r = await importCamt(ws, 1, 'golden-overlap.camt053.xml', GOLDEN_OVERLAP, 'beef'.repeat(16))
    expect(r.lines_total).toBe(3)
    expect(r.already_known, 'NR-003 and NR-004 converged').toBe(2)
    expect(r.imported, 'only SWISSCOM is new').toBe(1)
  })

  it('refuses a file that does not reconcile, and nothing lands', async () => {
    const { importCamt, ImportRefused } = await import('./queries/imports')
    const before = await db.execute(sql`SELECT count(*) AS n FROM books.entry WHERE workspace_id = ${ws}`)
    await expect(importCamt(ws, 1, 'truncated.xml', GOLDEN_TRUNCATED, 'dead'.repeat(16))).rejects.toThrow(ImportRefused)
    const after = await db.execute(sql`SELECT count(*) AS n FROM books.entry WHERE workspace_id = ${ws}`)
    expect(after.rows[0].n).toEqual(before.rows[0].n)
  })

  it('refuses lines booked outside an open exercice, naming each one', async () => {
    const { importCamt, ImportRefused } = await import('./queries/imports')
    const in2027 = GOLDEN.replace('<Dt>2026-08-12</Dt>', '<Dt>2027-08-12</Dt>')
    try {
      await importCamt(ws, 1, 'wrong-year.xml', in2027, 'feed'.repeat(16))
      expect.unreachable('the import must refuse')
    } catch (e) {
      expect(e).toBeInstanceOf(ImportRefused)
      const r = e as InstanceType<typeof ImportRefused>
      expect(r.code).toBe('no_open_exercice')
      expect(r.problems.some((p) => p.includes('no exercice 2027')), 'the offending line is named').toBe(true)
    }
  })

  it("an RI book's lines land in ITS journal, directions mapped", async () => {
    const { importCamt } = await import('./queries/imports')
    const r = await importCamt(ws, riSourceSeq, 'golden-ri.camt053.xml', GOLDEN, 'face'.repeat(16))
    expect(r.journal).toBe('recettes_depenses')
    expect(r.imported).toBe(4)

    const rows = await db.execute(sql`
      SELECT direction, amount, bank_ref, fx IS NOT NULL AS has_fx FROM books.ri_entry
      WHERE workspace_id = ${ws} AND entity_id = ${riEntity} ORDER BY seq`)
    expect(rows.rows[0]).toMatchObject({ direction: 'recette', amount: '5000.00' })
    expect(rows.rows[1]).toMatchObject({ direction: 'depense', amount: '1800.00' })
    expect(rows.rows[2].has_fx).toBe(true)
  })

  it('posting: refused unmapped, allowed after resolve, idempotent on retry', async () => {
    const { postEntry, PostRefused } = await import('./queries/imports')

    // The imported coffee entry: staged, open side NULL.
    const coffee = await db.execute(sql`
      SELECT seq FROM books.entry WHERE workspace_id = ${ws} AND raw_label LIKE 'CARTE CAFE%'`)
    const seq = Number(coffee.rows[0].seq)

    await expect(postEntry(ws, seq)).rejects.toThrow(PostRefused)
    await expect(postEntry(ws, seq)).rejects.toThrow(/no account/)

    const { resolveEntry } = await import('./queries/resolve')
    await resolveEntry(ws, seq, {
      explanation: { en: 'Team coffee, client meeting' },
      recognition: 'known_one_off',
      account: '6570',
    })

    const posted = await postEntry(ws, seq)
    expect(posted.already).toBe(false)
    expect(posted.status).toBe('posted')

    const again = await postEntry(ws, seq)
    expect(again.already, 'a retry is not an error').toBe(true)
  })
})
