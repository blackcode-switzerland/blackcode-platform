// The starting chart of accounts: the Swiss PME plan, as these books use it.
//
// ===========================================================================
// A BOOK WITH NO ACCOUNTS CANNOT TAKE A SINGLE POSTING
// ===========================================================================
// This file exists because `createEntity` created books nobody could use. Every
// account referenced by a posting line has to exist in `books.account` for that
// entity, so a book with an empty chart accepts no entry at all, and the create
// path produced exactly that until 2026-08-17.
//
// The seed hid it. It inserts the mockup's 26 accounts into each of its three
// books directly, so every test and every screen worked, and the first person to
// press "create a book" would have got a book that could hold nothing.
// `lib/derive/runtime.test.ts` is the test that says otherwise now.
//
// ===========================================================================
// WHY THIS IS CODE, WHEN `books.statement_position` IS A TABLE
// ===========================================================================
// The two look like the same kind of reference data and are not.
//
//   STATEMENT POSITIONS ARE LAW. art. 959a and 959b fix them, every account must
//   map to one, and 0003 seeds them into a table so `account.statement_position`
//   can be a real foreign key that refuses an unmapped account.
//
//   A CHART IS A STARTING POINT. It belongs to the book once applied: two books
//   may keep different accounts, and AIOS SA's chart in the mockup is already a
//   subset of blackcode SA's. Shared rows in a table would make one book's edit
//   everybody's.
//
// So this is a TEMPLATE, copied per book at creation, and afterwards those rows
// are that book's own. Adding an account here changes what NEW books start with
// and touches no existing one.
//
// ===========================================================================
// THE SAME 26 ACCOUNTS THE SEEDED BOOKS HAVE
// ===========================================================================
// `lib/chart.test.ts` pins this against `fixtures/mockup.json`, so a
// runtime-created book and a seeded one cannot end up with different charts. That
// matters because the parity test proves the derivations against the mockup's
// numbers: a chart that drifted from the fixture would make those numbers prove
// something about a chart no real book has.
//
// The template is NOT read from the fixture. That file is 107KB of development
// data and the runtime create path must not import it.

/**
 * An account label.
 *
 * `{ fr, enSuffix }` is the mockup's own shape, unusual key name included, and it
 * is what the `label` jsonb column holds verbatim. Deliberately NOT the
 * `StatementLabel` used by `lib/statements.ts`, which is `{ fr, en }`: statement
 * headings are translated in full, an account label is a French name with an
 * English gloss appended.
 */
export interface AccountLabel {
  fr: string
  enSuffix: string
}

export interface ChartTemplateAccount {
  no: string
  /** 1-9. `books.account` CHECKs the range. */
  class: number
  label: AccountLabel
  statement: 'bilan' | 'cr'
  /** Must be a key of `books.statement_position`, which is a FK and will refuse. */
  statement_position: string
}

/**
 * The chart every new book starts with.
 *
 * Account-number order, which is also `listAccounts`' order, so a reader
 * comparing this file to a screen sees the same sequence.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 * The fixture marks accounts 1141 and 2261 `related_party: true` and there is no
 * such column here or in the table. Art. 959a al. 4 separation is a property of
 * the STATEMENT LINE, not of the account: `BILAN_STRUCTURE` carries `related` on
 * `autres_creances_ct_liees` and `autres_dettes_ct_liees`, which is where the
 * bilan reads it from. A second copy on the account would be the one that went
 * stale, and it would be the one a filing believed.
 */
