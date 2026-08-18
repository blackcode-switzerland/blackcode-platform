// The derivations. Pure functions over rows, and the only place a statement is
// computed.
//
// ===========================================================================
// NOTHING HERE IS EVER STORED
// ===========================================================================
// A balance is a function of the postings, not a column. Store it and you have two
// answers that must agree, kept in agreement by nobody, and the day they diverge
// the wrong one is the one that reaches a filing.
//
// ===========================================================================
// PORTED FROM THE MOCKUP. READ ITS VERSION BEFORE CHANGING THIS ONE.
// ===========================================================================
// Reference: `bbooks/assets/bbooks-data.js` lines 1281-1372 in the `b-mockups`
// repo. `lib/derive/parity.test.ts` asserts this file agrees with it to the
// rappen on every seeded book, so a change here that drifts from it fails.
//
// Four things in the reference are easy to get wrong, and my first draft got three
// of them wrong. All four are load-bearing:
//
//   1. `movement` counts POSTED entries only. Staged ones are money that moved
//      with no agreed meaning; including them would put unexplained figures on a
//      statutory statement.
//
//   2. ONLY CLASS 2 FLIPS SIGN on the bilan. Not 3, not 7. Liabilities and equity
//      grow on the credit side, so debit-minus-credit is negated for them and for
//      nothing else. Classes 3 and 7 are credit-nature too but they live on the
//      compte de résultat, where the flip is done by the line's `sign` instead.
//
//   3. The compte de résultat uses MOVEMENT, never balance. CR accounts have no
//      opening balance: a year of trading starts at zero by definition, which is
//      what closing an exercice means.
//
//   4. `resultat_exercice` is OVERWRITTEN with the CR result, not summed from
//      accounts. The bilan balances BY CONSTRUCTION because the year's profit is
//      injected into equity. Any account mapped to that position is replaced.
//      This is why `bilan.balanced` is a real check and not a tautology: it
//      confirms the postings plus the injected result agree, and it fails when a
//      posting is missing from one side.
//
// ===========================================================================
// MONEY ARITHMETIC IS DONE IN CENTIMES, IN BIGINT
// ===========================================================================
// `numeric(14,2)` arrives from the driver as a STRING. Summing those as JavaScript
// numbers reintroduces exactly the error the column type exists to avoid, and this
// data contains 22333.03 and 2283.03, which is where a float starts to drift.
//
// The reference implementation uses floats, because a mockup can. Here every sum
// converts to integer centimes, accumulates in `bigint`, and formats back to a
// fixed-2 string at the edge. The parity test compares those strings against the
// reference rounded to two places, so this is exact where the reference is merely
// close.

import { BILAN_STRUCTURE, CR_STRUCTURE, type StatementLabel } from '../statements'
import type { Money } from '../types'

/** A posting line, joined to its entry's status. */
export interface PostingLine {
  account_no: string | null
  debit: Money
  credit: Money
  /** `posted` | `staged`. Only posted lines reach a statement. */
  status: string
}

/** An account, enough of it to place a balance on a statement. */
export interface ChartAccount {
  no: string
  class: number
  statement: string
  statement_position: string
}

// ---------------------------------------------------------------------------
// Centimes: the only safe way to add money that arrived as a string
// ---------------------------------------------------------------------------

/**
 * `"1850.00"` -> `185000n`.
 *
 * Parses the decimal string directly rather than through `Number`, so a value at
 * the top of `numeric(14,2)` cannot lose its last rappen to a float.
 */
export function toCentimes(value: Money | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n
  const s = typeof value === 'number' ? value.toFixed(2) : String(value).trim()
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const [whole, frac = ''] = body.split('.')
  const cents = (frac + '00').slice(0, 2)
  const n = BigInt(whole || '0') * 100n + BigInt(cents)
  return neg ? -n : n
}

