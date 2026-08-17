// A book created at RUNTIME balances too.
//
// ===========================================================================
// WHY A FOURTH BOOK, SPECIFICALLY
// ===========================================================================
// phase-1-statutory-core.md asks for this by name: "actif equals passif on every
// entity, tested with a fourth one created at runtime so nothing silently assumes
// three".
//
// Three books are seeded. Every other test in this app reads those three, so any
// accidental dependence on them — a hardcoded slug, a chart that only exists
// because the seed inserted it, a derivation that works because `OPENING` happened
// to have a row — passes everywhere and fails the first time a user presses
// "create a book".
//
// The user can create any number of books. This is the test that says so.
//
// It also exercises the create path end to end through the real query layer, which
// is the same path `bk books entity create` takes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
  console.warn('\n  lib/derive/runtime.test.ts SKIPPED: no DATABASE_URL. A runtime-created book was NOT verified.\n')
}

d('a book created at runtime', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let slug = ''

  beforeAll(async () => {
    const { getDb } = await import('../db/client')
    db = getDb()
    slug = 'rt-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('runtime@example.test', 'runtime')
      ON CONFLICT (email) DO UPDATE SET name = 'runtime' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('runtime', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)
  })

  afterAll(async () => {
    // ── NOTHING IS DELETED, AND NOT OUT OF LAZINESS ─────────────────────────
    // Teardown used to `ALTER TABLE ... DISABLE TRIGGER` so the workspace cascade
    // could remove the entries. That is safe alone and WRONG in a suite: vitest
    // runs test FILES in parallel, and this app has two that both write entries,
    // so one file's disable window swallowed the other's assertion. Measured
    // 2026-08-17 — "soft-deleting a posted entry" passed because the freeze
    // trigger was off, disabled by a sibling file mid-run.
    //
    // Disabling a trigger to clean up after a test that exists to prove the
    // trigger works is the wrong trade anyway. Isolation comes from the unique
    // workspace slug above instead, and the rows stay: this is a development
    // database, and `npm run db:seed:books` rebuilds the seeded workspace without
    // touching these.
  })

  it('is created through the same path the CLI uses, with its own #number', async () => {
    const { createEntity, listEntities } = await import('../db/queries/statutory')
    const e = await createEntity(ws, {
      slug: 'fourth',
      name: 'Fourth SA',
      legal_form: 'SA',
      bookkeeping_regime: 'double_entry',
    })
    expect(e.seq, 'the #number is allocated from books.counters, not assumed').toBe(1)
    expect((await listEntities(ws)).length).toBe(1)
  })

  it('balances with no opening balances and no postings at all', async () => {
    const { getBilan, listEntities, createExercice, listAccounts } = await import('../db/queries/statutory')
    const [entity] = await listEntities(ws)
    const x = await createExercice(ws, { entityId: entity.id, year: 2027 })

    // A brand new book has an empty chart. Nothing may assume the seed's 26 rows.
    expect(await listAccounts(entity.id)).toEqual([])

    const bilan = await getBilan(entity.id, x.id)
    expect(bilan.balanced, `a book with nothing in it must balance at zero, écart ${bilan.ecart}`).toBe(true)
    expect(bilan.totalActif).toBe('0.00')
    expect(bilan.totalPassif).toBe('0.00')
    // Every legal line is still emitted. An empty book has a full-length bilan.
    expect(bilan.groups.reduce((s, g) => s + g.lines.length, 0)).toBe(25)
  })

  it('balances once it has its own chart and a posted entry', async () => {
    const { getBilan, getCr, listEntities, listExercices } = await import('../db/queries/statutory')
    const [entity] = await listEntities(ws)
    const [x] = await listExercices(ws, entity.id)

    await db.execute(sql`
      INSERT INTO books.account (workspace_id, entity_id, no, class, label, statement, statement_position)
      VALUES (${ws}, ${entity.id}, '1020', 1, '{"fr":"Banque"}', 'bilan', 'tresorerie'),
             (${ws}, ${entity.id}, '2000', 2, '{"fr":"Fournisseurs"}', 'bilan', 'dettes_fournisseurs'),
             (${ws}, ${entity.id}, '6000', 6, '{"fr":"Loyer"}', 'cr', 'autres_charges_exploitation')`)

    // Opening: 5000 in the bank, 5000 owed. Balanced before any trading.
    await db.execute(sql`
      INSERT INTO books.opening_balance (workspace_id, entity_id, exercice_id, account_no, amount)
      VALUES (${ws}, ${entity.id}, ${x.id}, '1020', 5000), (${ws}, ${entity.id}, ${x.id}, '2000', 5000)`)

    const before = await getBilan(entity.id, x.id)
    expect(before.balanced, `écart ${before.ecart}`).toBe(true)

    // Pay rent of 1234.56 from the bank: a charge, so the result goes negative and
    // the injected résultat_exercice is what keeps the two sides equal.
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entity.id}, ${x.id}, 1, 1, '2027-03-01', 'staged', 'RENT REF-1') RETURNING id`)
    const id = Number(r.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${id}, '6000', 1234.56, 0), (${id}, '1020', 0, 1234.56)`)
    await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)

    const after = await getBilan(entity.id, x.id)
    expect(after.balanced, `écart ${after.ecart}`).toBe(true)
    // An amount a float would round. 1234.56 must survive exactly.
    expect(after.totalActif).toBe('3765.44')
    const cr = await getCr(entity.id, x.id)
    expect(cr.resultat).toBe('-1234.56')
    expect(after.resultat).toBe('-1234.56')
  })

  it('keeps a staged entry out of the statements entirely', async () => {
    const { getBilan, listEntities, listExercices } = await import('../db/queries/statutory')
    const [entity] = await listEntities(ws)
    const [x] = await listExercices(ws, entity.id)
    const before = await getBilan(entity.id, x.id)

    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entity.id}, ${x.id}, 2, 2, '2027-04-01', 'staged', 'UNEXPLAINED REF-2') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(r.rows[0].id)}, NULL, 999, 0), (${Number(r.rows[0].id)}, '1020', 0, 999)`)

    const after = await getBilan(entity.id, x.id)
    // Money that moved with no agreed meaning must not reach a statutory statement.
    expect(after.totalActif).toBe(before.totalActif)
    expect(after.balanced).toBe(true)
  })
})
