// Annex C, Table 23 (v2.4 PDF page 62), transcribed a second time and compared.
//
// This catches an accidental edit to `labels.ts`. It cannot catch a mistake made
// identically in both transcriptions — check against the PDF page for that.
//
// Watched failing on 2026-09-17: `Konto / Zahlbar an` reworded to
// `Konto / zahlbar an` in labels.ts → named the key and the language. Restored.
import { describe, expect, it } from 'vitest'
import { QR_LABELS, QR_LANGUAGES, qrLabels, type QrLabelKey } from './labels'

// Columns: German, French, Italian, English, Romansh — the PDF's own order.
const ANNEX_C: Record<QrLabelKey, [string, string, string, string, string]> = {
  payment_part: ['Zahlteil', 'Section paiement', 'Sezione pagamento', 'Payment part', 'Part da pajament'],
  receipt: ['Empfangsschein', 'Récépissé', 'Ricevuta', 'Receipt', 'Quittanza'],
  account_payable_to: ['Konto / Zahlbar an', 'Compte / Payable à', 'Conto / Pagabile a', 'Account / Payable to', 'Conto / Da pajar a'],
  reference: ['Referenz', 'Référence', 'Riferimento', 'Reference', 'Referenza'],
  additional_information: ['Zusätzliche Informationen', 'Informations supplémentaires', 'Informazioni supplementari', 'Additional information', 'Infurmaziuns supplementaras'],
  payable_by: ['Zahlbar durch', 'Payable par', 'Pagabile da', 'Payable by', 'Da pajar da'],
  payable_by_name_address: ['Zahlbar durch (Name/Adresse)', 'Payable par (nom/adresse)', 'Pagabile da (nome/indirizzo)', 'Payable by (name/address)', 'Da pajar da (num/adressa)'],
  currency: ['Währung', 'Monnaie', 'Valuta', 'Currency', 'Valuta'],
  amount: ['Betrag', 'Montant', 'Importo', 'Amount', 'Import'],
  acceptance_point: ['Annahmestelle', 'Point de dépôt', 'Punto di accettazione', 'Acceptance point', 'Post da recepziun'],
  separate_before_paying_in: ['Vor der Einzahlung abzutrennen', 'A détacher avant le versement', 'Da staccare prima del versamento', 'Separate before paying in', 'Da distatgar avant che pajar'],
  do_not_use_for_payment: ['NICHT ZUR ZAHLUNG VERWENDEN', 'NE PAS UTILISER POUR LE PAIEMENT', 'NON UTILIZZARE PER IL PAGAMENTO', 'DO NOT USE FOR PAYMENT', 'BETG DUVRAR PER IL PAJAMENT'],
  in_favour_of: ['Zugunsten', 'En faveur de', 'A favore di', 'In favour of', 'En favur da'],
}
const COLUMN = { de: 0, fr: 1, it: 2, en: 3, rm: 4 } as const

describe('Annex C literals', () => {
  it('carries exactly the headings of Table 23, no more and no fewer', () => {
    expect(Object.keys(QR_LABELS).sort()).toEqual(Object.keys(ANNEX_C).sort())
  })

  it('matches the table word for word, in every language', () => {
    for (const key of Object.keys(ANNEX_C) as QrLabelKey[]) {
      for (const lang of QR_LANGUAGES) {
        expect(QR_LABELS[key][lang], `${key}.${lang}`).toBe(ANNEX_C[key][COLUMN[lang]])
      }
    }
  })

  it('is frozen, so nothing at runtime can reword it', () => {
    expect(Object.isFrozen(QR_LABELS)).toBe(true)
    expect(Object.isFrozen(QR_LABELS.amount)).toBe(true)
    expect(Object.isFrozen(qrLabels('fr'))).toBe(true)
    expect(qrLabels('fr').amount).toBe('Montant')
  })
})
