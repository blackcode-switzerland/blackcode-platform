// Load the mockup into Postgres. This is the fixture AND the test data.
//
//   npm run db:seed:books            (idempotent: replaces the seeded workspace)
//
// ===========================================================================
// THE SEED IS A REAL CLIENT OF THE SCHEMA, WHICH IS THE POINT
// ===========================================================================
// It writes through the same constraints and triggers the app does, so it is the
// first honest test of migration 0003 and 0004. Every awkward step below is a rule
// the database is enforcing, not an inconvenience to route around:
//
//   * Entries are inserted STAGED, given lines, then UPDATEd to posted. Posting is
//     a transition (0004), so an entry cannot be born posted.
//   * `related_party.mirror_entry_id` and `rule.created_from_entry_id` are patched
//     in a second pass, because each points at a row the first pass has not
//     created yet. Patching `related_party` on a posted entry is allowed on
//     purpose: it is interpretation, not a booked figure.
//   * Amounts are written as fixed-2 STRINGS, never JavaScript numbers.
//
// ===========================================================================
// ONE EXERCICE, AND THE COMPROMISE IN IT
// ===========================================================================
// `ENTITIES` declares `exercice: 2026`, and the transaction data spans TWO years:
// fifteen entries in 2026 and two in 2025 (1001 and 1009, both frozen-UBS
// history). The mockup's own derivations have no year boundary at all, which is
// why nobody noticed.
//
// A faithful 2025/2026 split needs a YEAR-END CLOSE: 2025's closing balances become
// 2026's opening, with the year's result rolled into `résultat reporté`. Phase 1
// does not build that (see week-one.md, "no multi year and no year end close").
//
// So the seed creates ONE exercice per book, labelled 2026 as declared, starting
// early enough to contain the pre-migration entries. That reproduces the mockup's
// numbers exactly, which is the phase 1 acceptance criterion, and it is written
// down here rather than hidden because a reader will otherwise see a 2025 entry in
// exercice 2026 and think it a bug.
//
// The SCHEMA is not compromised: every derivation already takes
// `(entityId, exerciceId)`, so adding 2025 later is data plus a close routine, not
// a migration.

import { eq, sql } from 'drizzle-orm'
import { getDb } from './client'
import {
  booksWorkspaces,
  booksCounters,
  booksEntity,
  booksExercice,
  booksAccount,
  booksOpeningBalance,
  booksSource,
  booksRule,
  booksEntry,
  booksEntryLine,
  booksRiEntry,
  booksPatrimoine,
} from './schema'
import fixture from '../../fixtures/mockup.json'

/** Fixed-2 string, which is what `numeric(14,2)` wants. Never a float. */
const money = (n: number | null | undefined): string => (n ?? 0).toFixed(2)

type Json = Record<string, unknown> | null

interface FxEntity {
  id: number; slug: string; name: string; legal_form: string; seat?: string
  bookkeeping_regime: string; regime_note?: Json; fiscal_year: string
  vat_registered: boolean; vat_method: string | null; vat_filing: string | null
  vat_note?: Json; audit_status: string | null; fte_count: number | null; accent: string
}
interface FxSource {
  id: number; entity_id: number | null; name: string; type: string; layer: string
  draws_from: number | null; ledger_accounts?: string[]; method: string | null
  expected: string | null; last_import: string | null; retired: boolean; notes_freeform?: Json
}
interface FxRule {
  id: number; entity_id: number; source_id: number | null; active: boolean
  source?: string; pattern: Json; explanation?: Json; account: string | null
  created_from: number | null; created: string | null; note?: Json
}
interface FxTx {
  id: number; entity_id: number; date: string; status: string; source_id: number | null
  raw_label: string; counterparty: string | null; explanation?: Json
  lines: { account: string | null; debit: number; credit: number }[]
  recognition: string; matched_rule_id: number | null
  evidence_tier: string; evidence_note?: Json
  tva?: { rate: number | null; amount: number | null; input_claimed: boolean; note?: Json }
  related_party?: { counterpart: string; kind: string; justification?: Json; mirror_tx?: number } | null
  piece?: { drive_ref: string; hash: string; captured: string } | null
  history?: Json
}
interface FxRi {
  id: number; date: string; direction: string; amount: number; category?: Json
  raw_label: string; counterparty: string | null; explanation?: Json
  recognition: string; matched_rule_id: number | null; evidence_tier: string
  evidence_note?: Json; piece?: { drive_ref: string; hash: string; captured: string } | null
}
interface FxPatrimoine {
  id: number; as_of: string; compiled: string | null
  items: { label: Json; amount: number }[]; note?: Json
}

