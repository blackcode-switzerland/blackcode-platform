// The Swiss QR Code's module matrix — `qrcode` renders, it does not decide.
//
// §6 of the standard, and the choices this file makes, each one the standard's:
//   - error correction level **M** (§6.1)
//   - **binary** (byte) coding of the UTF-8 payload (§6.2). Forced as one byte
//     segment: left to itself `qrcode` may split a payload into numeric and
//     alphanumeric segments, which is valid ISO 18004 but not what §6.2 states
//   - the **smallest version** that fits (§6.4) — `qrcode`'s default
//   - no ECI marker. The standard does not call for one; the payload's own line 3
//     (`1` = UTF-8) declares the coding. `swissqrbill` adds ECI 26. Whether a
//     banking app decodes a non-ASCII name correctly either way is what the
//     manual scan (qr-bill.md §8, tier 3) exists to find out.
//
// It never sizes anything: scaling to 46 × 46 mm is `payment-part.ts`'s job.

import QRCode from 'qrcode'

export interface QrMatrix {
  size: number
  version: number
  isDark(row: number, col: number): boolean
}

export function qrMatrix(payload: string): QrMatrix {
  const code = QRCode.create([{ data: Buffer.from(payload, 'utf8'), mode: 'byte' }], {
    errorCorrectionLevel: 'M',
  })
  return {
    size: code.modules.size,
    version: code.version,
    isDark: (row, col) => code.modules.get(row, col) === 1,
  }
}
