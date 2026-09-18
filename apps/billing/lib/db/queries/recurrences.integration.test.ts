// Recurring series against a real database, as `billing_app` (phase 4, #91).
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/db/queries/recurrences.integration.test.ts
//
// One case per line of phase 4's "Done when", in its order. The database-only
// half of I9 — the CHECKs and the index with no app code in the way — is in
// lib/invariants.test.ts.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md
// ===========================================================================
// In the code:
//   - the period check replaced with a substitution     → "a wrong period is REFUSED" red
//   - the counter advanced in its own statement, before the transaction
//                                                        → ten cases red, including "a generation
//                                                          refused by the create path leaves the counter"
//   - the template never counted as the first occurrence → "a template issued in the start period" red
//   - every generation treated as advancing (no replacement)
//                                                        → the void case and the wrong-period case red
//   - `paused` not refused                               → the pause case red
//   - `--due` not filtering on status                    → the due case red
//
// In the local catalog — the LAYERS, one at a time:
//   - `uq_invoice_occurrence` dropped, app intact  → this file GREEN (the row lock and the check
//                                                    refuse), invariants.test.ts' I9 case RED.
//                                                    The index is what holds for a path with no lock
//   - the row lock and the existence check removed, index present
//                                                  → GREEN: twenty concurrent calls, one invoice,
//                                                    nineteen `already_generated` translated from 23505
//   - both removed                                 → four cases RED: two LIVE invoices for one period,
//                                                    sequentially and concurrently. The double bill
//                                                    this phase exists to prevent, observed
//   - a unique index that also counts voids        → the void/replacement case RED (P7)

import { beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing recurrence: generate, idempotency, voids, the cap',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing recurrence (integration)', () => {
  type Ctx = { workspaceId: number; actorUserId: number; via: 'token'; actorEmail: string; isOwner: boolean }
  let ctx: Ctx
  let q: {
    invoices: typeof import('./invoices')
    lifecycle: typeof import('./lifecycle')
    companies: typeof import('./companies')
    recurrences: typeof import('./recurrences')
    audit: typeof import('./audit')
  }
  let exec: (s: import('drizzle-orm').SQL) => Promise<{ rows: Record<string, unknown>[] }>
  let sql: typeof import('drizzle-orm')['sql']
  let today: string

  const refusalOf = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return e as { status: number; code: string; message: string; suggestion: string }
    }
    throw new Error('expected a refusal, and the call succeeded')
  }

  /** A draft template in `company`, issued on `issueDate`. */
  const template = (issueDate: string, company = 'rec') =>
    q.invoices.createInvoice(ctx, {
      company,
      ref_type: 'SCOR',
      issue_date: issueDate,
      client: { name: 'Client SA', street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      items: [{ description: 'Maintenance', qty: '1', unit: 'forfait', unit_price: '480.00', vat_rate: '8.10' }],
      message: 'Maintenance',
    } as never)

  /** A series whose first generation is `start`'s period (the template was issued earlier). */
  const series = async (frequency: 'monthly' | 'quarterly' | 'yearly', start: string, total: number) => {
    const t = await template('2025-01-15')
    return q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency, start_date: start, occurrences_total: total, label_en: 'Test' })
  }

  const invoicesIn = async (seriesSeq: number) => (await q.recurrences.getRecurrence(ctx.workspaceId, seriesSeq))!.invoices!

  beforeAll(async () => {
    const { getDb } = await import('../client')
    ;({ sql } = await import('drizzle-orm'))
    const { todayInZurich } = await import('@/lib/derive/format')
    today = todayInZurich()
    exec = (s) => getDb().execute(s) as never
    q = {
      invoices: await import('./invoices'),
      lifecycle: await import('./lifecycle'),
      companies: await import('./companies'),
      recurrences: await import('./recurrences'),
      audit: await import('./audit'),
    }
    const workspaces = await import('./workspaces')
    const who = await exec(sql`SELECT current_user`)
    process.stderr.write(`\n  recurrence integration suite running as: ${(who.rows[0] as { current_user: string }).current_user}\n`)
    const u = await exec(sql`SELECT id, email FROM platform.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`)
    const user = u.rows[0] as { id: number; email: string } | undefined
    if (!user) throw new Error('no user in platform.users — sign up locally first')
    const ws = await workspaces.createWorkspaceForUser(user.id, `itest-recurrence-${Date.now()}`)
    ctx = { workspaceId: ws.id, actorUserId: user.id, via: 'token', actorEmail: user.email, isOwner: true }
    await q.companies.createCompany(ctx, {
      slug: 'rec',
      name: 'Recurring SA',
      legal_name: 'Recurring SA',
      address: { street: 'Rue du Test', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      email: 'billing@rec.example',
      iban: 'CH9300762011623852957',
      vat_registered: true,
      number_format: 'RC-{SEQ4}',
    })
  })

  it('generate twice for one period: one invoice, one 409 naming it, the counter advanced once', async () => {
    const s = await series('quarterly', '2026-01-05', 8)
    expect([s.occurrences_done, s.next_period]).toEqual([0, '2026-Q1'])
    const first = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-Q1' })
    expect(first.replacement).toBe(false)
    expect(first.recurrence.occurrences_done).toBe(1)
    expect(first.recurrence.next_date).toBe('2026-04-05')

    const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-Q1' }))
    expect([e.status, e.code]).toEqual([409, 'already_generated'])
    expect(e.message).toContain(first.invoice.number)
    expect(e.suggestion).toContain(`bk billing invoice show ${first.invoice.seq}`)
    const after = (await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!
    expect(after.occurrences_done).toBe(1)
    expect((await invoicesIn(s.seq)).filter((i) => i.occurrence_period === '2026-Q1')).toHaveLength(1)
  })

  it('twenty concurrent generates for one period produce ONE invoice, and nineteen named refusals', async () => {
    const s = await series('monthly', '2026-03-10', 12)
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-03' })))
    const ok = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(refused.map((r) => (r.reason as { code?: string }).code)).toEqual(Array(19).fill('already_generated'))
    expect((await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!.occurrences_done).toBe(1)
    expect((await invoicesIn(s.seq)).filter((i) => i.occurrence_period === '2026-03')).toHaveLength(1)
  }, 60_000)

  it('a voided occurrence frees its period; the replacement keeps the counter where it was', async () => {
    const s = await series('monthly', '2026-05-01', 6)
    const may = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-05' })
    await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-06' })
    expect((await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!.occurrences_done).toBe(2)

    // Before the void, May is taken.
    expect((await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-05' }))).code).toBe('already_generated')
    await q.lifecycle.voidInvoice(ctx, String(may.invoice.seq), { reason_en: 'wrong client' })
    const again = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-05' })
    expect(again.replacement).toBe(true)
    expect(again.recurrence.occurrences_done).toBe(2)
    expect(again.recurrence.next_period).toBe('2026-07')
    // The void keeps its number AND its series.
    const inMay = (await invoicesIn(s.seq)).filter((i) => i.occurrence_period === '2026-05')
    expect(inMay.map((i) => i.status).sort()).toEqual(['draft', 'void'])
    expect(again.invoice.seq_no).toBeGreaterThan(may.invoice.seq_no)
  })

  it('stops at its cap: the last generate completes it with no next date, and the next call is refused', async () => {
    const s = await series('yearly', '2027-02-01', 2)
    await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2027' })
    const last = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2028' })
    expect([last.recurrence.status, last.recurrence.occurrences_done, last.recurrence.next_date]).toEqual(['completed', 2, null])
    const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2029' }))
    expect([e.status, e.code]).toEqual([409, 'series_completed'])
    expect(e.suggestion).toContain('recurrence create')
    // Completion is final, and never set by hand.
    expect((await refusalOf(q.recurrences.editRecurrence(ctx, s.seq, { status: 'active' }))).code).toBe('series_completed')
    const s2 = await series('yearly', '2027-02-01', 3)
    expect((await refusalOf(q.recurrences.editRecurrence(ctx, s2.seq, { status: 'completed' }))).code).toBe('invalid_status')
  })

  it('a paused series refuses to generate and names resume; resumed, it generates', async () => {
    const s = await series('monthly', '2026-08-01', 3)
    const paused = await q.recurrences.editRecurrence(ctx, s.seq, { status: 'paused' })
    expect(paused.status).toBe('paused')
    const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-08' }))
    expect([e.status, e.code]).toEqual([409, 'series_paused'])
    expect(e.suggestion).toBe(`bk billing recurrence resume ${s.seq}`)
    await q.recurrences.editRecurrence(ctx, s.seq, { status: 'active' })
    expect((await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-08' })).recurrence.occurrences_done).toBe(1)
  })

  it('a wrong period is REFUSED, not corrected — a later one, an earlier one, and a mis-shaped one', async () => {
    const s = await series('quarterly', '2026-04-01', 4)
    const before = (await invoicesIn(s.seq)).length
    for (const period of ['2026-Q3', '2026-Q1']) {
      const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period }))
      expect([e.status, e.code], period).toEqual([409, 'period_not_expected'])
      expect(e.suggestion).toBe(`bk billing recurrence generate ${s.seq} --period 2026-Q2`)
    }
    const shape = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-04' }))
    expect([shape.status, shape.code]).toEqual([400, 'invalid_period'])
    expect((await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, {}))).code).toBe('period_required')
    expect((await invoicesIn(s.seq)).length).toBe(before)
    expect((await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!.occurrences_done).toBe(0)
  })

  it('a monthly series from the 31st: end of February, then the 31st of March', async () => {
    const s = await series('monthly', '2027-01-31', 4)
    const jan = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2027-01' })
    expect(jan.recurrence.next_date).toBe('2027-02-28')
    const feb = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2027-02' })
    expect(feb.recurrence.next_date).toBe('2027-03-31')
  })

  it('a series with no template lists and shows, and refuses to generate by name', async () => {
    const s = await series('monthly', '2026-01-01', 12)
    // The mockup's Häberli shape: its template is in the imported archive.
    await exec(sql`UPDATE billing.recurrence SET template_invoice_id = NULL WHERE workspace_id = ${ctx.workspaceId} AND seq = ${s.seq}`)
    const shown = (await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!
    expect([shown.template, shown.template_number]).toEqual([null, null])
    expect((await q.recurrences.listRecurrences(ctx.workspaceId, { limit: 200 })).data.some((r) => r.seq === s.seq)).toBe(true)
    const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-01' }))
    expect([e.status, e.code]).toEqual([409, 'no_template'])
  })

  it('an occurrence is an ordinary draft: the next number, the template’s content, the same audit row', async () => {
    const t = await template('2025-06-01')
    const s = await q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency: 'monthly', start_date: '2026-09-01', occurrences_total: 3 })
    const oneOff = await template('2026-09-01')
    const g = await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-09', message: 'Maintenance septembre' })
    const inv = g.invoice
    expect(inv.status).toBe('draft')
    expect(inv.seq_no).toBe(oneOff.seq_no + 1)
    expect([inv.recurrence, inv.occurrence_period]).toEqual([s.seq, '2026-09'])
    expect(inv.items.map((l) => [l.description, l.qty, l.unit_price, l.vat_rate])).toEqual(t.items.map((l) => [l.description, l.qty, l.unit_price, l.vat_rate]))
    expect(inv.totals).toEqual(t.totals)
    expect(inv.client).toEqual(t.client)
    expect(inv.message).toBe('Maintenance septembre')
    expect(inv.issue_date).toBe(today)
    expect(inv.ref_body).not.toBe(t.ref_body)
    // The same `created` row a hand-made invoice gets, plus the counter's row on the series.
    const created = (await q.audit.listAudit(ctx.workspaceId, { subjectType: 'invoice', limit: 200 })).data.filter((a) => a.action === 'created' && a.detail_en?.includes(inv.number))
    expect(created).toHaveLength(1)
    const rid = (await exec(sql`SELECT id FROM billing.recurrence WHERE workspace_id = ${ctx.workspaceId} AND seq = ${s.seq}`)).rows[0] as { id: number }
    const onSeries = (await q.audit.listAudit(ctx.workspaceId, { subjectType: 'recurrence', subjectId: rid.id })).data
    expect(onSeries.map((a) => [a.action, a.field, a.from_value, a.to_value])).toContainEqual(['field_changed', 'occurrences_done', '0', '1'])
  })

  it('a template issued in the start period IS the first occurrence — so this period is not billed twice', async () => {
    const t = await template('2026-10-03')
    const s = await q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency: 'quarterly', start_date: '2026-10-03', occurrences_total: 4 })
    expect([s.occurrences_done, s.next_period]).toEqual([1, '2027-Q1'])
    const tpl = (await q.invoices.getInvoice(ctx.workspaceId, String(t.seq)))!
    expect([tpl.recurrence, tpl.occurrence_period]).toEqual([s.seq, '2026-Q4'])
    expect((await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-Q4' }))).code).toBe('already_generated')
    // An invoice belongs to one series.
    const e = await refusalOf(q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency: 'yearly', start_date: '2027-01-01', occurrences_total: 2 }))
    expect(e.code).toBe('template_in_another_series')
  })

  it('refuses an open-ended series at the write door, and a total below what is done', async () => {
    const t = await template('2025-03-01')
    const missing = await refusalOf(q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency: 'monthly', start_date: '2026-01-01' }))
    expect(missing.code).toBe('occurrences_required')
    const s = await series('monthly', '2026-11-01', 5)
    await q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-11' })
    expect((await refusalOf(q.recurrences.editRecurrence(ctx, s.seq, { occurrences_total: 0 }))).code).toBe('invalid_occurrences')
    // Ending it now: the total set to what is done completes it.
    const ended = await q.recurrences.editRecurrence(ctx, s.seq, { occurrences_total: 1 })
    expect([ended.status, ended.next_date]).toEqual(['completed', null])
  })

  it('a generation refused by the create path leaves the counter where it was', async () => {
    // A company of its own, so retiring it disturbs no other case.
    await q.companies.createCompany(ctx, {
      slug: 'soon-retired',
      name: 'Retiring SA',
      legal_name: 'Retiring SA',
      address: { street: 'Rue', building: '1', postal_code: '1200', city: 'Genève', country: 'CH' },
      iban: 'CH9300762011623852957',
      vat_registered: true,
      number_format: 'SR-{SEQ4}',
    })
    const t = await template('2025-01-15', 'soon-retired')
    const s = await q.recurrences.createRecurrence(ctx, { template: String(t.seq), frequency: 'monthly', start_date: '2026-03-01', occurrences_total: 3 })
    await q.companies.editCompany(ctx, 'soon-retired', { retired_at: new Date() } as never)
    const e = await refusalOf(q.recurrences.generateOccurrence(ctx, s.seq, { period: '2026-03' }))
    expect(e.code).toBe('company_retired')
    const after = (await q.recurrences.getRecurrence(ctx.workspaceId, s.seq))!
    expect([after.occurrences_done, after.next_period]).toEqual([0, '2026-03'])
  })

  it('--due lists exactly the active series whose date has arrived', async () => {
    const past = await series('monthly', '2026-01-15', 3)
    const future = await series('yearly', '2099-01-01', 2)
    const paused = await series('monthly', '2026-02-15', 3)
    await q.recurrences.editRecurrence(ctx, paused.seq, { status: 'paused' })
    const due = (await q.recurrences.listRecurrences(ctx.workspaceId, { due: true, limit: 200 })).data.map((r) => r.seq)
    expect(due).toContain(past.seq)
    expect(due).not.toContain(future.seq)
    expect(due).not.toContain(paused.seq)
    const all = (await q.recurrences.listRecurrences(ctx.workspaceId, { limit: 200 })).data
    expect(all.find((r) => r.seq === past.seq)!.due).toBe(true)
    expect(all.find((r) => r.seq === future.seq)!.due).toBe(false)
  })

  it('as billing_app: a series can be read, created and advanced, never deleted', async () => {
    const s = await series('monthly', '2026-12-01', 2)
    const where = sql`workspace_id = ${ctx.workspaceId} AND seq = ${s.seq}`
    expect((await exec(sql`SELECT count(*)::int AS n FROM billing.recurrence WHERE ${where}`)).rows[0]).toEqual({ n: 1 })
    let code: string | undefined
    try {
      await exec(sql`DELETE FROM billing.recurrence WHERE ${where}`)
    } catch (e) {
      for (let x = e as { code?: string; cause?: unknown } | undefined; x; x = x.cause as typeof x) if (typeof x.code === 'string') code = x.code
    }
    expect(code).toBe('42501')
  })
})
