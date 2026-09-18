// The database guards that only the MIGRATION OWNER can exercise.
//
// ===========================================================================
// WHY A SECOND CREDENTIAL
// ===========================================================================
// `write-paths.integration.test.ts` runs as `billing_app`, which is right for
// everything a request can do. But the statements here are ones the app role
// may not issue at all — a hard `DELETE FROM platform.users`, an `UPDATE` on a
// table whose UPDATE is revoked — and a refusal from a role that lacks the
// privilege says nothing about the TRIGGER behind it. That is CLAUDE.md finding
// #16: a denial from a subject that could do nothing proves nothing.
//
// So this suite connects as the owner, which is the one identity the triggers
// exist to stop, and it runs every case inside a transaction it rolls back.
// Nothing it does survives it.
//
//   TEST_OWNER_DATABASE_URL=postgres://blackcode:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/db/owner-guards.integration.test.ts
//
// ===========================================================================
// WATCHED FAILING, 2026-09-18 — each restored
// ===========================================================================
//   run against the database BEFORE 0009 was applied (0005's function in
//   place) → the erasure case red with 0005's own message, "billing.audit is
//   append-only"; the two refusal cases green, as they should be. Applied, 3/3.
//   `pg_proc` read back afterwards: the exemption is in the function
//   the exemption without "and nothing else changed" (any UPDATE that nulls the
//   actor allowed) → only the combined-change case red. Restored by replaying
//   0009, `pg_proc` read back, 3/3

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient } from 'pg'
import { integrationDescribe } from '@blackcode/platform-testing'

const OWNER_DB = process.env.TEST_OWNER_DATABASE_URL

