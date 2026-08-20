// The simplified regime, handled by exclusion — three doors that stepped aside.
//
// ===========================================================================
// ONE PATTERN, FOUND THREE TIMES IN ONE AFTERNOON
// ===========================================================================
// Driving `mustneer-shop` — an RI book, art. 957 al. 2 CO — from the CLI on
// 2026-08-20 turned up three separate defects with the same shape. Each guard
// asked "is this a double-entry book?", got `no`, and stepped aside, leaving
// the simplified path with no equivalent protection:
//
//   1. `reconcile()`   summed posting lines a simplified book never has, and
//                      reported `ledger says 0.00, drift 3837.60` — a drift
//                      that can never close, on a book kept perfectly.
//
//   2. `resolve`       took no `direction`, so a side guessed at import could
//                      not be corrected by anybody. Andrea's `neutral` rule
//                      (#59) reached `declare` only, and a card settlement
//                      therefore stayed a `depense` beside the very purchases
//                      it settles — the same spend, counted twice.
//
//   3. `createSource`  accepted a ledger account the chart has not got. 0016's
//                      `trg_line_account_in_chart` catches that at the first
//                      POST, and a simplified book never posts, so nothing
//                      caught it at all: a card feed was registered against
//                      `1090` in a book whose 25-account chart never had one.
//
// The pattern is worth more than the three fixes: a regime check that is
// `!simplified` is a guard admitting it does not know what to do here, and the
// answer is never "then do nothing".
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

d('the simplified regime is not an exemption from the guards', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let riEntity = 0
  let saEntity = 0
  let riSourceSeq = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'sg-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES (${slug + '@example.test'}, 'simplified-gaps') RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('simplified-gaps', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const ri = await createEntity(ws, { slug: 'sg-ri', name: 'SG RI', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    riEntity = ri.id
    const riX = await createExercice(ws, { entityId: riEntity, year: 2026 })
    const sa = await createEntity(ws, { slug: 'sg-sa', name: 'SG SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    saEntity = sa.id
    const saX = await createExercice(ws, { entityId: saEntity, year: 2026 })

    // The bank feed, and a pull that DID report a closing balance — so the only
    // reason reconciliation is unknowable is the regime.
    const { createSource } = await import('./queries/sources')
    const src = await createSource(ws, {
      entitySlug: 'sg-ri', name: 'Compte Pro', type: 'bank', ledgerAccounts: ['1020'],
    })
    riSourceSeq = src.seq
    await db.execute(sql`
      INSERT INTO books.source_pull (workspace_id, source_id, file, format, hash, pulled, closing_balance, closing_on)
      VALUES (${ws}, ${src.id}, 'sg-2026-06.xml', 'camt.053', 'sha256:sg', '2026-07-01', '3837.60', '2026-06-30')`)

    // The card settlement as it arrives from a bank file: a dépense, because
    // that is all the credit/debit indicator can say.
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${riEntity}, ${riX.id}, 1, '2026-06-30', 'depense', '512.40', 'DEBIT CARTE YAPEAL 6474 JUIN 2026', 'unrecognized', 'bare')`)

    await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, raw_label)
      VALUES (${ws}, ${saEntity}, ${saX.id}, 1, 1, '2026-06-30', 'VIREMENT')`)
  })

  // ── 1. reconciliation ────────────────────────────────────────────────────
  it('does not answer a reconciliation a simplified book cannot be asked', async () => {
    const { getSourceBySeq, reconcileSource } = await import('./queries/sources')
    const src = await getSourceBySeq(ws, riSourceSeq)
    const r = await reconcileSource(src!)

    expect(r.known, 'the statement reported 3837.60; the book keeps no ledger').toBe(false)
    expect(r.ledger_balance, 'a ledger balance of 0.00 here is an invention').toBeNull()
    expect(r.drift).toBeNull()
    expect(r.agrees).toBeNull()
    expect(r.note).toMatch(/recettes-dépenses/)
  })

  // ── 2. the direction door ────────────────────────────────────────────────
  it('lets a settlement be corrected to neutral, and keeps what it was', async () => {
    const { resolveRiEntry } = await import('./queries/resolve')
    const r = await resolveRiEntry(ws, riEntity, 1, {
      explanation: { en: 'Card settlement — the purchases are already in the book' },
      direction: 'neutral',
    })
    expect(r.entry.direction).toBe('neutral')

    const hist = r.entry.history as any[]
    expect(hist[hist.length - 1].was.direction, 'the guessed side is kept, not overwritten silently').toBe('depense')

    // riTotals must now count it on neither side: that is the whole point.
    const { riTotals } = await import('../derive')
    const t = riTotals([{ direction: r.entry.direction, amount: r.entry.amount }])
    expect(t.depenses, 'the settlement must not be an expense beside the purchases it settles').toBe('0.00')
    expect(t.recettes).toBe('0.00')
  })

  it('leaves the direction alone when the call does not mention it (#67)', async () => {
    const { resolveRiEntry } = await import('./queries/resolve')
    const r = await resolveRiEntry(ws, riEntity, 1, {
      explanation: { en: 'Same row, evidence filed later' },
    })
    expect(r.entry.direction, 'a partial update must not reset a field it never named').toBe('neutral')
  })

  it('refuses a direction a simplified book does not keep', async () => {
    const { resolveRiEntry } = await import('./queries/resolve')
    await expect(
      resolveRiEntry(ws, riEntity, 1, { explanation: { en: 'x' }, direction: 'transfert' as any })
    ).rejects.toMatchObject({ code: 'bad_direction' })
  })

  it('refuses a direction on a double-entry entry, whose direction is its lines', async () => {
    const { resolveEntry } = await import('./queries/resolve')
    await expect(
      resolveEntry(ws, 1, { explanation: { en: 'x' }, direction: 'neutral' })
    ).rejects.toMatchObject({ code: 'direction_is_ri_only' })
  })

  // ── 3. the chart, for a book that never posts ────────────────────────────
  it('refuses a source feeding an account this book has not got', async () => {
    const { createSource, SourceRefused } = await import('./queries/sources')
    await expect(
      createSource(ws, { entitySlug: 'sg-ri', name: 'Carte 6474', type: 'card', ledgerAccounts: ['1090'] })
    ).rejects.toBeInstanceOf(SourceRefused)
    await expect(
      createSource(ws, { entitySlug: 'sg-ri', name: 'Carte 6474', type: 'card', ledgerAccounts: ['1090'] })
    ).rejects.toMatchObject({ code: 'account_not_in_chart' })
  })

  // The refusal names the door that answers it, so this test walks the same
  // path a person does: refused, add the account, accepted.
  it('refuses the same account on an edit, and takes it once the chart carries it', async () => {
    const { createSource, updateSource } = await import('./queries/sources')
    const card = await createSource(ws, { entitySlug: 'sg-ri', name: 'Carte 6474', type: 'card' })
    await expect(
      updateSource(ws, card.seq, { ledgerAccounts: ['2010'] })
    ).rejects.toMatchObject({ code: 'account_not_in_chart' })

    const { createAccount } = await import('./queries/account')
    await createAccount(ws, riEntity, {
      no: '2010',
      class: 2,
      label: { fr: 'Carte Yapeal 6474' },
      statement_position: 'autres_dettes_ct',
    })

    const ok = await updateSource(ws, card.seq, { ledgerAccounts: ['2010'] })
    expect(ok.ledger_accounts).toEqual(['2010'])
  })
})
