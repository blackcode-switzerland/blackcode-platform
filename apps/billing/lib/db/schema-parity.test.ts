// `lib/db/schema.ts` mirrors the migrated database: every table, every column,
// its TYPE and its NULLABILITY, in both directions.
//
// ===========================================================================
// WHY IT EXISTS NOW, AND WHAT IT SAYS ABOUT THE PAST
// ===========================================================================
// `schema.ts` has said since phase 1 that this file "reads both and fails when
// they do" drift. It did not exist. A cited-tests guard is supposed to catch
// exactly that (CLAUDE.md finding #18), and it did not either: it resolved the
// citation to `apps/books`' file of the same name. Both were found on
// 2026-09-18 — the guard is fixed in packages/platform-testing, and this is the
// test the comment promised.
//
// Every migration here is HAND-WRITTEN SQL and `schema.ts` is typed separately,
// so the two can disagree silently: a column added to a migration and not to
// the mirror is unreachable from every query, and a width or a nullability that
// differs is a value one side accepts and the other refuses.
//
// ── WHAT IT COMPARES, AND HOW ──────────────────────────────────────────────
// Types through `format_type()` from `pg_attribute` — the catalog, not the repo
// (finding #20) — against Drizzle's `getSQLType()`, spelled the same way.
// Books' version compares names only; a `numeric(14,2)` declared as
// `numeric(12,2)` passes a name check.
//
// It runs as `billing_app` (TEST_DATABASE_URL), which can read the catalog for
// its own schema but not Drizzle's migration ledger — so "every migration is
// applied" is not asserted here, and a stale local database shows up as the
// drift it causes instead.
//
// WATCHED FAILING, 2026-09-18 — each restored; recorded in apps/billing/docs/backend.md

import { beforeAll, describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing schema.ts mirrors the migrated database',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

/** A column as both sides can state it: `type` in `format_type` spelling, and NOT NULL. */
interface Col {
  type: string
  notNull: boolean
}

/**
 * Drizzle's spelling → `format_type()`'s. A `serial` IS an integer with a
 * default, and `varchar(40)` is how Postgres says `character varying(40)`.
 */
function normalise(drizzleType: string): string {
  return drizzleType
    .replace(/^bigserial$/, 'bigint')
    .replace(/^serial$/, 'integer')
    .replace(/^varchar\((\d+)\)$/, 'character varying($1)')
    .replace(/^char\((\d+)\)$/, 'character($1)')
    .replace(/^numeric\((\d+), (\d+)\)$/, 'numeric($1,$2)')
}

run('billing schema.ts mirrors the migrated database (integration)', () => {
  let live: Map<string, Map<string, Col>>
  let declared: Map<string, Map<string, Col>>

  beforeAll(async () => {
    const { getDb } = await import('./client')
    const { sql } = await import('drizzle-orm')
    const r = await getDb().execute<{ tbl: string; col: string; type: string; not_null: boolean }>(sql`
      SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'billing' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`)
    live = new Map()
    for (const row of r.rows) {
      const t = live.get(row.tbl) ?? new Map<string, Col>()
      t.set(row.col, { type: row.type, notNull: row.not_null })
      live.set(row.tbl, t)
    }

    const schema = await import('./schema')
    declared = new Map()
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>
      try {
        cfg = getTableConfig(value as never)
      } catch {
        continue // a type, a helper, the pgSchema object itself
      }
      if (cfg.schema !== 'billing') continue
      declared.set(
        cfg.name,
        new Map(cfg.columns.map((c) => [c.name, { type: normalise(c.getSQLType()), notNull: c.notNull }]))
      )
    }
  })

  it('found both sides (guards against a vacuous pass)', () => {
    expect(live.size, 'no billing tables visible in pg_attribute — is this billing_app on the right database?').toBeGreaterThanOrEqual(10)
    expect(declared.size, 'no billing tables discovered in schema.ts').toBeGreaterThanOrEqual(10)
  })

  it('has the same tables on both sides', () => {
    const undeclared = [...live.keys()].filter((t) => !declared.has(t)).map((t) => `billing.${t} is in Postgres, not in schema.ts`)
    const phantom = [...declared.keys()].filter((t) => !live.has(t)).map((t) => `billing.${t} is in schema.ts, not in Postgres`)
    expect([...undeclared, ...phantom]).toEqual([])
  })

  it('matches column for column: name, type and nullability, both directions', () => {
    const problems: string[] = []
    for (const [table, cols] of declared) {
      const liveCols = live.get(table)
      if (!liveCols) continue // reported by the case above
      for (const [name, d] of cols) {
        const l = liveCols.get(name)
        if (!l) {
          problems.push(`billing.${table}.${name}: declared in schema.ts, absent from Postgres`)
          continue
        }
        if (l.type !== d.type) problems.push(`billing.${table}.${name}: Postgres ${l.type}, schema.ts ${d.type}`)
        if (l.notNull !== d.notNull) {
          problems.push(`billing.${table}.${name}: Postgres ${l.notNull ? 'NOT NULL' : 'nullable'}, schema.ts ${d.notNull ? 'notNull()' : 'nullable'}`)
        }
      }
      for (const name of liveCols.keys()) {
        if (!cols.has(name)) problems.push(`billing.${table}.${name}: in Postgres, absent from schema.ts`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
})
