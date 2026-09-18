// Every limit this app enforces, declared ONCE.
//
// ===========================================================================
// THE RULE: A NUMBER WITH MORE THAN ONE READER HAS EXACTLY ONE SOURCE
// ===========================================================================
// A limit is declared here, imported by the route that enforces it, and served
// by `/api/meta` so an agent can read the current value rather than a remembered
// one. **Never re-typed** — not in a help string, not in a guide topic, not in a
// client-side `maxLength`.
//
// `cli/internal/guide/guide_test.go` fails the build on a topic that hardcodes a
// size or a count, and the reason it matches by SHAPE rather than by value is
// CLAUDE.md finding #9: the guard's first version banned the CORRECT spelling of
// a limit and passed a stale one, so the only case it could not catch was a
// topic that had gone out of date.
//
// The shared limits — upload size, blocked MIME types — live in
// `packages/platform-api/src/limits.ts`. This file is for limits that are this
// app's own.
//
// ===========================================================================
// WHAT IS NOT HERE YET
// ===========================================================================
// Phase 1 adds the metadata caps from
// `docs/billing-app-plan/integration-surface.md` §3 (50 keys, 40 characters per
// key, 500 per value, following Stripe's so a caller migrating from it keeps its
// data) and the 140-character payment-message budget that phase 2's QR payload
// shares with billing information. Phase 2 adds the 997-character payload cap.
//
// **There is deliberately no `VAT_ROUNDING_STEP` here, and there will not be.**
// An earlier draft of the plan declared one. Decision D-B7 replaced it with
// `billing.company.rounding`, a per-company policy, because two companies in one
// workspace may keep different books — so the value is data, and a constant
// would have been a second, contradicting source. See phase 1's Derivations.

/**
 * `billing.workspaces.name` is `varchar(80)`.
 *
 * Declared here and imported by `POST /api/workspaces` so the route's 400 and
 * the column cannot disagree. The web form's `maxLength` is the same number
 * typed by hand, and that is the one place a copy is tolerated: importing this
 * module into a client component would pull the barrel into the browser bundle
 * for one integer, and the route's own 400 carries the number and a suggestion
 * when a caller exceeds it anyway.
 */
export const WORKSPACE_NAME_MAX = 80

/**
 * The `metadata` map's shape, on companies, invoices and (from phase 4) series.
 *
 * ── THE NUMBERS ARE STRIPE'S, AND THAT IS THE REASON FOR THEM ──────────────
 * 50 keys, 40 characters per key, 500 per value. Not because they are optimal —
 * any bound would do — but because a caller migrating an integration FROM
 * Stripe keeps its data. Choosing our own limits would mean a customer
 * discovering, one record at a time, which of their existing keys no longer fit.
 *
 * `docs/billing-app-plan/integration-surface.md` §3.
 *
 * ── FLAT, STRING TO STRING, AND NESTED VALUES ARE REFUSED ──────────────────
 * A nested value is refused at the write door rather than stored, because
 * `metadata` is the caller's bookkeeping and the moment it can hold structure
 * somebody puts a money amount in it. A money value inside `jsonb` is a JSON
 * number and therefore a float64, which is decision D-B4's whole argument.
 */
export const METADATA_LIMITS = {
  max_keys: 50,
  max_key_length: 40,
  max_value_length: 500,
} as const

/**
 * Validate a metadata map. Returns the reason it is refused, or null.
 *
 * Returns a REASON rather than throwing or returning a boolean: the caller turns
 * it into a `400` whose `suggestion` a person can act on, and "invalid
 * metadata" with no detail is a message that makes somebody guess which of
 * fifty keys is the problem.
 */
export function validateMetadata(meta: unknown): string | null {
  if (meta === undefined || meta === null) return null
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return 'metadata must be an object of string keys to string values'
  }
  const entries = Object.entries(meta as Record<string, unknown>)
  if (entries.length > METADATA_LIMITS.max_keys) {
    return `metadata has ${entries.length} keys; the limit is ${METADATA_LIMITS.max_keys}`
  }
  for (const [k, v] of entries) {
    if (k.length > METADATA_LIMITS.max_key_length) {
      return `metadata key ${JSON.stringify(k.slice(0, 20))}… is longer than ${METADATA_LIMITS.max_key_length} characters`
    }
    if (typeof v !== 'string') {
      return `metadata.${k} is ${Array.isArray(v) ? 'an array' : typeof v}; values must be strings. ` +
        'A number here would eventually be a money amount, and a money amount in jsonb is a float64'
    }
    if (v.length > METADATA_LIMITS.max_value_length) {
      return `metadata.${k} is ${v.length} characters; the limit is ${METADATA_LIMITS.max_value_length}`
    }
  }
  return null
}

/**
 * The QR-bill's unstructured message budget: 140 characters, **shared** with the
 * structured billing information this app does not emit (position P5).
 *
 * Enforced from day one even though nothing emits billing information, which is
 * what makes emitting it later additive rather than a breaking change for every
 * invoice already carrying a 140-character message.
 */
export const PAYMENT_MESSAGE_MAX = 140

/**
 * How many rows a list route returns at most, whatever `?limit=` says.
 *
 * Served by `/api/meta` so an agent paginating knows the ceiling rather than
 * discovering it by asking for 10000 and receiving 200 with no explanation.
 */
export const LIST_LIMIT_MAX = 200
export const LIST_LIMIT_DEFAULT = 50

// ---------------------------------------------------------------------------
// Delivery and lifecycle (phase 3)
// ---------------------------------------------------------------------------
// Served under `limits.delivery` by `/api/meta`, so an agent composing a send
// reads the real ceilings rather than a copy in a guide topic.

export const DELIVERY_LIMITS = {
  /** A subject line longer than this is a paragraph in the wrong field. */
  subject_max: 200,
  /** The covering note, not the document. The document is the attachment. */
  body_max: 5000,
  /** Copies. More than this is a mailing list, which a bill should not go to. */
  cc_max: 5,
  /** Per language. A void reason is a sentence a fiduciary reads in five years. */
  void_reason_max: 500,
} as const

// ---------------------------------------------------------------------------
// Imported history (phase 5)
// ---------------------------------------------------------------------------
// Served under `limits.history`. The widths are migration 0010's columns, typed
// once more here so the import route can refuse a row with a reason naming the
// field, rather than letting Postgres throw an error naming a column the
// mapper has never seen.

export const HISTORY_LIMITS = {
  /**
   * Rows per import. One import is one transaction, and a batch this size is
   * one a person can still check the output of. A larger export is several
   * imports — each all-or-nothing, so a split never half-lands.
   */
  import_max_rows: 500,
  source_ref_max: 64,
  number_max: 40,
  client_name_max: 200,
  /** Per language. A flag is a sentence about one row, not a report. */
  import_flag_max: 500,
  drive_path_max: 1000,
} as const

/**
 * Recurring series (phase 4).
 *
 * `occurrences_max` is a sanity cap, not a policy: ten years of monthly bills.
 * A series is FINITE by design (invariant I9), and a count past this is far more
 * likely a typo — 1200 for 12 — than an agreement anybody signed.
 */
export const RECURRENCE_LIMITS = {
  occurrences_max: 120,
  label_max: 200,
} as const
