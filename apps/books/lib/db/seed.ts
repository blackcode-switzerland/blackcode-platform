// Load the mockup into Postgres. This is the fixture AND the test data.
//
//   npm run db:seed:books            (idempotent: replaces the seeded workspace)
//
// A LOCAL DATABASE ONLY. See `seedRefusal` below: this deletes and rebuilds the
// workspace slugged `blackcode`, so it refuses any host that is not this machine.
// Production books are not seeded at all, they are created and posted to.
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
// TWO EXERCICES FOR BLACKCODE, AND THE REPRISE BETWEEN THEM
// ===========================================================================
// `ENTITIES` declares `exercice: 2026`, and the transaction data spans TWO years:
// fifteen entries in 2026 and two in 2025 (1001 and 1009, both posted, both
// frozen-UBS history, both blackcode's). The mockup's own derivations have no
// year boundary at all, which is why nobody noticed.
//
// This seed used to put all seventeen into one exercice labelled 2026, stretched
// backwards to contain them. That was the documented compromise, and it is gone:
// an entry dated 2025 sitting in exercice 2026 is exactly the kind of wrong this
// app exists to refuse.
//
// So blackcode gets exercice 2025 (CLOSED) holding its two 2025 entries, and
// exercice 2026 (open) holding the rest. AIOS and the RI have 2026 data only and
// get one exercice each. Every window is a clean calendar year.
//
// ── THE CLOSE IS DATA, NOT A FEATURE ────────────────────────────────────────
// 2026's opening balances are COMPUTED below from 2025's: closing balance per
// bilan account, with the 2025 result folded into 2970 (résultat reporté). The
// arithmetic is `closeYear`, built on the same audited derive functions the
// statements use.
//
// The app itself still has NO year-end close routine — that stays out of phase 1,
// per week-one.md. What this seed does is what onboarding any real client
// mid-life looks like: the prior year was closed elsewhere (here, by arithmetic;
// for Andrea, by the fiduciary), and its closing balances are keyed in as the new
// year's openings. `opening_balance` is a table for exactly this reason.
//
// `closed_at` stays NULL on the closed exercice: the close was not performed
// in-system, so a timestamp for it would be invention.
//
// ── WHAT THIS CHANGES AGAINST THE STATIC MOCKUP'S SCREENS ───────────────────
// The 2026 bilan TOTALS are unchanged to the rappen: openings absorb the 2025
// movements, so both sides land where they always did. But the mockup computed
// one statement over both years, so the RESULT lines move, all by the 2025
// result (-4850.00: rent 1850 + admin 3000, both charges, no produits):
//
//   résultat de l'exercice    -15843.60 whole-period -> -10993.60 for 2026
//   résultat reporté          -6000.00 -> -10850.00, holding the folded loss
//   CR autres charges         4850.00 smaller; the two charges sit on exercice
//                             2025's own compte de résultat instead
//
// (Figures restated from the live statements on 2026-08-18; an earlier draft of
// this header carried estimates. seed-parity.test.ts derives them, never trusts
// this comment.)
//
// That is the statutorily correct allocation: a December 2025 rent belongs to
// 2025's result, which by 2026 lives in retained earnings. The mockup's version
// was an artefact of having no year boundary. `seed-parity.test.ts` pins the
// invariant totals AND the shifted lines, each derived from the fixture rather
// than hardcoded.
//
// The 2025 statements are real and queryable: `bk books bilan --entity blackcode
// --exercice 2025` balances, and its closing balances are 2026's openings line
// for line.

