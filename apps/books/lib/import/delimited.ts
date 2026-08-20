// The second import format: a delimited statement, read through a mapping the
// SOURCE carries.
//
// ===========================================================================
// WHY THIS EXISTS
// ===========================================================================
// `HOWTO-BUILD.md` names three bank-file formats and only one was built:
//
//   ISO 20022 camt.053 XML (WIR primary)   — built
//   Yapeal CSV (camt.054 to confirm)       — this file
//   Stripe payout CSV                      — income side; see R9 below
//
// Cards and payment processors almost never issue camt.053. They issue a
// delimited export, which is why the mockup's two Yapeal card sources carry
// `.csv` pulls — pulls the seed wrote directly, so every screen showed a
// working card feed while nothing could actually parse one.
//
// ===========================================================================
// A MAPPING, NOT A PARSER PER ISSUER
// ===========================================================================
// There is no "CSV format": every issuer names its columns differently, and
// `HOWTO-BUILD` says "(camt.054 to confirm)" precisely because nobody yet knew
// what Yapeal emits. Hard-coding a guess at Yapeal's header would be inventing
// a bank's file format, and would need a code change and a release for the next
// issuer.
//
// So the shape of the file is DATA, held on the source beside its runbook: the
// runbook says how to fetch the file, the mapping says how to read it. Both are
// per-source facts a human establishes once by looking at a real export.
//
// ===========================================================================
// THE DISCIPLINE camt.053 GETS, THIS GETS TOO
// ===========================================================================
// `verifyCamt` refuses a statement whose OPBD + Σ(lines) does not reach its
// CLBD. That check is the reason a truncated download cannot quietly become a
// month with three days missing, and it must not be lost because a format is
// weaker.
//
// Most card exports carry no balances at all. So the balances are REQUIRED
// FROM THE CALLER: whoever downloads the file is looking at the statement that
// states them. This deliberately makes the CSV path slightly harder to use
// than the XML one — the alternative is an import that cannot tell a complete
// file from half of one, and silence is exactly what the camt reader refuses.
//
// If the export DOES carry a running balance, the mapping can name that column
// and the caller can read the two figures off the file's own first and last
// rows. The door still wants them stated: the point is that a human or an
// agent asserts what the file should sum to, and the arithmetic agrees.

import { toCentimes, fromCentimes } from '../derive'
import type { CamtLine, CamtStatement } from './camt053'

export class DelimitedRefused extends Error {
  constructor(
    public code: string,
    message: string,
    public problems: string[] = []
  ) {
    super(message)
  }
}

/**
 * How to read one issuer's export. Stored on `books.source.import_mapping`.
 *
 * Every field is about SHAPE, never about meaning: nothing here decides what a
 * line was, which stays the recognition layer's job.
 */
export interface DelimitedMapping {
  /** Column separator. One character; a tab is written "\t" in JSON. */
  delimiter: string
  /** Does row 1 name the columns? When false, `columns` must use indices. */
  header: boolean
  /**
   * Which column holds what. A value is a header NAME when `header` is true,
   * or a 0-based index as a string when it is false.
   */
  columns: {
    date: string
    label: string
    /** The signed amount, when one column carries both directions. */
    amount?: string
    /** Or two columns, when the issuer splits them. Exactly one shape. */
    debit?: string
    credit?: string
    counterparty?: string
    /** The issuer's own line reference, when it has one. Best idempotency. */
    ref?: string
  }
  /** `YYYY-MM-DD`, `DD.MM.YYYY` or `MM/DD/YYYY`. No free-form parsing. */
  date_format: 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'MM/DD/YYYY'
  /** Decimal separator in the amount column. */
  decimal: '.' | ','
  /** Thousands separator to strip, if the issuer writes one. */
  thousands?: string
  /**
   * Does a POSITIVE number in the amount column mean money in or money out?
   *
   * Card exports differ and the two are indistinguishable from the file: a
   * statement of charges may write purchases positive. Getting this backwards
   * inverts every line, and the reconciliation check is what catches it —
   * which is the second reason the balances are required.
   */
  positive_means: 'credit' | 'debit'
  /** Rows to skip before the header (issuer preamble). */
  skip_rows?: number
}

