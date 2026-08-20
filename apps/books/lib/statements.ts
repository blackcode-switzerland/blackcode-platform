// The statutory statement structures: art. 959a CO (bilan) and art. 959b CO
// (compte de résultat, par nature).
//
// ===========================================================================
// THIS IS LAW EXPRESSED AS CODE. IT IS NOT CONFIGURATION.
// ===========================================================================
// The line list, its order, and its grouping are dictated by the Swiss Code of
// Obligations. Nobody edits them at runtime, there is no admin screen for them,
// and they are not rows in a table — because a table implies somebody may add,
// rename, merge or reorder a line, and none of those are ours to do.
//
// Changing anything here is a reviewed code change that cites the article it
// follows. That is the whole reason this file exists instead of a `statement_line`
// table.
//
// ── THE THREE LAYERS, AND WHICH ONE IS TOUCHABLE ──────────────────────────
//   1. THE LAW           — this file. Fixed by art. 959a / 959b.
//   2. THE CHART         — account numbers (1020, 6570, …). The Swiss PME
//                          convention. Set up once, rarely changes.
//   3. THE MAPPING       — `account.statement_position`, pointing an account at
//                          exactly one `pos` below. **The only touchable layer**,
//                          and it is data, not code.
//
// So when a number on the bilan looks wrong, the fix is the transaction's account
// or that account's mapping. It is never this file.
//
// ── LANGUAGE ──────────────────────────────────────────────────────────────
// The French text is the statute's own wording and is what the filed PDF must
// say. The English is a gloss for the interface, which is otherwise English. See
// docs/books-app-plan/phase-0-contract.md.
//
// ── ZERO IS NOT ABSENT ────────────────────────────────────────────────────
// A line whose amount is zero is still a line. It may be visually collapsed; it
// is never dropped from the model, because the legal list is the legal list.

export interface StatementLabel {
  fr: string
  en: string
}

export interface BilanLine {
  pos: string
  label: StatementLabel
  /**
   * Presented separately under art. 959a al. 4: receivables from and payables to
   * shareholders, board members and related entities. With one owner behind
   * several books this is not an edge case, it is the central compliance
   * surface, so these are real standalone lines rather than a note.
   */
  related?: boolean
  /**
   * Computed, never posted. `resultat_exercice` is injected from the compte de
   * résultat so the bilan balances by construction.
   */
  derived?: boolean
}

export interface BilanGroup {
  group: StatementLabel
  side: 'actif' | 'passif'
  lines: BilanLine[]
}

/**
 * Art. 959a CO. Actif in decreasing liquidity, passif in decreasing
 * exigibility. The order below is the article's order.
 */
export const BILAN_STRUCTURE: readonly BilanGroup[] = [
  {
    group: { fr: 'Actif circulant', en: 'Current assets' },
    side: 'actif',
    lines: [
      { pos: 'tresorerie', label: { fr: 'Trésorerie', en: 'Cash & equivalents' } },
      { pos: 'creances_clients', label: { fr: 'Créances résultant de ventes et prestations', en: 'Trade receivables' } },
      { pos: 'autres_creances_ct', label: { fr: 'Autres créances à court terme', en: 'Other short-term receivables' } },
      { pos: 'autres_creances_ct_liees', label: { fr: 'Autres créances c.t. envers entités liées / actionnaire (art. 959a al. 4)', en: 'Other s.-t. receivables from related entities / shareholder (art. 959a al. 4)' }, related: true },
      { pos: 'stocks', label: { fr: 'Stocks et prestations non facturées', en: 'Inventory & unbilled services' } },
      { pos: 'regularisation_actif', label: { fr: 'Actifs de régularisation', en: 'Accrued income & prepaid expenses' } },
    ],
  },
  {
    group: { fr: 'Actif immobilisé', en: 'Fixed assets' },
    side: 'actif',
    lines: [
      { pos: 'immo_financieres', label: { fr: 'Immobilisations financières', en: 'Financial assets' } },
      { pos: 'participations', label: { fr: 'Participations', en: 'Participations' } },
      { pos: 'immo_corporelles', label: { fr: 'Immobilisations corporelles', en: 'Tangible fixed assets' } },
      { pos: 'immo_incorporelles', label: { fr: 'Immobilisations incorporelles', en: 'Intangible fixed assets' } },
      { pos: 'capital_non_libere', label: { fr: 'Capital social non libéré', en: 'Unpaid share capital' } },
    ],
  },
  {
    group: { fr: 'Capitaux étrangers à court terme', en: 'Short-term liabilities' },
    side: 'passif',
    lines: [
      { pos: 'dettes_fournisseurs', label: { fr: "Dettes résultant d'achats et prestations", en: 'Trade payables' } },
      { pos: 'dettes_ct_interet', label: { fr: 'Dettes à court terme portant intérêt', en: 'Short-term interest-bearing debt' } },
      { pos: 'autres_dettes_ct', label: { fr: 'Autres dettes à court terme', en: 'Other short-term liabilities' } },
      { pos: 'autres_dettes_ct_liees', label: { fr: 'Autres dettes c.t. envers entités liées / actionnaire (art. 959a al. 4)', en: 'Other s.-t. liabilities to related entities / shareholder (art. 959a al. 4)' }, related: true },
      { pos: 'regularisation_passif', label: { fr: 'Passifs de régularisation', en: 'Accrued expenses & deferred income' } },
    ],
  },
  {
    group: { fr: 'Capitaux étrangers à long terme', en: 'Long-term liabilities' },
    side: 'passif',
    lines: [
      { pos: 'dettes_lt_interet', label: { fr: 'Dettes à long terme portant intérêt', en: 'Long-term interest-bearing debt' } },
      { pos: 'autres_dettes_lt', label: { fr: 'Autres dettes à long terme', en: 'Other long-term liabilities' } },
      { pos: 'provisions', label: { fr: 'Provisions', en: 'Provisions' } },
    ],
  },
  {
    group: { fr: 'Capitaux propres', en: 'Equity' },
    side: 'passif',
    lines: [
      { pos: 'capital_actions', label: { fr: 'Capital-actions', en: 'Share capital' } },
      { pos: 'reserve_capital', label: { fr: 'Réserve légale issue du capital', en: 'Legal capital reserve' } },
      { pos: 'reserve_benefice', label: { fr: 'Réserve légale issue du bénéfice', en: 'Legal profit reserve' } },
      { pos: 'reserves_facultatives', label: { fr: 'Réserves facultatives', en: 'Voluntary reserves' } },
      { pos: 'resultat_reporte', label: { fr: 'Bénéfice / perte reporté(e)', en: 'Retained earnings / accumulated loss' } },
      { pos: 'resultat_exercice', label: { fr: "Bénéfice / perte de l'exercice", en: 'Result of the year' }, derived: true },
    ],
  },
]

