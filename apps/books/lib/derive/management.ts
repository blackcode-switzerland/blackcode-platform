// Phase 4B derivations: monthly flows, the cost breakdown, the VAT position
// and the two PM tax estimates. NOTHING HERE IS EVER STORED — index.ts's rule.
//
// ===========================================================================
// PORTED FROM THE MOCKUP. READ ITS VERSION BEFORE CHANGING THIS ONE.
// ===========================================================================
// Reference: `bbooks/assets/bbooks-data.js` — monthlyFlows (l.392),
// costBreakdownFor (l.421), pmProfitTax (l.1272), pmCapitalTax (l.1289),
// vatPosition (l.1443) in the `b-mockups` repo.
//
// Money that comes from POSTINGS is summed in centimes, in bigint, exactly as
// index.ts does it: flows, breakdowns and the VAT position are books figures
// and must agree with the statements to the rappen.
//
// The two TAX functions are different, deliberately: they are ESTIMATES of a
// position, never postings — a statutory rate times a profit, with a
// coefficient stack (8.5% + 3 1/3% × 232%) that has no exact centime
// representation. They compute in floats like the reference and round to two
// places at the edge, and their outputs go on a snapshot marked with the
// parameters' `confirmed` flags, never into an entry.
//
// One thing the reference could not have: the exercice boundary. Its "YTD"
// filtered on a string year prefix (dev-handoff OPEN-DECISIONS #B2). Here the
// CALLER scopes lines to an exercice before handing them over — the same
// contract as crFor/bilanFor — so a metric cannot mix two years by
// construction.

import { toCentimes, fromCentimes, type ChartAccount, type PostingLine } from './index'
import type { Money } from '../types'

// ---------------------------------------------------------------------------
// Monthly flows
// ---------------------------------------------------------------------------

/** A posting line that also knows WHEN — flows bucket by month. */
export interface DatedLine extends PostingLine {
  /** The entry's date, `YYYY-MM-DD`. */
  date: string
}

export interface MonthlyFlow {
  /** `YYYY-MM`. */
  month: string
  produits: Money
  charges: Money
}

/**
 * Monthly produits/charges from POSTED lines, CR accounts only. Months with no
 * actual écritures are absent, not zero — the honest series: unposted backlog
 * is invisible here, which is exactly why the recognition worklist matters.
 *
 * Class 3 is produits (credit-nature: credit − debit); every other CR class
 * reads as charges (debit − credit). That is the reference's rule, kept.
 */
export function monthlyFlows(lines: DatedLine[], accounts: ChartAccount[]): MonthlyFlow[] {
  const byNo = new Map(accounts.map((a) => [a.no, a]))
  const m = new Map<string, { produits: bigint; charges: bigint }>()
  for (const l of lines) {
    if (l.status !== 'posted' || l.account_no === null) continue
    const a = byNo.get(l.account_no)
    if (!a || a.statement !== 'cr') continue
    const month = l.date.slice(0, 7)
    const row = m.get(month) ?? { produits: 0n, charges: 0n }
    if (a.class === 3) row.produits += toCentimes(l.credit) - toCentimes(l.debit)
    else row.charges += toCentimes(l.debit) - toCentimes(l.credit)
    m.set(month, row)
  }
  return [...m.keys()]
    .sort()
    .map((k) => ({ month: k, ...m.get(k)! }))
    .filter((r) => r.produits !== 0n || r.charges !== 0n)
    .map((r) => ({ month: r.month, produits: fromCentimes(r.produits), charges: fromCentimes(r.charges) }))
}

/** The simplified book's flows: recettes are produits, dépenses are charges, neutral is neither. */
export function monthlyFlowsRi(rows: { date: string; direction: string; amount: Money }[]): MonthlyFlow[] {
  const m = new Map<string, { produits: bigint; charges: bigint }>()
  for (const r of rows) {
    const month = r.date.slice(0, 7)
    const row = m.get(month) ?? { produits: 0n, charges: 0n }
    if (r.direction === 'recette') row.produits += toCentimes(r.amount)
    else if (r.direction === 'depense') row.charges += toCentimes(r.amount)
    // 'neutral' and anything unknown: in the book, absent from both. index.ts's riTotals rule.
    m.set(month, row)
  }
  return [...m.keys()]
    .sort()
    .map((k) => ({ month: k, ...m.get(k)! }))
    .filter((r) => r.produits !== 0n || r.charges !== 0n)
    .map((r) => ({ month: r.month, produits: fromCentimes(r.produits), charges: fromCentimes(r.charges) }))
}