const run = integrationDescribe({
  describe,
  name: 'billing owner-only guards: audit erasure, history read-only',
  databaseUrl: OWNER_DB,
  envVar: 'TEST_OWNER_DATABASE_URL',
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing owner-only guards (integration, rolled back)', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: OWNER_DB, max: 2 })
  })
  afterAll(async () => {
    await pool?.end()
  })

  /**
   * Run `fn` in a transaction that is ALWAYS rolled back, and hand back what it
   * returned or the error it threw. A failed statement aborts a Postgres
   * transaction, so each case gets its own.
   */
  async function rolledBack<T>(fn: (c: PoolClient) => Promise<T>): Promise<T | Error> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      return await fn(c)
    } catch (e) {
      return e as Error
    } finally {
      await c.query('ROLLBACK').catch(() => undefined)
      c.release()
    }
  }

  /** A user, a workspace owned by a SECOND user (so RESTRICT cannot interfere), and the user's id. */
  async function fixture(c: PoolClient): Promise<{ userId: number; workspaceId: number }> {
    const tag = `owner-guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const owner = await c.query<{ id: number }>(
      `INSERT INTO platform.users (email, name) VALUES ($1, 'owner') RETURNING id`,
      [`${tag}-owner@example.invalid`]
    )
    const user = await c.query<{ id: number }>(
      `INSERT INTO platform.users (email, name) VALUES ($1, 'author') RETURNING id`,
      [`${tag}-author@example.invalid`]
    )
    const ws = await c.query<{ id: number }>(
      `INSERT INTO billing.workspaces (name, slug, owner_id) VALUES ($1, $1, $2) RETURNING id`,
      [tag.slice(0, 40), owner.rows[0].id]
    )
    return { userId: user.rows[0].id, workspaceId: ws.rows[0].id }
  }

  async function auditRow(c: PoolClient, workspaceId: number, userId: number): Promise<number> {
    const r = await c.query<{ id: number }>(
      `INSERT INTO billing.audit (workspace_id, seq, subject_type, subject_id, actor_user_id, via, action, detail_en)
       VALUES ($1, 1, 'invoice', 1, $2, 'token', 'created', 'probe') RETURNING id`,
      [workspaceId, userId]
    )
    return r.rows[0].id
  }

  async function historyRow(c: PoolClient, workspaceId: number, userId: number): Promise<number> {
    const co = await c.query<{ id: number }>(
      `INSERT INTO billing.company (workspace_id, seq, slug, name, legal_name) VALUES ($1, 1, 'probe', 'Probe', 'Probe SA') RETURNING id`,
      [workspaceId]
    )
    const r = await c.query<{ id: number }>(
      `INSERT INTO billing.history (workspace_id, seq, source, source_ref, company_id, number, client_name,
                                    issue_date, currency, total, status, imported_by, imported_via)
       VALUES ($1, 1, 'zoho', 'ZB-PROBE', $2, '2020-001', 'Client', '2020-01-01', 'CHF', '100.00', 'paid', $3, 'token')
       RETURNING id`,
      [workspaceId, co.rows[0].id, userId]
    )
    return r.rows[0].id
  }

  describe('billing.history (0010)', () => {
    it('refuses an UPDATE from the owner', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await historyRow(c, workspaceId, userId)
        await c.query(`UPDATE billing.history SET total = '1.00' WHERE id = $1`, [id])
        return 'updated'
      })
      expect(out).toBeInstanceOf(Error)
      expect((out as Error).message).toMatch(/read-only archive \(UPDATE/)
    })

    it('refuses a DELETE from the owner', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await historyRow(c, workspaceId, userId)
        await c.query(`DELETE FROM billing.history WHERE id = $1`, [id])
        return 'deleted'
      })
      expect(out).toBeInstanceOf(Error)
      expect((out as Error).message).toMatch(/read-only archive \(DELETE/)
    })

    it('lets a hard DELETE of the importer clear imported_by, and keeps the row', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await historyRow(c, workspaceId, userId)
        await c.query('DELETE FROM platform.users WHERE id = $1', [userId])
        const r = await c.query('SELECT imported_by, source_ref, total FROM billing.history WHERE id = $1', [id])
        return r.rows[0]
      })
      expect(out).not.toBeInstanceOf(Error)
      expect(out).toEqual({ imported_by: null, source_ref: 'ZB-PROBE', total: '100.00' })
    })

    it('refuses a drive_path on the blob store, and a flag in one language, at the CHECK', async () => {
      for (const [col, val, constraint] of [
        ['drive_path', 'https://x.public.blob.vercel-storage.com/a.pdf', 'history_drive_path_shape'],
        ['import_flag_en', 'only English', 'history_flag_both_languages'],
      ] as const) {
        const out = await rolledBack(async (c) => {
          const { userId, workspaceId } = await fixture(c)
          const co = await c.query<{ id: number }>(
            `INSERT INTO billing.company (workspace_id, seq, slug, name, legal_name) VALUES ($1, 1, 'probe', 'Probe', 'Probe SA') RETURNING id`,
            [workspaceId]
          )
          await c.query(
            `INSERT INTO billing.history (workspace_id, seq, source, source_ref, company_id, number, client_name,
                                          issue_date, currency, total, status, imported_by, imported_via, ${col})
             VALUES ($1, 1, 'zoho', 'ZB-PROBE', $2, '2020-001', 'Client', '2020-01-01', 'CHF', '100.00', 'paid', $3, 'token', $4)`,
            [workspaceId, co.rows[0].id, userId, val]
          )
          return 'inserted'
        })
        expect(out, col).toBeInstanceOf(Error)
        expect((out as Error & { constraint?: string }).constraint, col).toBe(constraint)
      }
    })
  })

  describe('billing.audit (0009)', () => {
    it('lets a hard DELETE of the author clear actor_user_id, and keeps the row', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await auditRow(c, workspaceId, userId)
        await c.query('DELETE FROM platform.users WHERE id = $1', [userId])
        const r = await c.query('SELECT actor_user_id, action, detail_en FROM billing.audit WHERE id = $1', [id])
        return r.rows[0]
      })
      expect(out).not.toBeInstanceOf(Error)
      expect(out).toEqual({ actor_user_id: null, action: 'created', detail_en: 'probe' })
    })

    it('still refuses any other UPDATE, from the owner', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await auditRow(c, workspaceId, userId)
        await c.query(`UPDATE billing.audit SET detail_en = 'rewritten' WHERE id = $1`, [id])
        return 'updated'
      })
      expect(out).toBeInstanceOf(Error)
      expect((out as Error).message).toMatch(/append-only/)
    })

    it('refuses clearing the actor TOGETHER with another change', async () => {
      const out = await rolledBack(async (c) => {
        const { userId, workspaceId } = await fixture(c)
        const id = await auditRow(c, workspaceId, userId)
        await c.query(`UPDATE billing.audit SET actor_user_id = NULL, action = 'voided' WHERE id = $1`, [id])
        return 'updated'
      })
      expect(out).toBeInstanceOf(Error)
      expect((out as Error).message).toMatch(/append-only/)
    })
  })
})