/** The balances the caller states, because the file usually cannot. */
export interface DeclaredBalances {
  opening: string
  closing: string
  /** The date the closing balance is stated as of. */
  closing_on?: string | null
}

// ---------------------------------------------------------------------------
// the reader
// ---------------------------------------------------------------------------

/**
 * Split one delimited line, honouring double quotes.
 *
 * Hand-written rather than a dependency: this is the whole of RFC 4180 that a
 * bank export uses, and `camt053.ts` makes the same argument for its element
 * walker. A quoted field may contain the delimiter and doubled quotes ("").
 */
export function splitRow(row: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (quoted) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      out.push(field)
      field = ''
    } else field += c
  }
  out.push(field)
  return out.map((f) => f.trim())
}

function parseDate(raw: string, format: DelimitedMapping['date_format']): string | null {
  const v = raw.trim()
  let y: string, m: string, d: string
  if (format === 'YYYY-MM-DD') {
    const p = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
    if (!p) return null
    ;[, y, m, d] = p
  } else if (format === 'DD.MM.YYYY') {
    const p = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v)
    if (!p) return null
    ;[, d, m, y] = p
  } else {
    const p = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v)
    if (!p) return null
    ;[, m, d, y] = p
  }
  const iso = `${y}-${m}-${d}`
  // A shape that parses but is not a date — 2026-13-45 — must not reach the
  // ledger as a booking date.
  const dt = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null
  return iso
}

function parseAmount(raw: string, m: DelimitedMapping): bigint | null {
  let v = raw.trim()
  if (v === '') return null
  // Parentheses are the accounting negative: (84.20) is −84.20.
  let neg = false
  if (/^\(.*\)$/.test(v)) {
    neg = true
    v = v.slice(1, -1)
  }
  if (m.thousands) v = v.split(m.thousands).join('')
  if (m.decimal === ',') v = v.replace(',', '.')
  v = v.replace(/[^\d.\-+]/g, '')
  if (v === '' || !/^[-+]?\d*\.?\d*$/.test(v) || !/\d/.test(v)) return null
  if (v.startsWith('+')) v = v.slice(1)
  if (v.startsWith('-')) {
    neg = !neg
    v = v.slice(1)
  }
  const cents = toCentimes(v)
  return neg ? -cents : cents
}

/**
 * Read a delimited export into the same statement shape camt.053 produces, so
 * everything downstream — the exercice checks, idempotency, rule matching, the
 * pull record — is the code that already exists and is already proven.
 *
 * `sourceKey` scopes the synthesized line references. See `refFor`.
 */
