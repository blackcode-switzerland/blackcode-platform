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
// the other side of the app.
//
// ── AND THE ROUTE WINS, NOT THE MOCKUP — CORRECTED 2026-08-18 ──────────────
// This file used to end the paragraph above with "where this file and the mockup
// disagree, the mockup wins". That was true while there were no routes. There
// are nine now, and the mockup is no longer what the frontend reads: the
// `public*` functions in `lib/db/queries/statutory.ts` are. Nine fields in this
// file described the fixture and not the payload, and **four of them would have
// rendered a confident wrong value** rather than failing to compile:
//
//   `Account.label`      is `{fr, enSuffix}` on the wire, not `{fr, en}`. `en()`
//                        falls back to the French, so every account name in the
//                        chart and every drill-down label would have rendered in
//                        French on an English screen, silently (D-A).
//   `Entity.fte_count`   is `"4.60"` — a `numeric` string, not a number.
//   `Entry.tva.rate`     is `"8.10"` — likewise. `percent()` takes a number and
//                        would have printed `8.1%` only by luck of coercion.
//   `Entry.tva`          is ALWAYS an object. Typed `Vat | null`, every screen
//                        writes a null check that can never fire and none writes
//                        the per-field one that must.
//
// The other five were phantom fields — `Entry.entity`, `Entry.exercice`,
// `Account.related_party`, `BilanLineResult.label`, `CrLineResult.label` — which
// read `undefined` and render as a blank cell.
//
// **Keep this file matching the `public*` functions field for field.** When one
// changes, this is the file that makes every bad read a compile error.
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
 * ── AND FIVE MORE, FOUND 2026-08-18 BY READING `publicEntity` AGAIN ────────
 *   - **`seat` is nullable.** `books.entity.seat` is `text` with no NOT NULL and
 *     `bk books entity create` does not require one, so a book created from the
 *     CLI has none. Typed `string`, a card renders the empty string and the
 *     reader sees a missing line rather than a book with no registered seat.
 *   - **`fte_count` is a STRING.** `numeric(6,2)` arrives as `"4.60"`. It was
 *     typed `number`, which is how a `numeric` column silently becomes a float
 *     everywhere else in this app.
 *   - **`accent` is nullable** — only the seeded books carry one.
 *   - **`legal_form` and `audit_status` are open strings on the wire.** The route
 *     stores whatever `--legal-form` was given; `SA` and `RI` are the two the
 *     product knows, not the two the column allows. Narrowing them here would
 *     make a fourth form a type error at the wrong end of the pipe.
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
  /**
   * `SA` or `RI` for every book that exists today. Typed WIDE deliberately: the
   * column takes any 20 characters and `entity create` validates nothing, so a
   * narrow union here would be a claim about the data this file cannot make.
   * Compare against `LegalForm` where the product genuinely branches.
   */
  legal_form: string
  /**
   * Legal seat. Drives which cantonal and communal tax parameters apply.
   * **Nullable** — a book created from the CLI without `--seat` has none.
   */
  seat: string | null
  bookkeeping_regime: BookkeepingRegime
  /** How the regime was arrived at — elected, or required by law. */
  regime_election: string | null
  regime_note: Label | null
  /**
   * `calendar` today. Kept as a field so nothing hardcodes 31.12 symmetry.
   *
   * An open string: the column is a `varchar` with a default, and a non-calendar
   * year is a phase-2 conversation rather than something the wire forbids.
   */
  fiscal_year: string
  /**
   * Nested to match the mockup, where VAT is a block rather than four columns.
   *
   * `method` and `filing` are open strings for the same reason `legal_form` is —
   * they are `varchar(20)` columns, and `effective`/`quarterly` are the two
   * values the seeded data happens to carry, not the two the wire allows.
   */
  vat: {
    registered: boolean
    method: string | null
    filing: string | null
    note: Label | null
  }
  /** `opted_out` under art. 727a CO, or null. Open string, same reason as above. */
  audit_status: string | null
  /**
   * Kept visible because it is what preserves audit opt-out eligibility.
   *
   * **A STRING**: `numeric(6,2)` crosses the wire as `"4.60"`. It is not money,
   * but it is a `numeric`, and the reason not to parse it is the same one.
   */
  fte_count: string | null
  /**
   * UI accent colour, served by the API so a new book needs no frontend change.
   * **Nullable** — a book created from the CLI has no accent until one is set.
   */
  accent: string | null
}

