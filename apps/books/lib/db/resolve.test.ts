// The resolve loop, end to end, against the real database.
//
// ===========================================================================
// PHASE 2'S ACCEPTANCE CRITERIA, EACH AS A TEST
// ===========================================================================
//   1. The loop runs: unrecognized -> resolved -> rule created -> the next
//      matching entry is suggested automatically.
//   2. The resolved row still shows "was: unrecognized".
//   3. The same merchant on a source with no rule stays unrecognized.
//   4. (The frontend's gated mutation is bala's half, #52.)
//
// Plus the freeze-line case this module exists to say properly: resolving a
// POSTED entry works for interpretation and refuses the account, because a
// posted entry's lines are accounting facts and a correction is a reversing
// entry.
//
// Isolation by unique workspace slug, nothing deleted, no trigger toggling —
// the same discipline as guards.test.ts, for the same measured reason.

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
  console.warn('\n  lib/db/resolve.test.ts SKIPPED: no DATABASE_URL. The resolve write path was NOT verified.\n')
}

d('the resolve loop', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0
  let sourceId = 0
  let otherSourceId = 0
  let seq = 0
  const nextSeq = () => ++seq

  const mkEntry = async (opts: {
    label: string
    source: number | null
    amount: string
    status?: 'staged' | 'posted'
    account?: string | null
  }) => {
    const s = nextSeq()
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, source_id, raw_label, recognition)
      VALUES (${ws}, ${entityId}, ${exerciceId}, ${s}, ${s}, '2027-05-01', 'staged', ${opts.source}, ${opts.label}, 'unrecognized')
      RETURNING id`)
    const id = Number(r.rows[0].id)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${id}, ${opts.account ?? null}, ${opts.amount}, 0), (${id}, '1020', 0, ${opts.amount})`)
    if (opts.status === 'posted') {
      await db.execute(sql`UPDATE books.entry SET status = 'posted' WHERE id = ${id}`)
    }
    return { id, seq: s }
  }

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'rz-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('resolve@example.test', 'resolve')
      ON CONFLICT (email) DO UPDATE SET name = 'resolve' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('resolve-loop', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, {
      slug: 'loop',
      name: 'Loop SA',
      legal_form: 'SA',
      bookkeeping_regime: 'double_entry',
    })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2027 })
    exerciceId = x.id

    const s1 = await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type)
      VALUES (${ws}, ${entityId}, 1, 'Tracked bank', 'bank') RETURNING id`)
    sourceId = Number(s1.rows[0].id)
    const s2 = await db.execute(sql`
      INSERT INTO books.source (workspace_id, entity_id, seq, name, type)
      VALUES (${ws}, ${entityId}, 2, 'Untracked card', 'card') RETURNING id`)
    otherSourceId = Number(s2.rows[0].id)
  })

  it('runs the whole loop: resolve teaches a rule, the next payment is suggested', async () => {
    const { resolveEntry } = await import('./queries/resolve')
    const { getWorklist } = await import('./queries/worklist')

    // An unexplained landlord payment arrives.
    const first = await mkEntry({ label: 'BANK-PMT REF-1 IMMOREGIE SA', source: sourceId, amount: '1850.00' })

    let wl = await getWorklist(entityId, exerciceId)
    expect(wl.map((r) => r.number)).toContain(first.seq)
    expect(wl.find((r) => r.number === first.seq)!.suggested_rules, 'no rule exists yet').toEqual([])

    // A human explains it and teaches the rule.
    const resolved = await resolveEntry(ws, first.seq, {
      explanation: { fr: 'Loyer bureau', en: 'Office rent' },
      account: '6000',
      rule: { counterparty: 'IMMOREGIE', amount_chf: 1850, tolerance_chf: 0, learnedFrom: 'contract' },
    })
    expect(resolved.entry.recognition).toBe('known_recurring')
    expect(resolved.taughtRuleSeq).not.toBeNull()

    // The resolved entry left the worklist, and its null line got the account.
    wl = await getWorklist(entityId, exerciceId)
    expect(wl.map((r) => r.number)).not.toContain(first.seq)
    const lines = await db.execute(sql`SELECT account_no FROM books.entry_line WHERE entry_id = ${first.id} ORDER BY id`)
    expect(lines.rows[0].account_no).toBe('6000')

    // The rule records which entry taught it.
    const rule = await db.execute(sql`SELECT * FROM books.rule WHERE workspace_id = ${ws} AND seq = ${resolved.taughtRuleSeq}`)
    expect(Number(rule.rows[0].created_from_entry_id)).toBe(first.id)
    expect(rule.rows[0].source_id).toBe(sourceId)

    // Next month's rent arrives: SUGGESTED automatically, applied by nobody.
    const second = await mkEntry({ label: 'BANK-PMT REF-2 IMMOREGIE SA', source: sourceId, amount: '1850.00' })
    wl = await getWorklist(entityId, exerciceId)
    const row = wl.find((r) => r.number === second.seq)!
    expect(row.suggested_rules).toEqual([resolved.taughtRuleSeq])
    expect(row.recognition, 'suggestion is an opinion, not an action').toBe('unrecognized')
  })

  it('keeps "was: unrecognized" in history, forever and appendably', async () => {
    const { resolveEntry } = await import('./queries/resolve')
    const e = await mkEntry({ label: 'MYSTERY DEBIT REF-9', source: sourceId, amount: '250.00' })

    const r1 = await resolveEntry(ws, e.seq, { explanation: { en: 'Team lunch' }, account: '6000' })
    const h1 = r1.entry.history as unknown as { event: string; was: { recognition: string } }[]
    expect(Array.isArray(h1)).toBe(true)
    expect(h1[0].was.recognition, 'the acceptance criterion verbatim').toBe('unrecognized')

    // Resolving again stacks history rather than replacing it.
    const r2 = await resolveEntry(ws, e.seq, { explanation: { en: 'Actually a client lunch' } })
    const h2 = r2.entry.history as unknown as { was: { recognition: string } }[]
    expect(h2.length).toBe(2)
    expect(h2[0].was.recognition).toBe('unrecognized')
    expect(h2[1].was.recognition).toBe('known_one_off')
  })

  it('never matches the same merchant through a source with no rule', async () => {
    const { getWorklist } = await import('./queries/worklist')
    // Identical label and amount, arriving through the untracked card.
    const e = await mkEntry({ label: 'BANK-PMT REF-3 IMMOREGIE SA', source: otherSourceId, amount: '1850.00' })
    const wl = await getWorklist(entityId, exerciceId)
    const row = wl.find((r) => r.number === e.seq)!
    expect(row.suggested_rules, 'the pair key: wrong source, no match, however familiar the name').toEqual([])
    expect(row.recognition).toBe('unrecognized')
  })

  it('resolves a POSTED entry for interpretation, and refuses to touch its account', async () => {
    const { resolveEntry, ResolveRefused } = await import('./queries/resolve')
    // The 1009 shape: posted with a provisional account, still unrecognized.
    const e = await mkEntry({ label: 'UBS DEBIT REF-7719', source: sourceId, amount: '3000.00', status: 'posted', account: '6500' })

    await expect(
      resolveEntry(ws, e.seq, { explanation: { en: 'no' }, account: '6570' })
    ).rejects.toSatisfy((err: unknown) => err instanceof ResolveRefused && err.code === 'posted_lines_frozen')

    // Interpretation still open: the whole point of the freeze line.
    const r = await resolveEntry(ws, e.seq, {
      explanation: { en: 'Fiduciary retainer, confirmed by counterparty attestation' },
      counterparty: 'TREUHAND AG',
    })
    expect(r.entry.recognition).toBe('known_one_off')
    expect(r.entry.counterparty).toBe('TREUHAND AG')
    const lines = await db.execute(sql`SELECT account_no FROM books.entry_line WHERE entry_id = ${e.id} ORDER BY id`)
    expect(lines.rows[0].account_no, 'the posted account did not move').toBe('6500')
  })

  it('refuses a resolution with no explanation at the query layer too', async () => {
    const { resolveEntry } = await import('./queries/resolve')
    await expect(
      resolveEntry(ws, 99999, { explanation: { en: 'x' } })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('deactivates a rule instead of deleting it, and the suggestion stops', async () => {
    const { resolveEntry, deactivateRule } = await import('./queries/resolve')
    const { getWorklist } = await import('./queries/worklist')

    const teacher = await mkEntry({ label: 'SWISSCOM FACTURE 1', source: sourceId, amount: '89.90' })
    const { taughtRuleSeq } = await resolveEntry(ws, teacher.seq, {
      explanation: { en: 'Telecoms' },
      account: '6570',
      rule: { counterparty: 'SWISSCOM', amount_chf: 89.9, tolerance_chf: 5 },
    })

    const next = await mkEntry({ label: 'SWISSCOM FACTURE 2', source: sourceId, amount: '89.90' })
    let wl = await getWorklist(entityId, exerciceId)
    expect(wl.find((r) => r.number === next.seq)!.suggested_rules).toContain(taughtRuleSeq)

    expect(await deactivateRule(ws, taughtRuleSeq!)).toBe(true)
    wl = await getWorklist(entityId, exerciceId)
    expect(wl.find((r) => r.number === next.seq)!.suggested_rules).not.toContain(taughtRuleSeq)

    // Still in the database: an entry cites its rule forever.
    const rule = await db.execute(sql`SELECT active FROM books.rule WHERE workspace_id = ${ws} AND seq = ${taughtRuleSeq}`)
    expect(rule.rows[0].active).toBe(false)
  })
})
