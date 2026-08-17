// The public shapes: what the routes serve and what the frontend types against.
//
// ===========================================================================
// THESE MIRROR THE MOCKUP FIELD FOR FIELD, AND THAT IS THE POINT
// ===========================================================================
// b/books is specified by a finished static mockup (the `b-mockups` repo, under
// `bbooks/`). Its `assets/bbooks-data.js` is the reference implementation, and
// `fixtures/mockup.json` here is that file's data dumped verbatim.
//
// The frontend codes against these shapes, so renaming a field costs a rewrite on
// the other side of the app. When in doubt, open the fixture and copy what is
// there. Where this file and the mockup disagree, the mockup wins.
//
// ── THE SERIAL ID IS NEVER HERE ────────────────────────────────────────────
// Every addressable row is served by its workspace `number` (the `seq`). A row id
// that reaches a caller ends up in a script, and then it is a contract nobody
// agreed to.
//
// ── MONEY AND DATES ARE STRINGS ────────────────────────────────────────────
// An amount is `numeric(14,2)` and crosses the wire as `"1234.50"`. Typing one as
// `number` invites rounding through a float in a system whose entire purpose is
// that the books are correct. A date is a Postgres `date` (`"2026-01-05"`), not
// an instant: parsing it into a Date puts it at midnight in some timezone, and a
// booking date has no time of day.
//
// ── ABSENT MEANS NULL, NOT UNDEFINED ───────────────────────────────────────
// Optional data is `T | null`, not `T?`. The mockup writes `piece: null` and
// omits `evidence_note` entirely when the tier is `full`; serving one shape for
// "no value" means the frontend writes one check instead of two.

import type { StatementLabel } from './statements'

/** A CHF amount as it crosses the wire: `"1234.50"`. Never a number. */
export type Money = string
/** A calendar date: `"2026-01-05"`. Never a Date. */
export type IsoDate = string

/**
 * Human-facing text carried by the STATUTORY layer, where the French is the
 * statute's wording and load-bearing (see lib/statements.ts).
 *
 * Interface chrome elsewhere is plain English strings. There is no i18n system
 * in this platform and b/books does not add one; what stays French is the legal
 * text that the filed PDF must reproduce.
 */
export type Label = StatementLabel

// ---------------------------------------------------------------------------
// entity — a BOOK
// ---------------------------------------------------------------------------

/**
 * `SA` is a company, `RI` a person's self-employment activity.
 *
 * The distinction is not cosmetic: an SA is always full double-entry under
 * art. 957 al. 1 ch. 2 CO with no turnover threshold, ever. There must be no
 * code path that lets one fall back to simplified bookkeeping.
 */
export type LegalForm = 'SA' | 'RI'

export type BookkeepingRegime = 'double_entry' | 'simplified'

/**
 * One book.
 *
 * ── REALIGNED WITH THE ROUTE ON 2026-08-17 ─────────────────────────────────
 * This described the mockup fixture. Phase 1's `publicEntity`
 * (`lib/db/queries/statutory.ts`) serves something different in three ways, and
 * two of them were rendering silently wrong values before this was corrected:
 *
 *   - **`vat` is NESTED**, not four flat columns. Every card read
 *     `entity.vat_registered` — `undefined` — and printed "Not registered" for
 *     a company that is registered. A wrong fact about tax status, stated
 *     confidently, with nothing thrown.
 *   - **`exercice` is GONE.** A book no longer carries one year; the years are
 *     rows in `books.exercice` and there can be several. The overview card
 *     printed the label with an empty value beside it. Use `useExercices`.
 *   - **`number` was added** — the workspace `seq`, which is what the CLI and
 *     any URN print. The serial `id` is never exposed.
 *
 * Keep this file matching `publicEntity` field for field. A type that describes
 * an older wire shape does not fail to compile; it renders `undefined` and lets
 * the screen make something up.
 */
export interface Entity {
  /** The workspace-scoped number. Never the serial `id`. */
  number: number
  /** Stable slug used in URLs and CLI flags: `blackcode`, `aios`, `ri`. */
  slug: string
  name: string
  legal_form: LegalForm
  /** Legal seat. Drives which cantonal and communal tax parameters apply. */
  seat: string
  bookkeeping_regime: BookkeepingRegime
  /** How the regime was arrived at — elected, or required by law. */
  regime_election: string | null
  regime_note: Label | null
  /** `calendar` today. Kept as a field so nothing hardcodes 31.12 symmetry. */
  fiscal_year: 'calendar'
  /** Nested to match the mockup, where VAT is a block rather than four columns. */
  vat: {
    registered: boolean
    method: 'effective' | null
    filing: 'quarterly' | null
    note: Label | null
  }
  /** `opted_out` under art. 727a CO, or null. */
  audit_status: 'opted_out' | null
  /** Kept visible because it is what preserves audit opt-out eligibility. */
  fte_count: number | null
  /** UI accent colour, served by the API so a new book needs no frontend change. */
  accent: string
}

// ---------------------------------------------------------------------------
// account — the chart
// ---------------------------------------------------------------------------

export interface Account {
  /** Swiss PME chart number: `1020`, `6570`. The primary key, per entity. */
  no: string
  /** Class 1-9. Classes 1-2 feed the bilan, 3-8 the compte de résultat. */
  class: number
  label: Label
  statement: 'bilan' | 'cr'
  /** Exactly one line of the statutory structure. The only touchable mapping. */
  statement_position: string
  /** art. 959a al. 4 — presented separately. */
  related_party: boolean
}

