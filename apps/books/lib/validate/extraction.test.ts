// The revalidator, proven against the worker's real output — then against
// tampered versions of it.
//
// The six seeded pieces are ACTUAL extractions from the OCR spike (the
// Philfruits kiosk receipt and its batch, fetched live from the shared Drive
// folder). They are the honest positive cases: real per-line rounding, a
// real weighed line (0.992 kg of apricots), a real document_type "other".
// Every negative case below is one of them, deliberately damaged — because a
// validator should be shown to catch tampering of documents it accepts, not
// tampering of straw men.

import { describe, it, expect } from 'vitest'
import { validateExtraction, needsReview, structuralRefusal, type Extraction } from './extraction'
import fixture from '../../fixtures/mockup.json'

interface FxPiece {
  id: number
  received: string
  extraction: {
    document_type: string
    multiple_documents?: boolean
    merchant: { name: string }
    tx: { date: string | null; currency: string; total: number }
    lines: { description?: string; amount: number; vat_rate?: number | null }[]
    vat_summary?: { rate: number; gross: number }[]
    confidence: number
    validation: { passed: boolean }
  }
}

const F = fixture as unknown as { PIECE_INBOX: FxPiece[] }

/** The mockup spells `tx`; the schema (and this validator) say `transaction`. */
const normalise = (p: FxPiece): Extraction =>
  ({
    ...p.extraction,
    transaction: p.extraction.tx,
  }) as unknown as Extraction

const receipt = F.PIECE_INBOX.find((p) => p.id === 9601)!

describe('the real extractions', () => {
  it('has six pieces, and their fields are what the schema promises', () => {
    expect(F.PIECE_INBOX.length).toBe(6)
    for (const p of F.PIECE_INBOX) {
      expect(structuralRefusal(normalise(p)), `piece ${p.id}`).toBeNull()
    }
  })

  it('agrees with the worker on every piece it can agree with', () => {
    // The five real receipts pass; 9605 (document_type "other", no lines)
    // fails the sum check — which the WORKER also knew, and which routes to
    // review either way. Agreement here is per-check, not blind.
    for (const p of F.PIECE_INBOX) {
      const v = validateExtraction(normalise(p), p.received)
      if (p.extraction.lines.length > 0) {
        expect(v.passed, `piece ${p.id}: ${v.problems.join('; ')}`).toBe(true)
      } else {
        expect(v.passed, `piece ${p.id} has no lines and cannot pass`).toBe(false)
      }
    }
  })

  it('sums the Philfruits receipt to the rappen, weighed line included', () => {
    const v = validateExtraction(normalise(receipt), receipt.received)
    expect(v.lines_sum_matches_total, '5.80+4.00+5.50+7.45+27.30+29.00 = 79.05').toBe(true)
  })
})

describe('tampering, caught regardless of what the worker claimed', () => {
  it('catches a changed total even when the embedded verdict says passed', () => {
    const tampered = normalise(receipt)
    tampered.transaction = { ...tampered.transaction, total: 790.5 }
    // The worker's own block still says passed — and is read by nothing.
    expect(receipt.extraction.validation.passed).toBe(true)
    const v = validateExtraction(tampered, receipt.received)
    expect(v.passed).toBe(false)
    expect(v.problems.join(' ')).toContain('79.05')
    expect(v.problems.join(' ')).toContain('790.50')
  })

  it('catches a changed line amount', () => {
    const tampered = normalise(receipt)
    tampered.lines = tampered.lines.map((l, i) => (i === 0 ? { ...l, amount: 6.8 } : l))
    expect(validateExtraction(tampered, receipt.received).lines_sum_matches_total).toBe(false)
  })

  it('refuses a VAT rate Switzerland does not have', () => {
    const tampered = normalise(receipt)
    tampered.lines = tampered.lines.map((l, i) => (i === 0 ? { ...l, vat_rate: 7.7 } : l))
    const v = validateExtraction(tampered, receipt.received)
    expect(v.vat_rates_valid, '7.7% was the OLD standard rate; a 2026 receipt cannot carry it').toBe(false)
  })

  it('accepts a line with no VAT rate at all', () => {
    const x = normalise(receipt)
    x.lines = x.lines.map((l) => ({ ...l, vat_rate: null }))
    expect(validateExtraction(x, receipt.received).vat_rates_valid).toBe(true)
  })

  it('rejects a future date and an implausibly old one', () => {
    const future = normalise(receipt)
    future.transaction = { ...future.transaction, date: '2026-09-01' }
    expect(validateExtraction(future, '2026-08-13').date_plausible).toBe(false)

    const ancient = normalise(receipt)
    ancient.transaction = { ...ancient.transaction, date: '2019-01-01' }
    expect(validateExtraction(ancient, '2026-08-13').date_plausible).toBe(false)
  })
})

describe('routing', () => {
  it('sends "other", multi-document scans, and failed validation to review', () => {
    const ok = normalise(receipt)
    const v = validateExtraction(ok, receipt.received)
    expect(needsReview(ok, v)).toBe(false)

    const other = F.PIECE_INBOX.find((p) => p.id === 9605)!
    const xo = normalise(other)
    expect(needsReview(xo, validateExtraction(xo, other.received)), '9605 is document_type other').toBe(true)

    const multi = { ...ok, multiple_documents: true }
    expect(needsReview(multi, v)).toBe(true)
  })
})

describe('the structural gate — the only outright refusal', () => {
  it('names what is missing', () => {
    expect(structuralRefusal(null)).toContain('not an object')
    expect(structuralRefusal({})).toContain('document_type')
    expect(structuralRefusal({ document_type: 'receipt', merchant: {} })).toContain('merchant.name')
    expect(
      structuralRefusal({ document_type: 'receipt', merchant: { name: 'X' }, transaction: { currency: 'CHF' } })
    ).toContain('total')
  })

  it('accepts the mockup spelling tx as well as the schema spelling transaction', () => {
    const p = normalise(receipt) as unknown as Record<string, unknown>
    const asTx: Record<string, unknown> = { ...p, tx: p.transaction }
    delete asTx.transaction
    expect(structuralRefusal(asTx)).toBeNull()
  })
})
