// Starting a book and ending a year, against the real database.
//
//   - `createAccount` gives a book the accounts the template does not carry,
//     and refuses a class that contradicts its statutory line.
//   - `setOpenings` types the first year's balance sheet, refuses an
//     unbalanced one, and refuses any year that is not the book's first.
//   - `closeExercice` refuses over staged work, carries every bilan account
//     into the next year, and adds the year's result to 2970.
//   - The chart guard refuses a posting to an account the book has not got —
//     the bug that produced `balanced: false` on 2026-08-19.
//
// Isolation by unique workspace slug, nothing deleted: guards.test.ts's
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
  console.warn('\n  lib/db/year.test.ts SKIPPED: no DATABASE_URL. The close was NOT verified.\n')
}

d('starting a book and ending a year', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entity: any
  let x2026: any

  /**
   * Run something and report the whole error chain, or null if it succeeded.
   * Drizzle hides the driver's message behind `Failed query: …` and hangs the
   * real one off `cause`, so asserting on the outer message would match every
   * failure identically. Same helper, same reason, as guards.test.ts.
   */
  async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
    try {
      await fn()
      return null
    } catch (e) {
      const parts: string[] = []
      let cur: unknown = e
      while (cur instanceof Error) {
        parts.push(cur.message)
        cur = (cur as { cause?: unknown }).cause
      }
      if (parts.length === 0) parts.push(String(e))
      return parts.join(' | ')
    }
  }

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'yr-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('year@example.test', 'year')
      ON CONFLICT (email) DO UPDATE SET name = 'year' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('year', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    entity = await createEntity(ws, { slug: 'yr', name: 'YR SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    x2026 = await createExercice(ws, { entityId: entity.id, year: 2026 })
  })

  // -------------------------------------------------------------------------
  // the chart
  // -------------------------------------------------------------------------

  it('refuses a declaration naming an account this book has not got', async () => {
    const { declareEntry } = await import('./queries/declare')
    await expect(
      declareEntry(ws, {
        entitySlug: 'yr',
        date: '2026-02-01',
        amount: '43.70',
        label: 'YAPEAL*GITHUB.COM',
        explanation: { en: 'the 2026-08-19 bug, in one call' },
        account: '6570',
        contra: '1022', // a real bank, and not in the PME template
        declaredBy: 'test',
      })
    ).rejects.toMatchObject({ code: 'unknown_account' })
  })

  it('adds the account, and then the same declaration is accepted', async () => {
    const { createAccount } = await import('./queries/account')
    const a = await createAccount(ws, entity.id, {
      no: '1022',
      class: 1,
      label: { fr: 'Yapeal', enSuffix: 'Yapeal' },
      statement_position: 'tresorerie',
    })
    expect(a.no).toBe('1022')

    const { declareEntry } = await import('./queries/declare')
    const r = await declareEntry(ws, {
      entitySlug: 'yr',
      date: '2026-02-01',
      amount: '43.70',
      label: 'YAPEAL*GITHUB.COM',
      explanation: { en: 'now it exists' },
      account: '6570',
      contra: '1022',
      declaredBy: 'test',
    })
    expect(r.journal).toBe('grand_livre')
  })

  it('refuses an account whose class contradicts its statutory line', async () => {
    const { createAccount } = await import('./queries/account')
    await expect(
      createAccount(ws, entity.id, {
        no: '6999',
        class: 6, // a charge…
        label: { fr: 'Test' },
        statement_position: 'tresorerie', // …on a bilan line
      })
    ).rejects.toMatchObject({ code: 'class_position_mismatch' })
  })

  it('refuses an account the book already has', async () => {
    const { createAccount } = await import('./queries/account')
    await expect(
      createAccount(ws, entity.id, {
        no: '1020',
        class: 1,
        label: { fr: 'Banque bis' },
        statement_position: 'tresorerie',
      })
    ).rejects.toMatchObject({ code: 'account_exists' })
  })

  // -------------------------------------------------------------------------
  // openings
  // -------------------------------------------------------------------------

  it('refuses an unbalanced balance sheet, naming the difference', async () => {
    const { setOpenings } = await import('./queries/openings')
    await expect(
      setOpenings(ws, entity.id, x2026, [
        { account: '1020', amount: '50000.00' },
        { account: '2800', amount: '12000.00' },
      ])
    ).rejects.toMatchObject({ code: 'openings_unbalanced' })
  })

  it('refuses a compte de résultat account: a trading year starts at zero', async () => {
    const { setOpenings } = await import('./queries/openings')
    await expect(
      setOpenings(ws, entity.id, x2026, [{ account: '3400', amount: '10.00' }])
    ).rejects.toMatchObject({ code: 'not_a_bilan_account' })
  })

  it('types the first year, and the bilan opens from it', async () => {
    const { setOpenings } = await import('./queries/openings')
    const r = await setOpenings(ws, entity.id, x2026, [
      { account: '1020', amount: '50000.00' },
      { account: '2000', amount: '5000.00' },
      { account: '2800', amount: '20000.00' },
      { account: '2970', amount: '25000.00' },
    ])
    expect(r.written).toBe(4)
    expect(r.totalActif).toBe('50000.00')
    expect(r.totalPassif).toBe('50000.00')
  })

  // -------------------------------------------------------------------------
  // the close
  // -------------------------------------------------------------------------

  it('refuses to close over an entry nobody has judged', async () => {
    const { closeExercice } = await import('./queries/close')
    // The declaration above is still staged.
    await expect(closeExercice(ws, entity.id, x2026)).rejects.toMatchObject({
      code: 'staged_entries',
    })
  })

  it('refuses to close with nowhere to carry the balances', async () => {
    const { closeExercice } = await import('./queries/close')
    const { getDb } = await import('./client')
    await getDb().execute(sql`UPDATE books.entry SET status = 'posted' WHERE exercice_id = ${x2026.id}`)
    await expect(closeExercice(ws, entity.id, x2026)).rejects.toMatchObject({
      code: 'no_next_exercice',
    })
  })

  it('closes: bilan accounts carry, the result lands on 2970, the year locks', async () => {
    const { createExercice } = await import('./queries/statutory')
    const { closeExercice } = await import('./queries/close')
    const { listOpenings } = await import('./queries/openings')
    const x2027 = await createExercice(ws, { entityId: entity.id, year: 2027 })

    const r = await closeExercice(ws, entity.id, x2026)

    // The only movement is the CHF 43.70 charge, so the year loses exactly it.
    expect(r.resultat).toBe('-43.70')
    expect(r.carriedInto).toBe(2027)
    // 25000 carried, less this year's loss.
    expect(r.retainedEarnings).toBe('24956.30')

    const carried = new Map((await listOpenings(entity.id, x2027.id)).map((o) => [o.account_no, o.amount]))
    expect(carried.get('1020'), 'untouched by the entry, carries whole').toBe('50000.00')
    expect(carried.get('1022'), 'the new bank paid the charge').toBe('-43.70')
    expect(carried.get('2970')).toBe('24956.30')
    expect(carried.get('3400'), 'a produit account never carries (art. 958 al. 2)').toBeUndefined()
    expect(carried.get('6570'), 'nor does a charge account').toBeUndefined()

    // And 2027 opens balanced, which is the whole point of the exercise.
    const { getBilan } = await import('./queries/statutory')
    const b = await getBilan(entity.id, x2027.id)
    expect(b.balanced, '2027 opens in balance because 2026 closed in balance').toBe(true)
  })

  it('refuses to close twice', async () => {
    const { closeExercice } = await import('./queries/close')
    const { listExercices } = await import('./queries/statutory')
    const rows = await listExercices(ws, entity.id)
    const closed = rows.find((x) => x.year === 2026)!
    await expect(closeExercice(ws, entity.id, closed)).rejects.toMatchObject({
      code: 'already_closed',
    })
  })

  it('refuses typed openings on a year the close produced', async () => {
    const { setOpenings } = await import('./queries/openings')
    const { listExercices } = await import('./queries/statutory')
    const rows = await listExercices(ws, entity.id)
    const x2027 = rows.find((x) => x.year === 2027)!
    await expect(
      setOpenings(ws, entity.id, x2027, [{ account: '1020', amount: '1.00' }])
    ).rejects.toMatchObject({ code: 'not_first_exercice' })
  })

  it('0016 refuses to reopen a closed year, at the table', async () => {
    // The cause is walked, not the outer message: drizzle replaces the driver's
    // text with "Failed query: UPDATE …", which every refusal shares. See the
    // same note in guards.test.ts.
    const said = await refusal(() =>
      db.execute(sql`
        UPDATE books.exercice SET status = 'open'
        WHERE entity_id = ${entity.id} AND year = 2026`)
    )
    expect(said, 'the trigger, not the door, is what refuses here').toMatch(/cannot be reopened/)
  })

  it('0016 freezes a closed year\'s opening balances, at the table', async () => {
    const said = await refusal(() =>
      db.execute(sql`
        DELETE FROM books.opening_balance
        WHERE entity_id = ${entity.id}
          AND exercice_id = (SELECT id FROM books.exercice WHERE entity_id = ${entity.id} AND year = 2026)`)
    )
    expect(said).toMatch(/part of what was filed/)
  })
})

