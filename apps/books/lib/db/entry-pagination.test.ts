// The grand livre states how long it is, and where to resume — issue #69.
//
// ===========================================================================
// A LIST THAT STOPPED AT 100 AND SAID IT WAS COMPLETE
// ===========================================================================
// `listEntries` capped at `limit ?? 100` and the route paired it with
// `next_cursor: null`. On this platform that pair MEANS "that is all of them",
// so a book with 115 écritures served 100 and asserted there were no more.
// Found 2026-08-21 on `bala/northgate`, which has exactly 115.
//
// Two things are asserted here, and the second is the one the ticket could not
// see from outside:
//
//   1. the page reports `total` and a real `next_cursor`, and walking the
//      cursor yields every entry exactly once, gaplessly;
//
//   2. `?account=` now filters the JOURNAL. It used to filter in JS AFTER the
//      limit, so an account whose only movement sits at entry 110 returned
//      NOTHING while the entry plainly existed — a second silent truncation
//      hiding inside the first.
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

const TOTAL = 115
/** The only movement on 1510, deliberately past the default page. */
const LATE = 110

d('the grand livre states its own length (#69)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'pg-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name)
      VALUES (${slug + '@example.test'}, 'pagination') RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('pagination', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, {
      slug: 'pg-sa', name: 'Pagination SA', legal_form: 'SA', bookkeeping_regime: 'double_entry',
    })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id

    // 115 entries, entry_no gapless from 1 — the shape northgate is in.
    await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, raw_label)
      SELECT ${ws}, ${entityId}, ${exerciceId}, g, g, DATE '2026-01-01' + (g || ' days')::interval,
             'ECRITURE ' || g
        FROM generate_series(1, ${TOTAL}) AS g`)

    // One line on 1510, on an entry past the first page. Nothing else touches it.
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, position, account_no, debit, credit)
      SELECT id, 1, '1510', '250.00', '0.00' FROM books.entry
       WHERE entity_id = ${entityId} AND entry_no = ${LATE}`)
  })

  it('reports the whole journal as its total, not the size of the page', async () => {
    const { listEntries } = await import('./queries/statutory')
    const page = await listEntries(entityId, exerciceId)

    expect(page.rows.length, 'the default page is still 100').toBe(100)
    expect(page.total, 'and it says how many there really are').toBe(TOTAL)
    expect(page.next_cursor, 'null used to mean "no more" and was a lie').toBe(100)
  })

  it('resumes from the cursor and ends by saying so', async () => {
    const { listEntries } = await import('./queries/statutory')
    const first = await listEntries(entityId, exerciceId)
    const second = await listEntries(entityId, exerciceId, { cursor: first.next_cursor! })

    expect(second.rows.length).toBe(TOTAL - 100)
    expect(second.total, 'the total is of the journal, not of what is left').toBe(TOTAL)
    expect(second.next_cursor, 'the last page is the one entitled to say null').toBeNull()
  })

  it('walking the cursor yields every entry exactly once, gaplessly', async () => {
    const { listEntries } = await import('./queries/statutory')
    const seen: number[] = []
    let cursor: number | undefined
    for (let guard = 0; guard < 20; guard++) {
      const page = await listEntries(entityId, exerciceId, { limit: 25, cursor })
      seen.push(...page.rows.map((r) => r.entry.entry_no))
      if (page.next_cursor === null) break
      cursor = page.next_cursor
    }
    expect(seen.length, 'no entry served twice, none skipped').toBe(TOTAL)
    expect(new Set(seen).size).toBe(TOTAL)
    expect(seen).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1))
  })

  // The bug inside the bug: this filter ran in JS on the 100 rows that came
  // back, so an account whose only movement is entry 110 was invisible.
  it('filters the journal by account, not the first page of it', async () => {
    const { listEntries } = await import('./queries/statutory')
    const page = await listEntries(entityId, exerciceId, { account: '1510' })

    expect(page.rows.length, 'entry 110 is past the default page and must still be found').toBe(1)
    expect(page.rows[0].entry.entry_no).toBe(LATE)
    expect(page.total, 'the total counts the filtered journal').toBe(1)
    expect(page.next_cursor).toBeNull()
  })

  it('still shows a filtered entry WHOLE, both sides of it', async () => {
    const { listEntries } = await import('./queries/statutory')
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, position, account_no, debit, credit)
      SELECT id, 2, '1020', '0.00', '250.00' FROM books.entry
       WHERE entity_id = ${entityId} AND entry_no = ${LATE}`)

    const page = await listEntries(entityId, exerciceId, { account: '1510' })
    const accounts = page.rows[0].lines.map((l) => l.account_no).sort()
    expect(accounts, 'the counter-line is not dropped by the filter').toEqual(['1020', '1510'])
  })
})
