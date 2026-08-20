// The bank reconciliation, pinned on the case that produced it.
import { describe, it, expect } from 'vitest'
import { reconcile } from './reconcile'

describe('reconcile', () => {
  const APRIL = {
    accounts: ['1020'],
    closing_balance: '17030.00',
    closing_on: '2026-04-30',
    openings: [{ account_no: '1020', amount: '12000.00' }],
  }

  // Boulangerie Grand-Pont, 2026-04: the four bank movements reach the CLBD
  // exactly, which is what the import already checked.
  const BANK = [
    { account_no: '1020', debit: '0.00', credit: '2400.00', date: '2026-04-05', status: 'posted' },
    { account_no: '1020', debit: '0.00', credit: '1850.00', date: '2026-04-09', status: 'posted' },
    { account_no: '1020', debit: '9600.00', credit: '0.00', date: '2026-04-15', status: 'posted' },
    { account_no: '1020', debit: '0.00', credit: '320.00', date: '2026-04-22', status: 'posted' },
  ]

  it('agrees when the ledger holds exactly what the bank delivered', () => {
    const r = reconcile({ ...APRIL, lines: BANK })
    expect(r.known).toBe(true)
    expect(r.ledger_balance).toBe('17030.00')
    expect(r.drift).toBe('0.00')
    expect(r.agrees).toBe(true)
  })

  // The measured case: payroll declared and posted, not on the statement.
  it('reports the drift a payment the bank has not seen produces', () => {
    const r = reconcile({
      ...APRIL,
      lines: [
        ...BANK,
        { account_no: '1020', debit: '0.00', credit: '7065.00', date: '2026-04-30', status: 'posted' },
      ],
    })
    expect(r.ledger_balance).toBe('9965.00')
    expect(r.drift).toBe('7065.00')
    expect(r.agrees).toBe(false)
  })

  it('reads the ledger at the statement date, not today', () => {
    const r = reconcile({
      ...APRIL,
      lines: [
        ...BANK,
        // May money. The bank closed in April and cannot have seen it.
        { account_no: '1020', debit: '5000.00', credit: '0.00', date: '2026-05-02', status: 'posted' },
      ],
    })
    expect(r.agrees, 'a later movement is not a drift').toBe(true)
  })

  it('excludes staged money from the balance and reports it separately', () => {
    const r = reconcile({
      ...APRIL,
      lines: [
        ...BANK,
        { account_no: '1020', debit: '0.00', credit: '500.00', date: '2026-04-28', status: 'staged' },
      ],
    })
    expect(r.ledger_balance, 'staged money is money nobody has judged').toBe('17030.00')
    expect(r.staged_on_account).toBe('-500.00')
    expect(r.agrees).toBe(true)
  })

  it('ignores accounts this source does not feed', () => {
    const r = reconcile({
      ...APRIL,
      lines: [...BANK, { account_no: '1000', debit: '800.00', credit: '0.00', date: '2026-04-10', status: 'posted' }],
    })
    expect(r.agrees).toBe(true)
  })

  // An unknown must never read as an agreement — 0005's Finding #16 applied to
  // a number instead of a permission.
  it('an unknown closing balance is not a drift of zero', () => {
    const r = reconcile({ accounts: ['1020'], closing_balance: null, closing_on: null, openings: [], lines: [] })
    expect(r.known).toBe(false)
    expect(r.drift).toBeNull()
    expect(r.agrees).toBeNull()
    expect(r.note).toMatch(/no imported statement/)
  })

  it('a source naming no ledger account says so, rather than reconciling to zero', () => {
    const r = reconcile({ accounts: [], closing_balance: '10.00', closing_on: '2026-04-30', openings: [], lines: [] })
    expect(r.known).toBe(false)
    expect(r.note).toMatch(/names no ledger account/)
  })
})
