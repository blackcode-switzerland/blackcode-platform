// Phase 5 against the real database: the rules, the review, the verdict
// write, and the ONE enforcement — blocked refuses to post.
//
// Rules are GLOBAL (no workspace), so the review test cleans up after itself
// with raw SQL: there is deliberately no un-review verb to clean up with, and
// leaving bk-002 approved in the dev database would make the next seed-parity
// run lie about what the fiduciary has signed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
  console.warn('\n  lib/db/compliance.test.ts SKIPPED: no DATABASE_URL. The compliance layer was NOT verified.\n')
}

d('the compliance layer', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let ws = 0
  let entityId = 0
  let exerciceId = 0

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const slug = 'cp-' + Date.now().toString(36)
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('compliance@example.test', 'compliance')
      ON CONFLICT (email) DO UPDATE SET name = 'compliance' RETURNING id`)
    const w = await db.execute(sql`
      INSERT INTO books.workspaces (name, slug, owner_id)
      VALUES ('compliance', ${slug}, ${Number(u.rows[0].id)}) RETURNING id`)
    ws = Number(w.rows[0].id)

    const { createEntity, createExercice } = await import('./queries/statutory')
    const e = await createEntity(ws, { slug: 'cp', name: 'CP SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    entityId = e.id
    const x = await createExercice(ws, { entityId, year: 2026 })
    exerciceId = x.id

    // A staged entry with balanced lines: postable, until a verdict says no.
    const r = await db.execute(sql`
      INSERT INTO books.entry (workspace_id, entity_id, exercice_id, seq, entry_no, date, status, raw_label)
      VALUES (${ws}, ${entityId}, ${exerciceId}, 1, 1, '2026-08-10', 'staged', 'PAIEMENT SANS PIECE') RETURNING id`)
    await db.execute(sql`
      INSERT INTO books.entry_line (entry_id, account_no, debit, credit)
      VALUES (${Number(r.rows[0].id)}, '6570', '250.00', '0.00'), (${Number(r.rows[0].id)}, '1020', '0.00', '250.00')`)
  })

  afterAll(async () => {
    // See the header: reviews are global and permanent by design, so the test
    // resets its own with SQL rather than leaving fiduciary state it invented.
    await db.execute(sql`
      UPDATE books.compliance_rule
      SET review_state = 'draft', edited_logic = NULL, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
      WHERE rule_id IN ('bk-002', 'vat-003') AND reviewed_by = 'test@fiduciary.test'`)
  })

  it('serves all 19 rules, every one born draft, every one carrying its confidence', async () => {
    const { listComplianceRules } = await import('./queries/compliance')
    const rules = await listComplianceRules()
    expect(rules.length).toBe(19)
    expect(rules.every((r) => ['verified_fedlex', 'doctrine_inferred', 'needs_fiduciary_check'].includes(r.source_confidence))).toBe(true)
    const bk1 = rules.find((r) => r.rule_id === 'bk-001')!
    expect(bk1.severity).toBe('blocker')
    expect(bk1.citation).toContain('957')
  })

  it('records a review with who and when, and refuses an edit without the corrected wording', async () => {
    const { reviewComplianceRule } = await import('./queries/compliance')
    const r = await reviewComplianceRule('bk-002', { state: 'approved', by: 'test@fiduciary.test' })
    expect(r.review_state).toBe('approved')
    expect(r.reviewed_by).toBe('test@fiduciary.test')
    expect(r.reviewed_at).not.toBeNull()

    await expect(
      reviewComplianceRule('vat-003', { state: 'edited', by: 'test@fiduciary.test' })
    ).rejects.toMatchObject({ code: 'edited_needs_logic' })
    const edited = await reviewComplianceRule('vat-003', {
      state: 'edited',
      editedLogic: 'IF invoice.recipient IS NULL AND amount_ttc > 400 THEN flag WARNING',
      by: 'test@fiduciary.test',
    })
    expect(edited.edited_logic).toContain('amount_ttc > 400')
    expect(edited.check_logic, 'the original stays').toContain('recipient_name')

    await expect(
      reviewComplianceRule('no-such', { state: 'approved', by: 'x' })
    ).rejects.toMatchObject({ code: 'rule_not_found' })
  })

  it('writes a verdict history-first, and a blocked entry refuses to post with the resolution as the way out', async () => {
    const { recordVerdict } = await import('./queries/compliance')
    const { postEntry } = await import('./queries/imports')

    const v = await recordVerdict(ws, 1, {
      verdict: 'blocked',
      rules: ['dt-001', 'vat-008'],
      worstCase: 'reprise plus loss of the input-VAT credit',
      resolves: 'attach the missing pièce, or declare the business purpose in a reconstruction note',
      by: 'devils-advocate@agents.test',
    })
    expect(v.journal).toBe('grand_livre')

    const e = await db.execute(sql`SELECT verdict, history FROM books.entry WHERE workspace_id = ${ws} AND seq = 1`)
    expect(e.rows[0].verdict.verdict).toBe('blocked')
    expect(e.rows[0].verdict.rules).toEqual(['dt-001', 'vat-008'])
    const h = e.rows[0].history
    expect(h[h.length - 1], 'the trail shows there was no verdict before').toMatchObject({ event: 'verdict', was: { verdict: null } })

    // THE enforcement. The refusal carries the agent's own resolution text.
    await expect(postEntry(ws, 1)).rejects.toMatchObject({ code: 'verdict_blocked' })
    await expect(postEntry(ws, 1)).rejects.toThrow(/dt-001/)

    // A fresh verdict is the way through — and the blocked one stays in history.
    await recordVerdict(ws, 1, { verdict: 'accepted', rules: ['dt-001'], by: 'devils-advocate@agents.test' })
    const posted = await postEntry(ws, 1)
    expect(posted.status).toBe('posted')
    const e2 = await db.execute(sql`SELECT history FROM books.entry WHERE workspace_id = ${ws} AND seq = 1`)
    const trail = e2.rows[0].history
    expect(trail[trail.length - 1].was.verdict.verdict, 'the overruled block is in the trail forever').toBe('blocked')
  })

  it('refuses a verdict citing a rule that does not exist, or citing nothing — flags are facts', async () => {
    const { recordVerdict } = await import('./queries/compliance')
    await expect(
      recordVerdict(ws, 1, { verdict: 'blocked', rules: ['zz-999'], by: 'x' })
    ).rejects.toMatchObject({ code: 'unknown_rule' })
    await expect(
      recordVerdict(ws, 1, { verdict: 'blocked', rules: [], by: 'x' })
    ).rejects.toMatchObject({ code: 'missing_rules' })
    await expect(
      recordVerdict(ws, 1, { verdict: 'maybe' as never, rules: ['dt-001'], by: 'x' })
    ).rejects.toMatchObject({ code: 'bad_verdict' })
  })

  it('reaches the RI journal through its book, and holds the entity boundary on the grand livre', async () => {
    const { createEntity, createExercice } = await import('./queries/statutory')
    const { recordVerdict } = await import('./queries/compliance')
    const ri = await createEntity(ws, { slug: 'cp-ri', name: 'Perso', legal_form: 'RI', bookkeeping_regime: 'simplified' })
    const x = await createExercice(ws, { entityId: ri.id, year: 2026 })
    await db.execute(sql`
      INSERT INTO books.ri_entry (workspace_id, entity_id, exercice_id, seq, date, direction, amount, raw_label, recognition, evidence_tier)
      VALUES (${ws}, ${ri.id}, ${x.id}, 1, '2026-08-10', 'depense', '99.00', 'TWINT SANS PIECE', 'known_one_off', 'bare')`)

    const v = await recordVerdict(ws, 1, {
      entity: 'cp-ri',
      verdict: 'accepted_with_warning',
      rules: ['dt-001'],
      by: 'devils-advocate@agents.test',
    })
    expect(v.journal).toBe('recettes_depenses')
    const r = await db.execute(sql`SELECT verdict FROM books.ri_entry WHERE workspace_id = ${ws} AND seq = 1`)
    expect(r.rows[0].verdict.verdict).toBe('accepted_with_warning')

    // The piece-match lesson, applied from birth: a double-entry book named
    // explicitly must own the entry the number resolves to.
    const other = await createEntity(ws, { slug: 'cp-b', name: 'CP-B SA', legal_form: 'SA', bookkeeping_regime: 'double_entry' })
    void other
    await expect(
      recordVerdict(ws, 1, { entity: 'cp-b', verdict: 'blocked', rules: ['dt-001'], by: 'x' })
    ).rejects.toMatchObject({ code: 'entry_other_book' })
  })
})
