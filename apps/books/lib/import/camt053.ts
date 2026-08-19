// A strict camt.053 subset reader — the bank import door's parser.
//
// ===========================================================================
// WHY THE SERVER PARSES, AND WHY THERE IS NO XML LIBRARY
// ===========================================================================
// The pièces door keeps OCR at arm's length because extraction is fallible AI
// judgment. camt.053 is the opposite kind of input: an ISO 20022 statement the
// bank itself produced, and reading it is deterministic arithmetic. So the
// server parses — one canonical, golden-file-tested reader — rather than
// trusting whatever a worker claims the file said.
//
// No XML dependency is added for this. The reader walks the handful of
// elements this app needs and REFUSES anything it does not fully understand:
// a strict subset honestly refused beats a lenient library confidently
// misread. Every refusal names what was missing.
//
// ===========================================================================
// WHAT IS READ, AND WHAT IS DELIBERATELY NOT
// ===========================================================================
//   read     Stmt (exactly one), IBAN, FrToDt, OPBD/CLBD balances,
//            booked entries: amount+currency, direction, booking date, the
//            bank's reference, remittance text, counterparty name, and the
//            original-currency details when the bank converted (fx).
//   skipped  PDNG (pending) entries — not yet facts.
//   refused  multiple statements per file, entries without any reference
//            (idempotency needs one), amounts that do not parse, a file
//            whose balances and lines disagree.

import { toCentimes, fromCentimes } from '../derive'

export class CamtRefused extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export interface CamtFx {
  original: string
  rate: string
  source: 'camt.053'
}

export interface CamtLine {
  /** The bank's identifier: AcctSvcrRef, else NtryRef, else EndToEndId. */
  ref: string
  /** Absolute amount, fixed-2 string. Direction carries the sign. */
  amount: string
  direction: 'credit' | 'debit'
  /** Booking date, YYYY-MM-DD. */
  booked: string
  /** The bank's narrative, verbatim. Becomes raw_label and is never rewritten. */
  label: string
  counterparty: string | null
  /** Present when the bank converted: the instructed amount and its rate. */
  fx: CamtFx | null
}

export interface CamtStatement {
  iban: string | null
  from: string | null
  to: string | null
  /** Signed, fixed-2. CRDT positive, DBIT negative. */
  opening: string
  closing: string
  currency: string
  lines: CamtLine[]
}

// ── the tiny element walker ─────────────────────────────────────────────────
// Tags are matched non-greedily and namespace-blind (\w+ never contains ':').
// camt.053 in the wild is unprefixed inside the Document element; a prefixed
// file simply fails to match and is refused as not understood, which is the
// strictness this reader promises.

function firstBlock(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : null
}

function allBlocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1])
  return out
}

function text(xml: string, tag: string): string | null {
  const b = firstBlock(xml, tag)
  return b === null ? null : b.trim()
}

/** An <Amt Ccy="CHF">45.00</Amt> pair. */
function amountWithCcy(xml: string, tag: string): { amount: string; ccy: string } | null {
  const m = xml.match(new RegExp(`<${tag}\\s[^>]*Ccy="([A-Z]{3})"[^>]*>\\s*([0-9]+(?:\\.[0-9]+)?)\\s*</${tag}>`))
  if (!m) return null
  return { ccy: m[1], amount: fromCentimes(toCentimes(Number(m[2]))) }
}

// ── balances ────────────────────────────────────────────────────────────────

function readBalance(stmt: string, code: 'OPBD' | 'CLBD'): { amount: string; date: string | null } {
  for (const bal of allBlocks(stmt, 'Bal')) {
    const cd = text(bal, 'Cd')
    if (cd !== code) continue
    const amt = amountWithCcy(bal, 'Amt')
    if (!amt) throw new CamtRefused('bad_balance', `${code} balance has no parsable <Amt Ccy=...>`)
    const ind = text(bal, 'CdtDbtInd')
    if (ind !== 'CRDT' && ind !== 'DBIT') {
      throw new CamtRefused('bad_balance', `${code} balance has no CdtDbtInd`)
    }
    const signed = ind === 'DBIT' ? -toCentimes(amt.amount) : toCentimes(amt.amount)
    return { amount: fromCentimes(signed), date: text(bal, 'Dt') }
  }
  throw new CamtRefused('missing_balance', `the statement carries no ${code} balance — a truncated export proves nothing`)
}

// ── entries ─────────────────────────────────────────────────────────────────

