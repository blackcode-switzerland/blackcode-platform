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
/**
 * HISTORY: `AccountLabel {fr, enSuffix}` lived here until 2026-08-19, when the
 * backend started normalizing account labels to `{fr, en}` at the wire
 * (phase-0-contract.md's promise, phase-1 handoff finding). Storage still
 * spells it `enSuffix`; no client sees that any more.
 */

export interface Account {
  /** Swiss PME chart number: `1020`, `6570`. The primary key, per entity. */
  no: string
  /** Class 1-9. Classes 1-2 feed the bilan, 3-8 the compte de résultat. */
  class: number
  label: Label
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
  /**
   * The sha256 taken at capture — **and it is nullable, which this file denied
   * until 2026-08-18.**
   *
   * `books.entry.piece_hash` is a nullable column and `publicEntry` serves it
   * verbatim, so `hash: string` here was a claim the wire never made. It stayed
   * invisible while every entry carrying a pièce came from the seed, which
   * always sets one.
   *
   * Phase 3's `match` write is what made it reachable: `matchPiece` fills
   * `piece_hash` from the pièce's `md5_checksum`, and **every seeded pièce has
   * a NULL checksum**, so attaching one leaves the entry with a document and no
   * hash. `<DriveLink>` then called `.slice()` on null and the entry detail page
   * went to a white screen — reproduced in the browser on `/ledger/12` after
   * matching pièce #1. The wire was right and this type was wrong, which is the
   * direction the phase rule assumes.
   *
   * The nested fields of `piece` were not in `lib/wire-parity.test.ts`'s scalar
   * list, so nothing caught it. They are now.
   */
  hash: string | null
  /** Also nullable on the column, for the same reason. */
  captured: IsoDate | null
}

/**
 * The original-currency story (migration 0011): "this CHF 398.75 was EUR
 * 420.00 at the issuer's rate". Display-only — amounts stay CHF and nothing
 * computes with this. Free-text strings; the writer may omit any field, so
 * render what is present.
 */
/**
 * The original-currency story (0011). CONTRACT (2026-08-19): when `fx` is
 * present, ALL THREE fields are — both writers (the bank door's camt.053
 * parser and the manual 0011 path) write the complete story or none, so a
 * client never meets a rate without its original. No field is optional
 * inside the block; absence is `fx: null` on the row.
 */
export interface Fx {
  /** e.g. "EUR 420.00" — the bank's own words for what was converted. */
  original: string
  /** e.g. "0.9494" — a display string, never computed with. */
  rate: string
  /** Where the story came from: "camt.053", "manual", … */
  source: string
}

/**
 * The Devil's Advocate's structured verdict (0014, phase 5). A `jsonb` column
 * served verbatim; the agent writes it through `POST /entries/{n}/verdict`
 * and the server never edits it. `worst_case` and `resolves` are whatever the
 * agent filed — usually plain text, possibly `{fr, en}` — so both are loose.
 */
export interface Verdict {
  verdict: 'accepted' | 'accepted_with_warning' | 'blocked'
  /** The compliance rule_ids that triggered, e.g. `["vat-008"]`. Never empty. */
  rules: string[]
  worst_case: unknown
  resolves: unknown
  at: string
  by: string
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
  /**
   * Which book and which year (2026-08-19). `number` is workspace-wide, so
   * these two say WHOSE écriture this is — state them, never infer them from
   * a URL filter (the relabelled-AIOS bug the transaction screen shipped
   * around, ticket #53).
   */
  /** The workspace #number. Never the serial id. */
  number: number
  entity: string
  exercice: number
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
  /** The original-currency story (0011). Null for almost everything. */
  fx: Fx | null
  /**
   * The Devil's Advocate's flag (0014). Null until an external agent pass
   * writes one; the server never computes a compliance judgment itself.
   * `blocked` has exactly one enforced consequence: the entry refuses to
   * post, server side — render the state, never re-derive it.
   */
  verdict: Verdict | null
  /** The entry this one reverses, as a serial id. Null for almost everything. */
  reverses_entry_id: number | null
  /**
   * Resolution provenance, and it is PERMANENT. Confirming an inferred entry
   * resolves the question; it does not erase where the answer came from.
   *
   * **Three shapes, not one — see `EntryHistory`.** This was `Label | null`
   * until 2026-08-18 and the entry detail screen rendered it with `en()`, which
   * returns `""` for the array `resolveEntry` actually writes. Every resolved
   * entry would have shown a blank audit trail from a truthy value.
   */
  history: EntryHistory
}

/**
 * The direction of a simplified book's movement.
 *
 * ── `neutral` IS A THIRD VALUE AND IT IS NOT DECORATION ───────────────────
 * A transfer between the owner's own accounts — bank 1 to bank 2, or a personal
 * spend from a business account — is **logged but counts in neither recettes
 * nor dépenses**. Andrea confirmed the rule on 2026-08-18 (DECISIONS.md); the
 * CHECK that allowed only two values was widened by migration 0009.
 *
 * So anything rendering a direction must handle three, and anything TOTALLING
 * one must not fold `neutral` into dépenses. This app totals nothing here — the
 * overview's RI figures come from the server's `riTotals` — and that is where
 * DECISIONS.md records the totals as provisional.
 */
export type RiDirection = 'recette' | 'depense' | 'neutral'

/**
 * One movement of a SIMPLIFIED book, exactly as `publicRiEntry` serves it.
 *
 * ===========================================================================
 * THIS IS THE SECOND SHAPE `GET …/entries` SERVES, AND THE WIRE HAS NO MARKER
 * ===========================================================================
 * Which of the two arrives is decided by the book's `bookkeeping_regime` and by
 * nothing in the payload — see `lib/journal.ts`. A screen that reads an `Entry`
 * out of this finds `entry_no`, `status` and `lines` all `undefined`, renders a
 * blank column where the journal number goes, a blank chip where the posting
 * status goes, and **"This entry has no lines."** over a row whose entire
 * content is one amount it never shows. Reproduced in a browser on 2026-08-19,
 * on all six seeded RI rows.
 *
 * ── WHAT IS HERE THAT AN `Entry` HAS NOT ─────────────────────────────────
 * `direction` and `amount`. A simplified book keeps art. 957 al. 2 CO's
 * recettes-dépenses: one amount per movement, its sign carried by a word rather
 * than by which side of a double entry it lands on. `category` replaces the
 * chart mapping, and there is no chart mapping to replace it with.
 *
 * ── WHAT IS DELIBERATELY ABSENT, AND WHAT IS MISSING ──────────────────────
 * ABSENT, correctly: `entry_no` (an RI journal has no statutory gapless
 * numbering), `status` (no staging step — a cash record is a fact on arrival),
 * `lines`, `tva`, `related_party`, `reverses_entry_id`.
 *
 * MISSING, and it is a defect: **`history`**. `books.ri_entry.history` is a real
 * column, `resolveRiEntry` writes to it in the same transaction as every other
 * resolution, and `matchPiece`'s recettes-dépenses branch writes to it too —
 * and `publicRiEntry` does not serve it. "A resolved row still shows what it
 * was" is this product's audit claim and phase 2's acceptance criterion, and it
 * cannot be met for a simplified book from this payload. `matched_rule_id` is
 * absent for the same reason and matters less. **Both are backend asks and are
 * in the report.** They are not declared here: this file describes what the
 * route serves, and declaring a field the wire does not carry is the failure
 * mode `lib/wire-parity.test.ts` exists to catch.
 */
