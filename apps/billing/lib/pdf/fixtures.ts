// A complete invoice and company, for rendering in tests and in the byte-stability
// script. Not imported by anything on a request path.
//
// Chosen to exercise the cases that differ: prices EXCLUDING VAT, one taxable
// line and one exempt line (so the VAT column has both spellings), a quantity
// with decimals, a client with a full structured address, and a QR-IBAN with a
// QR reference — the shape whose payment part carries the most.

import type { Invoice } from '@/types'
import type { PdfCompany } from './invoice'

export const sampleCompany: PdfCompany = {
  name: 'Blackcode',
  legal_name: 'Blackcode Sàrl',
  street: 'Rue du Marché',
  building: '12',
  postal_code: '1204',
  city: 'Genève',
  country: 'CH',
  email: 'facturation@blackcode.ch',
  iban: 'CH5204835012345671000',
  qr_iban: 'CH4431999123000889012',
  uid: 'CHE-123.456.789',
  vat_registered: true,
  vat_number: 'CHE-123.456.789 TVA',
  footer_fr: 'Conditions de paiement : 30 jours net. Merci de votre confiance.',
  footer_en: 'Payment terms: 30 days net. Thank you for your business.',
}

export function sampleInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    seq: 7,
    company: 'blackcode',
    number: 'BC-2026-0007',
    seq_no: 7,
    status: 'draft',
    issue_date: '2026-09-17',
    due_date: '2026-10-17',
    paid_date: null,
    currency: 'CHF',
    language: 'fr',
    ref_type: 'QRR',
    ref_body: '00000000000000000100000007',
    client: {
      name: 'Junod SA',
      street: 'Avenue de la Gare',
      building: '3',
      postal_code: '1003',
      city: 'Lausanne',
      country: 'CH',
    },
    vat_rate: '8.10',
    prices_include_vat: false,
    message: 'Facture BC-2026-0007, mandat de septembre',
    void: null,
    sent_at: null,
    sent_message_id: null,
    pdf_sha256: null,
    items: [
      { line_no: 1, description: 'Développement, septembre 2026', qty: '12.500', unit: 'jours', unit_price: '1200.00', vat_rate: '8.10', line_total: '15000.00' },
      { line_no: 2, description: 'Frais de déplacement (exonérés)', qty: '1.000', unit: null, unit_price: '240.00', vat_rate: null, line_total: '240.00' },
    ],
    totals: {
      subtotal: '15240.00',
      vat: [{ rate: '8.10', base: '15000.00', amount: '1215.00' }],
      vat_total: '1215.00',
      rounding: '0.00',
      total: '16455.00',
    },
    external_ref: null,
    metadata: {},
    ...over,
  } as Invoice
}
