// Phase 4A's second slice against the real database:
//
//   RI RESOLVE   the gap phase 2 left — worklist rows a nothing could resolve.
//                Same doctrine: history first, account refused with words
//                (an RI entry has no lines), rules key to the row's source.
//   DECLARE      money no feed will deliver: lands STAGED, provenance in
//                history, both accounts required for double-entry (no caisse),
//                direction required for RI.
//   SOURCE WRITES  register upkeep for the Companion: create, edit, record a
//                pull (idempotent on file, last_import moves), set a runbook —
//                which REFUSES anything that is not a credential reference.

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
  console.warn('\n  lib/db/phase4a-writes.test.ts SKIPPED: no DATABASE_URL. RI resolve, declare and source writes were NOT verified.\n')
}

d('phase 4A writes', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let saEntity = 0
  let riEntity = 0
  let riSourceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'p4-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('phase4a@example.test', 'phase4a')
      ON CONFLICT (email) DO UPDATE SET name = 'phase4a' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('phase4a-writes', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const sa = await createEntity(ws, { slug: 'p4-sa', name: 'P4 SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    saEntity = sa.id
    await createExercice(ws, { entityId: saEntity, year: 2026 })
    const ri = await createEntity(ws, { slug: 'p4-ri', name: 'P4 RI', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    riEntity = ri.id
    const riX = await createExercice(ws, { entityId: riEntity, year: 2026 })

    // An imported-style RI row: knows its source (0012), unrecognized.
    const src = await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type)
      VALUES (${ws}, ${riEntity}, 1, 'Compte privé', 'bank') RETURNING id`)
    riSourceId = Number(src.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier, source_id, bank_ref)
      VALUES (${ws}, ${riEntity}, ${riX.id}, 1, '2026-08-05', 'depense', '1200.00', 'LOYER STUDIO GENEVE', 'unrecognized', 'bare', ${riSourceId}, 'RI-REF-1')`)
  })

  it('resolves an RI entry: history first, rule keyed to the row source', async () => {
    const { resolveRiEntry } = await import('./queries/resolve')
    const r = await resolveRiEntry(ws, riEntity, 1, {
      explanation: { en: 'Studio rent, August' },
      counterparty: 'Régie du Lac',
      rule: { counterparty: 'LOYER STUDIO', amount_chf: 1200, tolerance_chf: 0, interval: 'monthly' },
    })
    expect(r.entry.recognition, 'a taught rule concludes known_recurring').toBe('known_recurring')
    expect(r.taughtRuleSeq).not.toBeNull()
    expect(Array.isArray(r.entry.history)).toBe(true)
    expect((r.entry.history as any[])[0].was.recognition, 'the row remembers being unrecognized').toBe('unrecognized')

    const rule = await db.execute(sql`
      SELECT source_id FROM books.rule WHERE workspace_id = ${ws} AND entity_id = ${riEntity}`)
    expect(Number(rule.rows[0].source_id), 'the pair doctrine reaches RI books now').toBe(riSourceId)
  })

  it('refuses --account on an RI entry with words, not silence', async () => {
    const { resolveRiEntry, ResolveRefused } = await import('./queries/resolve')
    await expect(
      resolveRiEntry(ws, riEntity, 1, { explanation: { en: 'x' }, account: '6000' })
    ).rejects.toThrow(ResolveRefused)
    await expect(
      resolveRiEntry(ws, riEntity, 1, { explanation: { en: 'x' }, account: '6000' })
    ).rejects.toThrow(/no lines/)
  })

  it('declares a cash expense into a double-entry book: staged, both sides, provenance', async () => {
    const { declareEntry } = await import('./queries/declare')
    const r = await declareEntry(ws, {
      entitySlug: 'p4-sa',
      date: '2026-08-18',
      amount: '20.00',
      label: 'Timbres, paiement comptant',
      explanation: { en: 'Stamps, paid cash by the owner' },
      account: '6500',
      contra: '2800',
      declaredBy: 'phase4a@example.test',
    })
    expect(r.journal).toBe('grand_livre')
    expect(r.entry_no).toBe(1)

    const row = await db.execute(sql`
      SELECT e.status, e.recognition, e.bank_ref, e.history FROM books.entry e
      WHERE e.workspace_id = ${ws} AND e.seq = ${r.number}`)
    expect(row.rows[0].status, 'declared money still passes the posting gate').toBe('staged')
    expect(row.rows[0].recognition, 'the declarer IS the explanation').toBe('known_one_off')
    expect(row.rows[0].bank_ref, 'no feed delivered this, honestly').toBeNull()
    expect(row.rows[0].history[0].event).toBe('declared')

    const { postEntry } = await import('./queries/imports')
    const posted = await postEntry(ws, r.number)
    expect(posted.status).toBe('posted')
  })

  it('refuses a double-entry declaration missing its sides, and an RI one missing direction', async () => {
    const { declareEntry, DeclareRefused } = await import('./queries/declare')
    await expect(
      declareEntry(ws, {
        entitySlug: 'p4-sa', date: '2026-08-18', amount: '10.00', label: 'X',
        explanation: { en: 'x' }, declaredBy: 't',
      })
    ).rejects.toThrow(DeclareRefused)
    await expect(
      declareEntry(ws, {
        entitySlug: 'p4-ri', date: '2026-08-18', amount: '10.00', label: 'X',
        explanation: { en: 'x' }, declaredBy: 't',
      })
    ).rejects.toThrow(/direction/)
  })

  it('declares into the RI journal with a direction', async () => {
    const { declareEntry } = await import('./queries/declare')
    const r = await declareEntry(ws, {
      entitySlug: 'p4-ri', date: '2026-08-18', amount: '35.00', label: 'Marché, comptant',
      explanation: { en: 'Market groceries for the workshop, cash' },
      direction: 'depense', declaredBy: 'phase4a@example.test',
    })
    expect(r.journal).toBe('recettes_depenses')
    const row = await db.execute(sql`
      SELECT direction, amount FROM books.ri_entry WHERE workspace_id = ${ws} AND seq = ${r.number}`)
    expect(row.rows[0]).toMatchObject({ direction: 'depense', amount: '35.00' })
  })

  it('creates and edits a source; records a pull idempotently; last_import moves', async () => {
    const { createSource, updateSource, recordPull } = await import('./queries/sources')
    const s = await createSource(ws, {
      entitySlug: 'p4-sa', name: 'Stripe payout reports', type: 'stripe', expected: 'monthly',
    })
    expect(s.seq, 'seq continues past the seeded source').toBe(2)

    const one = await recordPull(ws, s.seq, { file: 'stripe-2026-07.csv', format: 'csv', hash: 'sha256:abc', pulled: '2026-08-02' })
    expect(one.created).toBe(true)
    const again = await recordPull(ws, s.seq, { file: 'stripe-2026-07.csv', format: 'csv' })
    expect(again.created, 'the first delivery is the record').toBe(false)

    const src = await db.execute(sql`SELECT last_import::text AS li FROM books.source WHERE id = ${s.id}`)
    expect(src.rows[0].li).toBe('2026-08-02')

    const edited = await updateSource(ws, s.seq, { expected: 'weekly', retired: false })
    expect(edited.expected).toBe('weekly')
  })

  it('sets a runbook once per source, and refuses a secret where a reference belongs', async () => {
    const { setRunbook, SourceRefused } = await import('./queries/sources')
    const r = await setRunbook(ws, 1, {
      version: '1.1',
      loginUrl: 'https://ebanking.example.ch',
      credentialRef: 'vault://books/p4-ri/bank',
      steps: ['Log in', 'Export camt.053 for the period', 'Hash immediately'],
      output: 'camt.053 XML',
    })
    expect(r.version).toBe('1.1')

    const updated = await setRunbook(ws, 1, { version: '1.2', credentialRef: 'vault://books/p4-ri/bank' })
    expect(updated.version, 'versioned in place, one runbook per source').toBe('1.2')

    await expect(
      setRunbook(ws, 1, { credentialRef: 'hunter2-superSecret!' })
    ).rejects.toThrow(SourceRefused)
    await expect(
      setRunbook(ws, 1, { credentialRef: 'hunter2-superSecret!' })
    ).rejects.toThrow(/never a credential/)
  })
})