export interface RiEntry {
  /** The workspace #number, in `books.ri_entry`'s OWN seq series. */
  number: number
  date: IsoDate
  /** Three values. See `RiDirection` — `neutral` is real. */
  direction: RiDirection
  /**
   * The one amount. A `numeric(14,2)` string like every other amount here.
   *
   * Its SIGN is `direction`, not a minus. Nothing may derive one from the other
   * and nothing may negate this to make a single signed column: a `neutral` row
   * has an amount and belongs on neither side.
   */
  amount: Money
  /** What kind of movement, in place of a chart account. A `{fr, en}` pair. */
  category: Label | null
  /** The bank's own words. NEVER overwritten — it is the original record. */
  raw_label: string
  counterparty: string | null
  explanation: Label | null
  recognition: Recognition
  evidence_tier: EvidenceTier
  /**
   * Which book and which year — added by the hardening pass, 2026-08-19.
   *
   * `seq` is workspace-wide, so a bare-number read can return a row from any
   * book. The transaction screen was inferring the book from the URL filter and
   * relabelling an unchanged écriture when the selector moved; the payload names
   * it now, so the screen states it instead of guessing.
   */
  entity: string
  exercice: number
  evidence_note: Label | null
  piece: Piece | null
  /** The original-currency story (0011). Same field, same rule, as `Entry`. */
  fx: Fx | null
  /**
   * The Devil's Advocate's flag (0014), the same field the grand livre carries.
   *
   * **`null` means never checked, not "clean".** A simplified book's movements
   * go through the same compliance pass as an écriture, so a row that has been
   * through it carries a verdict and one that has not carries null — and a
   * screen rendering the absence as an accepted verdict would be inventing an
   * assurance nobody gave.
   */
  verdict: Verdict | null
}

// ---------------------------------------------------------------------------
// recognition rule — the legibility engine
// ---------------------------------------------------------------------------

/**
 * The match pattern. **`amount_chf` and `tolerance_chf` are JSON NUMBERS.**
 *
 * ── AND THAT IS AN EXCEPTION TO THE MONEY RULE, NOT A TYPO ─────────────────
 * `books.rule.pattern` is `jsonb`, and `publicRule` passes the column through
 * untouched, so `1850` and `89.9` arrive as floats — not as `"1850.00"`. This
 * file used to declare both as `Money` (a string), which would have handed
 * `<Money>` a number, failed its prop type, and — where a screen coerced instead
 * — printed a rule's expected amount through a float.
 *
 * They are numbers HERE and they stop being numbers immediately: nothing renders
 * one through `<Money>`. A rule's pattern is a MATCHING THRESHOLD, not an amount
 * in anybody's books, and it is displayed as `~CHF 1'850.00 ±5.00` by
 * `ruleAmount()` in `lib/format.ts`, which is the one place the conversion is
 * written down.
 *
 * **Serving these as strings is a backend request**, the same one
 * `usePatrimoine` carries. Until then the boundary is visible instead of hidden.
 */
export interface RulePattern {
  counterparty: string
  /** Null matches any amount. A JSON number — see above. */
  amount_chf: number | null
  tolerance_chf: number | null
  /**
   * Documented cadence. **Never matched on** — `matchesRule` ignores it
   * entirely, so it is a note to a human and not part of the key. Typed as a
   * plain string because `POST /rules` accepts any string in this field and
   * validates nothing, so narrowing it here would be a claim the route does not
   * keep.
   */
  interval: string | null
}

/**
 * A remembered judgment, exactly as `publicRule` serves it.
 *
 * ── FOUR OF THESE NINE FIELDS WERE WRONG UNTIL 2026-08-18 ──────────────────
 * This interface was written from the mockup's `RECOGNITION_RULES` and never
 * against `publicRule` (`lib/db/queries/rules.ts`). Every one of the four would
 * have rendered `undefined` — which is the failure this whole file exists to
 * turn into a compile error:
 *
 *   `source`      → the wire says **`source_id`**. Half the match key, blank.
 *   `source_kind` → the wire says **`learned_from`**. The rules table's
 *                   "Origin" column, blank on every row.
 *   `created`     → the wire says **`created_on`**. A rule's birthday, blank.
 *   `entity`      → **not on the wire at all.** A phantom field: the request
 *                   carries `?entity=`, the payload does not.
 *
 * And `pattern.amount_chf` was declared a string. See `RulePattern`.
 */
export interface RecognitionRule {
  number: number
  active: boolean
  /**
   * Half of the match key, as the source's workspace **#number** — the `#`
   * column `bk books source list` prints. The key is the PAIR (source,
   * counterparty), never the merchant name alone: the same merchant on a source
   * nobody tracks is a new fact and must stay queued rather than be silently
   * matched.
   *
   * A null means the rule matches only sourceless entries, which is what the
   * RI's rules are.
   *
   * ── IT WAS `source_id`, THE SERIAL, UNTIL #66 ──────────────────────────────
   * The old comment said "it is a serial id and this app does not resolve it —
   * phase 3 brings the source register". Phase 3 shipped, and the field was
   * never revisited: the wire carried a row id no caller could obtain, while
   * `rule create --source` took a #number and the route pushed it straight into
   * the FK. The flag was therefore unusable by anyone, and the resulting
   * constraint violation surfaced as a bare 500. Now both ends speak #numbers,
   * so what a listing shows is what a create takes.
   */
  source: number | null
  /** Where the rule came from: `contract`, `subscription` or `manual`. */
  learned_from: string | null
  pattern: RulePattern
  /** `jsonb`, and genuinely nullable — `POST /rules` does not require one. */
  explanation: Label | null
  account: string | null
  /**
   * Which entry TAUGHT this rule, as its workspace #number. The learning loop,
   * made visible — and it is always null on the 201 from `POST /rules`, because
   * a rule that predates its first entry was taught by nothing.
   */
  created_from: number | null
  created_on: IsoDate | null
  note: Label | null
}