// ---------------------------------------------------------------------------
// account — the chart
// ---------------------------------------------------------------------------

/**
 * An account's name, and **it is not a `StatementLabel`.**
 *
 * The English side is spelled `enSuffix`, not `en`. That is the mockup's own key
 * name (`lib/chart.ts` carries the same shape and the same note) and it survives
 * into `publicAccount` unchanged, so all 26 accounts of every book arrive this
 * way.
 *
 * ── WHY THIS IS ITS OWN TYPE AND NOT A WIDENED `Label` ─────────────────────
 * Because `en()` in `lib/label.ts` reads `.en` and falls back to `.fr`. Handed
 * one of these it finds no `.en`, returns the FRENCH, and renders it on an
 * English screen — which is decision D-A broken silently, on every account name
 * in the chart and every drill-down under an income-statement line. Nothing
 * throws and nothing looks empty; the words are simply the wrong language.
 *
 * A separate type makes that a compile error at the call site instead. Use
 * `accountLabelEn()` / `accountLabelFr()` in `lib/label.ts`.
 */
export interface AccountLabel {
  fr: string
  enSuffix: string
}

export interface Account {
  /** Swiss PME chart number: `1020`, `6570`. The primary key, per entity. */
  no: string
  /** Class 1-9. Classes 1-2 feed the bilan, 3-8 the compte de résultat. */
  class: number
  /** `{fr, enSuffix}`. NOT a `Label` — read the type above before using it. */
  label: AccountLabel
  statement: 'bilan' | 'cr'
  /** Exactly one line of the statutory structure. The only touchable mapping. */
  statement_position: string
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

/**
 * The VAT block. **Always present** — `publicEntry` builds it unconditionally
 * from four columns, so there is no `tva: null` on the wire and a null check on
 * the block is a check that can never fire. Every FIELD inside it can be null.
 */
export interface Vat {
  /**
   * `"8.10"`. A `numeric(4,2)` string, not a number — `percent()` in
   * `lib/format.ts` takes it as one.
   */
  rate: Money | null
  /**
   * The VAT amount. **Nullable** — `tva_amount` is a `numeric` with no NOT NULL,
   * so an entry that recorded no VAT has none, which is not the same claim as
   * `"0.00"`. `<Money>` renders an em dash for it.
   */
  amount: Money | null
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

/**
 * art. 959a al. 4 — the counterparty is a shareholder, a board member or another
 * book of the same owner.
 *
 * A `jsonb` column, served verbatim, so this type is the only thing describing
 * it. Two fields differ from the shape this file used to declare: the
 * justification is a `{fr, en}` pair rather than a string, and the mirror is
 * spelled `mirror_entry_id`.
 */
export interface RelatedParty {
  counterpart: string
  kind: string
  /** Arm's-length pricing justification. Its absence is the audit risk. */
  justification: Label | null
  /**
   * The mirror entry in the other book. Recorded on BOTH sides, always.
   *
   * **It is a serial `id`, not a #number** — the name says so and this app does
   * not resolve it. Do not link it: `/entries/{number}` takes the workspace seq
   * and would silently open a different écriture. Shown as a fact, not a link.
   */
  mirror_entry_id: number | null
}

/**
 * One écriture, exactly as `publicEntry` serves it.
 *
 * ── WHAT IS NOT ON THE WIRE, THOUGH IT WAS DECLARED HERE ──────────────────
 * `entity` and `exercice`. An entry payload does not say which book or year it
 * belongs to — the REQUEST does (`?entity=&exercice=`), and `/entries/{number}`
 * is workspace-scoped and answers for any book. A screen that needs to name the
 * book takes it from the scope, not from the row.
 */
export interface Entry {
  /** The workspace #number. Never the serial id. */
  number: number
  /**
   * Gapless journal number within (entity, exercice). Distinct from `number`.
   *
   * **NOT NULL on the wire** — `books.entry.entry_no` is `integer NOT NULL`, so
   * every entry has one, staged ones included. Declared non-nullable to match:
   * a `| null` here reads as "this can be absent" and would have every screen
   * writing a branch that cannot be reached, which is how a screen ends up with
   * an untested path in it.
   */
  entry_no: number
  date: IsoDate
  status: EntryStatus
  /** The source that produced it. A serial id; this app does not resolve it. */
  source_id: number | null
  /** The untouched bank text. NEVER overwritten — it is the original record. */
  raw_label: string
  counterparty: string | null
  /** What this entry MEANS. The legibility layer's actual product. */
  explanation: Label | null
  lines: EntryLine[]
  recognition: Recognition
  /** Which rule explained it. A serial id, and phase 2's to resolve. */
  matched_rule_id: number | null
  evidence_tier: EvidenceTier
  evidence_note: Label | null
  /** Always an object. See `Vat` — the block is never null, its fields are. */
  tva: Vat
  related_party: RelatedParty | null
  piece: Piece | null
  /** The entry this one reverses, as a serial id. Null for almost everything. */
  reverses_entry_id: number | null
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

/**
 * ===========================================================================
 * A STATEMENT PAYLOAD CARRIES NO LABELS. THE LABELS ARE THE LAW.
 * ===========================================================================
 * `BilanLineResult` used to declare `label` and `derived`, and `CrLineResult` a
 * `label`. Neither route serves any of the three: `bilanFor`/`crFor` in
 * `lib/derive/index.ts` emit `pos`, `related` and `amount`, and nothing else per
 * line. Read as declared, every line label on both statements would have been
 * `undefined` — a balance sheet of amounts with no line names.
 *
 * That is correct of the routes rather than a gap in them. The line list is
 * `BILAN_STRUCTURE` / `CR_STRUCTURE`, fixed by art. 959a and 959b, and serving a
 * second copy of it per request would be a copy that can disagree. The GROUP
 * label IS served (`BilanGroup.group`), because the derivation carries it
 * through.
 *
 * So a screen joins `pos` to the structure — from `/api/meta`, which is the
 * SERVER's copy, never from importing `lib/statements.ts` into the bundle.
 */
export interface BilanLineResult {
  pos: string
  /** art. 959a al. 4 — shown separately, and still counted in the total. */
  related: boolean
  amount: Money
}

export interface BilanGroupResult {
  /** The statutory group heading. Served; the LINE labels are not. */
  group: Label
  side: 'actif' | 'passif'
  lines: BilanLineResult[]
}

/** `GET …/bilan`. The envelope names the book and year the request resolved to. */
export interface BilanResult {
  /** The book slug the request resolved to — echoed, so a reader can check it. */
  entity: string
  exercice: number
  groups: BilanGroupResult[]
  totalActif: Money
  /** Must equal `totalActif`. Render the check; a mismatch is worth showing. */
  totalPassif: Money
  resultat: Money
  /**
   * Exact equality of the two sides. **Served, and it was not declared here.**
   * The screens are required to render this check (phase-1 README, screen 1) and
   * the field to render it from was missing from the type.
   */
  balanced: boolean
  /** Signed difference, so a failure says by how much rather than only "no". */
  ecart: Money
}

export interface CrLineResult {
  pos: string
  /**
   * +1 produit, −1 charge. A plain `number` on the wire — `crFor` types it as
   * one — so the literal union this used to declare was a narrowing the payload
   * does not guarantee.
   */
  sign: number
  amount: Money
  /** Accounts feeding this line. Drives the drill-down into the ledger. */
  accounts: string[]
}

/** `GET …/compte-resultat`. Same envelope as the bilan. */
export interface CrResult {
  entity: string
  exercice: number
  lines: CrLineResult[]
  resultat: Money
}

// ---------------------------------------------------------------------------
// overview — one row per book, with whichever statement its legal form has
// ---------------------------------------------------------------------------

/**
 * One book on the overview.
 *
 * **`bilan` and `ri` are two nullable fields, not one polymorphic result**, and
 * that is the route's deliberate choice: a sole proprietorship has no balance
 * sheet under art. 957 al. 2 CO, and a shared shape would invite a caller to
 * render one. Exactly one of the two is non-null for a book that has an
 * exercice; BOTH are null for a book that has none yet, which is a third state
 * and a real one — `entity create` does not open a fiscal year.
 */
export interface OverviewBook {
  slug: string
  name: string
  legal_form: string
  /** The newest exercice, or null when the book has none. */
  exercice: number | null
  /** Double-entry books only. */
  bilan: {
    actif: Money
    passif: Money
    balanced: boolean
    resultat: Money
  } | null
  /** Simplified books only. A CASH result, never a profit. */
  ri: {
    recettes: Money
    depenses: Money
    resultat: Money
  } | null
  entries: number
  /** Entries needing a human. Phase 2's worklist count. */
  unrecognized: number
  staged: number
}

export interface OverviewResult {
  books: OverviewBook[]
}

// ---------------------------------------------------------------------------
// patrimoine — art. 957 al. 2's other half
// ---------------------------------------------------------------------------

/**
 * One item of a net-worth statement.
 *
 * ── `amount` IS A JSON NUMBER, AND IT IS THE ONE PLACE IN THIS APP THAT IS ──
 * `books.patrimoine.items` is `jsonb` and `publicPatrimoine` serves it verbatim,
 * so these amounts arrive as `8200`, not `"8200.00"`. Every other amount in this
 * product is a `numeric` string for the reason `lib/format.ts` documents at
 * length, and this one is not, because a `jsonb` blob has no column type to be a
 * `numeric` of.
 *
 * It is typed honestly as `number` rather than laundered into `Money` here, so
 * the one conversion in the app is visible at its call site
 * (`lib/hooks.ts`, `usePatrimoine`). Raised with the backend — see the report.
 */
export interface PatrimoineItem {
  label: Label
  amount: number
}

export interface PatrimoineSnapshot {
  number: number
  /** The date the statement DESCRIBES. */
  as_of: IsoDate
  /** The date it was PRODUCED. Two fields on purpose — a reader needs both. */
  compiled: IsoDate | null
  items: PatrimoineItem[]
  /** Derived on read, never stored. A `numeric` string, unlike the items. */
  total: Money
  note: Label | null
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

/**
 * ===========================================================================
 * `BooksMeta` IS GONE. THE LIVE SHAPE IS `MetaPayload` IN lib/hooks.ts.
 * ===========================================================================
 * It declared `entities: Entity[]` and `exercices: number[]`. `GET /api/meta`
 * has served neither since phase 1 moved the books and the fiscal years into
 * `/api/workspaces/{ws}/…`: what it serves under `entities` is a POINTER
 * (`{source, table, note}`) at the routes that can answer.
 *
 * `lib/hooks.ts` already declared `MetaPayload` for the real shape, under a
 * header calling this "a real mismatch … the backend dev's file to correct".
 * Correcting it means deleting it, not fixing it — two declarations of one
 * payload is how the next one goes stale, and the one the hooks read is the one
 * that must be right.
 *
 * Import `MetaPayload` from `lib/hooks.ts`.
 */
