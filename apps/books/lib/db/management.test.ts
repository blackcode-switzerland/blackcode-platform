// Phase 4B against the real database: the sixth and seventh writes, and the
// three management reads.
//
//   - `recordAnalysis` files an answer with its `based_on` snapshot, verbatim,
//     and refuses a snapshot that does not actually snapshot anything.
//   - `createCategory` refuses accounts the chart does not hold and accounts
//     another active category already counts — one franc, one bar.
//   - The analytique and the tax snapshot agree with hand-computed figures on
//     a small book built line by line here.
//
// Isolation by unique workspace slug, nothing deleted — guards.test.ts's
// discipline, for its measured reason.

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
  console.warn('\n  lib/db/management.test.ts SKIPPED: no DATABASE_URL. Phase 4B writes were NOT verified.\n')
}

d('the management layer', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entity: any
  let exercice: any

  /** Insert one entry the guard-legal way: staged, lines, then the flip. */
  async function post(
    entityId: number,
    exerciceId: number,
    seq: number,
    date: string,
    label: string,
    lines: [string, string, string][],
    opts: { status?: string; tva?: { amount: string; claimed: boolean }; counterparty?: string } = {}
  ) {
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label,
                               counterparty, tva_amount, tva_input_claimed, evidence_tier)
      VALUES (${ws}, ${entityId}, ${exerciceId}, ${seq}, ${seq}, ${date}, 'staged', ${label},
              ${opts.counterparty ?? null}, ${opts.tva?.amount ?? null}, ${opts.tva?.claimed ?? false},
              ${opts.tva?.claimed ? 'full' : 'bare'})
      RETURNING id`)
    const id = Number(r.rows[0].id)
    for (const [account, debit, credit] of lines) {
      await db.execute(sql`
        INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
        VALUES (${id}, ${account}, ${debit}, ${credit})`)
    }
    if ((opts.status ?? 'posted') === 'posted') {
      await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)
    }
    return id
  }

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'mg-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('management@example.test', 'management')
      ON CONFLICT (email) DO UPDATE SET name = 'management' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('management', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    entity = await createEntity(ws, { slug: 'mg', name: 'MG SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    await db.execute(sql`UPDATE books.entity SET vat_registered = true WHERE id = ${entity.id}`)
    entity.vat_registered = true
    exercice = await createExercice(ws, { entityId: entity.id, year: 2026 })

    // Openings that balance: cash 21500 against capital 20000 + TVA due 1500.
    for (const [account, amount] of [
      ['1020', '21500.00'],
      ['2800', '20000.00'],
      ['2200', '1500.00'],
    ] as const) {
      await db.execute(sql`
        INSERT INTO books.opening_balance (workspace_id, entity_id, exercice_id, account_no, amount)
        VALUES (${ws}, ${entity.id}, ${exercice.id}, ${account}, ${amount})`)
    }

    // January: a 5000 mandate (output VAT 81.00 rides on it) and the rent.
    await post(entity.id, exercice.id, 1, '2026-01-08', 'VIREMENT NOVA SA', [
      ['1020', '5000.00', '0.00'],
      ['3400', '0.00', '5000.00'],
    ], { tva: { amount: '81.00', claimed: false }, counterparty: 'Nova SA' })
    await post(entity.id, exercice.id, 2, '2026-01-20', 'LOYER RENENS', [
      ['6000', '1800.00', '0.00'],
      ['1020', '0.00', '1800.00'],
    ], { counterparty: 'Régie du Lac' })
    // February: Hetzner with CLAIMED input VAT (full evidence), then an avoir.
    await post(entity.id, exercice.id, 3, '2026-02-03', 'HETZNER CLOUD', [
      ['6570', '398.75', '0.00'],
      ['1020', '0.00', '398.75'],
    ], { tva: { amount: '29.90', claimed: true }, counterparty: 'Hetzner' })
    await post(entity.id, exercice.id, 4, '2026-02-25', 'HETZNER AVOIR', [
      ['6570', '0.00', '50.00'],
      ['1020', '50.00', '0.00'],
    ], { counterparty: 'Hetzner' })
    // March: staged and therefore invisible to every chart.
    await post(entity.id, exercice.id, 5, '2026-03-01', 'OPENAI', [
      ['6570', '900.00', '0.00'],
      ['1020', '0.00', '900.00'],
    ], { status: 'staged', counterparty: 'OpenAI' })
  })

  it('files an analysis with its snapshot, verbatim, and numbers it', async () => {
    const { recordAnalysis, getAnalysis, publicAnalysis } = await import('./queries/management')
    const r = await recordAnalysis(ws, {
      entitySlug: 'mg',
      askedBy: 'Andrea',
      agent: 'claude-code',
      question: { fr: 'Puis-je embaucher ?', en: 'Can I hire?' },
      verdict: { fr: 'Pas encore.', en: 'Not yet.' },
      figures: [{ label: { fr: 'Coût', en: 'Cost' }, value: 'CHF 5175.00' }],
      basedOn: [{ label: { fr: 'Produits / mois', en: 'Revenue / month' }, value: 'CHF 5000.00', href: '/entries?account=3400' }],
      scenarioLabel: { fr: 'Avec embauche', en: 'With a hire' },
      runwayAfterMonths: 6.9,
    })
    expect(r.analysis.seq).toBe(1)

    const found = await getAnalysis(ws, 1)
    const out = publicAnalysis(found!)
    expect(out.entity).toBe('mg')
    expect(out.runway_after_months, 'a number for charts, not a string').toBe(6.9)
    expect(out.based_on, 'the snapshot exactly as filed').toEqual([
      { label: { fr: 'Produits / mois', en: 'Revenue / month' }, value: 'CHF 5000.00', href: '/entries?account=3400' },
    ])
    expect(typeof out.asked).toBe('string')
  })

  it('refuses an answer without a verdict, and a based_on item that snapshots nothing', async () => {
    const { recordAnalysis } = await import('./queries/management')
    await expect(
      recordAnalysis(ws, { entitySlug: 'mg', askedBy: 'a', agent: 'b', question: 'q?', verdict: '' })
    ).rejects.toMatchObject({ code: 'missing_verdict' })
    await expect(
      recordAnalysis(ws, {
        entitySlug: 'mg',
        askedBy: 'a',
        agent: 'b',
        question: 'q?',
        verdict: 'v',
        basedOn: [{ label: { fr: 'Trésorerie' }, value: undefined }],
      })
    ).rejects.toMatchObject({ code: 'based_on_incomplete' })
    await expect(
      recordAnalysis(ws, { entitySlug: 'nope', askedBy: 'a', agent: 'b', question: 'q?', verdict: 'v' })
    ).rejects.toMatchObject({ code: 'entity_not_found' })
  })

  it('creates categories, and holds the two integrity lines: chart membership and one-franc-one-bar', async () => {
    const { createCategory } = await import('./queries/management')
    const bureau = await createCategory(ws, { entitySlug: 'mg', key: 'bureau', label: { fr: 'Bureau & loyer', en: 'Office & rent' }, accounts: ['6000'] })
    expect(bureau.seq).toBe(1)
    const it = await createCategory(ws, { entitySlug: 'mg', key: 'it_ai', label: 'IT & tooling', accounts: ['6570'] })
    expect(it.label, 'a plain-string label is normalized: the wire always carries {fr, en}').toEqual({ fr: 'IT & tooling', en: 'IT & tooling' })
    const demi = await createCategory(ws, { entitySlug: 'mg', key: 'divers', label: { fr: 'Divers' }, accounts: ['6900'] })
    expect(demi.label, 'a half-spoken {fr}-only label is filled, not stored half-empty').toEqual({ fr: 'Divers', en: 'Divers' })

    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'fantome', label: 'x', accounts: ['9999'] })
    ).rejects.toMatchObject({ code: 'unknown_account' })
    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'caisse', label: 'x', accounts: ['1020'] })
    ).rejects.toMatchObject({ code: 'not_a_flow_account' })
    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'ventes', label: 'x', accounts: ['3400'] }),
      'class 3 passes the statement check but is revenue: in a cost bucket the breakdown would count produits as charges'
    ).rejects.toMatchObject({ code: 'revenue_not_a_cost' })
    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'double', label: 'x', accounts: ['6570'] })
    ).rejects.toMatchObject({ code: 'accounts_claimed' })
    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'bureau', label: 'x', accounts: ['6500'] })
    ).rejects.toMatchObject({ code: 'duplicate_key' })
    await expect(
      createCategory(ws, { entitySlug: 'mg', key: 'Bad Key', label: 'x', accounts: ['6500'] })
    ).rejects.toMatchObject({ code: 'bad_key' })
  })

  it('serves the analytique: hand-checked buckets, an avoir that reduces, staged money invisible', async () => {
    const { getAnalytique } = await import('./queries/management')
    const r = await getAnalytique(entity, exercice)

    const byKey = Object.fromEntries(r.categories.map((c: any) => [c.key, c]))
    expect(byKey.bureau.amount).toBe('1800.00')
    expect(byKey.it_ai.amount, '398.75 − 50.00, the avoir counted against its bucket').toBe('348.75')
    expect(byKey.it_ai.lines.map((l: any) => l.amount)).toEqual(['398.75', '-50.00'])
    expect(byKey.it_ai.lines[0].counterparty).toBe('Hetzner')

    expect(r.monthly_flows).toEqual([
      { month: '2026-01', produits: '5000.00', charges: '1800.00' },
      { month: '2026-02', produits: '0.00', charges: '348.75' },
    ])
  })

  it('serves the tax snapshot: exact VAT, cited estimates, the imputation shown not hidden', async () => {
    const { getTaxSnapshot } = await import('./queries/management')
    await db.execute(sql`
      INSERT INTO books.tax_params (workspace_id, entity_id, canton, commune, params)
      VALUES (${ws}, ${entity.id}, 'VD', 'Renens', ${JSON.stringify({
        ifd: { rate_pct: 8.5, citation: 'art. 68 LIFD', confirmed: true },
        cantonal: { base_rate_pct: 10 / 3, coefficient_pct: 155, confirmed: true },
        communal: { coefficient_pct: 77, confirmed: true },
        capital_tax: { base_rate_permille: 0.6, confirmed: false },
      })}::jsonb)`)

    const snap = await getTaxSnapshot(entity, exercice)
    expect(snap.configured).toBe(true)
    expect(snap.profit, '5000 − 1800 − 348.75').toBe('2851.25')
    expect(snap.equity, 'capital 20000 + the injected résultat').toBe('22851.25')

    expect(snap.vat, 'opening 1500 + output 81 − claimed 29.90; the unclaimed and the staged never count').toEqual({
      opening_due: '1500.00',
      output_ytd: '81.00',
      input_claimed_ytd: '29.90',
      net_due: '1551.10',
    })

    const t = snap.tax!
    expect(t.canton).toBe('VD')
    expect(t.profit_tax.cantonal).toBe('147.31')
    expect(t.profit_tax.communal).toBe('73.18')
    expect(t.profit_tax.ifd).toBe('242.36')
    expect(t.profit_tax.statutory_pct).toBe(16.23)
    expect(t.capital_tax.gross).toBe('13.71')
    expect(t.capital_tax.net_due, 'fully credited against the profit tax in a profit year').toBe('0.00')
    expect((t.params as any).capital_tax.confirmed, "the fiduciary has not answered; the flag says so").toBe(false)
  })

  it('a book with no parameters answers "not configured", never someone else\'s rates', async () => {
    const { createEntity, createExercice } = await import('./queries/statutory')
    const { getTaxSnapshot } = await import('./queries/management')
    const bare = await createEntity(ws, { slug: 'mg-bare', name: 'Bare SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    const x = await createExercice(ws, { entityId: bare.id, year: 2026 })
    const snap = await getTaxSnapshot(bare, x)
    expect(snap.configured).toBe(false)
    expect(snap.tax).toBeNull()
  })

  it('the simplified book refuses the snapshot and the category write, each by name', async () => {
    const { createEntity } = await import('./queries/statutory')
    const { createCategory, getTaxSnapshot } = await import('./queries/management')
    const ri = await createEntity(ws, { slug: 'mg-ri', name: 'Perso', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    const { createExercice } = await import('./queries/statutory')
    const x = await createExercice(ws, { entityId: ri.id, year: 2026 })

    await expect(getTaxSnapshot(ri, x)).rejects.toMatchObject({ code: 'no_tax_snapshot_for_simplified' })
    await expect(
      createCategory(ws, { entitySlug: 'mg-ri', key: 'repas', label: 'Repas', accounts: ['6000'] })
    ).rejects.toMatchObject({ code: 'ri_no_categories' })
  })

  it('the RI analytique groups dépenses by their own category', async () => {
    const { getAnalytique } = await import('./queries/management')
    const { getEntityBySlug, listExercices } = await import('./queries/statutory')
    const ri = await getEntityBySlug(ws, 'mg-ri')
    const [x] = await listExercices(ws, ri!.id)
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, counterparty, recognition, evidence_tier, category)
      VALUES (${ws}, ${ri!.id}, ${x.id}, 1, '2026-01-05', 'depense', '45.50', 'CARTE CAFE', 'Café du Coin', 'known_one_off', 'bare', ${'{"fr":"Repas","en":"Meals"}'}::jsonb),
             (${ws}, ${ri!.id}, ${x.id}, 2, '2026-01-12', 'recette', '500.00', 'VIREMENT CLIENT', 'Client', 'known_one_off', 'bare', NULL),
             (${ws}, ${ri!.id}, ${x.id}, 3, '2026-01-15', 'neutral', '2000.00', 'VIREMENT PROPRE', NULL, 'known_one_off', 'bare', NULL)`)
    const r = await getAnalytique(ri!, x)
    expect(r.categories.map((c: any) => [c.key, c.amount])).toEqual([['Repas', '45.50']])
    expect(r.monthly_flows, 'the neutral transfer is in neither series').toEqual([
      { month: '2026-01', produits: '500.00', charges: '45.50' },
    ])
  })
})
