// The statutory guards, asserted by `npm test` rather than by hand.
//
// ===========================================================================
// WHY THIS EXISTS BESIDE docs/sql/books-guard-probe.sql
// ===========================================================================
// That probe is thorough and it runs when somebody remembers. This file runs on
// every commit, which is the difference between a guard and a guard that used to
// work.
//
// The lesson is recent and it is this app's own: the phase 0 app-boundary probe
// passed on 2026-08-17 while `books_app` held no privilege on any table in its own
// schema. Every check in it was a negative, and a subject that can do nothing
// passes all of them. A manual probe plus no CI is how that survives.
//
// ===========================================================================
// IT SKIPS LOUDLY WITHOUT A DATABASE
// ===========================================================================
// These are integration tests against real Postgres, because the whole point is
// that the rules live in the database rather than in TypeScript. With no
// DATABASE_URL they SKIP and say so. A silent pass would be worse than a failure:
// "no database" and "guards verified" must not look the same.
//
// ===========================================================================
// THREE OF THESE ASSERT SUCCESS, AND THOSE ARE THE IMPORTANT ONES
// ===========================================================================
// A staged entry with no account, resolving a posted entry, and an RI keeping
// simplified books. Without them this file cannot tell a working guard from a
// blanket refusal — and one of the three is the app's main loop.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved from THIS FILE, not from the cwd. vitest can be invoked from the repo
// root or from the app, and a relative path silently loads nothing in one of those
// cases — which showed up here as fourteen tests skipping while a database was
// running two directories away.
const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  // Loud, on stderr, so a green run that checked nothing still says so.
  console.warn(
    '\n  lib/db/guards.test.ts SKIPPED: no DATABASE_URL.\n' +
      '  The statutory guards are database objects and were NOT verified by this run.\n' +
      '  Start Postgres (`docker compose up -d`) and create apps/books/.env.local.\n'
  )
}

