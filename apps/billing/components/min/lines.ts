// `desc|qty|unit|price|vat` per line — the CLI's `--item` spelling, so a test
// can use the same line in both front doors. An empty field is omitted, and an
// empty VAT means "no VAT", never 0 (invariant I3).
import type { CreateInvoiceLineBody } from '@/types'

export function parseLines(text: string): CreateInvoiceLineBody[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [description, qty, unit, unit_price, vat_rate] = l.split('|').map((p) => p?.trim() ?? '')
      return {
        description,
        qty: qty || '1',
        unit: unit || null,
        unit_price,
        vat_rate: vat_rate ? vat_rate : null,
      }
    })
}
