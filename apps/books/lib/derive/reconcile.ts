// Bank reconciliation: does the ledger agree with what the bank last said?
//
// ===========================================================================
// THE OLDEST CONTROL IN BOOKKEEPING, AND THE APP COULD NOT PERFORM IT
// ===========================================================================
// `verifyCamt` refuses a statement whose OPBD + Σ(lines) does not reach its
// CLBD. That check is about the FILE — it proves the document is intact and
// says nothing about the BOOK. Until 0018 the closing balance was checked and
// then discarded, so after an import there was no figure left to reconcile
// against and nothing ever compared the two sides again.
//
// Measured 2026-08-20 on a book driven end to end from the CLI:
//
//   statement CLBD, 30 April      17'030.00
//   account 1020 in the ledger     9'965.00   (drift 7'065.00)
//
// Both figures were right. April payroll of 7'065.00 was declared and posted
// and simply is not on the April statement. That is the ORDINARY case, and it
// is why this file reports rather than refuses: a drift is a question, not a
// verdict. The point is that the question is now asked, because the answers
// that are NOT ordinary — a posting to a bank account the bank never saw, a
// movement resolved onto the wrong account, a statement imported into the
// wrong book — were until now indistinguishable from this one.
//
// ── WHAT IT COMPARES, AND AT WHICH INSTANT ─────────────────────────────────
// The ledger side sums every posted line on the source's `ledger_accounts` up
// to and INCLUDING the statement's closing date, plus the opening balances
// those accounts carried into the year. Comparing a running ledger against a
// dated statement is the mistake that would make this report noise: the bank
// closed its books on a day, and the ledger must be read on the same day.
//
// STAGED ENTRIES ARE EXCLUDED. A staged entry is money nobody has judged yet;
// counting it would let an unreviewed guess silently reconcile a real gap.
// They are reported separately as `staged_on_account`, because a drift that
// exactly equals the staged total is a different conversation from one that
// does not.
//
// ── UNKNOWN IS NOT AGREEMENT ───────────────────────────────────────────────
// A source with no pull carrying a closing balance answers `known: false`. It
// must never answer "drift 0.00": a pull recorded by hand has no statement
// behind it, and one imported before 0018 genuinely does not know. Reporting
// zero would be inventing an agreement nobody checked — the same failure as a
// boundary probe built entirely on negatives (0005's header, Finding #16).

import { toCentimes, fromCentimes } from './index'
import type { Money } from '../types'

/** A posted line on one of the accounts a source feeds. */
export interface ReconcilableLine {
  account_no: string | null
  debit: Money | number
  credit: Money | number
  /** The entry's date, YYYY-MM-DD. */
  date: string
  /** Only `posted` counts toward the reconciled balance. */
  status: string
}

export interface ReconcileInput {
  /** The accounts this source feeds — `source.ledger_accounts`. */
  accounts: string[]
  /** What the statement said it closed at, and when. Null when unknown. */
  closing_balance: Money | null
  closing_on: string | null
  /** Opening balances those accounts carried into the exercice. */
  openings: { account_no: string; amount: Money }[]
  lines: ReconcilableLine[]
}

export interface Reconciliation {
  /** False when no imported statement has ever reported a closing balance. */
  known: boolean
  /** Why, when `known` is false — a sentence, not a code. */
  note: string | null
  statement_closing: Money | null
  statement_closed_on: string | null
  ledger_balance: Money | null
  /** statement − ledger. Positive: the bank holds more than the books show. */
  drift: Money | null
  agrees: boolean | null
  /** Staged (unjudged) movement on the same accounts, up to the same date. */
  staged_on_account: Money | null
}

const UNRECONCILED: Reconciliation = {
  known: false,
  note: null,
  statement_closing: null,
  statement_closed_on: null,
  ledger_balance: null,
  drift: null,
  agrees: null,
  staged_on_account: null,
}

export function reconcile(input: ReconcileInput): Reconciliation {
  if (input.accounts.length === 0) {
    return {
      ...UNRECONCILED,
      note: 'this source names no ledger account, so there is nothing to reconcile it against — set one with `bk books source edit --ledger-account`',
    }
  }
  if (input.closing_balance === null || input.closing_on === null) {
    return {
      ...UNRECONCILED,
      note: 'no imported statement has reported a closing balance for this source yet, so the ledger has nothing to be compared with',
    }
  }

  const wanted = new Set(input.accounts)
  const asOf = input.closing_on

  let ledger = 0n
  for (const o of input.openings) {
    if (wanted.has(o.account_no)) ledger += toCentimes(o.amount)
  }

  let staged = 0n
  for (const l of input.lines) {
    if (l.account_no === null || !wanted.has(l.account_no)) continue
    if (l.date > asOf) continue
    const movement = toCentimes(l.debit) - toCentimes(l.credit)
    if (l.status === 'posted') ledger += movement
    else staged += movement
  }

  const closing = toCentimes(input.closing_balance)
  const drift = closing - ledger

  return {
    known: true,
    note: null,
    statement_closing: fromCentimes(closing),
    statement_closed_on: asOf,
    ledger_balance: fromCentimes(ledger),
    drift: fromCentimes(drift),
    agrees: drift === 0n,
    staged_on_account: fromCentimes(staged),
  }
}