import { eq, sql } from 'drizzle-orm'
import { getDb } from './client'
import {
  booksWorkspaces,
  booksWorkspaceMembers,
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
import {
  accountBalance,
  crFor,
  toCentimes,
  fromCentimes,
  type ChartAccount,
  type PostingLine,
} from '../derive'
import { booksSourcePull, booksRunbook, booksAnalysis, booksAnalytiqueCategory, booksTaxParams } from './schema'
import { ingestPiece } from './queries/pieces'
import type { Extraction } from '../validate/extraction'
import fixture from '../../fixtures/mockup.json'
import complianceRules from '../../fixtures/compliance-rules.json'

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
  pulls?: { file: string; period?: string; format?: string; hash?: string; drive_ref?: string; pulled?: string }[]
  runbook?: { version?: string; updated?: string; login_url?: string; credential_ref?: string; steps?: unknown[]; output?: string }
}
interface FxPiece {
  id: number; entity_id: number | null; status: string; received: string; pipeline?: string
  source: { file_id: string; file_name?: string; mime_type?: string; md5_checksum?: string; created_time?: string; web_view_link?: string }
  extraction: Record<string, unknown> & { tx?: Record<string, unknown> }
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

interface FxAnalysis {
  id: number; entity_id: number; asked: string; asked_by: string; agent: string
  scenario_label?: Json; runway_after_months?: number | null
  question: Json; verdict: Json; figures: Json[]; based_on: Json[]
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
  PIECE_INBOX: FxPiece[]
  ANALYSES: FxAnalysis[]
  ANALYTIQUE_CATEGORIES: { key: string; accounts: string[]; label: Json }[]
  TAX_INFO: { ifd: Json; vd_cantonal: Json; communal_renens: Json; capital_tax: Record<string, unknown> }
}

export const SEED_SLUG = 'blackcode'

interface FxComplianceRule {
  rule_id: string; citation: string; applies_to: string; trigger_condition: string
  check_logic: string; severity: string; consequence_if_violated: string
  summary?: Json; source_confidence: string
}
const COMPLIANCE_RULES = (complianceRules as unknown as { rules: FxComplianceRule[] }).rules

// ---------------------------------------------------------------------------
// The reprise: closing one year to open the next
// ---------------------------------------------------------------------------

/** The fixture's chart in the shape the derive functions take. */
const CHART: ChartAccount[] = F.ACCOUNTS.map((a) => ({
  no: a.no,
  class: a.class,
  statement: a.statement,
  statement_position: a.statement_position,
}))

/** One book's posting lines for one calendar year, as the derivations see them. */
function fxLines(entityFxId: number, year: number, tx: FxTx[]): PostingLine[] {
  const out: PostingLine[] = []
  for (const t of tx) {
    if (t.entity_id !== entityFxId) continue
    if (Number(t.date.slice(0, 4)) !== year) continue
    for (const l of t.lines) {
      out.push({ account_no: l.account, debit: money(l.debit), credit: money(l.credit), status: t.status })
    }
  }
  return out
}

/**
 * Close a year: openings in, next year's openings out. Centimes throughout.
 *
 * Per bilan account, the closing balance (class 2 sign handled by
 * `accountBalance`); then the year's result folded into 2970, résultat reporté —
 * which is what closing an exercice MEANS, and why CR accounts start the new
 * year at zero without appearing here at all.
 *
 * Zero closings are dropped rather than written: a missing `opening_balance`
 * row means zero by contract, stated on the table itself in 0003.
 */
function closeYear(openings: Map<string, bigint>, lines: PostingLine[]): Map<string, bigint> {
  const next = new Map<string, bigint>()
  for (const a of CHART) {
    if (a.statement !== 'bilan') continue
    const closing = accountBalance(lines, a, openings.get(a.no) ?? 0n)
    if (closing !== 0n) next.set(a.no, closing)
  }
  const resultat = toCentimes(crFor(lines, CHART).resultat)
  const reporte = CHART.find((a) => a.statement_position === 'resultat_reporte')
  if (reporte && resultat !== 0n) {
    const folded = (next.get(reporte.no) ?? 0n) + resultat
    if (folded === 0n) next.delete(reporte.no)
    else next.set(reporte.no, folded)
  }
  return next
}

// ===========================================================================
// WHERE THIS MAY RUN, AND WHY THE GATE IS TIGHTER THAN THE SALES ONE
// ===========================================================================
// b/sales gates its seed on `NODE_ENV !== 'production'` AND `SALES_SEED=1`, and
// says of itself: "it never deletes anything it did not create".
//
// This seed does the opposite. It DELETES the workspace slugged `blackcode` and
// everything under it, with all six protective triggers switched off, and then
// rebuilds it. Against production that is not a duplicate row next to real data,
// it is Andrea's books gone — and it is one wrong `DATABASE_URL` away, because
// the destructive path is the NORMAL path here. Re-running the seed is how it is
// meant to be used.
//
// So the target host is checked as well, which is the gate that actually matches
// the hazard: `NODE_ENV` reflects how the process was launched, and a `.env.local`
// edited to point at a real database says nothing about `NODE_ENV` at all.
//
// Failing closed is the rule throughout: an absent or unparseable URL is refused
// rather than assumed local.

/** Loopback in the four forms a connection string can spell it, plus the empty host of a unix socket. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', ''])

/** The one deliberate escape hatch, for a dev database that genuinely is not on this machine. */
export const ALLOW_REMOTE_ENV = 'BOOKS_SEED_ALLOW_REMOTE_HOST'

/**
 * Why this seed must not run against `url`, or `null` if it may.
 *
 * Pure and parameterised rather than reading `process.env` directly, so
 * `seed-guard.test.ts` can check the refusals without mutating global env — a
 * guard nobody can test is a guard nobody can trust.
 */
export function seedRefusal(
  url: string | undefined,
  env: Record<string, string | undefined> = {}
): string | null {
  // Production is refused outright. The remote-host override does NOT reach this:
  // "my dev database is elsewhere" and "this is production" are different claims
  // and one must never be usable as the other.
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    return 'NODE_ENV or VERCEL_ENV says production. This seed deletes the workspace slugged `blackcode`.'
  }

