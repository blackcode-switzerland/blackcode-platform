// Imported history against a real database, as `billing_app` (phase 5).
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/db/queries/history.integration.test.ts
//
// Runs as the APP ROLE, which is what a request runs as — so "billing_app cannot
// UPDATE a history row" is checked as that role, with the positive half (it CAN
// read and insert) asserted first, because a role granted nothing refuses
// everything (CLAUDE.md finding #16). The owner-only half — the trigger that
// stops the owner too — is `lib/db/owner-guards.integration.test.ts`.
//
// Archive rows cannot be deleted, by anyone, so each run leaves one
// `itest-history-<timestamp>` workspace behind in the local database. That is
// the guard working, not the test being untidy.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md
// ===========================================================================

import { beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing imported history: import, duplicates, race, read-only',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing imported history (integration)', () => {
  let getDb: typeof import('../client')['getDb']
  let sql: typeof import('drizzle-orm')['sql']
  let history: typeof import('./history')
  let rowsFor: () => import('@/types').ImportHistoryRow[]
  let ctx: { workspaceId: number; actorUserId: number; via: 'token' }

  const count = async (where = sql`TRUE`) => {
    const r = await getDb().execute<{ n: number }>(
      sql`SELECT COUNT(*)::int AS n FROM billing.history WHERE workspace_id = ${ctx.workspaceId} AND ${where}`
    )
    return Number(r.rows[0].n)
  }

  /** The refusal a promise rejected with, or a failure naming what happened instead. */
  const refusalOf = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return e as InstanceType<typeof history.HistoryRefused>
    }
    throw new Error('expected a refusal, and the call succeeded')
  }

  beforeAll(async () => {
    ;({ getDb } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    history = await import('./history')
    const { mockupHistoryRows } = await import('@/lib/mockup')
    const workspaces = await import('./workspaces')
    const companies = await import('./companies')

    const who = await getDb().execute<{ current_user: string }>(sql`SELECT current_user`)
    process.stderr.write(`\n  history integration suite running as: ${who.rows[0]?.current_user}\n`)

    const u = await getDb().execute<{ id: number }>(sql`SELECT id FROM platform.users ORDER BY id LIMIT 1`)
    const user = u.rows[0]
    if (!user) throw new Error('no user in platform.users — sign up locally first')

    const stamp = Date.now()
    const ws = await workspaces.createWorkspaceForUser(user.id, `itest-history-${stamp}`)
    ctx = { workspaceId: ws.id, actorUserId: user.id, via: 'token' }
    for (const slug of ['blackcode', 'aurora']) {
      await companies.createCompany(
        { workspaceId: ws.id, actorUserId: user.id, via: 'token', isOwner: true },
        { slug, name: `${slug} SA`, number_format: 'IT-{SEQ4}' } as never
      )
    }
    rowsFor = () => mockupHistoryRows((id) => (id === 1 ? 'blackcode' : 'aurora'))
  })

  it('imports the mockup’s fourteen rows, contiguously, and names what it wrote', async () => {
    const res = await history.importHistory(ctx, { rows: rowsFor() })
    expect(res.imported).toBe(14)
    expect(res.flagged).toBe(5)
    expect(res.without_pdf).toBe(2)
    const seqs = res.rows.map((r) => r.seq)
    expect(seqs).toEqual(Array.from({ length: 14 }, (_, i) => seqs[0] + i))
    // What was stored is what was sent: the money as the same string, the ids
    // untouched, the flag in both languages.
    const sent = rowsFor()
    expect(res.rows.map((r) => [r.source, r.source_ref, r.number, r.total, r.currency, r.import_flag, r.drive_path])).toEqual(
      sent.map((r) => [r.source, r.source_ref, r.number, r.total, r.currency, r.import_flag, r.drive_path])
    )
    expect(await count()).toBe(14)
  })

  it('refuses a second import of the same file with a 409 naming every row, and writes nothing', async () => {
    const e = await refusalOf(history.importHistory(ctx, { rows: rowsFor() }))
    expect(e).toBeInstanceOf(history.HistoryRefused)
    expect(e.status).toBe(409)
    expect(e.code).toBe('already_imported')
    expect(e.message).toMatch(/^14 of 14 rows are already in the archive, so nothing was written: /)
    expect(e.message).toMatch(/invoicely "INV-0184" is #\d+/)
    expect(await count()).toBe(14)
  })

  it('refuses a batch with ONE already-imported row as a whole', async () => {
    const fresh = { ...rowsFor()[0], source_ref: `NEW-${Date.now()}` }
    const e = await refusalOf(history.importHistory(ctx, { rows: [fresh, rowsFor()[1]] }))
    expect(e.code).toBe('already_imported')
    expect(e.message).toMatch(/^1 of 2 rows/)
    expect(await count(sql`source_ref = ${fresh.source_ref}`)).toBe(0)
  })

  it('twenty concurrent imports of one row insert exactly one, and refuse the rest by name', async () => {
    const row = { ...rowsFor()[0], source_ref: `RACE-${Date.now()}` }
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => history.importHistory(ctx, { rows: [row] })))
    const ok = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    // Every loser is the NAMED refusal — not a bare constraint error, not a 500.
    expect(refused.map((r) => (r.reason as { code?: string }).code)).toEqual(Array(19).fill('already_imported'))
    expect(await count(sql`source_ref = ${row.source_ref}`)).toBe(1)
  }, 60_000)

  it('stores a padded source_ref byte for byte', async () => {
    const padded = `  PAD-${Date.now()} \t`
    const res = await history.importHistory(ctx, { rows: [{ ...rowsFor()[0], source_ref: padded }] })
    const back = await history.getHistory(ctx.workspaceId, res.rows[0].seq)
    expect(back?.source_ref).toBe(padded)
    const raw = await getDb().execute<{ ok: boolean }>(
      sql`SELECT source_ref = ${padded} AS ok FROM billing.history WHERE workspace_id = ${ctx.workspaceId} AND seq = ${res.rows[0].seq}`
    )
    expect(raw.rows[0].ok).toBe(true)
  })

  it('refuses a row naming a company this workspace does not have, writing nothing', async () => {
    const before = await count()
    const e = await refusalOf(history.importHistory(ctx, { rows: [{ ...rowsFor()[0], source_ref: `X-${Date.now()}`, company: 'nobody' }] }))
    expect(e.code).toBe('unknown_company')
    expect(await count()).toBe(before)
  })

  describe('as billing_app: read and insert, never update or delete', () => {
    it('CAN select (the positive half, first)', async () => {
      expect(await count()).toBeGreaterThan(0)
    })

    for (const [what, stmt] of [
      ['UPDATE', (ws: number) => sql`UPDATE billing.history SET total = 0 WHERE workspace_id = ${ws}`],
      ['DELETE', (ws: number) => sql`DELETE FROM billing.history WHERE workspace_id = ${ws}`],
    ] as const) {
      it(`cannot ${what} — refused by the privilege, before any trigger`, async () => {
        let code: string | undefined
        try {
          await getDb().execute(stmt(ctx.workspaceId))
        } catch (e) {
          for (let x = e as { code?: string; cause?: unknown } | undefined; x; x = x.cause as typeof x) {
            if (typeof x.code === 'string') code = x.code
          }
        }
        expect(code, `${what} should be refused with 42501 (insufficient privilege)`).toBe('42501')
      })
    }
  })

  describe('the list', () => {
    const all = async () => {
      const out: import('@/types').HistoryEntry[] = []
      let cursor: number | undefined
      for (let i = 0; i < 50; i++) {
        const page = await history.listHistory(ctx.workspaceId, { limit: 4, cursor })
        out.push(...page.data)
        if (page.next_cursor === null) return out
        cursor = page.next_cursor
      }
      throw new Error('pagination did not terminate')
    }

    it('pages through everything once, newest bill first', async () => {
      const paged = await all()
      const seqs = paged.map((r) => r.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(paged.length).toBe(await count())
      const keys = paged.map((r) => `${r.issue_date}#${String(r.seq).padStart(8, '0')}`)
      expect(keys).toEqual([...keys].sort().reverse())
    })

    it('filters by year, source, currency, company and flag', async () => {
      const mock = (await history.listHistory(ctx.workspaceId, { limit: 200 })).data.filter((r) =>
        rowsFor().some((m) => m.source === r.source && m.source_ref === r.source_ref)
      )
      expect(mock).toHaveLength(14)
      const y2024 = await history.listHistory(ctx.workspaceId, { year: 2024, limit: 200 })
      expect(y2024.data.every((r) => r.issue_date.startsWith('2024-'))).toBe(true)
      expect(y2024.data.filter((r) => mock.some((m) => m.seq === r.seq)).map((r) => r.source_ref).sort()).toEqual([
        'ZB-000203',
        'ZB-000219',
        'ZB-000241',
      ])
      const usd = await history.listHistory(ctx.workspaceId, { currency: 'USD', limit: 200 })
      expect(usd.data.map((r) => [r.source_ref, r.total, r.drive_path])).toEqual([['INV-0260', '7500.00', null]])
      const flagged = await history.listHistory(ctx.workspaceId, { flagged: true, limit: 200 })
      expect(flagged.data.every((r) => r.import_flag !== null && r.import_flag.fr && r.import_flag.en)).toBe(true)
      expect(flagged.data.filter((r) => mock.some((m) => m.seq === r.seq))).toHaveLength(5)
      const aurora = await history.listHistory(ctx.workspaceId, { company: 'aurora', limit: 200 })
      expect(aurora.data.map((r) => r.number)).toEqual(['AL-0096'])
    })

    it('refuses a cursor naming no row, rather than starting again', async () => {
      const e = await refusalOf(history.listHistory(ctx.workspaceId, { cursor: 99_999_999 }))
      expect(e.code).toBe('invalid_cursor')
    })
  })
})
