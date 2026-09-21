// The printed headings of a QR-bill, per language — Annex C, Table 23.
//
// ===========================================================================
// LEGAL TEXT. NEVER REWORDED, NEVER TRANSLATED BY US, NEVER INTERPOLATED.
// ===========================================================================
// These are the literals the standard fixes for the payment part and the
// receipt (§3.2: "the headings … must not be altered"). They are copied from
// the v2.4 PDF, page 62, including its choices a copy-editor would "fix":
// French `A détacher` with no accent on the capital A, and Romansh `Valuta` and
// Italian `Valuta` being the same word.
//
// `labels.test.ts` holds a second transcription of the same table and compares
// the two. That catches an accidental edit here; it cannot catch a mistake made
// identically in both, which is why the header names the page to check against.
//
// ── FIVE LANGUAGES HERE, FOUR DOCUMENT LANGUAGES IN THE APP ────────────────
// Romansh became a correspondence language on 1 January 2026. The app's
// document-language vocabulary is `fr`/`de`/`it`/`en`; `rm` is carried here
// complete so adding it to that vocabulary is a CHECK constraint and a
// dictionary entry, not a trip back to the PDF.

export const QR_LANGUAGES = ['de', 'fr', 'it', 'en', 'rm'] as const
export type QrLanguage = (typeof QR_LANGUAGES)[number]

export type QrLabelKey =
  | 'payment_part'
  | 'receipt'
  | 'account_payable_to'
  | 'reference'
  | 'additional_information'
  | 'payable_by'
  | 'payable_by_name_address'
  | 'currency'
  | 'amount'
  | 'acceptance_point'
  | 'separate_before_paying_in'
  | 'do_not_use_for_payment'
  | 'in_favour_of'

type Row = Readonly<Record<QrLanguage, string>>

export const QR_LABELS: Readonly<Record<QrLabelKey, Row>> = Object.freeze({
  payment_part: Object.freeze({
    de: 'Zahlteil',
    fr: 'Section paiement',
    it: 'Sezione pagamento',
    en: 'Payment part',
    rm: 'Part da pajament',
  }),
  receipt: Object.freeze({
    de: 'Empfangsschein',
    fr: 'Récépissé',
    it: 'Ricevuta',
    en: 'Receipt',
    rm: 'Quittanza',
  }),
  account_payable_to: Object.freeze({
    de: 'Konto / Zahlbar an',
    fr: 'Compte / Payable à',
    it: 'Conto / Pagabile a',
    en: 'Account / Payable to',
    rm: 'Conto / Da pajar a',
  }),
  reference: Object.freeze({
    de: 'Referenz',
    fr: 'Référence',
    it: 'Riferimento',
    en: 'Reference',
    rm: 'Referenza',
  }),
  additional_information: Object.freeze({
    de: 'Zusätzliche Informationen',
    fr: 'Informations supplémentaires',
    it: 'Informazioni supplementari',
    en: 'Additional information',
    rm: 'Infurmaziuns supplementaras',
  }),
  payable_by: Object.freeze({
    de: 'Zahlbar durch',
    fr: 'Payable par',
    it: 'Pagabile da',
    en: 'Payable by',
    rm: 'Da pajar da',
  }),
  payable_by_name_address: Object.freeze({
    de: 'Zahlbar durch (Name/Adresse)',
    fr: 'Payable par (nom/adresse)',
    it: 'Pagabile da (nome/indirizzo)',
    en: 'Payable by (name/address)',
    rm: 'Da pajar da (num/adressa)',
  }),
  currency: Object.freeze({
    de: 'Währung',
    fr: 'Monnaie',
    it: 'Valuta',
    en: 'Currency',
    rm: 'Valuta',
  }),
  amount: Object.freeze({
    de: 'Betrag',
    fr: 'Montant',
    it: 'Importo',
    en: 'Amount',
    rm: 'Import',
  }),
  acceptance_point: Object.freeze({
    de: 'Annahmestelle',
    fr: 'Point de dépôt',
    it: 'Punto di accettazione',
    en: 'Acceptance point',
    rm: 'Post da recepziun',
  }),
  separate_before_paying_in: Object.freeze({
    de: 'Vor der Einzahlung abzutrennen',
    fr: 'A détacher avant le versement',
    it: 'Da staccare prima del versamento',
    en: 'Separate before paying in',
    rm: 'Da distatgar avant che pajar',
  }),
  // For notification bills (§4.4), which v1 does not issue. Carried so the
  // omission is a decision rather than a missing row.
  do_not_use_for_payment: Object.freeze({
    de: 'NICHT ZUR ZAHLUNG VERWENDEN',
    fr: 'NE PAS UTILISER POUR LE PAIEMENT',
    it: 'NON UTILIZZARE PER IL PAGAMENTO',
    en: 'DO NOT USE FOR PAYMENT',
    rm: 'BETG DUVRAR PER IL PAJAMENT',
  }),
  // "Ultimate Creditor (future use)" in the PDF: the group may not be filled
  // today (§4.2.2 lines 12–18), so nothing prints this yet.
  in_favour_of: Object.freeze({
    de: 'Zugunsten',
    fr: 'En faveur de',
    it: 'A favore di',
    en: 'In favour of',
    rm: 'En favur da',
  }),
})

/** Every heading, in one language. */
export function qrLabels(language: QrLanguage): Readonly<Record<QrLabelKey, string>> {
  const out = {} as Record<QrLabelKey, string>
  for (const key of Object.keys(QR_LABELS) as QrLabelKey[]) out[key] = QR_LABELS[key][language]
  return Object.freeze(out)
}