  if (!url) {
    return 'DATABASE_URL is not set. Refusing rather than guessing where it would have written.'
  }

  // BELOW the production gate on purpose. "My dev database is elsewhere" and
  // "this is production" are different claims, and one must never be usable as
  // the other, so this waives the host check and nothing above it.
  if (env[ALLOW_REMOTE_ENV] === '1') return null

  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'DATABASE_URL could not be parsed, so its target host is unknown. Refusing.'
  }

  if (!LOCAL_HOSTS.has(host)) {
    return (
      `DATABASE_URL points at "${host}", which is not this machine.\n` +
      '  This seed DELETES the workspace slugged `blackcode` and everything under it,\n' +
      '  with every protective trigger disabled, and then rebuilds it from the mockup.\n' +
      '  Production books do not come from here: they are created with `bk books entity\n' +
      '  create` and posted to entry by entry.\n' +
      `  If that host really is a development database, set ${ALLOW_REMOTE_ENV}=1.`
    )
  }

  return null
}

/** Throws with the reason if this database must not be seeded. */
export function assertSeedable(env: Record<string, string | undefined> = process.env): void {
  const refusal = seedRefusal(env.DATABASE_URL, env)
  if (refusal) throw new Error(`refusing to seed: ${refusal}`)
}

export async function seed(ownerUserId: number): Promise<{ workspaceId: number }> {
  // Checked here and not only in `scripts/seed.ts`, so no future caller can reach
  // the teardown by importing this function directly.
  assertSeedable()

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

  // The owner's MEMBERSHIP row, without which the workspace does not exist as
  // far as the API is concerned: every read joins through workspace_members and
  // `owner_id` grants nothing by itself. Found on 2026-08-18 by the first real
  // CLI session against a seeded database — `bk books workspace list` as the
  // owner returned an empty table, because every automated test enters below
  // the membership gate. Same shape `ensureWorkspaceForUser` writes.
  await db
    .insert(booksWorkspaceMembers)
    .values({ workspace_id: ws.id, user_id: ownerUserId, role: 'owner' })

  const counters = new Map<string, number>()
  const nextSeq = (type: string): number => {
    const n = (counters.get(type) ?? 0) + 1
    counters.set(type, n)
    return n
  }

  // ---- books -------------------------------------------------------------
  const entityId = new Map<number, number>()
  // `${fixture entity id}/${year}` -> exercice row id. Keyed per year because a
  // book may have several, and blackcode does.
  const exerciceIdByYear = new Map<string, number>()
  const CURRENT_YEAR = 2026

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

    // ---- exercices and opening balances, year by year --------------------
    // One exercice per calendar year the book has entries in, plus the current
    // one. Past years are CLOSED, `closed_at` NULL — see the header for why.
    //
    // The FIRST year's openings are the fixture's `OPENING` (absent for the RI,
    // which is correct rather than missing data: art. 957 al. 2 bookkeeping has
    // no balance sheet to open). Every later year's openings are the previous
    // year's close, computed by `closeYear` — the reprise.
    const years = [
      ...new Set([CURRENT_YEAR, ...F.TX.filter((t) => t.entity_id === e.id).map((t) => Number(t.date.slice(0, 4)))]),
    ].sort()

    let opening = new Map<string, bigint>()
    for (const [no, amount] of Object.entries(F.OPENING[e.slug] ?? {})) {
      opening.set(no, toCentimes(amount))
    }

    for (const year of years) {
      const [ex] = await db
        .insert(booksExercice)
        .values({
          workspace_id: ws.id,
          entity_id: row.id,
          year,
          starts_on: `${year}-01-01`,
          ends_on: `${year}-12-31`,
          status: year < CURRENT_YEAR ? 'closed' : 'open',
        })
        .returning()
      exerciceIdByYear.set(`${e.id}/${year}`, ex.id)

      if (opening.size > 0) {
        await db.insert(booksOpeningBalance).values(
          [...opening].map(([no, cents]) => ({
            workspace_id: ws.id,
            entity_id: row.id,
            exercice_id: ex.id,
            account_no: no,
            amount: fromCentimes(cents),
          }))
        )
      }

      // Roll forward. For the last year this feeds nobody and costs nothing.
      opening = closeYear(opening, fxLines(e.id, year, F.TX))
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

  // ---- what hangs off each source: pulls and the runbook -------------------
  for (const src of F.SOURCES) {
    const sid = sourceId.get(src.id)!
    if (src.pulls?.length) {
      await db.insert(booksSourcePull).values(
        src.pulls.map((pl) => ({
          workspace_id: ws.id,
          source_id: sid,
          file: pl.file,
          period: pl.period ?? null,
          format: pl.format ?? null,
          hash: pl.hash ?? null,
          drive_ref: pl.drive_ref ?? null,
          pulled: pl.pulled ?? null,
        }))
      )
    }
    if (src.runbook) {
      await db.insert(booksRunbook).values({
        workspace_id: ws.id,
        source_id: sid,
        version: src.runbook.version ?? '1.0',
        updated: src.runbook.updated ?? null,
        login_url: src.runbook.login_url ?? null,
        credential_ref: src.runbook.credential_ref ?? null,
        steps: src.runbook.steps ?? [],
        output: src.runbook.output ?? null,
      })
    }
  }

  // ---- the pièces, through the REAL ingest pipeline ------------------------
  // Not raw inserts, on purpose: the seed is the first honest client of the
  // ingest path, exactly as the entry seed is of 0004. The server RE-VALIDATES
  // each of the mockup's real extractions and lands them staged; the Drive
  // manifest rows come out of the same call, so the manifest states in the
  // database are the pipeline's own verdicts, not copied fixture data — and
  // they had better agree with `DRIVE_MANIFEST` in the fixture, which is what
  // pieces.test.ts pins.
  for (const p of F.PIECE_INBOX) {
    const extraction = { ...p.extraction, transaction: p.extraction.tx } as unknown as Extraction
    await ingestPiece(
      ws.id,
      p.entity_id === null ? null : (entityId.get(p.entity_id) ?? null),
      p.source,
      extraction,
      p.received,
      p.pipeline ?? null
    )
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
  // Grouped per (entity, YEAR): the journal restarts at 1 each exercice, which
  // is what per-year statutory numbering means.
  const byBookYear = new Map<string, FxTx[]>()
  for (const t of F.TX) {
    const k = `${t.entity_id}/${t.date.slice(0, 4)}`
    const list = byBookYear.get(k) ?? []
    list.push(t)
    byBookYear.set(k, list)
  }

  for (const [, txs] of byBookYear) {
    txs.sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
    let entryNo = 0
    for (const t of txs) {
      entryNo += 1
      const [row] = await db
        .insert(booksEntry)
        .values({
          workspace_id: ws.id,
          entity_id: entityId.get(t.entity_id)!,
          exercice_id: exerciceIdByYear.get(`${t.entity_id}/${t.date.slice(0, 4)}`)!,
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
    // Every RI entry is 2026; the patrimoine's `as_of` of 2025-12-31 is the
    // opening net-worth snapshot of that same exercice, not a 2025 record.
    const riExercice = exerciceIdByYear.get(`${ri.id}/${CURRENT_YEAR}`)!
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

  // ---- management: categories, tax parameters, filed analyses -------------
  // Categories and tax parameters for every double-entry book: the fixture's
  // five buckets, and the Vaud/Renens rates all three seeded books actually
  // sit under. capital_tax seeds UNCONFIRMED: the mockup marked it confirmed
  // while carrying an open question for the fiduciary in the same block, and
  // until she answers, false is the honest flag (decided with Mustneer,
  // 2026-08-19).
  const seededParams = {
    ifd: F.TAX_INFO.ifd,
    cantonal: F.TAX_INFO.vd_cantonal,
    communal: F.TAX_INFO.communal_renens,
    capital_tax: { ...F.TAX_INFO.capital_tax, confirmed: false },
  }
  for (const e of F.ENTITIES) {
    if (e.legal_form === 'RI') continue
    const dbEntity = entityId.get(e.id)!
    for (const c of F.ANALYTIQUE_CATEGORIES) {
      await db.insert(booksAnalytiqueCategory).values({
        workspace_id: ws.id,
        entity_id: dbEntity,
        seq: nextSeq('category'),
        key: c.key,
        label: c.label,
        accounts: c.accounts,
      })
    }
    await db.insert(booksTaxParams).values({
      workspace_id: ws.id,
      entity_id: dbEntity,
      canton: 'VD',
      commune: 'Renens',
      params: seededParams,
    })
  }

  // The filed analyses, verbatim. Their `based_on` snapshots are permanent
  // records of what the agent read at answer time and stay exactly as filed —
  // the fixture's minute-precision timestamps are Europe/Zurich, August,
  // hence the fixed +02:00.
  for (const a of F.ANALYSES) {
    await db.insert(booksAnalysis).values({
      workspace_id: ws.id,
      entity_id: entityId.get(a.entity_id)!,
      seq: nextSeq('analysis'),
      asked: new Date(a.asked + ':00+02:00'),
      asked_by: a.asked_by,
      agent: a.agent,
      scenario_label: a.scenario_label ?? null,
      runway_after_months:
        a.runway_after_months === undefined || a.runway_after_months === null
          ? null
          : String(a.runway_after_months),
      question: a.question,
      verdict: a.verdict,
      figures: a.figures,
      based_on: a.based_on,
    })
  }

  // ---- compliance rules: GLOBAL, and reviews survive a reseed --------------
  // The 19 rules are law-derived and workspace-less. ON CONFLICT DO NOTHING
  // on purpose: a reseed replaces the demo WORKSPACE, but a fiduciary's
  // approve/edit/reject on a rule is real work this table is the only record
  // of, and `npm run db:seed` must never quietly reset it to draft.
  for (const r of COMPLIANCE_RULES) {
    await db.execute(sql`
      INSERT INTO books.compliance_rule
        (rule_id, citation, applies_to, trigger_condition, check_logic, severity,
         consequence, summary, source_confidence)
      VALUES
        (${r.rule_id}, ${r.citation}, ${r.applies_to}, ${r.trigger_condition},
         ${r.check_logic}, ${r.severity}, ${r.consequence_if_violated},
         ${r.summary ? JSON.stringify(r.summary) : null}::jsonb, ${r.source_confidence})
      ON CONFLICT (rule_id) DO NOTHING
    `)
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
