// DATA-MODEL.md §17 — the checklist, as tests. "Every invariant has a test
// that goes red when broken" is a phase 5 done-when box, and this file is the
// index that makes the claim auditable: each invariant is either tested HERE
// or names the file that already pins it.
//
//   1.  SA is always double-entry ............ HERE (and compliance rule bk-001)
//   2.  lines balance or nothing posts ....... lib/db/guards.test.ts (0004, deferred trigger)
//   3.  posted entries are immutable ......... lib/db/guards.test.ts (0004; resolve refuses accounts)
//   4.  staged never touches balances ........ lib/derive parity + lib/db/pieces.test.ts ("changes no balance")
//   5.  every account maps to one position ... lib/chart.test.ts ("maps every account to a real statement position")
//   6.  959a/959b order is law ............... lib/statements.test.ts (order + wording pinned to the fixture)
//   7.  "consolidé" appears nowhere else ..... HERE
//   8.  rule keying is the (source, cp) pair . lib/db/resolve.test.ts + recognition tests
//   9.  inferred provenance is permanent ..... lib/db/resolve.test.ts (history-first)
//   10. tier and VAT claim independent ....... lib/db/guards.test.ts (CHECK: claim needs full)
//   11. related-party on a separate line ..... lib/chart.test.ts ("related-party account ... presented separately")
//   12. source status computed, never set .... lib/derive/sources.test.ts
//   13. duplicates flagged, never dropped .... lib/db/pieces.test.ts ("flags the same checksum")
//   14. originals immutable, 10-year hold .... HERE (footprint refuses purge; art. 958f) + lib/db/pieces.test.ts
//   15. flags are facts ...................... lib/db/compliance.test.ts (verdicts cite rules or refuse)
//   16. no intelligence in the app ........... structural: the only agent doors are ingest, analyse
//                                              record and verdict — all writes OF external judgment,
//                                              never routes that produce one.

import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

