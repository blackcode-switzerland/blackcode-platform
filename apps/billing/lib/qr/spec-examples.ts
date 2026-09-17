// The SIX QR-bill guidelines' own examples, as data — for tests.
//
// Table 18 of v2.4 (PDF pages 52–53), "Data example for the QR code with
// additional procedure and billing information". `¶` in the table is CR+LF.
//
// The creditor name is copied from the v2.4 PDF as printed, `Max Muster & Söhne
// (sample company)`. The research extraction in b-mockups dropped the
// parenthesis; the PDF is the authority (docs/billing-app-plan/qr-bill.md,
// "Provenance").
//
// Not imported by anything on a request path.

import type { QrBillFields } from './payload'

export const EXAMPLE_2_LINES: readonly string[] = [
  'SPC',
  '0200',
  '1',
  'CH4431999123000889012',
  'S',
  'Max Muster & Söhne (sample company)',
  'Musterstrasse',
  '123',
  '8000',
  'Seldwyla',
  'CH',
  '', '', '', '', '', '', '',
  '1949.75',
  'CHF',
  'S',
  'Simon Muster',
  'Musterstrasse',
  '1',
  '8000',
  'Seldwyla',
  'CH',
  'QRR',
  '210000000003139471430009017',
  'Order from 15.10.2020',
  'EPD',
  '//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30',
  'eBill/B/simon.muster@example.com',
]

export const EXAMPLE_2: QrBillFields = {
  account: 'CH4431999123000889012',
  creditor: { name: 'Max Muster & Söhne (sample company)', street: 'Musterstrasse', building: '123', postalCode: '8000', town: 'Seldwyla', country: 'CH' },
  amount: '1949.75',
  currency: 'CHF',
  debtor: { name: 'Simon Muster', street: 'Musterstrasse', building: '1', postalCode: '8000', town: 'Seldwyla', country: 'CH' },
  referenceType: 'QRR',
  reference: '210000000003139471430009017',
  unstructuredMessage: 'Order from 15.10.2020',
  billingInformation: '//S1/10/1234/11/201021/30/102673386/32/7.7/40/0:30',
  alternativeProcedures: ['eBill/B/simon.muster@example.com'],
}

