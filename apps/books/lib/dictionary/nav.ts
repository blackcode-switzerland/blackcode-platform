// The sidebar's nine items, the three off-nav screens, and the page titles the
// shell draws from them.
//
// ── THE URL SEGMENTS STAY ENGLISH; ONLY THE LABELS MOVE ────────────────────
// `/income-statement` is the address in both languages. A localised path would
// mean two URLs for one screen, a link that changes meaning when the recipient's
// preference differs from the sender's, and a `lib/nav.ts` that has to know the
// locale to build an href. The label is what the reader reads; the segment is
// where the data lives.
//
// **The nav labels are the app's own words, not statutory ones.** "Balance
// sheet" / "Bilan" is the pair here; the statutory NAME of the filed document
// is `statements.ts`'s business and it is French in both languages — see
// `lib/dictionary/statements.ts`.

export const en = {
  'nav.overview': 'Overview',
  'nav.recognition': 'Recognition',
  'nav.documents': 'Supporting documents',
  'nav.ledger': 'General ledger',
  'nav.sources': 'Accounts & sources',
  'nav.balanceSheet': 'Balance sheet',
  'nav.incomeStatement': 'Income statement',
  'nav.management': 'Management view',
  'nav.analyses': 'Analyses',
  'nav.taxes': 'Taxes',
  'nav.patrimoine': 'Patrimoine',
  'nav.compliance': 'Compliance rules',
} as const

export const fr: Record<keyof typeof en, string> = {
  'nav.overview': 'Vue d’ensemble',
  'nav.recognition': 'Reconnaissance',
  'nav.documents': 'Pièces justificatives',
  'nav.ledger': 'Grand livre',
  'nav.sources': 'Comptes et sources',
  'nav.balanceSheet': 'Bilan',
  'nav.incomeStatement': 'Compte de résultat',
  'nav.management': 'Vue de gestion',
  'nav.analyses': 'Analyses',
  'nav.taxes': 'Impôts',
  // Untranslated on purpose: "patrimoine" is the word art. 957 al. 2 CO uses
  // for what this screen is, and there is no English term of art for it. It is
  // the same reasoning `legal()` applies to a statutory line label.
  'nav.patrimoine': 'Patrimoine',
  'nav.compliance': 'Règles de conformité',
}
