// `lib/db/schema.ts` agrees with the database the migrations built.
//
// ===========================================================================
// WHY THIS FILE EXISTS, AND WHO ASKED FOR IT
// ===========================================================================
// `schema.ts` is a MIRROR, not a source. `db:generate` cannot be used on this app
// (see `0001_books_init.sql`'s header: the `platform.*` re-export would have books
// owning the shared schema), so the migrations are hand-written SQL and these
// declarations are typed by hand to match. Two hand-maintained descriptions of one
// schema is exactly the arrangement that drifts.
//
// When they disagree the SQL is right and this file is the bug. A missing column
// here does not fail a build: it fails a query at runtime, on the one code path
// that reads it.
//
// It was CITED in `schema.ts` before it was written, and
// `packages/platform-testing/test/cited-tests-exist.test.ts` caught that on
// 2026-08-17 — a citation is a claim about what the repo protects, and a reader
// deciding whether a change is safe takes it as one. That guard was right and this
// is the debt it collected.
//
// Skips loudly without a database, for the reason `guards.test.ts` sets out: "no
// database" and "verified" must never look the same.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn(
    '\n  lib/db/schema-parity.test.ts SKIPPED: no DATABASE_URL.\n' +
      '  schema.ts was NOT checked against the real schema by this run.\n'
  )
}

d('schema.ts mirrors the migrated database', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let live: Map<string, Set<string>>
  let declared: Map<string, Set<string>>

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()

    const r = await db.execute(sql`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'books'`)
    live = new Map()
    for (const row of r.rows as { table_name: string; column_name: string }[]) {
      const cols = live.get(row.table_name) ?? new Set<string>()
      cols.add(row.column_name)
      live.set(row.table_name, cols)
    }

    // Every table this app DECLARES, discovered from the module rather than from a
    // hand-kept list — a list here would be the third copy of the same fact.
    const schema = await import('./schema')
    declared = new Map()
    for (const value of Object.values(schema)) {
      let cfg: ReturnType<typeof getTableConfig>
      try {
        cfg = getTableConfig(value as never)
      } catch {
        continue // not a table (a type, a helper, the pgSchema itself)
      }
      // ── FILTER ON THE POSTGRES SCHEMA, NOT THE TABLE NAME ──────────────────
      // `export *` from platform-db puts `platform.workspaces` in this namespace
      // under the bare name `workspaces`, which is also what `books.workspaces` is
      // called. Keying on the name alone let the platform table overwrite this
      // app's, and the test then reported three phantom missing columns
      // (`logo_url`, `deleted_at`, `storage_limit_bytes`) that belong to the
      // platform table and were never expected here.
      //
      // That is the mirror image of the hazard schema.ts's own header describes: a
      // bare `workspaces` shadowing the platform one SILENTLY. Worth knowing that
      // it bites readers of the schema as well as writers of it.
      if (cfg.schema !== 'books') continue
      declared.set(cfg.name, new Set(cfg.columns.map((c) => c.name)))
    }
  })

  it('found both sides (guards against a vacuous pass)', () => {
    expect(live.size, 'no books tables found in information_schema').toBeGreaterThan(10)
    expect(declared.size, 'no drizzle tables discovered in schema.ts').toBeGreaterThan(10)
  })

  it('declares every statutory table the migrations created', () => {
    // `books.statement_position` and `books.counters` are included deliberately:
    // both are real tables the app reads, not implementation details.
    const expectedTables = [
      'entity',
      'exercice',
      'account',
      'opening_balance',
      'source',
      'rule',
      'entry',
      'entry_line',
      'ri_entry',
      'patrimoine',
      'statement_position',
      'counters',
      'workspaces',
      'workspace_members',
      'invitations',
    ]
    for (const t of expectedTables) {
      expect(live.has(t), `books.${t} is missing from the database`).toBe(true)
      expect(declared.has(t), `books.${t} exists in Postgres but is not declared in schema.ts`).toBe(true)
    }
  })

  it('has no table in the database that schema.ts does not declare', () => {
    const undeclared = [...live.keys()].filter((t) => !declared.has(t))
    expect(
      undeclared,
      'these tables exist in the books schema and nothing in schema.ts describes them, so no query can reach them:\n' +
        undeclared.join('\n')
    ).toEqual([])
  })

  it('declares no table that the database does not have', () => {
    const phantom = [...declared.keys()].filter((t) => !live.has(t))
    expect(
      phantom,
      'schema.ts declares tables that do not exist — a query against one fails at runtime:\n' + phantom.join('\n')
    ).toEqual([])
  })

  it('matches column for column, in both directions', () => {
    const problems: string[] = []
    for (const [table, declaredCols] of declared) {
      const liveCols = live.get(table)!
      for (const c of declaredCols) {
        if (!liveCols.has(c)) problems.push(`books.${table}.${c} declared in schema.ts, absent from Postgres`)
      }
      for (const c of liveCols) {
        // Missing in the mirror is the more dangerous direction: the column holds
        // data no query can read, and nothing else in the repo reports it.
        if (!declaredCols.has(c)) problems.push(`books.${table}.${c} exists in Postgres, absent from schema.ts`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('has dropped the scaffold placeholder from both sides', () => {
    // 0007 removed it. If either side still carries it, the removal was partial —
    // and a half-removed table is worse than one left alone.
    expect(live.has('notes'), 'books.notes still exists in Postgres').toBe(false)
    expect(live.has('note_counters'), 'books.note_counters still exists in Postgres').toBe(false)
    expect(declared.has('notes'), 'schema.ts still declares notes').toBe(false)
  })

  it('agrees on which migrations have been applied', async () => {
    const journal = await import('./migrations/meta/_journal.json')
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations_books`)
    const applied = Number((r.rows[0] as { n: number }).n)
    // A journal entry with no applied row means somebody has not migrated; the
    // reverse means a migration was applied and then deleted from the journal,
    // which Drizzle cannot reconcile and a human has to.
    expect(applied, `${journal.default.entries.length} migrations in the journal, ${applied} applied`).toBe(
      journal.default.entries.length
    )
  })
})
