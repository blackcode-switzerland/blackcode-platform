// The invoice BODY's words, per document language.
//
// NOT legal text, and not to be confused with `lib/qr/labels.ts`, which holds
// the payment part's fixed headings from the standard's Annex C. These are
// ordinary invoice vocabulary a Swiss business would expect in each language —
// `MWST` in German, `TVA` in French, `IVA` in Italian — and they may be reworded
// when somebody has a better word. `pdf.test.ts` checks every language carries
// every key, which is what stops a French invoice printing a blank.

import type { DocumentLanguage } from '@/types'

export type CopyKey =
  | 'invoice'
  | 'issue_date'
  | 'due_date'
  | 'reference'
  | 'description'
  | 'qty'
  | 'unit'
  | 'unit_price'
  | 'vat'
  | 'amount'
  | 'subtotal'
  | 'vat_on'
  | 'vat_included'
  | 'rounding'
  | 'total'
  | 'vat_number'
  | 'page'
  | 'void'

export const INVOICE_COPY: Readonly<Record<DocumentLanguage, Readonly<Record<CopyKey, string>>>> = {
  fr: {
    invoice: 'Facture',
    issue_date: 'Date',
    due_date: 'Échéance',
    reference: 'Référence',
    description: 'Description',
    qty: 'Qté',
    unit: 'Unité',
    unit_price: 'Prix unitaire',
    vat: 'TVA',
    amount: 'Montant',
    subtotal: 'Sous-total',
    vat_on: 'TVA {rate} % sur {base}',
    vat_included: 'dont TVA {rate} %',
    rounding: 'Arrondi',
    total: 'Total',
    vat_number: 'N° TVA',
    page: 'Page {n} / {of}',
    void: 'ANNULÉE',
  },
  de: {
    invoice: 'Rechnung',
    issue_date: 'Datum',
    due_date: 'Fällig am',
    reference: 'Referenz',
    description: 'Beschreibung',
    qty: 'Menge',
    unit: 'Einheit',
    unit_price: 'Einzelpreis',
    vat: 'MWST',
    amount: 'Betrag',
    subtotal: 'Zwischensumme',
    vat_on: 'MWST {rate} % auf {base}',
    vat_included: 'inkl. MWST {rate} %',
    rounding: 'Rundung',
    total: 'Total',
    vat_number: 'MWST-Nr.',
    page: 'Seite {n} / {of}',
    void: 'STORNIERT',
  },
  it: {
    invoice: 'Fattura',
    issue_date: 'Data',
    due_date: 'Scadenza',
    reference: 'Riferimento',
    description: 'Descrizione',
    qty: 'Qtà',
    unit: 'Unità',
    unit_price: 'Prezzo unitario',
    vat: 'IVA',
    amount: 'Importo',
    subtotal: 'Subtotale',
    vat_on: 'IVA {rate} % su {base}',
    vat_included: 'di cui IVA {rate} %',
    rounding: 'Arrotondamento',
    total: 'Totale',
    vat_number: 'N. IVA',
    page: 'Pagina {n} / {of}',
    void: 'ANNULLATA',
  },
  en: {
    invoice: 'Invoice',
    issue_date: 'Date',
    due_date: 'Due date',
    reference: 'Reference',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit',
    unit_price: 'Unit price',
    vat: 'VAT',
    amount: 'Amount',
    subtotal: 'Subtotal',
    vat_on: 'VAT {rate} % on {base}',
    vat_included: 'incl. VAT {rate} %',
    rounding: 'Rounding',
    total: 'Total',
    vat_number: 'VAT no.',
    page: 'Page {n} / {of}',
    void: 'VOID',
  },
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')
}
