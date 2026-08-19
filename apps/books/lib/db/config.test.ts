// The configuration doors: a book's own facts, its tax parameters, and
// switching a rule off.
//
// Each one closes a hole that was invisible from inside the code and obvious
// the moment somebody drove the CLI as a person would:
//
//   - `vat_registered` defaults to false and gates the entire VAT position, so
//     every book created through the app reported none, for ever.
//   - `books.tax_params` was SELECT-only, so `configured: false` was the only
//     answer a real book could give.
//   - `deactivateRule` was written, exported and reachable from nothing.
//
// Isolation by unique workspace slug, nothing deleted.

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
  console.warn('\n  lib/db/config.test.ts SKIPPED: no DATABASE_URL.\n')
}

d('the configuration doors', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let sa: any
  let ri: any
  let exercice: any

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'cf-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('config@example.test', 'config')
      ON CONFLICT (email) DO UPDATE SET name = 'config' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('config', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    sa = await createEntity(ws, { slug: 'cf', name: 'CF SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    ri = await createEntity(ws, { slug: 'cf-ri', name: 'CF RI', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    exercice = await createExercice(ws, { entityId: sa.id, year: 2026 })
  })

  // -------------------------------------------------------------------------
  // entity edit
  // -------------------------------------------------------------------------

  it('a new book is NOT vat registered, which is what silenced the VAT position', async () => {
    const { getEntityBySlug } = await import('./queries/statutory')
    const e = await getEntityBySlug(ws, 'cf')
    expect(e!.vat_registered, 'the default, and nothing could change it before today').toBe(false)
  })

  it('refuses to register without a method and a period', async () => {
    const { updateEntity } = await import('./queries/entity-edit')
    await expect(updateEntity(ws, 'cf', { vat_registered: true })).rejects.toMatchObject({
      code: 'vat_needs_method_and_filing',
    })
  })

  it('registers, and the tax snapshot serves a VAT position it never could before', async () => {
    const { updateEntity } = await import('./queries/entity-edit')
    const { getTaxSnapshot } = await import('./queries/management')
    const { getEntityBySlug } = await import('./queries/statutory')

    const before = await getTaxSnapshot((await getEntityBySlug(ws, 'cf'))!, exercice)
    expect(before.vat, 'gated on a flag nothing could set').toBeNull()

    await updateEntity(ws, 'cf', {
      vat_registered: true,
      vat_method: 'effective',
      vat_filing: 'quarterly',
    })

    const after = await getTaxSnapshot((await getEntityBySlug(ws, 'cf'))!, exercice)
    expect(after.vat, 'the whole point of the flag').not.toBeNull()
  })

  it('refuses a VAT method and a filing period outside the law', async () => {
    const { updateEntity } = await import('./queries/entity-edit')
    await expect(updateEntity(ws, 'cf', { vat_method: 'cash' })).rejects.toMatchObject({ code: 'bad_vat_method' })
    await expect(updateEntity(ws, 'cf', { vat_filing: 'weekly' })).rejects.toMatchObject({ code: 'bad_vat_filing' })
    await expect(updateEntity(ws, 'cf', { audit_status: 'none' })).rejects.toMatchObject({ code: 'bad_audit_status' })
  })

  it('refuses the three permanent fields by name', async () => {
    const { refusePermanentFields } = await import('./queries/entity-edit')
    expect(() => refusePermanentFields({ slug: 'other' })).toThrow(/slug/)
    expect(() => refusePermanentFields({ legal_form: 'SARL' })).toThrow(/re-registration/)
    expect(() => refusePermanentFields({ bookkeeping_regime: 'simplified' })).toThrow(/art. 957/)
  })

  it('changes what genuinely changes', async () => {
    const { updateEntity } = await import('./queries/entity-edit')
    const row = await updateEntity(ws, 'cf', { name: 'CF Holding SA', seat: 'Sion VS', fte_count: '2.50' })
    expect(row.name).toBe('CF Holding SA')
    expect(row.seat).toBe('Sion VS')
    expect(row.fte_count).toBe('2.50')
  })

  // -------------------------------------------------------------------------
  // tax params
  // -------------------------------------------------------------------------

  const VD = {
    canton: 'VD',
    commune: 'Renens',
    ifd_rate_pct: 8.5,
    cantonal_base_rate_pct: 3.3333,
    cantonal_coefficient_pct: 155,
    communal_coefficient_pct: 77,
    capital_tax_base_rate_permille: 0.6,
  }

  it('a book with no params answers configured: false, and is not filled in', async () => {
    const { getTaxSnapshot } = await import('./queries/management')
    const { getEntityBySlug } = await import('./queries/statutory')
    const snap = await getTaxSnapshot((await getEntityBySlug(ws, 'cf'))!, exercice)
    expect(snap.configured, 'decision D-D: nothing may assume a canton').toBe(false)
    expect(snap.tax).toBeNull()
  })

  it('refuses a canton that is not one, and a commune that is missing', async () => {
    const { setTaxParams } = await import('./queries/tax-params')
    await expect(setTaxParams(ws, sa, { ...VD, canton: 'XX' })).rejects.toMatchObject({ code: 'bad_canton' })
    await expect(setTaxParams(ws, sa, { ...VD, commune: '  ' })).rejects.toMatchObject({ code: 'missing_commune' })
    await expect(setTaxParams(ws, sa, { ...VD, ifd_rate_pct: NaN })).rejects.toMatchObject({ code: 'bad_rate' })
  })

  it('refuses a simplified book: its result is its owner\'s personal income', async () => {
    const { setTaxParams } = await import('./queries/tax-params')
    await expect(setTaxParams(ws, ri, VD)).rejects.toMatchObject({
      code: 'no_tax_params_for_simplified',
    })
  })

  it('sets them, and the snapshot computes where it answered null', async () => {
    const { setTaxParams } = await import('./queries/tax-params')
    const { getTaxSnapshot } = await import('./queries/management')
    const { getEntityBySlug } = await import('./queries/statutory')

    await setTaxParams(ws, sa, VD)
    const snap = await getTaxSnapshot((await getEntityBySlug(ws, 'cf'))!, exercice)
    expect(snap.configured).toBe(true)
    expect(snap.tax!.canton).toBe('VD')
    expect(snap.tax!.commune).toBe('Renens')
    expect(snap.tax!.capital_tax).toBeTruthy()
  })

  it('is configuration, so a voted coefficient replaces the one before it', async () => {
    const { setTaxParams } = await import('./queries/tax-params')
    const { getTaxParams } = await import('./queries/management')
    await setTaxParams(ws, sa, { ...VD, communal_coefficient_pct: 78.5 })
    const row = await getTaxParams(sa.id)
    expect((row!.params as any).communal.coefficient_pct, 'upsert, one row per book').toBe(78.5)
  })

  // -------------------------------------------------------------------------
  // rule deactivate
  // -------------------------------------------------------------------------

  it('a rule stops matching, and is never deleted', async () => {
    const { insertRule } = await import('./queries/rules')
    const { deactivateRule } = await import('./queries/resolve')
    const { listRules } = await import('./queries/rules')

    const rule = await db.transaction(async (tx: any) =>
      insertRule(tx, ws, {
        entityId: sa.id,
        sourceId: null,
        pattern: { counterparty: 'IMMOREGIE', amount_chf: null, tolerance_chf: null, interval: null },
        explanation: { en: 'rent' },
        accountNo: '6000',
        learnedFrom: 'contract',
        createdFromEntryId: null,
      })
    )

    expect((await listRules(sa.id, { active: true })).some((r) => r.seq === rule.seq)).toBe(true)
    expect(await deactivateRule(ws, rule.seq)).toBe(true)

    // Gone from what the importer reads…
    expect(
      (await listRules(sa.id, { active: true })).some((r) => r.seq === rule.seq),
      'the importer only reads active rules'
    ).toBe(false)
    // …and still there, because a posted entry may cite it for ten years.
    expect(
      (await listRules(sa.id, {})).some((r) => r.seq === rule.seq),
      'art. 958f: the row stays, the flag moves'
    ).toBe(true)
  })

  it('answers false for a rule that is not there', async () => {
    const { deactivateRule } = await import('./queries/resolve')
    expect(await deactivateRule(ws, 999999)).toBe(false)
  })
})