export const PME_CHART: readonly ChartTemplateAccount[] = [
  // ── Class 1, actif ────────────────────────────────────────────────────────
  // ONE neutral bank account. The mockup fixture names three ('Banque WIR',
  // 'Banque UBS (gelée)', 'Yapeal') because that chart IS blackcode's book —
  // its banks, its frozen account. Those are book-local customizations the
  // SEED applies from the fixture; a template that shipped them would open
  // every new company's books with another company's bank names. Found by
  // the first fresh-company simulation, 2026-08-18.
  { no: '1020', class: 1, label: { fr: 'Banque', enSuffix: 'Bank' }, statement: 'bilan', statement_position: 'tresorerie' },
  { no: '1100', class: 1, label: { fr: 'Créances clients', enSuffix: 'Trade receivables' }, statement: 'bilan', statement_position: 'creances_clients' },
  { no: '1141', class: 1, label: { fr: 'Prêts aux entités liées', enSuffix: 'Loans to related entities' }, statement: 'bilan', statement_position: 'autres_creances_ct_liees' },
  { no: '1300', class: 1, label: { fr: 'Actifs de régularisation', enSuffix: 'Accrued assets' }, statement: 'bilan', statement_position: 'regularisation_actif' },
  { no: '1510', class: 1, label: { fr: 'Mobilier et informatique', enSuffix: 'Furniture & IT' }, statement: 'bilan', statement_position: 'immo_corporelles' },
  { no: '1850', class: 1, label: { fr: 'Capital social non libéré', enSuffix: 'Unpaid share capital' }, statement: 'bilan', statement_position: 'capital_non_libere' },

  // ── Class 2, passif. The only class whose sign flips on the bilan ─────────
  { no: '2000', class: 2, label: { fr: 'Dettes fournisseurs', enSuffix: 'Trade payables' }, statement: 'bilan', statement_position: 'dettes_fournisseurs' },
  { no: '2200', class: 2, label: { fr: 'TVA due', enSuffix: 'VAT payable' }, statement: 'bilan', statement_position: 'autres_dettes_ct' },
  { no: '2261', class: 2, label: { fr: 'Dettes envers entités liées', enSuffix: 'Debts to related entities' }, statement: 'bilan', statement_position: 'autres_dettes_ct_liees' },
  { no: '2300', class: 2, label: { fr: 'Passifs de régularisation', enSuffix: 'Accrued liabilities' }, statement: 'bilan', statement_position: 'regularisation_passif' },
  { no: '2800', class: 2, label: { fr: 'Capital-actions', enSuffix: 'Share capital' }, statement: 'bilan', statement_position: 'capital_actions' },
  { no: '2950', class: 2, label: { fr: 'Réserve légale issue du bénéfice', enSuffix: 'Legal reserve from profit' }, statement: 'bilan', statement_position: 'reserve_benefice' },
  // Carries a NEGATIVE opening in two of the seeded books. There is no positivity
  // CHECK on money anywhere in this schema, and this account is why.
  { no: '2970', class: 2, label: { fr: 'Bénéfice / perte reporté(e)', enSuffix: 'Retained earnings / loss' }, statement: 'bilan', statement_position: 'resultat_reporte' },

  // ── Classes 3-8, compte de résultat ──────────────────────────────────────
  // No opening balance, ever: a year of trading starts at zero, which is what
  // closing an exercice means. The statements read MOVEMENT on these.
  { no: '3400', class: 3, label: { fr: 'Prestations de services', enSuffix: 'Service revenue' }, statement: 'cr', statement_position: 'produits_nets' },
  { no: '4400', class: 4, label: { fr: 'Prestations de tiers', enSuffix: 'Third-party services' }, statement: 'cr', statement_position: 'charges_materiel' },
  { no: '5000', class: 5, label: { fr: 'Salaires', enSuffix: 'Salaries' }, statement: 'cr', statement_position: 'charges_personnel' },
  { no: '5700', class: 5, label: { fr: 'Charges sociales', enSuffix: 'Social charges' }, statement: 'cr', statement_position: 'charges_personnel' },
  { no: '6000', class: 6, label: { fr: 'Loyer', enSuffix: 'Rent' }, statement: 'cr', statement_position: 'autres_charges_exploitation' },
  { no: '6500', class: 6, label: { fr: 'Administration & fiduciaire', enSuffix: 'Admin & fiduciary' }, statement: 'cr', statement_position: 'autres_charges_exploitation' },
  { no: '6570', class: 6, label: { fr: 'Informatique & abonnements', enSuffix: 'IT & subscriptions' }, statement: 'cr', statement_position: 'autres_charges_exploitation' },
  { no: '6800', class: 6, label: { fr: 'Amortissements', enSuffix: 'Depreciation' }, statement: 'cr', statement_position: 'amortissements' },
  { no: '6900', class: 6, label: { fr: 'Charges financières', enSuffix: 'Financial expense' }, statement: 'cr', statement_position: 'financier' },
  { no: '8500', class: 8, label: { fr: 'Charges hors exploitation', enSuffix: 'Non-operating expense' }, statement: 'cr', statement_position: 'hors_exploitation' },
  { no: '8900', class: 8, label: { fr: 'Impôts directs', enSuffix: 'Direct taxes' }, statement: 'cr', statement_position: 'impots' },
]