// ---------------------------------------------------------------------------
// The VAT arithmetic, which needs no database
// ---------------------------------------------------------------------------

describe('TVA on an entry', () => {
  it('derives the tax inside a TTC gross', async () => {
    const { tvaOnGross } = await import('./queries/tva')
    // G × r / (100 + r), rounded to the rappen: the tax is INSIDE a Swiss
    // TTC price, never added to it.
    expect(tvaOnGross('83.20', 8.1)).toBe('6.23')
    expect(tvaOnGross('5421.00', 8.1)).toBe('406.20')
    expect(tvaOnGross('1000.00', 2.6)).toBe('25.34')
    expect(tvaOnGross('100.00', 0)).toBe('0.00')
  })

  it('refuses a rate that is not in force', async () => {
    const { tvaColumns, TvaRefused } = await import('./queries/tva')
    expect(() => tvaColumns({ rate: 7.7 }, '100.00')).toThrow(TvaRefused)
  })

  it("keeps the invoice's own figure, within a rappen", async () => {
    const { tvaColumns } = await import('./queries/tva')
    const near = tvaColumns({ rate: 8.1, amount: '7.50' }, '100.00')
    expect(near?.tva_amount, 'the supplier said 7.50, arithmetic says 7.49').toBe('7.50')
    expect(() => tvaColumns({ rate: 8.1, amount: '12.00' }, '100.00')).toThrow(/is not 8.1%/)
  })

  it('refuses a claim without full evidence (art. 28 al. 1 LTVA)', async () => {
    const { tvaColumns } = await import('./queries/tva')
    expect(() => tvaColumns({ rate: 8.1, inputClaimed: true, evidenceTier: 'partial' }, '100.00')).toThrow(
      /evidence is complete/
    )
    const ok = tvaColumns({ rate: 8.1, inputClaimed: true, evidenceTier: 'full' }, '100.00')
    expect(ok?.tva_input_claimed).toBe(true)
  })

  it('says nothing when the caller said nothing', async () => {
    const { tvaColumns } = await import('./queries/tva')
    expect(tvaColumns(undefined, '100.00')).toBeNull()
  })
})