const F = fixture as unknown as {
  ENTITIES: FxEntity[]
  ACCOUNTS: { no: string; class: number; label: Json; statement: string; statement_position: string }[]
  OPENING: Record<string, Record<string, number>>
  SOURCES: FxSource[]
  RECOGNITION_RULES: FxRule[]
  TX: FxTx[]
  RI_ENTRIES: FxRi[]
  PATRIMOINE: FxPatrimoine[]
}

export const SEED_SLUG = 'blackcode'

export async function seed(ownerUserId: number): Promise<{ workspaceId: number }> {
  const db = getDb()

  // ---- idempotence -------------------------------------------------------
  // Replace rather than merge: a seed that half-applies is worse than one that
  // starts over.
  //
  // ── THE GUARDS HAVE TO COME OFF, AND THE ORDER IS THE WHOLE TRICK ──────────
  // Every guard in 0004 refuses this teardown, correctly: posted entries cannot be
  // deleted, their lines cannot be removed, and `entry` rejects DELETE outright
  // under art. 958f. That is the schema working, not an obstacle.
  //
  // So the seed disables them, and **every DISABLE runs before any DML**. Getting
  // that order wrong fails outright rather than subtly: with a delete first,
  // Postgres answers `cannot ALTER TABLE "entry_line" because it has pending
  // trigger events`, because the deferred balance constraint has queued work that
  // an ALTER may not jump ahead of.
  //
  // Two things make this safe to do here and nowhere else:
  //
  //   1. It runs as the MIGRATOR. `books_app` cannot reach it at all — 0005 revokes
  //      DELETE on every ledger table, so the app cannot follow this path even by
  //      accident.
  //   2. Each statement is its own autocommit, so the re-ENABLEs cannot be skipped
  //      by a rollback halfway through.
  //
  // The two DB test files deliberately do NOT do this. They leave their rows and
  // isolate by workspace slug instead, because vitest runs files in parallel and
  // one file's disable window silently swallowed a sibling's assertion.
  const FROZEN_TRIGGERS: [string, string][] = [
    ['books.entry', 'trg_no_hard_delete'],
    ['books.ri_entry', 'trg_no_hard_delete'],
    ['books.entry', 'trg_entry_frozen'],
    ['books.entry_line', 'trg_entry_line_frozen'],
    // The two DEFERRED constraint triggers. Easy to forget, and the failure names
    // the symptom rather than the cause: `entry 14 cannot be posted with 0 line(s)`,
    // raised at COMMIT because the balance check saw a posted entry whose lines had
    // just been deleted.
    ['books.entry', 'trg_entry_balanced'],
    ['books.entry_line', 'trg_entry_line_balanced'],
  ]

  const existing = await db
    .select()
    .from(booksWorkspaces)
    .where(eq(booksWorkspaces.slug, SEED_SLUG))

  if (existing.length > 0) {
    for (const [table, trigger] of FROZEN_TRIGGERS) {
      await db.execute(sql.raw(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`))
    }
    try {
      for (const w of existing) {
        // Bottom-up, so no foreign key complains on the way.
        await db.execute(
          sql`DELETE FROM books.entry_line WHERE entry_id IN (SELECT id FROM books.entry WHERE workspace_id = ${w.id})`
        )
        await db.execute(sql`DELETE FROM books.entry WHERE workspace_id = ${w.id}`)
        await db.execute(sql`DELETE FROM books.ri_entry WHERE workspace_id = ${w.id}`)
        // The rest cascades from the workspace.
        await db.execute(sql`DELETE FROM books.workspaces WHERE id = ${w.id}`)
      }
    } finally {
      // `finally`, so a failed delete cannot leave the guards off for the next
      // person to run against a database that silently accepts anything.
      for (const [table, trigger] of FROZEN_TRIGGERS) {
        await db.execute(sql.raw(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`))
      }
    }
  }

  const [ws] = await db
    .insert(booksWorkspaces)
    .values({ name: 'blackcode', slug: SEED_SLUG, owner_id: ownerUserId })
    .returning()

  const counters = new Map<string, number>()
  const nextSeq = (type: string): number => {
    const n = (counters.get(type) ?? 0) + 1
    counters.set(type, n)
    return n
  }

  // ---- books -------------------------------------------------------------
  const entityId = new Map<number, number>()
  const exerciceId = new Map<number, number>()

  // Earliest posting across the whole fixture, so the single exercice contains
  // the pre-migration entries. See the header.
  const earliest = F.TX.map((t) => t.date).sort()[0] ?? '2026-01-01'

  for (const e of F.ENTITIES) {
    const [row] = await db
      .insert(booksEntity)
      .values({
        workspace_id: ws.id,
        seq: nextSeq('entity'),
        slug: e.slug,
        name: e.name,
        legal_form: e.legal_form,
        seat: e.seat ?? null,
        bookkeeping_regime: e.bookkeeping_regime,
        // Recorded, not inferred. An RI keeping simplified books has made no
        // election; the column exists so choosing double entry later is data.
        regime_election: null,
        regime_note: e.regime_note ?? null,
        fiscal_year: e.fiscal_year,
        vat_registered: e.vat_registered,
        vat_method: e.vat_method,
        vat_filing: e.vat_filing,
        vat_note: e.vat_note ?? null,
        audit_status: e.audit_status,
        fte_count: e.fte_count === null ? null : money(e.fte_count),
        accent: e.accent,
      })
      .returning()
    entityId.set(e.id, row.id)

    const [ex] = await db
      .insert(booksExercice)
      .values({
        workspace_id: ws.id,
        entity_id: row.id,
        year: 2026,
        starts_on: earliest < '2026-01-01' ? earliest : '2026-01-01',
        ends_on: '2026-12-31',
        status: 'open',
      })
      .returning()
    exerciceId.set(e.id, ex.id)

    // ---- chart of accounts, per book ------------------------------------
    // The mockup has one shared chart; each book gets its own copy, because
    // `account` is per entity and two books may diverge.
    await db.insert(booksAccount).values(
      F.ACCOUNTS.map((a) => ({
        workspace_id: ws.id,
        entity_id: row.id,
        no: a.no,
        class: a.class,
        label: a.label,
        statement: a.statement,
        statement_position: a.statement_position,
      }))
    )

    // ---- opening balances ------------------------------------------------
    // Absent for the RI, which is correct rather than missing data: art. 957 al. 2
    // bookkeeping has no balance sheet to open.
    const opening = F.OPENING[e.slug]
    if (opening) {
      await db.insert(booksOpeningBalance).values(
        Object.entries(opening).map(([no, amount]) => ({
          workspace_id: ws.id,
          entity_id: row.id,
          exercice_id: ex.id,
          account_no: no,
          amount: money(amount),
        }))
      )
    }
  }

  // ---- sources (two passes for the self-reference) ------------------------
  const sourceId = new Map<number, number>()
  for (const s of F.SOURCES) {
    const [row] = await db
      .insert(booksSource)
      .values({
        workspace_id: ws.id,
        entity_id: s.entity_id === null ? null : (entityId.get(s.entity_id) ?? null),
        seq: nextSeq('source'),
        name: s.name,
        type: s.type,
        layer: s.layer,
        draws_from: null,
        ledger_accounts: s.ledger_accounts ?? [],
        method: s.method,
        expected: s.expected,
        last_import: s.last_import,
        retired: s.retired,
        notes_freeform: s.notes_freeform ?? null,
      })
      .returning()
    sourceId.set(s.id, row.id)
  }
  for (const s of F.SOURCES) {
    if (s.draws_from === null) continue
    const target = sourceId.get(s.draws_from)
    if (target === undefined) continue
    await db
      .update(booksSource)
      .set({ draws_from: target })
      .where(eq(booksSource.id, sourceId.get(s.id)!))
  }

  // ---- recognition rules -------------------------------------------------
  const ruleId = new Map<number, number>()
  for (const r of F.RECOGNITION_RULES) {
    const [row] = await db
      .insert(booksRule)
      .values({
        workspace_id: ws.id,
        entity_id: entityId.get(r.entity_id)!,
        seq: nextSeq('rule'),
        source_id: r.source_id === null ? null : (sourceId.get(r.source_id) ?? null),
        active: r.active,
        // The mockup calls this `source`; renamed to avoid reading as `source_id`.
        learned_from: r.source ?? null,
        pattern: r.pattern,
        explanation: r.explanation ?? null,
        account_no: r.account,
        created_from_entry_id: null, // patched below
        created_on: r.created,
        note: r.note ?? null,
      })
      .returning()
    ruleId.set(r.id, row.id)
  }

  // ---- entries: staged, then lines, then posted ---------------------------
  // `entry_no` is the statutory journal number and must be GAPLESS per
  // (entity, exercice), so it is assigned in date order rather than from the
  // mockup's ids.
  const entryId = new Map<number, number>()
  const byEntity = new Map<number, FxTx[]>()
  for (const t of F.TX) {
    const list = byEntity.get(t.entity_id) ?? []
    list.push(t)
    byEntity.set(t.entity_id, list)
  }

  for (const [fxEntity, txs] of byEntity) {
    txs.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
    let entryNo = 0
    for (const t of txs) {
      entryNo += 1
      const [row] = await db
        .insert(booksEntry)
        .values({
          workspace_id: ws.id,
          entity_id: entityId.get(t.entity_id)!,
          exercice_id: exerciceId.get(t.entity_id)!,
          seq: nextSeq('entry'),
          entry_no: entryNo,
          date: t.date,
          status: 'staged', // ALWAYS. Posting is a transition.
          source_id: t.source_id === null ? null : (sourceId.get(t.source_id) ?? null),
          raw_label: t.raw_label,
          counterparty: t.counterparty,
          explanation: t.explanation ?? null,
          recognition: t.recognition,
          matched_rule_id:
            t.matched_rule_id === null ? null : (ruleId.get(t.matched_rule_id) ?? null),
          evidence_tier: t.evidence_tier,
          evidence_note: t.evidence_note ?? null,
          tva_rate: t.tva?.rate === null || t.tva?.rate === undefined ? null : money(t.tva.rate),
          tva_amount: t.tva?.amount === undefined ? null : money(t.tva.amount),
          tva_input_claimed: t.tva?.input_claimed ?? false,
          tva_note: t.tva?.note ?? null,
          related_party: null, // patched below: mirror_tx points forward
          piece_drive_ref: t.piece?.drive_ref ?? null,
          piece_hash: t.piece?.hash ?? null,
          piece_captured: t.piece?.captured ?? null,
          history: t.history ?? null,
        })
        .returning()
      entryId.set(t.id, row.id)

      await db.insert(booksEntryLine).values(
        t.lines.map((l, i) => ({
          entry_id: row.id,
          account_no: l.account,
          debit: money(l.debit),
          credit: money(l.credit),
          position: i,
        }))
      )

      // The transition. The deferred balance check fires at COMMIT.
      if (t.status === 'posted') {
        await db.update(booksEntry).set({ status: 'posted' }).where(eq(booksEntry.id, row.id))
      }
    }
  }

  // ---- second pass: the forward references -------------------------------
  for (const t of F.TX) {
    if (!t.related_party) continue
    const rp = t.related_party
    await db
      .update(booksEntry)
      .set({
        related_party: {
          counterpart: rp.counterpart,
          kind: rp.kind,
          justification: rp.justification ?? null,
          // The mirroring entry in the OTHER book. Only expressible because one
          // workspace holds every book (D1).
          mirror_entry_id: rp.mirror_tx ? (entryId.get(rp.mirror_tx) ?? null) : null,
        },
      })
      .where(eq(booksEntry.id, entryId.get(t.id)!))
  }

  for (const r of F.RECOGNITION_RULES) {
    if (r.created_from === null) continue
    await db
      .update(booksRule)
      .set({ created_from_entry_id: entryId.get(r.created_from) ?? null })
      .where(eq(booksRule.id, ruleId.get(r.id)!))
  }

  // ---- the sole proprietorship ------------------------------------------
  const ri = F.ENTITIES.find((e) => e.legal_form === 'RI')
  if (ri) {
    const riEntity = entityId.get(ri.id)!
    const riExercice = exerciceId.get(ri.id)!
    for (const r of F.RI_ENTRIES) {
      await db.insert(booksRiEntry).values({
        workspace_id: ws.id,
        entity_id: riEntity,
        exercice_id: riExercice,
        seq: nextSeq('ri_entry'),
        date: r.date,
        direction: r.direction,
        amount: money(r.amount),
        category: r.category ?? null,
        raw_label: r.raw_label,
        counterparty: r.counterparty,
        explanation: r.explanation ?? null,
        recognition: r.recognition,
        matched_rule_id:
          r.matched_rule_id === null ? null : (ruleId.get(r.matched_rule_id) ?? null),
        evidence_tier: r.evidence_tier,
        evidence_note: r.evidence_note ?? null,
        piece_drive_ref: r.piece?.drive_ref ?? null,
        piece_hash: r.piece?.hash ?? null,
        piece_captured: r.piece?.captured ?? null,
      })
    }
    for (const p of F.PATRIMOINE) {
      await db.insert(booksPatrimoine).values({
        workspace_id: ws.id,
        entity_id: riEntity,
        exercice_id: riExercice,
        seq: nextSeq('patrimoine'),
        as_of: p.as_of,
        compiled: p.compiled,
        items: p.items,
        note: p.note ?? null,
      })
    }
  }

  // ---- counters ----------------------------------------------------------
  // So the app's next #number continues where the seed stopped instead of
  // colliding with it.
  for (const [type, last] of counters) {
    await db.insert(booksCounters).values({
      workspace_id: ws.id,
      entity_type: type,
      last_value: last,
    })
  }

  return { workspaceId: ws.id }
}