// ---------------------------------------------------------------------------
// the worklist — phase 2's payload, and the one screen with judgment in it
// ---------------------------------------------------------------------------

/**
 * One thing needing a human, exactly as `getWorklist` builds it.
 *
 * ── THE TWO KINDS SHARE A NUMBER SERIES AND DO NOT SHARE A ROUTE ───────────
 * `kind` is not decoration. `books.entry` and `books.ri_entry` have SEPARATE
 * `seq` counters, so `{kind:'entry', number:5}` and `{kind:'ri_entry', number:5}`
 * are two different rows that both exist — and `POST /entries/{n}/resolve` only
 * ever addresses `books.entry`. Asking it to resolve an `ri_entry` by the number
 * printed on the row rewrites an unrelated journal entry and answers 200.
 *
 * Reproduced 2026-08-18 against the seeded workspace: resolving RI #5 (the TWINT
 * row) overwrote entry #5, the January payroll. Raised on ticket #51.
 *
 * **So the type is the guard.** `<ResolveForm>` takes a row narrowed to
 * `kind: 'entry'`, and handing it an RI row does not compile.
 */
export interface WorklistRow {
  /**
   * ── THERE ARE THREE KINDS SINCE PHASE 3, AND THE THIRD ARRIVED SILENTLY ──
   * `getWorklist` gained `kind: 'piece'` rows when the backend's phase-3 branch
   * merged. This file still said two, so `npm run typecheck` went red on
   * `_WorklistKeys` in `lib/wire-parity.test.ts` — **and it was red on the
   * branch before this phase's frontend work started**, which means the guard
   * fired and nobody read it.
   *
   * The consequence was not cosmetic. `<WorklistRows>` branched on
   * `row.kind === 'ri_entry' ? readOnly : resolveForm`, a NEGATIVE test that was
   * exhaustive when there were two kinds. A third kind fell into the else,
   * rendered "Explain this", and `<ResolveForm>` would have POSTed
   * `/entries/{piece.number}/resolve` — pièce #1 rewriting journal entry #1.
   * That is ticket #51's bug, reachable from the default screen, for six seeded
   * rows. **Nothing in this repo was written wrong; a correct backend change
   * retargeted a correct branch.** CLAUDE.md finding #10's mechanism.
   *
   * The branch is positive now (`kind === 'entry'`), and this union is what
   * makes the next kind a compile error rather than a write.
   */
  kind: 'entry' | 'ri_entry' | 'piece'
  /** The workspace #number **within this kind**. See the note above. */
  number: number
  date: IsoDate
  /**
   * `posted` or `staged` for a journal entry, and **null for every `ri_entry`** —
   * a simplified book has no staging step, so the column is hardcoded null in
   * `getWorklist`. Null here means "this regime has no such state", not "unknown",
   * and it must not render as a chip saying `staged`.
   *
   * A pièce carries its own lifecycle here (`staged`, `matched`), which happens
   * to share a spelling with the entry vocabulary and does not mean the same
   * thing — a staged pièce is a document waiting for a judgment, not an écriture
   * waiting to post.
   */
  status: EntryStatus | 'matched' | null
  /** The bank's own words. Never overwritten — it is the original record. */
  raw_label: string
  counterparty: string | null
  /**
   * Why this row needs a human — **and a pièce answers in a different
   * vocabulary on purpose.** An entry is `unrecognized` or `inferred`; a
   * document is `unmatched` or `needs_review`, because a document is not a
   * transaction. Neither pièce value is in the served `recognition` vocabulary,
   * so `<VocabChip>` draws it raw and uncoloured — legible and obviously
   * un-styled, which is the right failure for a value the server knows and this
   * bundle does not.
   */
  recognition: Recognition | 'unmatched' | 'needs_review'
  /**
   * Empty string for a pièce: a document has no evidence tier of its own — it
   * IS the evidence. `<VocabChip>` renders nothing for a falsy value, so the
   * absence shows as an absence rather than as a `bare` chip, which would be a
   * legal claim about an entry that does not exist.
   */
  evidence_tier: EvidenceTier | ''
  /** A `numeric(14,2)` string. For an entry, the sum of its debit lines. */
  amount: Money
  /**
   * Rule #numbers that WOULD explain this row, computed live at read time.
   *
   * **An opinion, never an action.** Nothing on the server applies one and
   * nothing on this screen may either: a suggestion prefills the form and a
   * human presses the button. Often `[]` — every seeded row has none, because
   * the match key is the PAIR and no seeded rule shares a source with a seeded
   * worklist row.
   */
  suggested_rules: number[]
  /**
   * Pièces only: entry #numbers this document could prove — same amount to the
   * rappen, dated within three days either side, computed live by
   * `candidatesFor`.
   *
   * **The same kind of opinion as `suggested_rules`, and it auto-applies
   * nothing.** `[]` on every seeded pièce, because no seeded entry shares an
   * amount and a date window with a seeded receipt.
   *
   * ── AND THE #NUMBER IS DISAMBIGUATED BY THE PIÈCE'S OWN BOOK ────────────
   * `journalOf(entity)` decides whether these name grand-livre entries or
   * recettes-dépenses rows; an unattributed pièce reads as the grand livre.
   * That is the shape ticket #51 should be fixed into — the caller supplies the
   * context, rather than having to get the number right.
   */
  suggested_entries: number[]
}

/**
 * `GET …/worklist`'s envelope. **Not `{data, next_cursor}`** — it is a bespoke
 * object, and `entity`/`exercice` echo back WHICH BOOK AND YEAR THE SERVER
 * CHOSE, which is the only way a screen can tell that its `?entity=` was
 * defaulted rather than honoured.
 */
export interface WorklistResult {
  entity: string
  exercice: number
  count: number
  rows: WorklistRow[]
}

// ---------------------------------------------------------------------------
// resolve — the first write
// ---------------------------------------------------------------------------

