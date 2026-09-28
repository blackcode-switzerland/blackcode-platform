// `verifyToken` stamps `last_used_at` at most once per UTC day.
//
// It runs on every authenticated request, so an agent loop used to write a row
// per call and wake the database for a value the only reader (a date in the
// token list) never shows at that precision. No database needed: the handle is
// a recorder, and the assertion is on the statements it was asked to run.
//
// The POSITIVE cases matter as much as the skip. A verify that never stamped
// would pass "does not update on the same day" for free, so the first two cases
// assert that an UPDATE IS issued — for a never-used token and for one last used
// on an earlier day — and the token is still resolved to its user in all four.

import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { verifyToken } from '@blackcode/platform-auth/tokens'

const PLAINTEXT = 'bk_live_test-secret'
const HASH = createHash('sha256').update(PLAINTEXT).digest('hex')
const dialect = new PgDialect()

function recorder(lastUsedAt: Date | null) {
  const statements: string[] = []
  const db = {
    async execute(q: SQL) {
      const text = dialect.sqlToQuery(q).sql
      statements.push(text)
      if (/from\s+"platform"\."api_tokens"/i.test(text) && /^\s*select/i.test(text)) {
        return {
          rows: [
            { id: 7, user_id: 3, token_hash: HASH, expires_at: null, last_used_at: lastUsedAt },
          ],
        }
      }
      if (/^\s*select\s+\*\s+from/i.test(text)) return { rows: [{ id: 3, email: 'a@b.test' }] }
      return { rows: [] }
    },
  }
  return { db: db as never, updates: () => statements.filter((s) => /^\s*update/i.test(s)) }
}

describe('verifyToken — last_used_at is day-granular', () => {
  it('stamps a token that has never been used', async () => {
    const r = recorder(null)
    const user = await verifyToken(r.db, PLAINTEXT)
    expect(user?.id).toBe(3)
    expect(r.updates()).toHaveLength(1)
  })

  it('stamps a token last used on an earlier day', async () => {
    const r = recorder(new Date(Date.now() - 36 * 3600 * 1000))
    const user = await verifyToken(r.db, PLAINTEXT)
    expect(user?.id).toBe(3)
    expect(r.updates()).toHaveLength(1)
  })

  it('issues no UPDATE when the token was already used today', async () => {
    const r = recorder(new Date())
    const user = await verifyToken(r.db, PLAINTEXT)
    expect(user?.id).toBe(3)
    expect(r.updates()).toHaveLength(0)
  })

  it('still refuses an unknown token', async () => {
    const r = recorder(new Date())
    const db = { execute: async () => ({ rows: [] }) } as never
    expect(await verifyToken(db, PLAINTEXT)).toBeNull()
    expect(r.updates()).toHaveLength(0)
  })
})
