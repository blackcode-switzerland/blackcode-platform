// A second opinion: the maintained `swissqrbill` package (MIT, v4.4.1).
//
// ===========================================================================
// WHY A LIBRARY IS IN A TEST AND NOT ON THE REQUEST PATH
// ===========================================================================
// Decision D-B2: the payload and the rules are ours, because the standard's §6
// checklist is only an acceptance test if we can read what it tests. But two
// independent implementations of the same algorithm are a cheap way to find a
// bug in either: if they disagree on a check digit, one of them is wrong, and
// the vectors in `reference.test.ts` say which.
//
// Deterministic inputs (a fixed-seed generator), so a failure reproduces.
//
// ── ONE RECORDED DISAGREEMENT ──────────────────────────────────────────────
// When line 32 (billing information) is unused and line 33 (an alternative
// procedure) is used, `swissqrbill` drops line 32 and this app keeps it empty.
// The standard does not settle it; `payload.ts`'s header argues the choice. The
// case is asserted below as a disagreement, so a library upgrade that changes
// its answer is noticed.
//
// Watched failing on 2026-09-17: our mod-10 carry table's last two entries
// swapped → the QRR comparison over 500 bodies went red on the first mismatch.
// Restored.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  calculateQRReferenceChecksum,
  calculateSCORReferenceChecksum,
  formatIBAN,
  formatQRReference,
  formatSCORReference,
  isIBANValid,
  isQRIBAN,
} from 'swissqrbill/utils'
import { formatIban, formatQRR, formatSCOR, isQrIban, isValidIban, qrrCheckDigit, refQRR, refSCOR, scorCheckDigits } from './reference'
import { serializeQrPayload, type QrBillFields } from './payload'
import { EXAMPLE_2 } from './spec-examples'

/** mulberry32 — small, deterministic, good enough to spread digits. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DIGITS = '0123456789'
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function randomString(next: () => number, alphabet: string, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(next() * alphabet.length)]
  return s
}

describe('check digits agree with swissqrbill', () => {
  it('QRR, over 500 random 26-digit bodies', () => {
    const next = rng(20260917)
    for (let i = 0; i < 500; i++) {
      const body = randomString(next, DIGITS, 26)
      expect(qrrCheckDigit(body), body).toBe(calculateQRReferenceChecksum(body))
    }
  })

  it('SCOR, over 500 random bodies of 1–21 letters and digits', () => {
    const next = rng(11649)
    for (let i = 0; i < 500; i++) {
      const body = randomString(next, ALNUM, 1 + Math.floor(next() * 21))
      expect(scorCheckDigits(body), body).toBe(calculateSCORReferenceChecksum(body))
    }
  })

  it('IBAN validity and QR-IID detection, over valid and one-digit-corrupted accounts', () => {
    const next = rng(13616)
    const accounts = ['CH4431999123000889012', 'CH6431961000004421557', 'CH5204835012345671000']
    for (const a of [...accounts]) {
      for (let i = 0; i < 20; i++) {
        const pos = 4 + Math.floor(next() * 17)
        const digit = DIGITS[Math.floor(next() * 10)]
        accounts.push(a.slice(0, pos) + digit + a.slice(pos + 1))
      }
    }
    for (const a of accounts) {
      expect(isValidIban(a), a).toBe(isIBANValid(a))
      expect(isQrIban(a), a).toBe(isQRIBAN(a))
    }
  })

  it('printed groupings', () => {
    expect(formatIban('CH4431999123000889012')).toBe(formatIBAN('CH4431999123000889012'))
    expect(formatQRR(refQRR('21000000000313947143000901'))).toBe(formatQRReference('210000000003139471430009017'))
    expect(formatSCOR(refSCOR('539007547034'))).toBe(formatSCORReference('RF18539007547034'))
  })
})

// The payload generator is not in the package's `exports` map, so it is loaded
// by file path from the resolved package directory. If a future version moves
// it, this fails loudly at import, which is the right way for it to fail.
async function libraryPayload(fields: QrBillFields): Promise<string> {
  const require = createRequire(import.meta.url)
  const utils = require.resolve('swissqrbill/utils')
  const esm = join(dirname(utils), '..', '..', 'esm', 'shared', 'qr-code.js')
  const { generateQRData } = await import(pathToFileURL(esm).href)
  const address = (a: NonNullable<QrBillFields['debtor']>) => ({
    name: a.name,
    address: a.street ?? '',
    buildingNumber: a.building ?? undefined,
    zip: a.postalCode ?? '',
    city: a.town ?? '',
    country: a.country ?? '',
  })
  return generateQRData({
    creditor: { ...address(fields.creditor), account: fields.account },
    currency: fields.currency,
    amount: fields.amount === null ? undefined : Number(fields.amount),
    debtor: fields.debtor ? address(fields.debtor) : undefined,
    reference: fields.reference ?? undefined,
    message: fields.unstructuredMessage ?? undefined,
    additionalInformation: fields.billingInformation ?? undefined,
    av1: fields.alternativeProcedures[0],
    av2: fields.alternativeProcedures[1],
  })
}

describe('the payload agrees with swissqrbill', () => {
  it('on Example 2 and on the four shapes this app issues', async () => {
    const shapes: QrBillFields[] = [
      EXAMPLE_2,
      { ...EXAMPLE_2, billingInformation: null, alternativeProcedures: [] },
      { ...EXAMPLE_2, account: 'CH5204835012345671000', referenceType: 'SCOR', reference: 'RF18539007547034', billingInformation: null, alternativeProcedures: [] },
      { ...EXAMPLE_2, account: 'CH5204835012345671000', currency: 'EUR', referenceType: 'SCOR', reference: 'RF18539007547034', billingInformation: null, alternativeProcedures: [] },
      { ...EXAMPLE_2, account: 'CH5204835012345671000', referenceType: 'NON', reference: null, amount: null, debtor: null, billingInformation: null, alternativeProcedures: [] },
    ]
    for (const f of shapes) {
      expect(serializeQrPayload(f, '\n'), `${f.currency}+${f.referenceType}`).toBe(await libraryPayload(f))
    }
  })

  it('DISAGREES, deliberately, when only an alternative procedure is used', async () => {
    const f = { ...EXAMPLE_2, billingInformation: null }
    const ours = serializeQrPayload(f, '\n').split('\n')
    const theirs = (await libraryPayload(f)).split('\n')
    expect(ours).toHaveLength(33) // line 32 kept, empty
    expect(theirs).toHaveLength(32) // line 32 dropped; the procedure sits in its place
  })
})