d('the statutory guards are enforced by Postgres', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entity = 0
  let exercice = 0

  /**
   * Run something and report the error message, or null if it succeeded.
   *
   * ── UNWRAP THE CAUSE, OR THIS FILE TESTS DRIZZLE INSTEAD OF POSTGRES ────────
   * Drizzle replaces the driver's message with `Failed query: UPDATE …` and hangs
   * the real one off `cause`. Asserting on the outer message matches every
   * failure identically, so a test that meant "refused because it does not
   * balance" would pass on a typo in the SQL. Measured: all eight refusals looked
   * the same until this walked the chain.
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

  /** A balanced, posted entry, built the only way the schema allows. */
  async function postedEntry(seq: number, no: number): Promise<number> {
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label, evidence_tier)
      VALUES (${ws}, ${entity}, ${exercice}, ${seq}, ${no}, '2026-01-05', 'staged', 'UBS DEBIT REF-7719', 'bare')
      RETURNING id`)
    const id = Number(r.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${id}, '6000', 1850, 0), (${id}, '1020', 0, 1850)`)
    await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)
    return id
  }

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('guards@example.test', 'guards')
      ON CONFLICT (email) DO UPDATE SET name = 'guards' RETURNING id`)
    const userId = Number(u.rows[0].id)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('guards', ${'guards-' + Date.now().toString(36)}, ${userId}) RETURNING id`)
    ws = Number(w.rows[0].id)
    const e = await db.execute(sql`
      INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
      VALUES (${ws}, 1, 'probe-sa', 'Probe SA', 'SA', 'double_entry') RETURNING id`)
    entity = Number(e.rows[0].id)
    const x = await db.execute(sql`
      INSERT INTO books.exercice (workspace_id, entity_id, year, starts_on, ends_on)
      VALUES (${ws}, ${entity}, 2026, '2026-01-01', '2026-12-31') RETURNING id`)
    exercice = Number(x.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.account (workspace_id, entity_id, no, class, label, statement, statement_position)
      VALUES (${ws}, ${entity}, '1020', 1, '{"fr":"Banque"}', 'bilan', 'tresorerie'),
             (${ws}, ${entity}, '6000', 6, '{"fr":"Loyer"}', 'cr', 'autres_charges_exploitation')`)
  })

  afterAll(async () => {
    // ── NOTHING IS DELETED, AND NOT OUT OF LAZINESS ─────────────────────────
    // Teardown used to `ALTER TABLE ... DISABLE TRIGGER` so the workspace cascade
    // could remove the entries. That is safe alone and WRONG in a suite: vitest
    // runs test FILES in parallel, and this app has two that both write entries,
    // so one file's disable window swallowed the other's assertion. Measured
    // 2026-08-17 — "soft-deleting a posted entry" passed because the freeze
    // trigger was off, disabled by a sibling file mid-run.
    //
    // Disabling a trigger to clean up after a test that exists to prove the
    // trigger works is the wrong trade anyway. Isolation comes from the unique
    // workspace slug above instead, and the rows stay: this is a development
    // database, and `npm run db:seed:books` rebuilds the seeded workspace without
    // touching these.
  })

  it('discovered a database and built its fixtures (guards against a vacuous pass)', () => {
    expect(ws, 'no workspace created').toBeGreaterThan(0)
    expect(entity).toBeGreaterThan(0)
    expect(exercice).toBeGreaterThan(0)
  })

  it('refuses to post an entry that does not balance', async () => {
    const msg = await refusal(async () => {
      const r = await db.execute(sql`
        INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
        VALUES (${ws}, ${entity}, ${exercice}, 10, 1, '2026-01-05', 'staged', 'unbalanced') RETURNING id`)
      const id = Number(r.rows[0].id)
      await db.execute(sql`
        INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
        VALUES (${id}, '6000', 100, 0), (${id}, '1020', 0, 99)`)
      await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)
      await db.execute(sql`SELECT books.assert_entry_balanced(${id})`)
    })
    expect(msg, 'an unbalanced entry was allowed to post').toContain('does not balance')
  })

  it('refuses to post an entry whose line has no account', async () => {
    const msg = await refusal(async () => {
      const r = await db.execute(sql`
        INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
        VALUES (${ws}, ${entity}, ${exercice}, 11, 2, '2026-01-05', 'staged', 'nullacct') RETURNING id`)
      const id = Number(r.rows[0].id)
      await db.execute(sql`
        INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
        VALUES (${id}, NULL, 100, 0), (${id}, '1020', 0, 100)`)
      await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)
      await db.execute(sql`SELECT books.assert_entry_balanced(${id})`)
    })
    expect(msg).toContain('no account')
  })

  // ── POSITIVE ──────────────────────────────────────────────────────────────
  it('ACCEPTS a staged entry whose line has no account (the normal arrival state)', async () => {
    const msg = await refusal(async () => {
      const r = await db.execute(sql`
        INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
        VALUES (${ws}, ${entity}, ${exercice}, 12, 3, '2026-01-05', 'staged', 'staged ok') RETURNING id`)
      const id = Number(r.rows[0].id)
      await db.execute(sql`
        INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
        VALUES (${id}, NULL, 620, 0), (${id}, '1020', 0, 620)`)
      await db.execute(sql`SELECT books.assert_entry_balanced(${id})`)
    })
    expect(msg, 'the guard is too broad: money arrives before its meaning does').toBeNull()
  })

  it('freezes the accounting facts of a posted entry', async () => {
    const id = await postedEntry(20, 10)
    expect(await refusal(() => db.execute(sql`UPDATE books.entry SET date = '2026-02-01' WHERE id = ${id}`)))
      .toContain('fixed')
    expect(await refusal(() => db.execute(sql`UPDATE books.entry SET status = 'staged' WHERE id = ${id}`)))
      .toContain('cannot be un-posted')
    expect(await refusal(() => db.execute(sql`UPDATE books.entry SET deleted_at = now() WHERE id = ${id}`)))
      .toContain('cannot be deleted')
    expect(await refusal(() => db.execute(sql`UPDATE books.entry_line SET debit = 9999 WHERE entry_id = ${id}`)))
      .toContain('lines are fixed')
  })

  it('never lets raw_label be overwritten, at any status', async () => {
    const id = await postedEntry(21, 11)
    const msg = await refusal(() => db.execute(sql`UPDATE books.entry SET raw_label = 'tidied' WHERE id = ${id}`))
    expect(msg).toContain('never overwritten')
  })

  it('refuses a hard delete (art. 958f, ten-year retention)', async () => {
    const id = await postedEntry(22, 12)
    const msg = await refusal(() => db.execute(sql`DELETE FROM books.entry WHERE id = ${id}`))
    expect(msg).toContain('never hard-deleted')
  })

  // ── POSITIVE, AND THE MOST IMPORTANT ONE ──────────────────────────────────
  it('ACCEPTS resolving a posted entry (Reconnaissance, mockup entry 1009)', async () => {
    const id = await postedEntry(23, 13)
    const msg = await refusal(() =>
      db.execute(sql`
        UPDATE books.entry
           SET counterparty = 'IMMOREGIE SA',
               explanation = '{"fr":"Loyer","en":"Rent"}',
               recognition = 'known_recurring',
               evidence_tier = 'partial',
               related_party = '{"counterpart":"AIOS Companion SA","kind":"loan"}',
               piece_drive_ref = 'drive://probe/x.pdf'
         WHERE id = ${id}`)
    )
    expect(
      msg,
      'a whole-row freeze blocks the app\'s main loop: entry 1009 is posted, unrecognized, and meant to be resolved later'
    ).toBeNull()
  })

  it('refuses a capital company keeping simplified books (art. 957 al. 1 ch. 2)', async () => {
    const msg = await refusal(() =>
      db.execute(sql`
        INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
        VALUES (${ws}, 90, 'bad-sa', 'Bad SA', 'SA', 'simplified')`)
    )
    expect(msg).toContain('chk_books_entity_capital_company_double_entry')
  })

  // ── POSITIVE ──────────────────────────────────────────────────────────────
  it('ACCEPTS a sole proprietorship keeping simplified books (art. 957 al. 2)', async () => {
    const msg = await refusal(() =>
      db.execute(sql`
        INSERT INTO books.entity (workspace_id, seq, slug, name, legal_form, bookkeeping_regime)
        VALUES (${ws}, 91, 'ok-ri', 'Andrea RI', 'RI', 'simplified')`)
    )
    expect(msg, 'the constraint is too broad: an RI under the threshold may keep simplified books').toBeNull()
  })

  it('refuses claiming input VAT without full evidence (art. 26 LTVA)', async () => {
    const msg = await refusal(() =>
      db.execute(sql`
        INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label, evidence_tier, tva_input_claimed)
        VALUES (${ws}, ${entity}, ${exercice}, 30, 20, '2026-01-05', 'staged', 'vat overclaim', 'bare', true)`)
    )
    expect(msg).toContain('chk_books_entry_input_vat_needs_full_evidence')
  })

  it('refuses an account mapped to a position that is not law', async () => {
    const msg = await refusal(() =>
      db.execute(sql`
        INSERT INTO books.account (workspace_id, entity_id, no, class, label, statement, statement_position)
        VALUES (${ws}, ${entity}, '9999', 6, '{"fr":"x"}', 'cr', 'autre')`)
    )
    expect(msg).toContain('statement_position')
  })

  it('refuses a line carrying both a debit and a credit', async () => {
    const msg = await refusal(async () => {
      const r = await db.execute(sql`
        INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
        VALUES (${ws}, ${entity}, ${exercice}, 40, 30, '2026-01-05', 'staged', 'both sides') RETURNING id`)
      await db.execute(sql`
        INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
        VALUES (${Number(r.rows[0].id)}, '6000', 50, 50)`)
    })
    expect(msg).toContain('entry_line_check')
  })

  it('keeps the legal line list in the database identical to lib/statements.ts', async () => {
    const { BILAN_STRUCTURE, CR_STRUCTURE } = await import('../statements')
    const code = [
      ...BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos)),
      ...CR_STRUCTURE.map((l) => l.pos),
    ].sort()
    const r = await db.execute(sql`SELECT pos FROM books.statement_position ORDER BY pos`)
    const table = r.rows.map((x: { pos: string }) => x.pos).sort()
    // Three copies of the law exist: the code, this table, and the mockup.
    // lib/statements.test.ts pins the code to the mockup; this pins the table to
    // the code. Neither can drift alone.
    expect(table).toEqual(code)
  })
})