// ---------------------------------------------------------------------------
// §17.7 — « consolidé » appears nowhere except the personal overview
// ---------------------------------------------------------------------------
// The cross-entity rollup is AGGREGATION: art. 963 CO reserves consolidation
// for controlled groups, and three books of one owner are not one. The word
// is allowed exactly where the disclaimer explains this, and nowhere else.
describe('invariant 7: never say consolidated', () => {
  // ── THIS LIST GAINED AN ENTRY ON 2026-08-20, AND WHY MATTERS ────────────
  // The disclaimer used to be JSX inside the overview page. The language switch
  // moved it into `lib/dictionary/overview.ts` — where both languages of it now
  // live — and this guard went red on the same commit, which is exactly what it
  // is for: it is the rule that the word may not travel without its explanation,
  // and the explanation travelled.
  //
  // **The page is still allowed**, because `overview.rollupLead` is rendered
  // there and the key names it. What is NOT allowed is a third file: the word
  // has one home in each language and this list is what says so.
  const ALLOWED = new Set([
    'app/dashboard/[ws]/page.tsx', // the personal overview, disclaimer included
    'lib/dictionary/overview.ts', // that disclaimer's two languages, and only there
    'lib/rollup.ts', // computes the aggregation; its comments state the rule
    'lib/rollup.test.ts',
    'lib/invariants.test.ts', // this file
  ])

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
  }

  it('the word lives only where the disclaimer explains it', () => {
    const offenders: string[] = []
    for (const dir of ['app', 'lib']) {
      for (const file of walk(join(APP_ROOT, dir))) {
        const rel = file.slice(APP_ROOT.length + 1)
        if (ALLOWED.has(rel)) continue
        if (/consolid/i.test(readFileSync(file, 'utf8'))) offenders.push(rel)
      }
    }
    expect(offenders, 'aggregation, never consolidation — art. 963 reserves the word').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §17.1 and §17.14 need the database
// ---------------------------------------------------------------------------
const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip
if (!HAS_DB) {
  console.warn('\n  lib/invariants.test.ts DB half SKIPPED: no DATABASE_URL. Invariants 1 and 14 were NOT verified.\n')
}

d('invariant 1: an SA is always double-entry', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0

  beforeAll(async () => {
    const { getDb } = await import('./db/client')
    db = getDb()
    const slug = 'inv-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('invariants@example.test', 'invariants')
      ON CONFLICT (email) DO UPDATE SET name = 'invariants' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('invariants', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)
  })

  it('there is no code path to a simplified SA — the door itself refuses (bk-001)', async () => {
    const { createEntity } = await import('./db/queries/statutory')
    for (const legal_form of ['SA', 'Sarl', 'GmbH', 'AG']) {
      await expect(
        createEntity(ws, { slug: 'x-' + legal_form.toLowerCase(), name: 'X', legal_form, bookkeeping_regime: 'simplified' })
      ).rejects.toThrow(/957/)
    }
    // And the legal combination still walks through the same door.
    const ok = await createEntity(ws, { slug: 'x-ok', name: 'X', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    expect(ok.bookkeeping_regime).toBe('double_entry')
  })
})

d('invariant 14: ten-year retention — the account may close, the books stay', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let userId = 0
  let wsWithRecords = 0

  beforeAll(async () => {
    const { getDb } = await import('./db/client')
    db = getDb()
    const stamp = Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES (${'retention-' + stamp + '@example.test'}, 'retention')
      RETURNING id`)
    userId = Number(u.rows[0].id)

    // One workspace WITH statutory records, one with an empty book only.
    const w1 = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('retained', ${'ret-' + stamp}, ${userId}) RETURNING id`)
    wsWithRecords = Number(w1.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.workspace_members (workspace_id, user_id, role)
      VALUES (${wsWithRecords}, ${userId}, 'owner')`)
    const w2 = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('empty', ${'emp-' + stamp}, ${userId}) RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.workspace_members (workspace_id, user_id, role)
      VALUES (${Number(w2.rows[0].id)}, ${userId}, 'owner')`)

    const { createEntity, createExercice } = await import('./db/queries/statutory')
    const e = await createEntity(wsWithRecords, { slug: 'ret', name: 'Ret SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    const x = await createExercice(wsWithRecords, { entityId: e.id, year: 2026 })
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${wsWithRecords}, ${e.id}, ${x.id}, 1, 1, '2026-08-01', 'staged', 'UNE ECRITURE') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(r.rows[0].id)}, '6570', '10.00', '0.00'), (${Number(r.rows[0].id)}, '1020', '0.00', '10.00')`)
    // An empty book in the empty workspace: structure, not records.
    await createEntity(Number(w2.rows[0].id), { slug: 'emp', name: 'Empty SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
  })

  it('the footprint reports the recorded workspace as blocked, and purge refuses naming art. 958f', async () => {
    const { booksFootprintSource } = await import('./db/queries/footprint')
    const fp = await booksFootprintSource.read(userId)
    expect(fp.known).toBe(true)
    expect(fp.blocked_by.map((b) => b.workspace_id)).toContain(wsWithRecords)
    expect(fp.will_delete.map((w) => w.workspace_id)).not.toContain(wsWithRecords)

    await expect(booksFootprintSource.purge(userId)).rejects.toThrow(/958f/)
    const still = await db.execute(sql`SELECT count(*)::int AS n FROM books.entry WHERE workspace_id = ${wsWithRecords}`)
    expect(still.rows[0].n, 'the écriture survived the refusal').toBe(1)
  })

  it('a workspace whose books recorded nothing purges legally, and only that one', async () => {
    const { booksFootprintSource } = await import('./db/queries/footprint')
    const before = await booksFootprintSource.read(userId)
    const empty = before.will_delete
    expect(empty.length, 'the empty-book workspace is deletable: structure is not a record').toBe(1)

    // purge still refuses — the RECORDED workspace blocks the whole account
    // close, which is exactly the platform conversation phase 5 raises.
    await expect(booksFootprintSource.purge(userId)).rejects.toThrow(/958f/)
  })
})