/**
 * One entry in an entry's `history`, as `resolveEntry` appends it.
 *
 * ── `history` HAS THREE SHAPES ON THE WIRE AND ALL THREE ARE REAL ──────────
 * The column is `jsonb` and nullable, and three different things have written it:
 *
 *   `null`            never resolved. Most rows.
 *   `{fr, en}`        the SEED's narrative sentence, an object, not a list.
 *   `HistoryEvent[]`  what `resolveEntry` writes — append-only, and if it finds
 *                     a non-array already there it keeps it as element 0.
 *
 * So `EntryHistory` is a union and `<HistoryTrail>` handles all three. Declaring
 * it `Label | null` — which this file did until 2026-08-18 — makes the array
 * case render through `en()`, which finds no `.en` and no `.fr` and returns the
 * empty string. **A blank audit trail, from a truthy value, with nothing thrown.**
 * That is the product's central claim rendering as nothing at all.
 */
export interface HistoryEvent {
  /** An ISO instant — a timestamp, unlike every other date in this app. */
  at: string
  event: string
  was: {
    recognition: Recognition
    counterparty: string | null
    explanation: Label | null
    /**
     * The internal serial id of the rule that matched, and **the one place this
     * app leaks one onto the wire.** Not resolvable to a #number; not shown.
     */
    matched_rule_id: number | null
  }
}

/** `null`, the seed's narrative object, or the append-only event list. */
export type EntryHistory = Label | HistoryEvent[] | null

/**
 * What `POST /entries/{n}/resolve` answers with.
 *
 * It carries neither the updated `counterparty` nor the line's new account — a
 * caller that set either has to re-read the entry. `taught_rule` is the new
 * rule's #number when the resolution taught one.
 */
