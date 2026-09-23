// THE WIRE CONTRACT: every shape that crosses the boundary between this app's
// server and anything else — a page, the CLI, or an outside system.
//
// ===========================================================================
// THIS IS THE FIRST FILE OF PHASE 1, BEFORE ANY ROUTE OR ANY PAGE
// ===========================================================================
// `docs/billing-app-plan/` runs the backend one phase ahead of the frontend, so
// screens are built against typed fixtures before the routes they will call
// exist. That only works if both sides compile against the same declarations:
// otherwise the frontend's belief about a shape and the server's answer diverge
// silently, and the first symptom is a blank page in production.
//
// That is not hypothetical. `apps/sales`' members page went blank because a cast
// RENAMED the `{ data, next_cursor }` envelope instead of opening it — a pure
// type-level mistake, in a layer no route test can see. CLAUDE.md calls it "a
// route is not a page"; this file is the part of the answer that `tsc` can
// enforce.
//
// So: shaping functions in `lib/db/queries/**` return these types, and the
// frontend's fixtures are annotated with them. A drift is a compile error.
//
// ===========================================================================
// MONEY AND DATES ARE STRINGS. THIS IS THE RULE, NOT A STYLE.
// ===========================================================================
// Every amount is a decimal STRING (`"1590.00"`), every date is `YYYY-MM-DD`,
// and neither is ever a `number` on the wire. A money value that passes through
// a JavaScript float is silently wrong in the last rappen, and an invoice that
// is wrong in the last rappen is a document somebody has to reissue.
//
// `numeric(14,2)` in Postgres, string here, integer rappen inside
// `lib/derive/totals.ts`, and nothing in between. `apps/books/lib/format.ts`
// records what the float path cost: `"0.145"` and `"8.005"` rounded in opposite
// directions and `"1e3"` rendered as `CHF 1'000.00`.
//
// A reviewer's shortcut: if you see `: number` below and it is not a count, an
// id, a sequence or a line index, it is a bug.

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/**
 * Every list route's response. `jsonList()` in `packages/platform-api` builds
 * it, and a client must OPEN it rather than cast around it.
 */
export interface ListEnvelope<T> {
  data: T[]
  /** Opaque. Pass it back as `?cursor=`; null means this is the last page. */
  next_cursor: string | null
}

/**
 * Every 4xx/5xx body.
 *
 * ── THE HUMAN-READABLE FIELD IS `error`, NOT `message` ─────────────────────
 * `errorBody` in `packages/platform-api/src/errors.ts` writes
 * `{ error: err.message, code: err.code }`, and `suggestion` only when the
 * error carries a string in `details`.
 *
 * This interface said `message` in its first draft, which is what a reader would
 * guess and is wrong. A client switching on `message` reads `undefined` on every
 * refusal — caught on 2026-09-17 by a curl that printed `None` for a real 400.
 *
 * **Switch on `code`, never on `error`.** The code is the contract; the sentence
 * is for a person.
 */
export interface ErrorEnvelope {
  code: string
  /** One sentence for a person. Do not parse it. */
  error: string
  /** The recovery. The CLI prints it as a `hint:` line. */
  suggestion?: string
}

// ---------------------------------------------------------------------------
// Vocabulary-typed unions
// ---------------------------------------------------------------------------
// Each of these has a CHECK constraint behind it in migration 0005 and an entry
// in `lib/vocabularies.ts`. Three copies of one list is two too many, so
// `lib/vocabularies.test.ts` asserts the three agree.

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void'

/** The Swiss QR-bill reference type. See `docs/billing-app-plan/qr-bill.md`. */
export type ReferenceType = 'QRR' | 'SCOR' | 'NON'

/** The DOCUMENT's language, not the operator's UI language. */
export type DocumentLanguage = 'fr' | 'de' | 'it' | 'en'

/**
 * How a company rounds. Decision D-B7 — a per-company policy rather than one
 * constant, because two companies in one workspace may keep different books.
 */
