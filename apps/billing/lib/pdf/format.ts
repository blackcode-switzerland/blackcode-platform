// The PRINTED forms of values. Not the payload forms — those are in lib/qr.
//
// Three amount formats coexist on one bill, and mixing any two is a defect
// somebody reading the bill, or a bank, will notice:
//
//   payload   `1590.00`        lib/qr (amountForPayload)
//   printed   `1 590.00`       here — a SPACE as the thousands separator (§3.5.3)
//   on screen `CHF 1 590.00`   lib/derive/format.ts, with a thin space
//
// A plain space here rather than U+2009: the standard says "space", and a
// printed bill is not the place to discover which glyphs an embedded font lacks.

import type { QrAddress } from '@/lib/qr/payload'

export function printAmount(amount: string): string {
  const [whole, frac = '00'] = amount.split('.')
  const neg = whole.startsWith('-')
  const digits = neg ? whole.slice(1) : whole
  let grouped = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ' '
    grouped += digits[i]
  }
  return `${neg ? '-' : ''}${grouped}.${frac.padEnd(2, '0').slice(0, 2)}`
}

/**
 * A structured address as printed lines: name; street and number; postal code
 * and town. The country is printed as a prefix only outside CH and LI (§3.5.4).
 */
export function printAddress(a: QrAddress): string[] {
  const lines = [a.name]
  const street = [a.street, a.building].filter(Boolean).join(' ')
  if (street) lines.push(street)
  const foreign = a.country && a.country !== 'CH' && a.country !== 'LI' ? `${a.country}-` : ''
  const town = `${foreign}${a.postalCode ?? ''} ${a.town ?? ''}`.trim()
  if (town) lines.push(town)
  return lines
}

/** A Postgres date, `2026-10-17`, as `17.10.2026` — by slicing, never through `Date`. */
export function printDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