export interface ResolveResult {
  number: number
  recognition: Recognition
  explanation: Label | null
  history: EntryHistory
  taught_rule: number | null
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

/**
 * One month of the compte de résultat — `?by=month`, ticket #64.
 *
 * ── IT IS THE SAME LINE SHAPE AS THE YEAR, AND THAT IS THE POINT ───────────
 * `crByMonth` runs each month through `crFor`, the function the annual
 * statement uses, so a month carries `CrLineResult` exactly — `pos`, `sign`,
 * `amount` and the same `accounts` array. Declaring a narrower "monthly line"
 * here would be a second shape that can disagree with the one the derivation
 * emits, which is the failure `lib/statement-view.ts` opens by describing.
 *
 * **`month` is `"YYYY-MM"`, not a Date.** A Postgres month bucket has no time of
 * day and constructing a `Date` from one puts it at midnight in whichever
 * timezone the reader is in — the same reason `lib/format.ts`'s `date()` slices
 * the string instead of parsing it.
 */
export interface MonthlyCrResult {
  /** `YYYY-MM`. */
  month: string
  lines: CrLineResult[]
  resultat: Money
}

/** `GET …/compte-resultat`. Same envelope as the bilan. */
export interface CrResult {
  entity: string
  exercice: number
  lines: CrLineResult[]
  resultat: Money
  /**
   * The monthly breakdown, when `?by=month` was asked for. Ticket #64.
   *
   * ── OPTIONAL, BECAUSE THE ROUTE MAKES IT OPTIONAL ─────────────────────────
   * `compte-resultat/route.ts` spreads it in only for `by=month`, so a payload
   * without it is a correct answer to a request that did not ask. The screen
   * offers the grid only when this is present rather than rendering twelve
   * empty columns for a payload that never carried them.
   *
   * **The annual `lines` and `resultat` above are served ALONGSIDE it,
   * unchanged.** That is deliberate on the route's side: the grid has a total to
   * show without asking twice and reading two moments of one statement. Nothing
   * in the view may add the months up to produce it.
   */
  months?: MonthlyCrResult[]
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
  /**
   * STRICTLY `recognition = 'unrecognized'` — not the worklist count.
   *
   * ── THE COMMENT HERE USED TO SAY "Phase 2's worklist count" AND IT WAS ────
   * ── WRONG, WHICH IS HOW A LABEL ON A SCREEN CAME TO BE WRONG TOO ─────────
   * The worklist is `unrecognized` OR `inferred`: an inference nobody confirmed
   * still needs a human. This field counts only the first of the two, so it is
   * always less than or equal to `worklist` below and it under-reports whenever
   * a rule has guessed at something. On the seeded blackcode book, 2 against 3.
   *
   * The overview page labelled the ROLLUP of this field "Need a human" while
   * `bk books overview` printed `worklist` under TO RESOLVE from the same
   * database. Use `worklist` for anything phrased as work outstanding; use this
   * one only where the word "unrecognized" is what is actually meant.
   */
  unrecognized: number
  /**
   * What the Reconnaissance worklist ACTUALLY lists for this book:
   * `recognition IN ('unrecognized', 'inferred')`.
   *
   * ── SERVED SINCE PHASE 2 AND DECLARED HERE ONLY ON 2026-08-18 ────────────
   * `getOverview` has always returned it; this type did not have it, so nothing
   * could read it and the screen used `unrecognized` instead. Found by
   * `_OverviewKeys` in `lib/wire-parity.test.ts`, which is the assertion this
   * whole class of drift exists to be caught by — the key set alone could not
   * see it, because TypeScript does not object to a payload carrying more than
   * you asked for. `Mutual` objects, in both directions.
   *
   * **It is not the same as `WorklistResult.count`.** That counts pièce rows
   * too; this counts entries only. See `useWorklist` in `lib/hooks.ts`, which
   * records the one case where the two predicates could disagree.
   */
  worklist: number
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
  /** A `numeric` string since 2026-08-19, like every other amount. */
  amount: Money
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

// ===========================================================================
// PHASE 3 — SOURCES AND PIÈCES
// ===========================================================================
// Every shape below was read off the ROUTE, not off the mockup. Four of them
// disagree with what the mockup renders and the disagreements are named where
// they sit: `draws_from`, `drive`, `sourceBalance` and the pièces `match`
// object are all mockup facts that no b/books route serves.
//
// `lib/wire-parity.test.ts` pins each key set against its `public*` function.

/**
 * The completeness verdict. **Computed at read time, never a column.**
 *
 * `lib/derive/sources.ts` holds the reasoning: the register answers "do I have
 * everything", and that answer is only trustworthy while nobody can set it. The
 * one hand-set lifecycle fact is `retired`, which is a boolean on the row and
 * takes precedence over every other verdict.
 *
 * Declared as a union rather than a `string` because it is the value the screen
 * decides layout from, and a state the server added since this bundle shipped
 * must fail the build rather than fall into an `else`. The CHIP is a different
 * matter and takes the raw value — see `<VocabChip vocabulary="source_status">`,
 * which renders an unknown term uncoloured instead of hiding it.
 */
export type SourceStatus = 'current' | 'stale' | 'gap' | 'never_connected' | 'retired'

/**
 * The failure semantics of one cadence, in days. `gap` is twice `stale`.
 *
 * Served alongside the status so a screen can say *why* — "stale after 10 days,
 * gap after 20" — without re-deriving the thresholds. Re-deriving them here
 * would be a second copy of `sourceWindows`, and the two would drift silently.
 */
export interface SourceWindows {
  stale_after_days: number
  gap_after_days: number
}

/**
 * One row of the register, as `publicSource` serves it.
 *
 * ── WHAT THE MOCKUP DRAWS AND THIS PAYLOAD DOES NOT CARRY ─────────────────
 * `draws_from` (the card→bank edge), the `drive` block (folder id, access,
 * file count, last sync) and a book balance per source. `books.source` HAS a
 * `draws_from` column; `publicSource` does not serve it, so the mockup's
 * three-layer CHAIN cannot be drawn — only each source's own `layer`. The
 * balance was never a column at all: the mockup computed it from the fixture.
 * All three are backend requests, and none is faked here.
 */
export interface Source {
  /** The workspace #number. Never the serial id. */
  number: number
  name: string
  /** `bank | card | processor | saas | drive_folder` — the `source_types` vocabulary. */
  type: string
  /** `bank | card | routing_app`, or null: four sources have no tier. */
  layer: string | null
  /** The book's slug, or null — an unattributed source is legitimate. */
  entity: string | null
  method: string | null
  /** `daily | weekly | monthly | quarterly | none`, or null. Drives the windows. */
  expected: string | null
  last_import: IsoDate | null
  /** The ONLY hand-set lifecycle fact on this row. */
  retired: boolean
  ledger_accounts: string[]
  /** Computed from `expected` against `last_import`. Never settable. */
  status: SourceStatus
  windows: SourceWindows
  /** `{fr, en}`. English chrome (D-A), so `en()`. */
  notes_freeform: Label | null
}

/** One raw file pulled from a source and kept on our side. Archival insurance. */
export interface SourcePull {
  file: string
  period: string | null
  format: string | null
  hash: string | null
  drive_ref: string | null
  pulled: IsoDate | null
  /**
   * What the statement itself said it closed at, and when — 0018.
   *
   * NULL is a real answer and not a zero: a pull recorded by hand through
   * `source record-pull` has no statement behind it, and one imported before
   * 0018 genuinely does not know. `derive/reconcile.ts` reports those as
   * `known: false` rather than as an agreement.
   */
  closing_balance: Money | null
  closing_on: IsoDate | null
}

/**
 * How to pull this source, versioned in place.
 *
 * ── `credential_ref` IS A VAULT REFERENCE AND IS RENDERED AS ONE ───────────
 * `vault://blackcode/yapeal`. If a real secret ever appears in this field the
 * bug is upstream, in whoever wrote the runbook, and **the fix is rotation, not
 * CSS.** There is deliberately no masking component in this app: masking a
 * leaked secret in one renderer leaves it in the payload, in `bk books source
 * show --json`, and in every log that touched the response, while making the
 * screen look like the problem was handled.
 */
export interface SourceRunbook {
  version: string
  updated: IsoDate | null
  login_url: string | null
  credential_ref: string | null
  steps: string[]
  output: string | null
}

/** `GET …/sources/{number}` — the register row, plus its files and its runbook. */
export interface SourceDetail extends Source {
  pulls: SourcePull[]
  runbook: SourceRunbook | null
}

/**
 * One file in the worker's ledger of a Drive folder.
 *
 * ── `created_time` IS A TIMESTAMP, NOT A `date` ───────────────────────────
 * `books.drive_manifest.drive_created_time` is `timestamp with time zone`, so
 * the shaping function's TypeScript type is `Date` and the WIRE carries
 * `"2026-08-13T13:46:00.000Z"`. Every other date in this app is a Postgres
 * `date` and arrives as `"2026-08-13"`. `<DateText>` and `format.date()` slice
 * the first ten characters and are therefore correct for both — but only
 * because they never parse. Do not "improve" either into a `new Date()`.
 */
export interface ManifestFile {
  file_id: string
  name: string | null
  mime_type: string | null
  /** ISO **timestamp**, not a date. See above. */
  created_time: string | null
  fetched: IsoDate | null
  /** `discovered | downloaded | extracted | validated_staged | needs_review | ingested`. */
  state: string
  /** The immutable legal-archive copy. False everywhere today, honestly. */
  archived: boolean
  archive_ref: string | null
  /** The pièce this file became, as a #number. Null while nothing extracted it. */
  piece: number | null
}

/**
 * `GET …/sources/{number}/manifest`. **Not `{data, next_cursor}`** — it is a
 * bespoke envelope, so `apiList` would find no `data` key, substitute `[]`, and
 * render "no files on record" over a folder holding six. Same failure shape as
 * the worklist; `useManifest` keeps the envelope for the same reason.
 */
export interface ManifestResult {
  /** The source's own #number, echoed. What the server answered for. */
  source: number
  files: ManifestFile[]
}

/** The server's verdict on one extraction. **The worker's own claim is not this.** */
export interface PieceValidation {
  lines_sum_matches_total: boolean
  vat_rates_valid: boolean
  date_plausible: boolean
  passed: boolean
  /** Every failed check, in words. Empty when passed. */
  problems: string[]
}

/** One line of an extracted document, as the worker read it. */
export interface PieceExtractionLine {
  description?: string
  quantity?: number
  unit?: string
  unit_price?: number
  amount: number
  vat_rate?: number | null
}

/**
 * The worker's payload, stored VERBATIM.
 *
 * ── IT IS SPELLED `tx` ON THE SEED AND `transaction` IN THE SCHEMA ────────
 * `lib/validate/extraction.ts` says the schema's name is `transaction` and the
 * mockup's seeded pieces spell it `tx`; `ingestPiece` accepts either. The seeded
 * rows really do carry both spellings inconsistently — piece #1 has only `tx`,
 * piece #5 has both — so **anything reading this must try both**, which is what
 * `transactionOf()` in `lib/hooks.ts` is for. Reading `transaction` alone renders
 * an empty detail panel over a document that has every field.
 *
 * `validation` inside here is the WORKER'S claim and is read by nothing. The
 * server recomputes its own and serves it as the payload's top-level
 * `validation`. On seeded piece #5 the two disagree — the worker says passed,
 * the server says the lines support nothing — and the screen shows the server's.
 */
export interface PieceExtraction {
  document_type?: string
  merchant?: { name?: string; vat_number?: string | null }
  transaction?: PieceTransaction
  /** The seed's spelling of the same object. */
  tx?: PieceTransaction
  lines?: PieceExtractionLine[]
  vat_summary?: { rate: number; gross: number }[]
  confidence?: number
  notes?: string | null
  /** The worker's own verdict. Evidence of what it claimed; never input. */
  validation?: Partial<PieceValidation>
}

export interface PieceTransaction {
  date?: string | null
  time?: string | null
  ticket_number?: string | null
  currency?: string
  total?: number
  payment_method?: string | null
}

/**
 * One document in the receipts inbox, as `publicPiece` (plus the route's
 * `duplicate_of`) serves it.
 *
 * ── `Piece` IS ALREADY TAKEN, AND MEANS SOMETHING ELSE ────────────────────
 * `Piece` above is the reference an ENTRY carries — `{drive_ref, hash,
 * captured}`. This is the inbox row the entry's reference may one day come
 * from. Two different things; two names.
 *
 * ── A FLAGGED PIÈCE IS NORMAL TRAFFIC ─────────────────────────────────────
 * `needs_review` is true for a document a human must look at, and a payload
 * that fails validation still lands: refusing it at the door would hide it in
 * the worker's retry queue. So the screen draws it as a judgment to make, not
 * as an error.
 */
export interface InboxPiece {
  /** The workspace #number. */
  number: number
  /** The book's slug, or null — a scanned receipt does not always say whose it is. */
  entity: string | null
  /** `staged | matched`. Everything lands staged; nothing auto-posts. */
  status: string
  received: IsoDate
  pipeline: string | null
  source: {
    file_id: string
    file_name: string | null
    mime_type: string | null
    md5_checksum: string | null
    /** ISO **timestamp**. See `ManifestFile.created_time`. */
    created_time: string | null
    web_view_link: string | null
  }
  /**
   * ── TWO FIELDS WHOSE WIRE TYPE IS STRONGER THAN THE DATA ────────────────
   * `publicPiece` casts the `jsonb` column to `Extraction`, which declares
   * `document_type: string` and `merchant.name: string` as REQUIRED. So the
   * shaping function's type is `string`, its `?? null` on the merchant is
   * unreachable *by the type*, and typing these as nullable here would fail the
   * parity assertion for a difference that is a claim rather than a shape.
   *
   * The claim is backed at the door: `structuralRefusal` in
   * `lib/validate/extraction.ts` refuses a payload without either field, so
   * nothing can reach this table through `pieces/ingest` without them. **The
   * seed writes rows directly and is not held by that guard** — so the screen
   * still handles absence rather than trusting the type, which is the standing
   * rule about a falsy fallback pointed at a field the TYPE says cannot be
   * missing.
   */
  document_type: string
  merchant: string
  /** A STRING, like every other amount. Null when the extraction had no total. */
  total: Money | null
  date: IsoDate | null
  /** THE SERVER'S verdict, recomputed. Not the worker's. */
  validation: PieceValidation
  needs_review: boolean
  /** An earlier pièce with the same checksum, as a #number. Flagged, never dropped. */
  duplicate_of: number | null
  matched_entry: number | null
  /** Which journal that #number lives in. Null until matched. */
  matched_journal: 'grand_livre' | 'recettes_depenses' | null
  extraction: PieceExtraction
  note: Label | null
}

// ---------------------------------------------------------------------------
// analytique — the management view (phase 4B)
// ---------------------------------------------------------------------------

/**
 * One ledger line under a cost category.
 *
 * ── `account` IS `""` ON A SIMPLIFIED BOOK, NOT `null` ─────────────────────
 * `costBreakdownRi` in `lib/derive/management.ts` fills it with the empty
 * string, because an RI movement has no chart account to name. Typed as the
 * string it is rather than widened to `string | null`, so a screen that renders
 * it has to decide what an empty account looks like instead of leaning on a
 * `??` that never fires. Verified against the wire on 2026-08-19.
 *
 * ── `number` NAMES A ROW IN WHICHEVER JOURNAL THE BOOK KEEPS ───────────────
 * A grand-livre `entry.seq` on a double-entry book, an `ri_entry.seq` on a
 * simplified one — and **the two counters collide.** On the seeded workspace
 * `#3` is blackcode's rent écriture AND the RI's AVS instalment. `/ledger/{n}`
 * asks the grand livre first, so linking an RI line by this number opens
 * another book's record. See `components/cost-breakdown.tsx`.
 */
export interface AnalytiqueLine {
  number: number
  date: IsoDate
  /** The entry's counterparty, falling back to its raw label. Never null. */
  counterparty: string
  amount: Money
  /** The chart account. `""` on a simplified book — see above. */
  account: string
}

/**
 * One bucket of the cost breakdown, as `GET …/analytique` serves it.
 *
 * ── A ZERO BUCKET IS A ROW, NOT AN ABSENCE ────────────────────────────────
 * `amount: "0.00"` with `lines: []` is what a configured category with no
 * postings looks like, and it is on the screen. Four of AIOS's five read that
 * way. Same rule as the statutory zero lines.
 *
 * ── `accounts` IS `null` ON A SIMPLIFIED BOOK ─────────────────────────────
 * There is no account→category mapping there: an RI movement carries its own
 * category, so `key` is that label's French text (or `"__none"` for the
 * uncategorized bucket) rather than a configured slug.
 */
export interface AnalytiqueCategory {
  key: string
  label: Label
  /** The accounts this bucket counts, or null on a simplified book. */
  accounts: string[] | null
  amount: Money
  lines: AnalytiqueLine[]
}

/**
 * One month of produits and charges.
 *
 * **The series is SPARSE.** A month with no posted écriture is absent, not
 * zero — `monthlyFlows` filters those out — so twelve months of a year may be
 * two rows. Nothing may interpolate between them; see
 * `components/flows-chart.tsx`.
 */
export interface MonthlyFlow {
  /** `YYYY-MM`. */
  month: string
  produits: Money
  charges: Money
}

/** `GET /api/workspaces/{ws}/analytique?entity=&exercice=`. */
export interface AnalytiqueResult {
  /** Echoed back: the book this breakdown is about, resolved server-side. */
  entity: string
  exercice: number
  categories: AnalytiqueCategory[]
  monthly_flows: MonthlyFlow[]
}

/**
 * One configured bucket, as `GET …/analytique/categories` serves it.
 *
 * Not the same shape as `AnalytiqueCategory` above and deliberately a separate
 * type: this is the CONFIGURATION — it carries `number` and `retired` and
 * carries no amounts — while the other is a DERIVATION over postings. The
 * breakdown drops retired buckets (`getAnalytique` filters them); this list
 * serves them flagged, which is the only place a reader can see that an
 * account has stopped being counted.
 */
export interface AnalytiqueCategoryConfig {
  number: number
  entity: string
  key: string
  label: Label
  accounts: string[]
  retired: boolean
}

// ===========================================================================
// PHASE 5 — THE ANALYSES JOURNAL, THE TAX SNAPSHOT, THE COMPLIANCE RULES
// ===========================================================================
// ── EVERY JSONB FIELD BELOW IS DECLARED, AND NONE OF THEM IS PROTECTED ────
// `lib/db/schema.ts` declares every `jsonb()` column without `.$type<>()`, so
// `question`, `verdict`, `figures`, `based_on`, `scenario_label`, `summary` and
// the whole tax `params` block cross the wire as `unknown`. `wire-parity`'s
// compile-time half compares a shaping function's return type against these,
// and against an `unknown` there is nothing to compare — a `Mutual<>` on a
// payload of `unknown` fields is satisfied by any shape at all.
//
// **So these types are a CLAIM this app makes about the payload, not a fact the
// suite can hold it to.** That is filed with the backend on #55 and is repeated
// here because the consequence is local: the guard for a jsonb field has to be a
// PURE FUNCTION with a test — `lib/analysis.ts`, `lib/compliance.ts` — never a
// check written inline in JSX, which is the phase-4B `accountsLabel` lesson.

/**
 * One row of a filed analysis's `figures` or `based_on` array.
 *
 * ── `value` IS TEXT THE AGENT WROTE, AND IS NOT A `Money` ─────────────────
 * The seeded records carry `"CHF 5'175.00"`, `"−5'281.20 → −10'456.20"`,
 * `"13.7 → 6.9 mois"` and `"15% → 4'500 × 1.15 = 5'175"`. It is prose with
 * numbers in it, already formatted by whoever filed it. **It never goes through
 * `<Money>` and it is never parsed** — reformatting a filed figure is editing
 * the record, and parsing one is the recompute the route forbids.
 */
export interface AnalysisFigure {
  label: Label
  value: string
  /**
   * Where the agent said it read the value. **Recorded, not navigable.**
   *
   * The seeded hrefs are the MOCKUP's addresses (`app-ledger.html?entity=…`),
   * which are not routes in this app. An agent filing one tomorrow may write
   * anything at all. Rendering it as a link would offer a reader a destination
   * this app cannot promise — see `<BasedOnTable>`.
   */
  href?: string | null
}

/**
 * One filed analysis. `GET …/analyses` and `GET …/analyses/{number}`.
 *
 * ===========================================================================
 * THE ROW IS PERMANENT AND NOTHING ON IT IS EVER RECOMPUTED
 * ===========================================================================
 * The route's own header: *"the `based_on` snapshot exactly as it was filed.
 * NEVER recomputed — a stored answer that silently reflows is a different
 * answer."* There is no update route and none is coming (migration 0013 revokes
 * UPDATE and DELETE from the app role); a drifted answer is re-asked and both
 * rows stand.
 *
 * `POST /analyses` is the AGENT's door — ring 0, an append from the world. This
 * app reads the journal and does not author in it (decision D-H's rule).
 *
 * ── THE MOCKUP'S `metrics`, `polarity` AND `verdict_short` DO NOT EXIST ───
 * `app-analyse.html` draws two SVG charts and three gauges off
 * `a.metrics.{revenue_monthly, burn_monthly, net_monthly, runway_months,
 * cash_chf, driver}`, and colours every row by `a.polarity`. **None of those is
 * a column and none is on the wire.** What survives of them is
 * `runway_after_months` — one number, the "after" side with no "before" — and
 * `figures`, which is text. Building against the mockup here would have been
 * building against a shape nobody serves.
 */
export interface Analysis {
  /** The workspace #number. Its own URL; agents deep-link it. */
  number: number
  /** The book's slug. */
  entity: string
  /** A full ISO timestamp, not a `date` — the server's clock at filing. */
  asked: string
  asked_by: string
  /** Which agent answered: `claude-code`, `companion`, … Free text. */
  agent: string
  /** Verbatim as filed: usually {fr, en}, a bare string when an agent files one. */
  scenario_label: Label | string | null
  /**
   * The scenario's runway, in months, as the agent computed it. Null when the
   * question had no runway answer.
   *
   * **There is no "before" on the wire**, so nothing here may draw a delta:
   * the mockup's gauges each need both sides and this payload has one.
   */
  runway_after_months: number | null
  /**
   * Verbatim as filed. Usually {fr, en}; a BARE STRING when an agent files
   * one — the door's `speaks()` accepts both, and real filings use both.
   * Render through `speech()`, never `en()`.
   */
  question: Label | string
  verdict: Label | string
  figures: AnalysisFigure[]
  /** What the agent READ. The snapshot. Permanent, and never recomputed. */
  based_on: AnalysisFigure[]
}

/**
 * The VAT position, exact and in centimes on the server.
 *
 * `net_due` is `opening_due + output_ytd − input_claimed_ytd` — the arithmetic
 * is rendered rather than only its answer, because a reader who cannot see the
 * three inputs cannot tell a net due from a net claim.
 */
export interface VatPosition {
  opening_due: Money
  output_ytd: Money
  input_claimed_ytd: Money
  net_due: Money
}

/**
 * The profit-tax ESTIMATE. Floats on the server, deliberately — see
 * `lib/derive/management.ts`'s header: a coefficient stack of
 * 8.5% + 3⅓% × 232% has no exact centime representation, and this is a position
 * estimate rather than a posting. It still crosses the wire as strings.
 *
 * `statutory_pct` and `effective_pct` are NUMBERS, not `Money`: they are rates,
 * and `effective` is `s/(1+s)` because Swiss taxes are themselves deductible.
 * Both are served so a reader can see which one a figure was computed at.
 */
export interface ProfitTax {
  cantonal: Money
  communal: Money
  ifd: Money
  total: Money
  statutory_pct: number
  effective_pct: number
}

/**
 * The capital-tax estimate, with the art. 118 LI-VD imputation SHOWN.
 *
 * `gross` is the per-mille of book equity, `credited` is the cantonal+communal
 * profit tax counted against it, `net_due` is what remains. All three are
 * served because whether the imputation applies exactly this way is the
 * parameters' own open question — serving only `net_due` would pick an answer
 * the fiduciary has not given.
 */
export interface CapitalTax {
  gross: Money
  credited: Money
  net_due: Money
}

/**
 * The tax parameter record for one book, verbatim from `books.tax_params`.
 *
 * ===========================================================================
 * EVERY FIGURE ON THE TAXES SCREEN IS CITED FROM HERE, AND `unknown` IS WHY
 * ===========================================================================
 * This is a `jsonb` column served without normalisation, so the shape below is
 * this app's reading of it rather than a contract. A `citation` is a `string` on
 * three of the four blocks and a `{fr, en}` pair on the fourth (`communal`),
 * which is not a mistake to tidy: it is what the seed holds and what an agent
 * may file. `lib/tax.ts`'s `citationText` is the one place that difference is
 * resolved, and it is tested.
 *
 * `confirmed` is a fact about the PARAMETER, not about the arithmetic. The
 * seeded `capital_tax` block is `confirmed: false` with an `open_question` for
 * the fiduciary; a screen that renders its figure without that flag has turned
 * an open question into a number somebody might file.
 */
export interface TaxParamBlock {
  citation?: unknown
  confirmed?: unknown
  open_question?: unknown
  [key: string]: unknown
}

export interface TaxParams {
  ifd?: TaxParamBlock
  cantonal?: TaxParamBlock
  communal?: TaxParamBlock
  capital_tax?: TaxParamBlock
  [key: string]: unknown
}

/**
 * `GET /api/workspaces/{ws}/tax-snapshot?entity=&exercice=`.
 *
 * ===========================================================================
 * RING 3. DERIVED AT REQUEST TIME AND STORED NOWHERE.
 * ===========================================================================
 * Not a tax return, not a position tracked over time — that is a different
 * product (b/tax). This is the statutory picture of one (book, exercice) at the
 * moment the page was opened.
 *
 * ── `configured: false` IS A REAL ANSWER AND MUST NOT BE FILLED IN ────────
 * A book with no `books.tax_params` row answers `tax: null, configured: false`.
 * **The canton and the commune come from that row and from nowhere else**
 * (decision D-D: nothing may assume a Swiss canton, let alone VD/Renens). A
 * screen that supplied a default rate would be inventing somebody's tax bill.
 *
 * ── A SIMPLIFIED BOOK IS REFUSED, BY CODE ────────────────────────────────
 * `no_tax_snapshot_for_simplified`, 400: a sole proprietorship's result is taxed
 * as its owner's personal income. That is a SCREEN STATE, like the bilan's
 * refusal — see `isNoTaxSnapshotRefusal` in `lib/hooks.ts`.
 */
export interface TaxSnapshotResult {
  /** Echoed back: the book the server resolved, not the one the URL asked for. */
  entity: string
  exercice: number
  /** The exercice result, from the compte de résultat. Negative in a loss year. */
  profit: Money
  /** Capitaux propres from the bilan, including the injected result. */
  equity: Money
  /** Null when the book is not VAT-registered — not zero. */
  vat: VatPosition | null
  tax: {
    canton: string
    commune: string
    profit_tax: ProfitTax
    capital_tax: CapitalTax
    params: TaxParams
  } | null
  configured: boolean
}

/**
 * One statutory compliance rule. `GET /api/compliance-rules`.
 *
 * ===========================================================================
 * THIS ROUTE IS NOT WORKSPACE-SCOPED, AND THAT IS DELIBERATE
 * ===========================================================================
 * The same law binds every book, so the rules live at `/api/compliance-rules`
 * rather than under `/api/workspaces/{ws}/`, and the GET is unauthenticated for
 * the same reason `/api/meta` is: the payload is law text with citations,
 * holding no amounts and no names. It is the one read in this app that is
 * genuinely global, which is why it is the third `booksGlobalKey`.
 *
 * ── `draft` IS THE RESTING STATE, NOT A WARNING ──────────────────────────
 * All nineteen are born `draft`. Research against Fedlex is not a fiduciary's
 * sign-off, and the seed says so in capitals. Nineteen researched rules awaiting
 * a human is what this screen looks like when nothing is wrong; drawing it in
 * red says the opposite. `lib/compliance.ts` holds that as a tested function
 * rather than as a class name in JSX.
 *
 * ── `source_confidence` IS A FACT ABOUT THE SOURCE, NOT ABOUT THE RULE ────
 * `verified_fedlex` means the agent read the article in Fedlex.
 * `doctrine_inferred` means it is a reading rather than a quotation.
 * `needs_fiduciary_check` means the source itself is not settled. It is
 * PROVENANCE and it is rendered as provenance — a reader has to be able to see
 * which rules rest on statute and which rest on something softer.
 */
export interface ComplianceRule {
  /** `bk-001`, `vat-008`, … The id a verdict cites. */
  rule_id: string
  /** The article. `art. 957 al. 1 ch. 2 CO`. Never absent. */
  citation: string
  /** `SA`, `RI`, or `both` — which legal form the rule binds. */
  applies_to: string
  trigger_condition: string
  /** The rule as executable prose. Superseded by `edited_logic` after an edit. */
  check_logic: string
  /** `blocker` | `warning` | `info`. Served, never derived here. */
  severity: string
  consequence: string
  /** The human-sized one-liner. Null on a rule that has none. */
  summary: Label | null
  /** `verified_fedlex` | `doctrine_inferred` | `needs_fiduciary_check`. */
  source_confidence: string
  /** `draft` | `approved` | `edited` | `rejected`. Never reviewed BACK to draft. */
  review_state: string
  /** The fiduciary's corrected wording. Set only by an `edited` review. */
  edited_logic: string | null
  review_note: string | null
  reviewed_by: string | null
  /** A full ISO timestamp, or null while the rule is still draft. */
  reviewed_at: string | null
}