export type RoundingPolicy = 'line_0_05' | 'total_0_05' | 'none'

export type RecurrenceFrequency = 'monthly' | 'quarterly' | 'yearly'

export type RecurrenceStatus = 'active' | 'paused' | 'completed'

export type AuditAction =
  | 'created'
  | 'field_changed'
  | 'status_changed'
  | 'sent'
  | 'paid'
  | 'voided'

/** How the write arrived. The only structural difference between a human and an agent. */
export type ActorVia = 'session' | 'token'

/** Where an imported bill came from. `lib/vocabularies.ts` HISTORY_SOURCES. */
export type HistorySource = 'zoho' | 'invoicely'

/** An imported bill's status, mapped onto three words. Not the native lifecycle. */
export type HistoryStatus = 'paid' | 'unpaid' | 'void'

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

/**
 * A structured address, in the QR-bill's own field widths.
 *
 * **Structured only.** The standard's combined-address option is gone, and the
 * lengths are the payload's (`docs/billing-app-plan/qr-bill.md` §3), which is
 * why they are enforced by the columns rather than trimmed at render time: a
 * 71-character street does not produce a slightly wide PDF, it produces a
 * payload a bank rejects.
 */
export interface StructuredAddress {
  name: string
  street: string | null
  /** House number. Separate from `street` because the standard separates them. */
  building: string | null
  postal_code: string | null
  city: string | null
  /** ISO 3166-1 alpha-2. */
  country: string | null
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export interface Company {
  /** The workspace `#number` — the address every surface prints. Not `id`. */
  seq: number
  /** The URL and CLI handle. Immutable after create. */
  slug: string
  name: string
  /**
   * The name that goes on the payment part, and it **must match the account
   * holder** of the credit account. A mismatch is a bill a bank may refuse.
   */
  legal_name: string
  address: StructuredAddress
  email: string | null
  logo_initials: string | null
  logo_color: string | null

  /**
   * ⇠ borrowed from b/books. Carries SCOR and NON, CHF and EUR.
   *
   * **Owner-only to edit.** Changing an IBAN redirects real money, which is why
   * the route gates it on `requireOwner` rather than on membership.
   */
  iban: string | null
  /** ⇠ borrowed from b/books. QR-IID 30000–31999. Null means QRR is impossible here. */
  qr_iban: string | null

  /** `false` means VAT is OMITTED from its invoices — no rate, no 0%, no block. */
  vat_registered: boolean
  uid: string | null
  vat_number: string | null

  /** Prefills for new invoices and their lines. Never read at render time. */
  defaults: {
    currency: string
    language: DocumentLanguage
    ref_type: ReferenceType
    /** A decimal string, or null for "no VAT on new lines". */
    vat_rate: string | null
    prices_include_vat: boolean
    payment_terms_days: number
  }

  /** Read at DERIVATION time, unlike the defaults above. D-B7. */
  rounding: RoundingPolicy

  number_format: string
  /** The next statutory number this company will issue. Read-only on every surface. */
  next_seq: number

  footer_fr: string | null
  footer_en: string | null
  /** A retired company issues no new invoices and still renders its old ones. */
  retired_at: string | null

  /** The caller's own identifier. Unique per workspace where not null. */
  external_ref: string | null
  metadata: Record<string, string>
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

/**
 * One line of an invoice.
 *
 * Served as `items: [...]` on the invoice, which is the shape the mockup uses.
 * Stored as a TABLE (`billing.invoice_line`, decision D-B4), because a money
 * value inside `jsonb` is a JSON number and therefore a float64.
 */
export interface InvoiceLine {
  line_no: number
  description: string
  /** Decimal string: `"12"`, `"0.5"`, `"48"`. Three decimal places. */
  qty: string
  /** Display-only text. NOT a vocabulary — "days", "hours", "pcs", anything. */
  unit: string | null
  unit_price: string
  /**
   * **Null means this line carries no VAT** — a VAT-exempt medical act, or a
   * company that is not registered at all. `"0"` is a REAL rate (export,
   * reverse charge) and prints `TVA 0%`.
   *
   * The null-versus-zero distinction is load-bearing and it lives HERE, per
   * line, since decision D-B7. Never write the test as `> 0`.
   */
  vat_rate: string | null
  /** Derived, never stored. Included so a caller need not recompute it. */
  line_total: string
}

/** One rate's contribution to the VAT block. One entry per distinct rate. */
export interface VatLine {
  /** Decimal string, e.g. `"8.1"`. */
  rate: string
  /** The sum of the line totals carrying this rate. */
  base: string
  amount: string
}

/**
 * Everything derived from an invoice and its lines. **Nothing here is stored.**
 *
 * One block, computed once on the server, read by the PDF, the on-screen
 * preview and any external caller — so they cannot disagree. Phase 2 adds the
 * reference and account fields to it.
 */
export interface InvoiceTotals {
  subtotal: string
  /** One entry per distinct non-null rate. Empty when no line carries VAT. */
  vat: VatLine[]
  vat_total: string
  /**
   * The rounding adjustment the company's policy produced, as a signed string.
   * `"0.00"` for `line_0_05` and `none`; printed as its own `Arrondi` line when
   * it is not zero.
   */
  rounding: string
  total: string
}

export interface VoidRecord {
  ts: string
  by: string
  reason: { fr: string; en: string }
}

export interface Invoice {
  /** The workspace `#number` — the address. `bc:billing:<ws>/invoice/<seq>`. */
  seq: number
  /** The issuing company's slug. Frozen after insert. */
  company: string
  /**
   * The statutory number, printed on the document. **Never edited**, and its
   * sequence per company has no holes — see the allocator in
   * `lib/db/queries/seq.ts`.
   */
  number: string
  /** The per-company sequence value behind `number`. */
  seq_no: number

  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  paid_date: string | null

  currency: string
  /** The DOCUMENT's language. Drives the Annex C literals and the content. */
  language: DocumentLanguage

  ref_type: ReferenceType
  /** The reference WITHOUT its check digit. Null for NON. */
  ref_body: string | null

  /**
   * One self-contained block. **Nothing else on the invoice may depend on its
   * internals**, which is what makes the later swap to a b/clients lookup a
   * data-source change rather than a rewrite.
   */
  client: StructuredAddress

  /** The rate prefilled onto NEW lines. The totals read the lines, never this. */
  vat_rate: string | null
  /** `true` means each line's `unit_price` already contains its VAT. D-B7. */
  prices_include_vat: boolean

  /** The unstructured payment message. Max 140 characters, shared budget. */
  message: string | null
  /** A void is a RECORD, never a deletion. The number stays consumed. */
  void: VoidRecord | null

  /** When it left `draft`. Null until then. */
  sent_at: string | null
  /**
   * The id of the email that carried it. **Null on a sent invoice means it was
   * sent OUTSIDE this app** (`mark-sent`): "sent by us, here is the message" and
   * "sent somehow, we were told" are different facts, and the null is the second.
   */
  sent_message_id: string | null
  /** sha256 (hex) of the PDF bytes actually attached. Null unless this app emailed it. */
  pdf_sha256: string | null

  /**
   * The issuing company AS IT WAS when this invoice left `draft` (invariant
   * I12). **Null on a draft, and only on a draft**: a draft renders from the
   * company as it is now, so a correction made before sending reaches it.
   */
  issuer: IssuerSnapshot | null

  /**
   * The `#number` of the series this invoice belongs to — as an occurrence or as
   * its template. A void keeps it. Null on a one-off.
   */
  recurrence: number | null
  /** The period it bills — `2026-10`, `2026-Q4`, `2026`. Null on a one-off and a template that is not itself an occurrence. */
  occurrence_period: string | null

  /** The lines, as the mockup serves them. */
  items: InvoiceLine[]
  /** Derived. Never stored. */
  totals: InvoiceTotals
  /**
   * Derived. Never stored. What the payment part says, computed by the same
   * code the PDF uses — so a screen and a PDF cannot disagree.
   */
  derived: InvoiceDerived

  external_ref: string | null
  metadata: Record<string, string>
}

/**
 * The company columns a document prints or derives from, copied at issue.
 * The keys are `ISSUER_FIELDS` in lib/issuer.ts plus `captured_at`.
 */
export interface IssuerSnapshot {
  name: string
  legal_name: string
  street: string | null
  building: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  email: string | null
  logo_initials: string | null
  logo_color: string | null
  iban: string | null
  qr_iban: string | null
  vat_registered: boolean
  uid: string | null
  vat_number: string | null
  rounding: RoundingPolicy
  footer_fr: string | null
  footer_en: string | null
  /** ISO timestamp of the copy. */
  captured_at: string
  /**
   * Present and true ONLY on a row migration 0011 filled in: the company as it
   * was on migration day, not on the day the bill went out. Never evidence of
   * what a client received.
   */
  backfilled?: true
}

/** One thing that stops the payment part being valid, in words a person can act on. */
export interface PaymentPartProblem {
  code: string
  field?: string
  message: string
  suggestion: string
}

export interface InvoiceDerived {
  /** The FULL reference with its check digits. Null for NON, or when `ref_body` is malformed. */
  reference: string | null
  /** As printed: `21 00000 …` for QRR, blocks of four for SCOR. */
  reference_formatted: string | null
  /** The account the bill settles on: the issuer's `qr_iban` for QRR, else its `iban`. */
  account: string | null
  account_formatted: string | null
  /** The creditor block of the payment part: the issuer's LEGAL name and address. */
  creditor: StructuredAddress
  /** `false` for a currency the QR-bill does not carry, and for a void invoice. */
  has_payment_part: boolean
  /**
   * Why `…/pdf` and `…/qr` would refuse this invoice today. Empty means they
   * will serve it. Always empty when `has_payment_part` is false.
   */
  problems: PaymentPartProblem[]
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * One row of the append-only log. **The log IS the edit workflow** — there is no
 * separate history feature, and nothing here is ever updated or deleted.
 *
 * It doubles as this app's event feed: `GET …/audit?since=<seq>` returns rows
 * ascending from a cursor, which is how an outside system learns that a bill was
 * sent or paid by somebody in the browser
 * (`docs/billing-app-plan/integration-surface.md` §4).
 */
export interface AuditEntry {
  /** Monotonic per workspace. The feed's cursor. */
  seq: number
  subject_type: 'invoice' | 'company' | 'recurrence'
  /** The subject's `#number`, not its row id. */
  subject_seq: number
  /**
   * The subject's own `external_ref`, so a poller maps an entry straight to
   * the record it created without a second read. Null when it has none.
   */
  subject_external_ref: string | null
  ts: string
  actor: {
    user_id: number | null
    email: string | null
    /** Humans and agents land in the same log; this is the only difference. */
    via: ActorVia
  }
  action: AuditAction
  /** `items[2].unit_price`, `metadata.order_id`. Null for whole-record actions. */
  field: string | null
  from_value: string | null
  to_value: string | null
  detail_fr: string | null
  detail_en: string | null
}

// ---------------------------------------------------------------------------
// Imported history (phase 5)
// ---------------------------------------------------------------------------

/** An ambiguity the mapper could not resolve, in both languages or neither. */
export interface ImportFlag {
  fr: string
  en: string
}

/**
 * One bill from before this app existed. **Read-only**, and in its own
 * namespace: `number` is the historical number as issued and is never a native
 * invoice number, and `seq` is this app's address for the row.
 */
export interface HistoryEntry {
  /** The workspace #number — the ADDRESS (`bk billing history show 12`). */
  seq: number
  source: HistorySource
  /** The source system's own id, byte for byte as it was imported. */
  source_ref: string
  /** The issuing company's slug. */
  company: string
  /** The historical number as issued. Never renumbered. */
  number: string
  client_name: string
  issue_date: string
  /** Any ISO 4217 code, USD included. Only CHF and EUR ever carry a payment part, and an archive row carries none. */
  currency: string
  /** Stored, not derived: the source's total. A decimal STRING. */
  total: string
  status: HistoryStatus
  /** Null means the row mapped cleanly. Never cleared once set. */
  import_flag: ImportFlag | null
  /** A path or id on Google Drive. Null means the export had no PDF — say so, do not hide it. */
  drive_path: string | null
  imported_at: string
  imported_by: {
    /** Null when the importing account has since been removed. */
    user_id: number | null
    email: string | null
    via: ActorVia
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * The dashboard's aggregates.
 *
 * **Per currency, never merged** (invariant I8). Adding CHF to EUR produces a
 * number that is not money in any currency, and a dashboard that shows one is
 * worse than a dashboard that shows nothing.
 */
export interface CurrencyTotal {
  currency: string
  outstanding: string
  paid: string
  overdue: string
  count: number
}

export interface Overview {
  by_currency: CurrencyTotal[]
  /** Invoices wanting a human: overdue, or drafted and never sent. */
  needs_action: Invoice[]
  recent_invoices: Invoice[]
  recent_audit: AuditEntry[]
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface CreateCompanyBody {
  slug: string
  name: string
  legal_name?: string
  address?: Partial<StructuredAddress>
  email?: string | null
  iban?: string | null
  qr_iban?: string | null
  vat_registered?: boolean
  uid?: string | null
  vat_number?: string | null
  defaults?: Partial<Company['defaults']>
  rounding?: RoundingPolicy
  number_format?: string
  footer_fr?: string | null
  footer_en?: string | null
  external_ref?: string | null
  metadata?: Record<string, string>
}

export interface CreateInvoiceLineBody {
  description: string
  qty?: string
  unit?: string | null
  unit_price: string
  vat_rate?: string | null
}

export interface CreateInvoiceBody {
  /** The company's slug. Required: an invoice with no issuer is not a document. */
  company: string
  client?: Partial<StructuredAddress>
  items?: CreateInvoiceLineBody[]
  currency?: string
  language?: DocumentLanguage
  ref_type?: ReferenceType
  /**
   * The reference body WITHOUT its check digit. Optional: it is derived from the
   * company and the invoice number when absent (`lib/qr/reference.ts`).
   *
   * Supply it when a bank or a client dictates the reference, or when importing
   * one that already exists — in which case it must not be regenerated.
   */
  ref_body?: string | null
  vat_rate?: string | null
  prices_include_vat?: boolean
  issue_date?: string
  due_date?: string
  message?: string | null
  external_ref?: string | null
  metadata?: Record<string, string>
  /**
   * Optional. When present and different from the derived total, the create is
   * refused with `409 total_mismatch` carrying both numbers, the company's
   * rounding policy and its price mode — and **nothing is allocated**.
   *
   * It exists because two billing systems rounding differently is the oldest
   * integration bug there is, and the first external customer rounds VAT to the
   * rappen while the default policy rounds it to five
   * (`docs/billing-app-plan/integration-surface.md` §6). One field, and they
   * learn about the disagreement on the first bill rather than the first
   * complaint.
   */
  expected_total?: string
}

// ---------------------------------------------------------------------------
// Lifecycle bodies (phase 3)
// ---------------------------------------------------------------------------

/**
 * One row of `POST …/history`, as an agent maps it from an export.
 *
 * Unknown keys are REFUSED, not ignored: a mapper that wrote `sourceRef` would
 * otherwise import a row with its only link to the source silently missing.
 */
export interface ImportHistoryRow {
  source: HistorySource
  /** Verbatim. Surrounding whitespace is kept, because the source has it. */
  source_ref: string
  /** The issuing company's slug. */
  company: string
  number: string
  client_name: string
  issue_date: string
  currency: string
  /** A decimal string, `"3240.00"`. A JSON number is refused: money is never a float here. */
  total: string
  status: HistoryStatus
  import_flag?: ImportFlag | null
  drive_path?: string | null
}

/** `POST …/history`'s body: the rows, all written or none. */
export interface ImportHistoryBody {
  rows: ImportHistoryRow[]
}

/** `POST …/history`'s answer: what was written, named, not just counted. */
export interface ImportHistoryResult {
  imported: number
  flagged: number
  without_pdf: number
  rows: HistoryEntry[]
}

/** `POST …/invoices/{ref}/send`. Subject and body default to the document's language. */
export interface SendInvoiceBody {
  to: string
  cc?: string[]
  subject?: string
  /** Plain text. Paragraphs separated by a blank line. Never HTML. */
  body?: string
}

/** `POST …/invoices/{ref}/paid`. An ASSERTION that money arrived — this app never reconciles. */
export interface MarkPaidBody {
  /** YYYY-MM-DD, not in the future. */
  paid_date: string
}

/**
 * `POST …/invoices/{ref}/void`. At least one reason; a single one is used for
 * both languages.
 */
export interface VoidInvoiceBody {
  reason_fr?: string
  reason_en?: string
  /**
   * Optional. When present it must equal the invoice's printed `number`
   * EXACTLY, or nothing is voided. `bk` always sends it; an integration may.
   */
  confirm?: string
}

// ---------------------------------------------------------------------------
// Recurrence (phase 4)
// ---------------------------------------------------------------------------

/** One invoice of a series, as the series lists it. */
export interface RecurrenceOccurrence {
  seq: number
  number: string
  status: InvoiceStatus
  /** Null only on a template that is not itself an occurrence. */
  occurrence_period: string | null
  issue_date: string
  total: string
  currency: string
}

/**
 * A finite series. **A rule is data; nothing fires on it** — an agent reads
 * `next_date` (or lists with `?due=true`) and asks for the next occurrence.
 */
export interface Recurrence {
  /** The workspace `#number`. `bc:billing:<ws>/recurrence/<seq>`. */
  seq: number
  company: string
  /** The template's `#number`. Null when the template predates this app. */
  template: number | null
  template_number: string | null
  status: RecurrenceStatus
  frequency: RecurrenceFrequency
  start_date: string
  /** The END CONDITION. There is no open-ended series. */
  occurrences_total: number
  /** Live occurrences generated or counted so far. A void and its replacement are ONE. */
  occurrences_done: number
  /** Null exactly when completed. */
  next_date: string | null
  /** The period the next generation must name. Null exactly when completed. */
  next_period: string | null
  /** Active and its next date has arrived, in Zurich. */
  due: boolean
  label: { fr: string | null; en: string | null }
  external_ref: string | null
  metadata: Record<string, string>
  /** Every invoice carrying this series, oldest first — voids included. On a single read only. */
  invoices?: RecurrenceOccurrence[]
}

export interface CreateRecurrenceBody {
  /** The invoice every occurrence is copied from: its `#number` or printed number. */
  template: string
  frequency: RecurrenceFrequency
  /** YYYY-MM-DD. Its day of the month is the series' anchor. */
  start_date: string
  /** Required. There is no default and no "leave it open". */
  occurrences_total: number
  label_fr?: string | null
  label_en?: string | null
  external_ref?: string | null
  metadata?: Record<string, string>
}

export interface GenerateOccurrenceBody {
  /** The period to bill — must be the series' next period, or a voided one being replaced. */
  period: string
  /** Defaults to today in Zurich. */
  issue_date?: string
  /** Defaults to the template's. */
  message?: string | null
}

export interface GenerateOccurrenceResult {
  invoice: Invoice
  recurrence: Recurrence
  /** True when this filled a period whose earlier occurrence was voided: the counter did not move. */
  replacement: boolean
}