export interface CrLine {
  pos: string
  label: StatementLabel
  /** +1 income, -1 expense. Drives both the sign convention and the total. */
  sign: 1 | -1
}

/**
 * Art. 959b CO, par nature.
 *
 * Lines 7 to 9 — `financier`, `hors_exploitation`, `exceptionnel` — are a HARD
 * legal requirement and must never be flattened into one generic "other"
 * bucket. That collapse is the most common way a small company's compte de
 * résultat stops being compliant while still adding up.
 */
export const CR_STRUCTURE: readonly CrLine[] = [
  { pos: 'produits_nets', label: { fr: 'Produits nets des ventes et prestations', en: 'Net revenue from goods & services' }, sign: 1 },
  { pos: 'variation_stocks', label: { fr: 'Variation des stocks / prestations non facturées', en: 'Change in inventory / unbilled services' }, sign: 1 },
  { pos: 'charges_materiel', label: { fr: 'Charges de matériel et de prestations de tiers', en: 'Material & third-party service expense' }, sign: -1 },
  { pos: 'charges_personnel', label: { fr: 'Charges de personnel', en: 'Personnel expense' }, sign: -1 },
  { pos: 'autres_charges_exploitation', label: { fr: "Autres charges d'exploitation", en: 'Other operating expense' }, sign: -1 },
  { pos: 'amortissements', label: { fr: 'Amortissements et corrections de valeur', en: 'Depreciation & value adjustments' }, sign: -1 },
  { pos: 'financier', label: { fr: 'Charges et produits financiers', en: 'Financial expense & income' }, sign: -1 },
  { pos: 'hors_exploitation', label: { fr: 'Charges et produits hors exploitation', en: 'Non-operating expense & income' }, sign: -1 },
  { pos: 'exceptionnel', label: { fr: 'Charges et produits exceptionnels, uniques ou hors période', en: 'Extraordinary, one-off or prior-period items' }, sign: -1 },
  { pos: 'impots', label: { fr: 'Impôts directs', en: 'Direct taxes' }, sign: -1 },
]

/**
 * Every legal position an account may be mapped to.
 *
 * `account.statement_position` is validated against this AT LOAD, and an
 * unmapped or unknown value is a hard load error. There is deliberately no
 * fallback "autre" bucket: a silent catch-all is how money quietly leaves the
 * statement it legally belongs on.
 */
export const STATEMENT_POSITIONS: ReadonlySet<string> = new Set([
  ...BILAN_STRUCTURE.flatMap((g) => g.lines.map((l) => l.pos)),
  ...CR_STRUCTURE.map((l) => l.pos),
])

/** True when `pos` is a line of one of the two statutory statements. */
export function isStatementPosition(pos: string): boolean {
  return STATEMENT_POSITIONS.has(pos)
}