// ---------------------------------------------------------------------------
// entry — the ledger
// ---------------------------------------------------------------------------

/** Can the system EXPLAIN this entry? The legibility core. */
export type Recognition = 'known_recurring' | 'known_one_off' | 'inferred' | 'unrecognized'

/**
 * What evidence is held, with TWO INDEPENDENT legal consequences that are never
 * merged: profit-tax plausibility (LIFD art. 58) and input VAT recovery
 * (LTVA art. 26). A bank record can support the first and never the second.
 */
export type EvidenceTier = 'full' | 'partial' | 'bare'

/** `staged` never touches a balance. `posted` is immutable. */
export type EntryStatus = 'posted' | 'staged'

export interface EntryLine {
  /** Chart account number. Null is allowed only while `staged`. */
  account: string | null
  debit: Money
  credit: Money
}

export interface Vat {
  rate: number
  amount: Money
  /**
   * INDEPENDENT of `evidence_tier`, deliberately. Never derive one from the
   * other: a bank record alone never supports an input VAT claim, however
   * plausible the expense is for profit tax.
   */
  input_claimed: boolean
  note: Label | null
}

/**
 * The supporting document. A REFERENCE, never a file.
 *
 * `drive_ref` points into Google Drive; `hash` is the sha256 taken at capture,
 * which is what makes the digital copy admissible under art. 958f CO. Nothing is
 * ever uploaded into this app.
 */
export interface Piece {
  drive_ref: string
  hash: string
  captured: IsoDate
}

export interface RelatedParty {
  counterpart: string
  kind: string
  /** Arm's-length pricing justification. Its absence is the audit risk. */
  justification: string | null
  /** The mirror entry in the other book. Recorded on BOTH sides, always. */
  mirror_entry: number | null
}

export interface Entry {
  /** The workspace #number. Never the serial id. */
  number: number
  entity: string
  exercice: number
  /** Gapless journal number within (entity, exercice). Distinct from `number`. */
  entry_no: number | null
  date: IsoDate
  status: EntryStatus
  source: number | null
  /** The untouched bank text. NEVER overwritten — it is the original record. */
  raw_label: string
  counterparty: string | null
  /** What this entry MEANS. The legibility layer's actual product. */
  explanation: Label | null
  lines: EntryLine[]
  recognition: Recognition
  matched_rule: number | null
  evidence_tier: EvidenceTier
  evidence_note: Label | null
  tva: Vat | null
  related_party: RelatedParty | null
  piece: Piece | null
  /**
   * Resolution provenance, and it is PERMANENT. Confirming an inferred entry
   * resolves the question; it does not erase where the answer came from.
   */
  history: Label | null
}

// ---------------------------------------------------------------------------
// recognition rule — the legibility engine
// ---------------------------------------------------------------------------

export interface RulePattern {
  counterparty: string
  /** Null matches any amount. */
  amount_chf: Money | null
  tolerance_chf: Money | null
  interval: 'weekly' | 'monthly' | 'quarterly' | null
}

export interface RecognitionRule {
  number: number
  entity: string
  /**
   * Half of the match key. The key is the PAIR (source, counterparty), never the
   * merchant name alone: the same merchant on a source nobody tracks is a new
   * fact and must stay queued rather than be silently matched.
   */
  source: number | null
  active: boolean
  /** Where the rule came from. */
  source_kind: 'contract' | 'subscription' | 'manual'
  pattern: RulePattern
  explanation: Label
  account: string | null
  /** Which entry TAUGHT this rule. The learning loop, made visible. */
  created_from: number | null
  created: IsoDate
  note: Label | null
}

// ---------------------------------------------------------------------------
// derived statements — what the bilan and CR screens render
// ---------------------------------------------------------------------------

export interface BilanLineResult {
  pos: string
  label: Label
  related: boolean
  derived: boolean
  amount: Money
}

export interface BilanGroupResult {
  group: Label
  side: 'actif' | 'passif'
  lines: BilanLineResult[]
}

export interface BilanResult {
  groups: BilanGroupResult[]
  totalActif: Money
  /** Must equal `totalActif`. Render the check; a mismatch is worth showing. */
  totalPassif: Money
  resultat: Money
}

export interface CrLineResult {
  pos: string
  label: Label
  sign: 1 | -1
  amount: Money
  /** Accounts feeding this line. Drives the drill-down into the ledger. */
  accounts: string[]
}

export interface CrResult {
  lines: CrLineResult[]
  resultat: Money
}

// ---------------------------------------------------------------------------
// meta — the vocabularies
// ---------------------------------------------------------------------------

/**
 * A vocabulary term, WITH its presentation.
 *
 * The colour and icon are served by the API rather than hardcoded in CSS, so
 * adding a state does not need a frontend release. That is how the mockup does
 * it and it is worth keeping.
 */
export interface Term {
  value: string
  label: string
  color?: string
  icon?: string
  /** Legal consequence, where the term has one. Evidence tiers do. */
  note?: string
}

export interface BooksMeta {
  app: 'books'
  entities: Entity[]
  exercices: number[]
  vocabularies: {
    recognition: Term[]
    evidence_tiers: Term[]
    entry_status: Term[]
    source_types: Term[]
    source_layers: Term[]
    source_status: Term[]
    manifest_states: Term[]
  }
  /** Valid Swiss VAT rates since 01.01.2024. The whitelist ingest validates on. */
  tva_rates: number[]
  statements: {
    bilan: readonly { group: Label; side: string; lines: { pos: string; label: Label }[] }[]
    cr: readonly { pos: string; label: Label; sign: number }[]
  }
}
