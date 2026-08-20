// Andrea's rule, ticket #59: an own-account transfer is logged but neutral.
//
// "If a transaction is made from the account of the same person (from my bank 1
// to my bank 2) for personal expense it's logged but still neutral" — her words,
// 2026-08-18, answering the phase 2 questions. Two halves, both here:
//
//   THE VOCABULARY   migration 0009 admits direction = 'neutral'
//   THE ARITHMETIC   riTotals counts a neutral row in NEITHER total
//
// The arithmetic half is the dangerous one: riTotals' else-branch used to file
// anything non-recette under dépenses, so the day the first neutral row landed,
// her bank-1-to-bank-2 transfer would have become an EXPENSE — quietly, on a
// statement. The pure tests below would have caught that version.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { riTotals } from '../derive'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

describe('riTotals with neutral rows (pure)', () => {
  const rows = [
    { direction: 'recette', amount: '1000.00' },
    { direction: 'depense', amount: '400.00' },
    // The transfer: real money moved between her own accounts.
    { direction: 'neutral', amount: '5000.00' },
  ]

  it('counts a neutral row in neither total', () => {
    const t = riTotals(rows)
    expect(t.recettes).toBe('1000.00')
    expect(t.depenses, 'the 5000 transfer must NOT be an expense').toBe('400.00')
    expect(t.resultat).toBe('600.00')
  })

  it('would have failed the old else-branch (the regression pin)', () => {
    // With only a neutral row, both totals are zero. The old code returned
    // depenses 5000.00 here.
    const t = riTotals([{ direction: 'neutral', amount: '5000.00' }])
    expect(t.depenses).toBe('0.00')
    expect(t.recettes).toBe('0.00')
    expect(t.resultat).toBe('0.00')
  })

  it('files an unknown direction nowhere, loudly rather than under dépenses', () => {
    const t = riTotals([{ direction: 'transfert', amount: '99.00' }])
    expect(t.depenses, 'a vocabulary riTotals has not heard of must not become an expense').toBe('0.00')
  })
})

d('the vocabulary in the database', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'nt-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('neutral@example.test', 'neutral')
      ON CONFLICT (email) DO UPDATE SET name = 'neutral' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('neutral-transfers', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)
    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'nt', name: 'NT', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id
  })

  it('accepts neutral and still refuses anything else', async () => {
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, '2026-05-01', 'neutral', '5000.00', 'VIREMENT BANK1 -> BANK2', 'known_one_off', 'full')`)

    await expect(
      db.execute(sql`
        INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
        VALUES (${ws}, ${entityId}, ${exerciceId}, 2, '2026-05-01', 'transfert', '1.00', 'X', 'known_one_off', 'full')`)
    ).rejects.toThrow()
  })

  it('keeps the transfer visible in the book and out of both totals, end to end', async () => {
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 3, '2026-05-02', 'recette', '800.00', 'HONORAIRES', 'known_one_off', 'full')`)

    const { listRiEntries } = await import('./queries/statutory')
    const rows = await listRiEntries(entityId, exerciceId)
    expect(rows.length, 'logged: the transfer is IN the book').toBe(2)

    const t = riTotals(rows.map((r: { direction: string; amount: string }) => ({ direction: r.direction, amount: r.amount })))
    expect(t.recettes).toBe('800.00')
    expect(t.depenses, 'neutral: and in neither total').toBe('0.00')
    expect(t.resultat).toBe('800.00')
  })
})
