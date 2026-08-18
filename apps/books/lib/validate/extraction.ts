// Server-side revalidation of an ExtractionResult. The boundary trusts bytes
// and arithmetic, not the caller.
//
// ===========================================================================
// THE WORKER'S OWN VALIDATION BLOCK IS EVIDENCE, NEVER INPUT
// ===========================================================================
// The Drive worker posts an `ExtractionResult` that carries its own
// `validation` verdict. It is stored verbatim inside `extraction` as a record
// of what the worker CLAIMED, and it is read by nothing: every check below is
// recomputed here from the payload's own arithmetic. A tampered payload whose
// claimed verdict says `passed: true` fails all the same, which is phase 3's
// third acceptance criterion.
//
// Contract: `_bridge/to-claude/ocr-spike-handoff/prototype/extraction-schema
// .json` in the b-mockups repo (ExtractionResult v0.1). The mockup's seeded
// pieces spell the field `tx`; the schema says `transaction`; `ingestPiece`
// accepts either and normalises to the schema's name.
//
// ===========================================================================
// FAILING VALIDATION DOES NOT REJECT THE DOCUMENT
// ===========================================================================
// Rule 4: flag, never drop. A payload that is STRUCTURALLY an extraction lands
// staged with `needs_review: true` and this verdict attached — a bad sum is
// exactly the kind of document a human must see, and refusing it at the door
// would hide it in the worker's retry queue. Only a payload missing the
// schema's required fields is refused outright, because there is nothing
// coherent to stage.

import { toCentimes } from '../derive'

/** The Swiss VAT rates in force. Anything else on a 2026 receipt is a misread. */
export const VAT_RATES = [0, 2.6, 3.8, 8.1] as const

export interface ExtractionLine {
  description?: string
  quantity?: number
  unit?: string
  unit_price?: number
  amount: number
  vat_rate?: number | null
}

export interface Extraction {
  document_type: string
  multiple_documents?: boolean
  merchant: { name: string; vat_number?: string | null }
  transaction: {
    date: string | null
    time?: string | null
    ticket_number?: string | null
    currency: string
    total: number
    payment_method?: string | null
  }
  lines: ExtractionLine[]
  vat_summary?: { rate: number; gross: number }[]
  confidence: number
  notes?: string | null
}

/** The server's verdict. Shape mirrors the mockup's `validation` block. */
export interface Validation {
  lines_sum_matches_total: boolean
  vat_rates_valid: boolean
  date_plausible: boolean
  passed: boolean
  /** Every failed check, spelled out for the reviewer. Empty when passed. */
  problems: string[]
}

/** Why a structurally-broken payload was refused. `null` means well-formed. */
export function structuralRefusal(body: unknown): string | null {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return 'payload is not an object'
  if (typeof b.document_type !== 'string') return 'document_type is required'
  const merchant = b.merchant as Record<string, unknown> | undefined
  if (!merchant || typeof merchant.name !== 'string' || !merchant.name.trim()) {
    return 'merchant.name is required'
  }
  const tx = (b.transaction ?? b.tx) as Record<string, unknown> | undefined
  if (!tx || typeof tx !== 'object') return 'transaction is required'
  if (typeof tx.total !== 'number' || !Number.isFinite(tx.total)) return 'transaction.total must be a number'
  if (typeof tx.currency !== 'string') return 'transaction.currency is required'
  if (!Array.isArray(b.lines)) return 'lines must be an array (empty is allowed)'
  if (typeof b.confidence !== 'number') return 'confidence is required'
  return null
}

/**
 * Recompute the verdict from the payload's own arithmetic.
 *
 * SUM: line amounts, in centimes, must equal the total exactly. Swiss receipts
 * round per line, so the printed lines sum to the printed total to the rappen;
 * a mismatch is a misread or a tamper, and both are for a human. An empty
 * `lines` array fails the sum check by definition — a document with no lines
 * proves nothing about its total.
 *
 * VAT: every rate on a line or in the summary must be one of {0, 2.6, 3.8,
 * 8.1}. A line with NO rate is fine (not every ticket prints one); a line
 * with a WRONG rate is not.
 *
 * DATE: parseable ISO, not after `receivedOn` (a receipt from the future is a
 * misread), and no more than two years before it (older is not impossible,
 * but it is exactly what a reviewer should see).
 */
export function validateExtraction(x: Extraction, receivedOn: string): Validation {
  const problems: string[] = []

  const total = toCentimes(x.transaction.total)
  const sum = x.lines.reduce((s, l) => s + toCentimes(l.amount), 0n)
  const lines_sum_matches_total = x.lines.length > 0 && sum === total
  if (x.lines.length === 0) problems.push('no lines: nothing supports the total')
  else if (sum !== total) {
    problems.push(`lines sum to ${fmt(sum)} but the total says ${fmt(total)}`)
  }

  let vat_rates_valid = true
  const badRate = (r: number) => !(VAT_RATES as readonly number[]).includes(r)
  for (const l of x.lines) {
    if (l.vat_rate !== null && l.vat_rate !== undefined && badRate(l.vat_rate)) {
      vat_rates_valid = false
      problems.push(`line "${l.description ?? '?'}" carries VAT ${l.vat_rate}%, which is not a Swiss rate`)
    }
  }
  for (const v of x.vat_summary ?? []) {
    if (badRate(v.rate)) {
      vat_rates_valid = false
      problems.push(`vat_summary carries ${v.rate}%, which is not a Swiss rate`)
    }
  }

  let date_plausible = false
  const d = x.transaction.date
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d).getTime())) {
    const received = new Date(receivedOn).getTime()
    const docDate = new Date(d).getTime()
    const twoYears = 2 * 365 * 86400000
    date_plausible = docDate <= received && received - docDate <= twoYears
  }
  if (!date_plausible) {
    problems.push(`transaction date "${d}" is missing, unparseable, in the future, or implausibly old`)
  }

  const passed = lines_sum_matches_total && vat_rates_valid && date_plausible
  return { lines_sum_matches_total, vat_rates_valid, date_plausible, passed, problems }
}

/**
 * Routing: does this piece need a human before anything else happens?
 * Validation failure, a document the model could not classify, or a scan that
 * appears to hold several documents.
 */
export function needsReview(x: Extraction, v: Validation): boolean {
  return !v.passed || x.document_type === 'other' || x.multiple_documents === true
}

function fmt(c: bigint): string {
  const neg = c < 0n
  const abs = neg ? -c : c
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}