function readLine(ntry: string, index: number): CamtLine | null {
  // Only booked movements are facts. Pending ones are skipped, not refused.
  const sts = text(ntry, 'Sts')
  if (sts !== null && sts !== 'BOOK') return null

  const amt = amountWithCcy(ntry, 'Amt')
  if (!amt) throw new CamtRefused('bad_entry', `entry ${index + 1} has no parsable <Amt Ccy=...>`)

  const ind = text(ntry, 'CdtDbtInd')
  if (ind !== 'CRDT' && ind !== 'DBIT') {
    throw new CamtRefused('bad_entry', `entry ${index + 1} has no CdtDbtInd`)
  }

  const bookg = firstBlock(ntry, 'BookgDt')
  const booked = bookg ? text(bookg, 'Dt') : null
  if (!booked || !/^\d{4}-\d{2}-\d{2}$/.test(booked)) {
    throw new CamtRefused('bad_entry', `entry ${index + 1} has no booking date`)
  }

  const ref = text(ntry, 'AcctSvcrRef') ?? text(ntry, 'NtryRef') ?? text(ntry, 'EndToEndId')
  if (!ref) {
    throw new CamtRefused(
      'missing_ref',
      `entry ${index + 1} carries no reference (AcctSvcrRef / NtryRef / EndToEndId) — without one, a re-import cannot converge, so the file is refused rather than imported twice on a retry`
    )
  }

  const ustrd = allBlocks(ntry, 'Ustrd').map((s) => s.trim()).filter(Boolean)
  const label = (ustrd.length > 0 ? ustrd.join(' ') : (text(ntry, 'AddtlNtryInf') ?? '')).trim()
  if (!label) throw new CamtRefused('bad_entry', `entry ${index + 1} has no narrative (Ustrd or AddtlNtryInf)`)

  // Counterparty: the OTHER party. For money out (DBIT) it is the creditor;
  // for money in (CRDT) the debtor.
  const parties = firstBlock(ntry, 'RltdPties')
  let counterparty: string | null = null
  if (parties) {
    const side = firstBlock(parties, ind === 'DBIT' ? 'Cdtr' : 'Dbtr')
    counterparty = side ? text(side, 'Nm') : null
  }

  // fx: when the bank converted, AmtDtls carries the instructed amount in the
  // original currency and the applied rate. Display evidence only (0011). The
  // wire contract is ALL THREE FIELDS OR NULL, so a conversion whose rate the
  // bank did not state is not stored as fx — the narrative still tells it.
  let fx: CamtFx | null = null
  const dtls = firstBlock(ntry, 'AmtDtls')
  if (dtls) {
    const instd = firstBlock(dtls, 'InstdAmt')
    const orig = instd ? amountWithCcy(instd, 'Amt') : null
    const rate = text(dtls, 'XchgRate')
    if (orig && orig.ccy !== amt.ccy && rate) {
      fx = { original: `${orig.ccy} ${orig.amount}`, rate, source: 'camt.053' }
    }
  }

  return {
    ref: ref.slice(0, 64),
    amount: amt.amount,
    direction: ind === 'CRDT' ? 'credit' : 'debit',
    booked,
    label,
    counterparty,
    fx,
  }
}

// ── the statement ───────────────────────────────────────────────────────────

export function parseCamt053(xml: string): CamtStatement {
  if (!xml.includes('<BkToCstmrStmt')) {
    throw new CamtRefused('not_camt053', 'not a camt.053: no <BkToCstmrStmt> element')
  }
  const stmts = allBlocks(xml, 'Stmt')
  if (stmts.length === 0) throw new CamtRefused('not_camt053', 'no <Stmt> block in the file')
  if (stmts.length > 1) {
    throw new CamtRefused('multi_statement', `${stmts.length} statements in one file — import one account's statement at a time`)
  }
  const stmt = stmts[0]

  const acct = firstBlock(stmt, 'Acct')
  const iban = acct ? text(acct, 'IBAN') : null

  const period = firstBlock(stmt, 'FrToDt')
  const from = period ? text(period, 'FrDtTm')?.slice(0, 10) ?? null : null
  const to = period ? text(period, 'ToDtTm')?.slice(0, 10) ?? null : null

  const opening = readBalance(stmt, 'OPBD')
  const closing = readBalance(stmt, 'CLBD')

  const rawEntries = allBlocks(stmt, 'Ntry')
  const lines: CamtLine[] = []
  const seen = new Set<string>()
  rawEntries.forEach((n, i) => {
    const line = readLine(n, i)
    if (!line) return
    if (seen.has(line.ref)) {
      throw new CamtRefused('duplicate_ref', `entry reference "${line.ref}" appears twice in one file — the bank does not do that; the file is damaged`)
    }
    seen.add(line.ref)
    lines.push(line)
  })

  // Currency: every booked line and both balances must agree. A statement in
  // one currency is the only kind this book keeps (fx is evidence, 0011).
  const ccys = new Set<string>()
  for (const n of rawEntries) {
    const a = amountWithCcy(n, 'Amt')
    if (a) ccys.add(a.ccy)
  }
  if (ccys.size > 1) {
    throw new CamtRefused('mixed_currency', `entries in ${[...ccys].join(', ')} — one statement, one currency`)
  }
  const currency = [...ccys][0] ?? 'CHF'

  return { iban, from, to, opening: opening.amount, closing: closing.amount, currency, lines }
}

/**
 * The whole-file arithmetic check: opening + Σ(signed lines) must equal
 * closing to the rappen. A file that fails is truncated or damaged and is
 * refused WHOLE — bank facts are ring 0, and a half-true file must not
 * half-land.
 */
export function verifyCamt(stmt: CamtStatement): string[] {
  const problems: string[] = []
  let sum = 0n
  for (const l of stmt.lines) {
    sum += l.direction === 'credit' ? toCentimes(l.amount) : -toCentimes(l.amount)
  }
  const expected = toCentimes(stmt.opening) + sum
  if (expected !== toCentimes(stmt.closing)) {
    problems.push(
      `opening ${stmt.opening} plus ${stmt.lines.length} line(s) gives ${fromCentimes(expected)}, but the statement closes at ${stmt.closing} — the file is truncated or damaged`
    )
  }
  return problems
}