/** `185000n` -> `"1850.00"`. Always two decimals, so output is comparable. */
export function fromCentimes(c: bigint): Money {
  const neg = c < 0n
  const abs = neg ? -c : c
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// isBalanced
// ---------------------------------------------------------------------------

/**
 * Does this entry's debit total equal its credit total?
 *
 * Exact equality, no tolerance: `numeric(14,2)` is exact, so a tolerance could
 * only hide a real error. The database enforces the same rule in SQL for POSTED
 * rows (migration 0004); this exists for STAGED ones, so a screen can say "this
 * will not post" before somebody presses the button.
 */
export function isBalanced(lines: Pick<PostingLine, 'debit' | 'credit'>[]): boolean {
  let net = 0n
  for (const l of lines) net += toCentimes(l.debit) - toCentimes(l.credit)
  return net === 0n
}

// ---------------------------------------------------------------------------
// movement and balance
// ---------------------------------------------------------------------------

/**
 * Net movement on one account, debit-positive, POSTED lines only.
 *
 * Whether that reads as an increase depends on the account class, and that is
 * `accountBalance`'s job rather than this one's.
 */
export function movement(lines: PostingLine[], accountNo: string): bigint {
  let net = 0n
  for (const l of lines) {
    if (l.status !== 'posted') continue
    if (l.account_no !== accountNo) continue
    net += toCentimes(l.debit) - toCentimes(l.credit)
  }
  return net
}

/**
 * Closing balance of one BILAN account: opening plus movement, class 2 negated.
 *
 * Only class 2. See note 2 in the header before adding another class here.
 */
export function accountBalance(
  lines: PostingLine[],
  account: ChartAccount,
  openingCentimes: bigint
): bigint {
  const mov = movement(lines, account.no)
  return account.class === 2 ? openingCentimes - mov : openingCentimes + mov
}

// ---------------------------------------------------------------------------
// Compte de résultat, art. 959b
// ---------------------------------------------------------------------------

export interface CrLine {
  pos: string
  sign: number
  amount: Money
  accounts: string[]
}

export interface CrResult {
  lines: CrLine[]
  resultat: Money
}

/**
 * Profit and loss by nature.
 *
 * Every legal line is emitted, including the ones that come to zero: a
 * zero-balance statutory line still legally exists and is only ever collapsed
 * visually, never dropped from the model.
 *
 * `sign` is +1 for a produit and -1 for a charge. A produit's amount is the
 * NEGATED movement, because a revenue account carries a credit balance and the
 * statement prints it positive.
 */
export function crFor(lines: PostingLine[], accounts: ChartAccount[]): CrResult {
  const out: CrLine[] = []
  let resultat = 0n

  for (const row of CR_STRUCTURE) {
    const accs = accounts.filter((a) => a.statement === 'cr' && a.statement_position === row.pos)
    let amount = 0n
    for (const a of accs) {
      const mov = movement(lines, a.no)
      amount += row.sign === 1 ? -mov : mov
    }
    out.push({
      pos: row.pos,
      sign: row.sign,
      amount: fromCentimes(amount),
      accounts: accs.map((a) => a.no),
    })
    resultat += row.sign === 1 ? amount : -amount
  }

  return { lines: out, resultat: fromCentimes(resultat) }
}

// ---------------------------------------------------------------------------
// Bilan, art. 959a
// ---------------------------------------------------------------------------

export interface BilanLine {
  pos: string
  /** art. 959a al. 4: shown separately, and still counted in the total. */
  related: boolean
  amount: Money
}

export interface BilanGroup {
  /**
   * The bilingual statutory group heading, carried through rather than flattened.
   * The filed PDF reproduces the French wording, so the renderer must receive both
   * halves instead of a language this layer picked for it.
   */
  group: StatementLabel
  side: 'actif' | 'passif'
  lines: BilanLine[]
}

export interface BilanResult {
  groups: BilanGroup[]
  totalActif: Money
  totalPassif: Money
  resultat: Money
  /** Exact equality of the two sides. The most important boolean in this app. */
  balanced: boolean
  /** Signed difference, so a failure says by how much rather than only "no". */
  ecart: Money
}

/**
 * The balance sheet.
 *
 * `openings` maps account number to opening balance in centimes. **A missing entry
 * means zero and is normal**: the mockup's `OPENING` covers two of its three books
 * and the sole proprietorship has none at all.
 *
 * The result of the exercice is injected into `resultat_exercice`, replacing
 * anything mapped there. See note 4 in the header for why that makes `balanced`
 * meaningful rather than circular.
 */
export function bilanFor(
  lines: PostingLine[],
  accounts: ChartAccount[],
  openings: Map<string, bigint>
): BilanResult {
  const resultat = toCentimes(crFor(lines, accounts).resultat)

  const posSum = new Map<string, bigint>()
  for (const a of accounts) {
    if (a.statement !== 'bilan') continue
    const bal = accountBalance(lines, a, openings.get(a.no) ?? 0n)
    posSum.set(a.statement_position, (posSum.get(a.statement_position) ?? 0n) + bal)
  }
  posSum.set('resultat_exercice', resultat)

  const groups: BilanGroup[] = BILAN_STRUCTURE.map((g) => ({
    group: g.group,
    side: g.side,
    lines: g.lines.map((l) => ({
      pos: l.pos,
      related: !!l.related,
      amount: fromCentimes(posSum.get(l.pos) ?? 0n),
    })),
  }))

  const sideTotal = (side: string): bigint => {
    let t = 0n
    for (const g of BILAN_STRUCTURE) {
      if (g.side !== side) continue
      for (const l of g.lines) t += posSum.get(l.pos) ?? 0n
    }
    return t
  }

  const actif = sideTotal('actif')
  const passif = sideTotal('passif')

  return {
    groups,
    totalActif: fromCentimes(actif),
    totalPassif: fromCentimes(passif),
    resultat: fromCentimes(resultat),
    balanced: actif === passif,
    ecart: fromCentimes(actif - passif),
  }
}

// ---------------------------------------------------------------------------
// The single-entry book, art. 957 al. 2
// ---------------------------------------------------------------------------

export interface RiRow {
  direction: string
  amount: Money
}

export interface RiTotals {
  recettes: Money
  depenses: Money
  /** Recettes minus dépenses. A CASH result, not a profit. */
  resultat: Money
}

/**
 * Totals for a recettes/dépenses book.
 *
 * Deliberately not named as a profit. Art. 957 al. 2 bookkeeping is cash movement
 * with no accruals and no depreciation, so calling the bottom line `benefice`
 * would invite it onto a document where it would be read as something it is not.
 *
 * There is no bilan here, ever. A sole proprietorship's counterpart is the
 * patrimoine statement.
 */
export function riTotals(rows: RiRow[]): RiTotals {
  let recettes = 0n
  let depenses = 0n
  for (const r of rows) {
    if (r.direction === 'recette') recettes += toCentimes(r.amount)
    else depenses += toCentimes(r.amount)
  }
  return {
    recettes: fromCentimes(recettes),
    depenses: fromCentimes(depenses),
    resultat: fromCentimes(recettes - depenses),
  }
}

/** Net worth from a patrimoine snapshot's items. */
export function patrimoineTotal(items: { amount: Money | number }[]): Money {
  let total = 0n
  for (const i of items) total += toCentimes(i.amount)
  return fromCentimes(total)
}