export function parseDelimited(
  text: string,
  mapping: DelimitedMapping,
  balances: DeclaredBalances,
  sourceKey: string
): CamtStatement {
  const problems: string[] = []
  if (!mapping.delimiter || mapping.delimiter.length !== 1) {
    throw new DelimitedRefused('bad_mapping', 'the mapping\'s delimiter must be exactly one character')
  }
  const both = mapping.columns.debit !== undefined || mapping.columns.credit !== undefined
  if (both === (mapping.columns.amount !== undefined)) {
    throw new DelimitedRefused(
      'bad_mapping',
      'the mapping needs EITHER an `amount` column OR a `debit`/`credit` pair, never both and never neither'
    )
  }

  const rows = text
    .split(/\r\n|\n|\r/)
    .slice(mapping.skip_rows ?? 0)
    .filter((r) => r.trim() !== '')
  if (rows.length === 0) throw new DelimitedRefused('empty_file', 'the file has no rows')

  let index: Record<string, number> = {}
  let body = rows
  if (mapping.header) {
    const head = splitRow(rows[0], mapping.delimiter)
    body = rows.slice(1)
    head.forEach((name, i) => {
      index[name] = i
    })
    for (const [role, col] of Object.entries(mapping.columns)) {
      if (col !== undefined && !(col in index)) {
        problems.push(`the mapping's ${role} column "${col}" is not in the header: ${head.join(', ')}`)
      }
    }
    if (problems.length > 0) throw new DelimitedRefused('mapping_does_not_fit', 'the mapping does not describe this file', problems)
  } else {
    index = Object.fromEntries(Object.values(mapping.columns).filter(Boolean).map((c) => [String(c), Number(c)]))
  }

  const at = (cells: string[], col: string | undefined): string | undefined => {
    if (col === undefined) return undefined
    const i = mapping.header ? index[col] : Number(col)
    return Number.isInteger(i) ? cells[i] : undefined
  }

  const lines: CamtLine[] = []
  const seen = new Map<string, number>()

  body.forEach((row, n) => {
    const cells = splitRow(row, mapping.delimiter)
    const rowNo = n + 1 + (mapping.header ? 1 : 0) + (mapping.skip_rows ?? 0)

    const booked = parseDate(at(cells, mapping.columns.date) ?? '', mapping.date_format)
    if (!booked) {
      problems.push(`row ${rowNo}: "${at(cells, mapping.columns.date) ?? ''}" is not a ${mapping.date_format} date`)
      return
    }

    let signed: bigint | null
    if (mapping.columns.amount !== undefined) {
      signed = parseAmount(at(cells, mapping.columns.amount) ?? '', mapping)
      if (signed === null) {
        problems.push(`row ${rowNo}: "${at(cells, mapping.columns.amount) ?? ''}" is not an amount`)
        return
      }
      if (mapping.positive_means === 'debit') signed = -signed
    } else {
      const d = parseAmount(at(cells, mapping.columns.debit) ?? '', mapping) ?? 0n
      const c = parseAmount(at(cells, mapping.columns.credit) ?? '', mapping) ?? 0n
      if (d !== 0n && c !== 0n) {
        problems.push(`row ${rowNo}: both a debit and a credit — a line moves money one way`)
        return
      }
      signed = c - (d < 0n ? -d : d)
    }
    if (signed === 0n) {
      problems.push(`row ${rowNo}: a zero-franc line is not a movement`)
      return
    }

    const label = (at(cells, mapping.columns.label) ?? '').trim()
    if (label === '') {
      problems.push(`row ${rowNo}: no narrative — a line with no label cannot be recognized later`)
      return
    }

    const declaredRef = (at(cells, mapping.columns.ref) ?? '').trim()
    const ref = declaredRef !== '' ? declaredRef : refFor(sourceKey, booked, signed, label, seen)

    lines.push({
      ref,
      amount: fromCentimes(signed < 0n ? -signed : signed),
      direction: signed < 0n ? 'debit' : 'credit',
      booked,
      label,
      counterparty: (at(cells, mapping.columns.counterparty) ?? '').trim() || null,
      // FX on a delimited line is not read: the issuer's original-currency
      // columns are not standardised, and inventing a rate is worse than
      // recording the settled CHF, which is what R6 already says to book.
      fx: null,
    })
  })

  if (problems.length > 0) {
    throw new DelimitedRefused('unreadable_rows', 'the file has rows this mapping cannot read', problems)
  }
  if (lines.length === 0) throw new DelimitedRefused('empty_file', 'the file has no movement rows')

  const dates = lines.map((l) => l.booked).sort()
  return {
    iban: null,
    from: dates[0],
    to: dates[dates.length - 1],
    opening: balances.opening,
    closing: balances.closing,
    closing_on: balances.closing_on ?? dates[dates.length - 1],
    currency: 'CHF',
    lines,
  }
}

/**
 * A stable identifier for a line the issuer did not identify.
 *
 * camt.053 lines carry the bank's own `AcctSvcrRef`, which is what makes
 * re-importing an overlapping statement converge instead of duplicating. A CSV
 * usually carries nothing, so one is derived from the facts of the line —
 * source, date, signed amount, narrative — plus an OCCURRENCE COUNTER.
 *
 * The counter is the part that matters. Two identical coffees on the same day
 * are two movements, not one delivered twice, and a key without it would
 * silently collapse them into a single entry the second time the file is
 * imported. With it, the same file yields the same refs in the same order and
 * converges; a file with a genuinely repeated charge keeps both.
 *
 * `csv:` prefixed so a synthesized reference is never mistaken for a bank's.
 */
export function refFor(
  sourceKey: string,
  booked: string,
  signed: bigint,
  label: string,
  seen: Map<string, number>
): string {
  const base = `${sourceKey}|${booked}|${signed}|${label.toUpperCase().replace(/\s+/g, ' ')}`
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  let h = 0
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
  return `csv:${(h >>> 0).toString(36)}:${booked}:${n}`
}