// ---------------------------------------------------------------------------
// Cost breakdown per management category
// ---------------------------------------------------------------------------

export interface BreakdownInputLine extends DatedLine {
  /** The entry's counterparty, falling back to its raw label — a bar opens into names. */
  counterparty: string
  /** The entry's workspace #number, so a line links back to its écriture. */
  entry_number: number
}

export interface CategoryLine {
  number: number
  date: string
  counterparty: string
  amount: Money
  account: string
}

export interface CategoryBreakdown {
  key: string
  label: unknown
  accounts: string[] | null
  amount: Money
  lines: CategoryLine[]
}

/**
 * Charge breakdown per management category, carrying the underlying ledger
 * lines so every bar can open into its counterparties. POSTED lines only;
 * amount is debit − credit (a credit note reduces its category, honestly).
 * Zero-movement lines are dropped; a category with nothing keeps its row at
 * zero — the set of categories is configuration, not data.
 */
export function costBreakdown(
  categories: { key: string; label: unknown; accounts: string[] }[],
  lines: BreakdownInputLine[]
): CategoryBreakdown[] {
  return categories.map((c) => {
    const out: (CategoryLine & { cents: bigint })[] = []
    for (const l of lines) {
      if (l.status !== 'posted' || l.account_no === null) continue
      if (!c.accounts.includes(l.account_no)) continue
      const cents = toCentimes(l.debit) - toCentimes(l.credit)
      if (cents === 0n) continue
      out.push({
        number: l.entry_number,
        date: l.date,
        counterparty: l.counterparty,
        amount: fromCentimes(cents),
        account: l.account_no,
        cents,
      })
    }
    out.sort((a, b) => (b.cents === a.cents ? 0 : b.cents > a.cents ? 1 : -1))
    const total = out.reduce((s, l) => s + l.cents, 0n)
    return {
      key: c.key,
      label: c.label,
      accounts: c.accounts,
      amount: fromCentimes(total),
      lines: out.map(({ cents: _cents, ...rest }) => rest),
    }
  })
}

/**
 * The simplified book's breakdown: dépenses grouped by the entry's OWN
 * category label (RI entries carry one; accounts do not exist there). An
 * uncategorized dépense lands under a named "Sans catégorie" bucket rather
 * than vanishing — the total must still be the total.
 */
export function costBreakdownRi(
  rows: {
    seq: number
    date: string
    direction: string
    amount: Money
    counterparty: string | null
    raw_label: string
    category: unknown
  }[]
): CategoryBreakdown[] {
  const g = new Map<string, CategoryBreakdown & { cents: bigint }>()
  for (const r of rows) {
    if (r.direction !== 'depense') continue
    const cat = r.category as { fr?: string } | null
    const key = cat?.fr ?? '__none'
    const row =
      g.get(key) ??
      ({
        key,
        label: r.category ?? { fr: 'Sans catégorie', en: 'Uncategorized' },
        accounts: null,
        amount: '0.00',
        lines: [],
        cents: 0n,
      } as CategoryBreakdown & { cents: bigint })
    row.cents += toCentimes(r.amount)
    row.lines.push({
      number: r.seq,
      date: r.date,
      counterparty: r.counterparty ?? r.raw_label,
      amount: r.amount,
      account: '',
    })
    g.set(key, row)
  }
  return [...g.values()]
    .sort((a, b) => (b.cents === a.cents ? 0 : b.cents > a.cents ? 1 : -1))
    .map(({ cents, ...row }) => ({ ...row, amount: fromCentimes(cents) }))
}

// ---------------------------------------------------------------------------
// VAT position — exact, from the entries' TVA columns
// ---------------------------------------------------------------------------

