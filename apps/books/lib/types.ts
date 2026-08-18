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
export interface Fx {
  original?: string
  rate?: string
  source?: string
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
  /** The original-currency story (0011). Null for almost everything. */
  fx: Fx | null
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
   * Half of the match key. The key is the PAIR (source, counterparty), never the
   * merchant name alone: the same merchant on a source nobody tracks is a new
   * fact and must stay queued rather than be silently matched.
   *
   * **It is a serial id and this app does not resolve it** — phase 3 brings the
   * source register. Shown as a fact, never as a link. A null means the rule
   * matches only sourceless entries, which is what the RI's rules are.
   */
  source_id: number | null
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
