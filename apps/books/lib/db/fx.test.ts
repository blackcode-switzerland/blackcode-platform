// FX vocabulary (0011): the original currency is evidence, never arithmetic.
//
// The book is CHF and `amount` holds what the card was actually charged; `fx`
// holds the story ({original, rate, source}), display-only. These tests pin
// the two properties that make it safe:
//
//   1. The story survives: fx round-trips through the wire shapes untouched,
//      and is null when there is none.
//   2. Nothing computes with it: an RI book's totals are identical with and
//      without fx on every row.

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

if (!HAS_DB) {
  console.warn('\n  lib/db/fx.test.ts SKIPPED: no DATABASE_URL. FX vocabulary was NOT verified.\n')
}

const FX = { original: 'USD 5.00', rate: '0.894', source: 'card statement' }

d('the original-currency story', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'fx-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('fx@example.test', 'fx')
      ON CONFLICT (email) DO UPDATE SET name = 'fx' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('fx-vocabulary', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)
    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'fx', name: 'FX', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id

    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier, fx)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, '2026-08-18', 'depense', '4.47', 'Coffee abroad', 'known_one_off', 'bare', ${JSON.stringify(FX)}::jsonb)`)
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 2, '2026-08-18', 'recette', '100.00', 'HONORAIRES', 'known_one_off', 'full')`)
  })

  it('round-trips through publicRiEntry, and is null when there is none', async () => {
    const { listRiEntries, publicRiEntry } = await import('./queries/statutory')
    const rows = (await listRiEntries(entityId, exerciceId)).map((r) => publicRiEntry(r, { entity: 'fx', exercice: 2026 }))
    expect(rows.find((r: { number: number }) => r.number === 1)!.fx).toEqual(FX)
    expect(rows.find((r: { number: number }) => r.number === 2)!.fx, 'no story, no field').toBeNull()
  })

  it('publicEntry carries it for the grand livre the same way', async () => {
    const { publicEntry } = await import('./queries/statutory')
    const shaped = publicEntry(
      {
        entry: { seq: 9, entry_no: 9, fx: FX, piece_drive_ref: null } as any,
        lines: [],
      } as any,
      { entity: 'fx', exercice: 2026 }
    )
    expect(shaped.fx).toEqual(FX)
  })

  it('nothing computes with it: totals identical with and without the story', async () => {
    const { listRiEntries } = await import('./queries/statutory')
    const rows = await listRiEntries(entityId, exerciceId)
    const t = riTotals(rows.map((r: { direction: string; amount: string }) => ({ direction: r.direction, amount: r.amount })))
    // 100.00 in, 4.47 out — the CHF amounts, exactly; USD 5.00 appears nowhere.
    expect(t.recettes).toBe('100.00')
    expect(t.depenses).toBe('4.47')
    expect(t.resultat).toBe('95.53')
  })
})
