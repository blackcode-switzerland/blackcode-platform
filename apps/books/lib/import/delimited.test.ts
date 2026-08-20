// The delimited reader, against the Yapeal-shaped export the spec names.
import { describe, it, expect } from 'vitest'
import { parseDelimited, splitRow, DelimitedRefused, type DelimitedMapping } from './delimited'
import { verifyCamt } from './camt053'

const YAPEAL: DelimitedMapping = {
  delimiter: ',',
  header: true,
  columns: { date: 'Date', label: 'Merchant', amount: 'Amount', counterparty: 'Merchant' },
  date_format: 'YYYY-MM-DD',
  decimal: '.',
  positive_means: 'credit',
}

const FILE = `Date,Merchant,Amount,Currency,Card
2026-06-02,MIGROS SION GARE,-84.20,CHF,6474
2026-06-09,COOP SION CENTRE,-46.55,CHF,6474
2026-06-17,SUMUP*FROID-SERVICE,-120.00,CHF,6474
2026-06-24,GALAXUS.CH,-189.90,CHF,6474`

const BAL = { opening: '0.00', closing: '-440.65' }

describe('splitRow', () => {
  it('honours quotes, doubled quotes and embedded delimiters', () => {
    expect(splitRow('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
    expect(splitRow('a,"say ""hi""",c', ',')).toEqual(['a', 'say "hi"', 'c'])
    expect(splitRow('a\t b \tc', '\t')).toEqual(['a', 'b', 'c'])
  })
})

describe('parseDelimited', () => {
  it('reads the card export into the shape camt.053 produces', () => {
    const s = parseDelimited(FILE, YAPEAL, BAL, 'src4')
    expect(s.lines).toHaveLength(4)
    expect(s.currency).toBe('CHF')
    expect(s.from).toBe('2026-06-02')
    expect(s.to).toBe('2026-06-24')
    expect(s.lines[0]).toMatchObject({
      amount: '84.20',
      direction: 'debit',
      booked: '2026-06-02',
      label: 'MIGROS SION GARE',
      counterparty: 'MIGROS SION GARE',
    })
  })

  // The whole point of requiring the balances: the same check camt gets.
  it('the declared balances reconcile against the lines', () => {
    expect(verifyCamt(parseDelimited(FILE, YAPEAL, BAL, 'src4'))).toEqual([])
  })

  it('a wrong closing balance is refused by the same arithmetic that guards camt', () => {
    const s = parseDelimited(FILE, YAPEAL, { opening: '0.00', closing: '-400.00' }, 'src4')
    expect(verifyCamt(s).length).toBeGreaterThan(0)
  })

  // A statement of CHARGES writes purchases positive. Getting this backwards
  // inverts every line, and the reconciliation is what catches it.
  it('positive_means flips the direction of every line', () => {
    const charges = parseDelimited(
      FILE.replace(/,-/g, ','),
      { ...YAPEAL, positive_means: 'debit' },
      BAL,
      'src4'
    )
    expect(charges.lines.every((l) => l.direction === 'debit')).toBe(true)
    expect(verifyCamt(charges)).toEqual([])
  })

  it('reads a debit/credit pair, Swiss decimals and thousands separators', () => {
    const m: DelimitedMapping = {
      delimiter: ';',
      header: true,
      columns: { date: 'Datum', label: 'Text', debit: 'Belastung', credit: 'Gutschrift' },
      date_format: 'DD.MM.YYYY',
      decimal: ',',
      thousands: "'",
      positive_means: 'credit',
    }
    const s = parseDelimited(
      `Datum;Text;Belastung;Gutschrift\n02.06.2026;MIETE;1'250,00;\n15.06.2026;ZAHLUNG;;2'000,50`,
      m,
      { opening: '0.00', closing: '750.50' },
      'src9'
    )
    expect(s.lines[0]).toMatchObject({ amount: '1250.00', direction: 'debit', booked: '2026-06-02' })
    expect(s.lines[1]).toMatchObject({ amount: '2000.50', direction: 'credit' })
    expect(verifyCamt(s)).toEqual([])
  })

  it('parentheses are the accounting negative', () => {
    const s = parseDelimited(
      `Date,Merchant,Amount\n2026-06-02,X,(84.20)`,
      YAPEAL,
      { opening: '0.00', closing: '-84.20' },
      'src4'
    )
    expect(s.lines[0]).toMatchObject({ amount: '84.20', direction: 'debit' })
  })

  // Whole file or nothing: one unreadable row refuses the import, it does not
  // skip the row and book the rest.
  it('refuses the whole file when a row cannot be read, naming the row', () => {
    const bad = FILE.replace('2026-06-09', '09.06.2026')
    expect(() => parseDelimited(bad, YAPEAL, BAL, 'src4')).toThrow(DelimitedRefused)
    try {
      parseDelimited(bad, YAPEAL, BAL, 'src4')
    } catch (e) {
      expect((e as DelimitedRefused).problems[0]).toMatch(/row 3/)
    }
  })

  it('refuses a date that parses but is not a day', () => {
    const bad = FILE.replace('2026-06-02', '2026-13-45')
    expect(() => parseDelimited(bad, YAPEAL, BAL, 'src4')).toThrow(/cannot read/)
  })

  it('refuses a mapping whose columns are not in the header, and says what is', () => {
    const m = { ...YAPEAL, columns: { ...YAPEAL.columns, date: 'Datum' } }
    try {
      parseDelimited(FILE, m, BAL, 'src4')
      throw new Error('should have refused')
    } catch (e) {
      expect((e as DelimitedRefused).code).toBe('mapping_does_not_fit')
      expect((e as DelimitedRefused).problems[0]).toContain('Merchant')
    }
  })

  it('refuses a mapping that names both an amount and a debit/credit pair', () => {
    const m = { ...YAPEAL, columns: { ...YAPEAL.columns, debit: 'Amount' } }
    expect(() => parseDelimited(FILE, m, BAL, 'src4')).toThrow(/never both/)
  })

  // The per-row reason rides on `problems`, not on the message: the message
  // says the file was refused, the problems say why, row by row.
  it('refuses a zero-franc row and a row with no narrative', () => {
    const why = (text: string) => {
      try {
        parseDelimited(text, YAPEAL, BAL, 'src4')
        throw new Error('should have refused')
      } catch (e) {
        return (e as DelimitedRefused).problems.join(' ')
      }
    }
    expect(why(`Date,Merchant,Amount\n2026-06-02,X,0.00`)).toMatch(/zero-franc/)
    expect(why(`Date,Merchant,Amount\n2026-06-02,,-5.00`)).toMatch(/no narrative/)
  })
})

describe('synthesized line references', () => {
  it('are stable, so re-importing the same file converges', () => {
    const a = parseDelimited(FILE, YAPEAL, BAL, 'src4')
    const b = parseDelimited(FILE, YAPEAL, BAL, 'src4')
    expect(a.lines.map((l) => l.ref)).toEqual(b.lines.map((l) => l.ref))
  })

  it('differ per source, so two cards cannot collide', () => {
    const a = parseDelimited(FILE, YAPEAL, BAL, 'src4')
    const b = parseDelimited(FILE, YAPEAL, BAL, 'src7')
    expect(a.lines[0].ref).not.toBe(b.lines[0].ref)
  })

  // The occurrence counter. Two identical coffees on one day are two
  // movements; without it the second import would collapse them into one.
  it('keep two identical charges on the same day apart', () => {
    const twice = `Date,Merchant,Amount\n2026-06-02,CAFE,-4.50\n2026-06-02,CAFE,-4.50`
    const s = parseDelimited(twice, YAPEAL, { opening: '0.00', closing: '-9.00' }, 'src4')
    expect(s.lines).toHaveLength(2)
    expect(s.lines[0].ref).not.toBe(s.lines[1].ref)
    expect(verifyCamt(s)).toEqual([])
  })

  it('are marked as synthesized, never mistakable for a bank reference', () => {
    const s = parseDelimited(FILE, YAPEAL, BAL, 'src4')
    expect(s.lines.every((l) => l.ref.startsWith('csv:'))).toBe(true)
  })

  it("use the issuer's own reference when the file carries one", () => {
    const m = { ...YAPEAL, columns: { ...YAPEAL.columns, ref: 'Card' } }
    const s = parseDelimited(FILE, m, BAL, 'src4')
    expect(s.lines[0].ref).toBe('6474')
  })
})