export interface VatEntry {
  status: string
  tva_amount: Money | null
  tva_input_claimed: boolean
  /** Does a line credit the revenue account 3400? Output VAT rides on revenue. */
  credits_revenue: boolean
}

export interface VatPosition {
  opening_due: Money
  output_ytd: Money
  input_claimed_ytd: Money
  net_due: Money
}

/**
 * VAT position: output VAT on posted revenue entries, minus input VAT actually
 * CLAIMED (`tva_input_claimed`, the column a CHECK ties to full evidence —
 * art. 26 LTVA), on top of the opening balance of the TVA-due account (2200).
 */
export function vatPosition(opening2200: bigint, entries: VatEntry[]): VatPosition {
  let output = 0n
  let input = 0n
  for (const e of entries) {
    if (e.status !== 'posted') continue
    const tva = toCentimes(e.tva_amount)
    if (tva === 0n) continue
    if (e.credits_revenue) output += tva
    else if (e.tva_input_claimed) input += tva
  }
  return {
    opening_due: fromCentimes(opening2200),
    output_ytd: fromCentimes(output),
    input_claimed_ytd: fromCentimes(input),
    net_due: fromCentimes(opening2200 + output - input),
  }
}

// ---------------------------------------------------------------------------
// PM tax estimates — floats, on purpose; see the header
// ---------------------------------------------------------------------------

/** The `params` jsonb of books.tax_params. Citations ride along, uninterpreted. */
export interface TaxParams {
  ifd: { rate_pct: number }
  cantonal: { base_rate_pct: number; coefficient_pct: number }
  communal: { coefficient_pct: number }
  capital_tax: { base_rate_permille: number }
}

export interface ProfitTax {
  cantonal: Money
  communal: Money
  ifd: Money
  total: Money
  statutory_pct: number
  effective_pct: number
}

const round2 = (n: number): Money => (Math.round(n * 100) / 100).toFixed(2)

/**
 * PM profit-tax estimate. Statutory combined = IFD + base × (cantonal +
 * communal coefficients); taxes are deductible, so the EFFECTIVE pre-tax rate
 * is s/(1+s). A loss computes as zero, not as a refund.
 */
export function pmProfitTax(profitCentimes: bigint, p: TaxParams): ProfitTax {
  const profit = Math.max(0, Number(profitCentimes) / 100)
  const base = profit * (p.cantonal.base_rate_pct / 100)
  const cantonal = base * (p.cantonal.coefficient_pct / 100)
  const communal = base * (p.communal.coefficient_pct / 100)
  const ifd = profit * (p.ifd.rate_pct / 100)
  const statutoryPct =
    p.ifd.rate_pct + p.cantonal.base_rate_pct * ((p.cantonal.coefficient_pct + p.communal.coefficient_pct) / 100)
  const effectivePct = statutoryPct / (1 + statutoryPct / 100)
  return {
    cantonal: round2(cantonal),
    communal: round2(communal),
    ifd: round2(ifd),
    total: round2(cantonal + communal + ifd),
    statutory_pct: Math.round(statutoryPct * 100) / 100,
    effective_pct: Math.round(effectivePct * 100) / 100,
  }
}

export interface CapitalTax {
  gross: Money
  credited: Money
  net_due: Money
}

/**
 * Capital-tax estimate with the art. 118 LI-VD imputation shown, not hidden:
 * `gross` is the 0.6‰ of book equity, `credited` is the cantonal+communal
 * profit tax counted against it, `net_due` is what remains — it only bites in
 * loss or low-profit years. Whether the imputation applies exactly this way is
 * the parameters' OPEN QUESTION (capital_tax.confirmed stays false until the
 * fiduciary answers — decided with Mustneer 2026-08-19); serving all three
 * figures is what lets a reader apply either reading.
 */
export function pmCapitalTax(equityCentimes: bigint, cantCommProfitTax: number, p: TaxParams): CapitalTax {
  const equity = Math.max(0, Number(equityCentimes) / 100)
  const gross = equity * (p.capital_tax.base_rate_permille / 1000)
  const credited = Math.min(gross, cantCommProfitTax)
  return { gross: round2(gross), credited: round2(credited), net_due: round2(Math.max(0, gross - credited)) }
}
