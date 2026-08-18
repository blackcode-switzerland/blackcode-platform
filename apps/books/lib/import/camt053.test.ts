// The camt.053 reader against the golden statement — pure, no database.
//
// The reader's promise is STRICTNESS: everything it returns it fully
// understood, and everything else is a named refusal. Each case below is one
// clause of that promise.

import { describe, it, expect } from 'vitest'
import { parseCamt053, verifyCamt, CamtRefused } from './camt053'
import { GOLDEN, GOLDEN_TRUNCATED } from './golden-camt053'

describe('parseCamt053 on the golden statement', () => {
  const stmt = parseCamt053(GOLDEN)

  it('reads the account, the period and both balances', () => {
    expect(stmt.iban).toBe('CH21 0900 0000 1000 0060 6')
    expect(stmt.from).toBe('2026-08-01')
    expect(stmt.to).toBe('2026-08-17')
    expect(stmt.opening).toBe('10000.00')
    expect(stmt.closing).toBe('12756.25')
    expect(stmt.currency).toBe('CHF')
  })

  it('reads four booked lines and skips the pending one', () => {
    expect(stmt.lines).toHaveLength(4)
    expect(stmt.lines.map((l) => l.ref)).toEqual([
      'ASR-2026-0804-771',
      'ASR-2026-0805-102',
      'ASR-2026-0808-433',
      'ASR-2026-0812-951',
    ])
    expect(stmt.lines.find((l) => l.label.includes('PENDING'))).toBeUndefined()
  })

  it('reads amount, direction, date, narrative and counterparty', () => {
    const rent = stmt.lines[1]
    expect(rent.amount).toBe('1800.00')
    expect(rent.direction).toBe('debit')
    expect(rent.booked).toBe('2026-08-05')
    expect(rent.label).toBe('LOYER AOUT REGIE DUBOIS')
    expect(rent.counterparty).toBe('Régie Dubois')
    // Money in: the counterparty is the DEBTOR.
    expect(stmt.lines[0].direction).toBe('credit')
    expect(stmt.lines[0].counterparty).toBe('Nova Health Sàrl')
  })

  it('reads the fx story when the bank converted, and only then', () => {
    const hetzner = stmt.lines[2]
    expect(hetzner.fx).toEqual({ original: 'EUR 420.00', rate: '0.9494', source: 'camt.053' })
    expect(stmt.lines[1].fx, 'a plain CHF movement carries no fx').toBeNull()
  })

  it('verifies: opening plus lines equals closing, to the rappen', () => {
    expect(verifyCamt(stmt)).toEqual([])
  })
})

describe('the refusals', () => {
  it('refuses a truncated file whole: balances disagree with the lines', () => {
    const stmt = parseCamt053(GOLDEN_TRUNCATED)
    const problems = verifyCamt(stmt)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('12756.25')
    expect(problems[0]).toContain('12800.00')
  })

  it('refuses a file with no closing balance', () => {
    const gutted = GOLDEN.replace('<Cd>CLBD</Cd>', '<Cd>ITBD</Cd>')
    expect(() => parseCamt053(gutted)).toThrow(CamtRefused)
    expect(() => parseCamt053(gutted)).toThrow(/CLBD/)
  })

  it('refuses an entry with no reference — idempotency has no key without one', () => {
    const noRef = GOLDEN.replace('<AcctSvcrRef>ASR-2026-0805-102</AcctSvcrRef>', '').replace(
      '<NtryRef>NR-002</NtryRef>',
      ''
    )
    expect(() => parseCamt053(noRef)).toThrow(/no reference/)
  })

  it('refuses a file where one reference appears twice', () => {
    const doubled = GOLDEN.replace('ASR-2026-0812-951', 'ASR-2026-0808-433')
    expect(() => parseCamt053(doubled)).toThrow(/appears twice/)
  })

  it('refuses more than one statement per file', () => {
    const twoStmts = GOLDEN.replace('</Stmt>', '</Stmt><Stmt></Stmt>')
    expect(() => parseCamt053(twoStmts)).toThrow(/one account's statement at a time/)
  })

  it('refuses a file that is not camt.053 at all', () => {
    expect(() => parseCamt053('{"hello": "world"}')).toThrow(/not a camt\.053/)
  })
})
