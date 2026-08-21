// The three statutory documents, the shared statement table, and the two calm
// refusals.
//
// ===========================================================================
// THE STATUTORY-NAME DECISION LIVES HERE (D-A, rewritten 2026-08-20)
// ===========================================================================
// Three different kinds of French are on a statement screen and they are NOT
// the same problem:
//
//   UI chrome              "Collapse zero lines", "Posted entries only"
//                          → translated, ordinary
//   Statutory LINE labels  `produits_nets` → *Produits nets des ventes*
//                          → `legal()` in `lib/label.ts`. **French in BOTH
//                            languages.** Art. 959a/959b fix the wording and
//                            the filed document reproduces it.
//   The DOCUMENT's NAME    *Compte de résultat*, *Bilan*
//                          → the pairs below, and the decision is:
//
// **The heading follows the reader's language, and the legal name stays visible
// underneath.** An English reader sees *Income statement* with *compte de
// résultat* beneath it; a French reader sees the French alone, because for them
// the two are the same words and printing both would be a rendering fault.
// Nobody loses the legal identity of the document, and nobody has to read a
// language they did not choose.
//
// `…Ui` is what the reader is called it in their language; `…Legal` is the
// French name of the legal instrument and is French in both tables. That the
// two French entries are identical is the point, not a copy-paste slip — it is
// what makes `<StatementHeading>` able to notice they are the same and render
// one.

export const en = {
  'statements.bilanUi': 'Balance sheet',
  'statements.bilanLegal': 'Bilan',
  'statements.bilanArticle': 'art. 959a CO',
  'statements.crUi': 'Income statement',
  'statements.crLegal': 'Compte de résultat',
  'statements.crArticle': 'art. 959b CO, par nature',
  'statements.patrimoineUi': 'Statement of net worth',
  'statements.patrimoineLegal': 'Patrimoine',
  'statements.patrimoineArticle': 'art. 957 al. 2 CO',
  'statements.exercice': 'exercice {year}',

  'statements.loadingBilan': 'Loading the balance sheet',
  'statements.loadingCr': 'Loading the income statement',
  'statements.bilanFailed': 'The balance sheet could not be derived',
  'statements.crFailed': 'The income statement could not be derived',

  'statements.collapseZero': 'Collapse zero lines',
  'statements.relatedParty': 'related party',
  'statements.relatedPartyTitle': 'art. 959a al. 4 CO — presented separately',
  'statements.derived': 'derived',
  'statements.derivedTitle': 'Computed from the income statement, never posted',
  'statements.groupTotal': 'Total {group}',
  'statements.totalActif': 'Total actif',
  'statements.totalPassif': 'Total passif',
  'statements.resultat': 'Résultat de l’exercice',
  'statements.resultatNote': 'injected into equity from the income statement',
  'statements.crLead':
    'Each line lists the accounts feeding it. Follow one to see its postings in the general ledger. Amounts are magnitudes — the sign of each line is fixed by the article, and only the result at the foot is signed.',

  'statements.reading': 'Reading',
  'statements.viewYear': 'Year',
  'statements.viewMonth': 'By month',

  // ── the actif = passif check ────────────────────────────────────────────
  'statements.balanced': 'Actif = passif. Both sides come to {amount}, so the balance sheet balances to the rappen.',
  'statements.unbalancedTitle': 'This balance sheet does not balance.',
  'statements.unbalancedBody':
    'Actif {actif} against passif {passif}, an écart of {ecart}. A posting is missing from one side. Do not file this, and do not fix it by moving a line — the entry’s account is what is wrong.',

  // ── posted-only ─────────────────────────────────────────────────────────
  'statements.postedOnlyLead': 'Posted entries only.',
  'statements.postedOnlyStaged':
    '{n} staged entries are excluded from every figure here — staged money has no agreed meaning and never touches a statement. The ledger shows them, so a drill-down may list more than a line counted.',
  'statements.postedOnlyStagedOne':
    '{n} staged entry is excluded from every figure here — staged money has no agreed meaning and never touches a statement. The ledger shows them, so a drill-down may list more than a line counted.',
  'statements.postedOnlyNone':
    'Staged entries never touch a statement. There are none in this book and exercice, so every posting below is counted.',

  // ── the simplified-book refusal ─────────────────────────────────────────
  'statements.simplifiedTitle': '{book} has no {statement}, and that is correct.',
  'statements.simplifiedBody':
    'Simplified bookkeeping is income and expenditure plus a statement of net worth. There is no double entry behind it, so {because} — the second half of what the law asks for is the patrimoine statement.',
  'statements.simplifiedBecauseBilan':
    'there are no balances to arrange into the art. 959a groups',
  'statements.simplifiedBecauseCr':
    'there are no expense and revenue accounts to arrange into the art. 959b lines',
  'statements.openPatrimoine': 'Open the patrimoine statement',
  'statements.fromTerminal': 'From the terminal: {suggestion}',
  'statements.monthlyHeader': 'Compte de résultat',
  'statements.monthlyResult': 'Résultat',
  'statements.monthlyResultGloss': 'Result',
  'statements.monthlyNoticeLead': 'A monthly view is for reading, not for filing.',
  'statements.monthlyNoticeBody':
    'Art. 959b CO defines the compte de résultat as an annual statement. A month is not a legal reporting period and no column below is a document you can file. The figures are not approximations: every month is derived exactly as the year is, and the twelve sum to the year in the last column.',
  'statements.unmapped': 'unmapped',
  'statements.noDrillRi':
    'This book keeps recettes and dépenses under art. 957 al. 2 CO. Its journal has no chart mapping, so there is nothing to drill into by account number.',
  'statements.noDrillUnknown':
    'Which journal this book keeps is not known yet, so this cannot be drilled into.',
  'patrimoine.loading': 'Loading the patrimoine statement',
  'patrimoine.loadError': 'The patrimoine statement could not be loaded',
  'patrimoine.leadSimplified':
    'Simplified bookkeeping is income and expenditure plus this. It is a compiled snapshot of what the activity holds and owes on one date — not a balance sheet, and not derived from postings.',
  'patrimoine.leadDouble':
    'A compiled snapshot of what a book holds and owes on one date. It is required of simplified books (art. 957 al. 2 CO) and optional for this one, which states its net worth on the equity side of its balance sheet instead.',
  'patrimoine.none': 'No statement has been compiled for this book.',
  'patrimoine.noneSimplified':
    '{book} keeps simplified books, so art. 957 al. 2 CO asks it for one of these alongside its recettes and dépenses. None is recorded yet.',
  'patrimoine.noneDoubleBefore':
    '{book} keeps double-entry books, so it is not required to compile one — its net worth is the equity side of',
  'patrimoine.noneDoubleLink': 'its balance sheet',
  'patrimoine.noneDoubleAfter': '. Nothing is missing here.',
  'patrimoine.newestFirst':
    'Newest first. Each statement stands on its own — they are compiled documents, not revisions of one another.',
  'patrimoine.asOf': 'As of',
  'patrimoine.compiled': 'compiled',
  'patrimoine.noItems': 'This statement records no items.',
  'patrimoine.netWorth': 'Net worth',
  'patrimoine.totalNote':
    'The total is summed on read from the items above and is never stored, so it cannot disagree with them.',
  'entry.noLines': 'This entry has no lines.',
  'piece.noDocument': 'no document',
  'piece.document': 'Document',
  'piece.noChecksum': 'no checksum',
  'table.nothingHere': 'Nothing here yet.',
  // `<TableSearch>`'s own chrome — shared by every table that grows a search
  // box, so the two screens that have one cannot word the same control
  // differently. What is SEARCHED stays with each table.
  'table.clearSearch': 'Clear the search',
  'table.searchMatches': '{n} of {total} shown',
  'dashboard.notSetUp': 'Your account is not set up yet',
  'dashboard.notSetUpBody':
    'Signing in should have finished setting up your account. It is best-effort and idempotent, so signing out and back in retries it.',
  'dashboard.notSetUpBody2':
    'If it keeps failing, the server log carries the reason — {reason}. Your account settings are still reachable at {path}.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'statements.bilanUi': 'Bilan',
  'statements.bilanLegal': 'Bilan',
  'statements.bilanArticle': 'art. 959a CO',
  'statements.crUi': 'Compte de résultat',
  'statements.crLegal': 'Compte de résultat',
  'statements.crArticle': 'art. 959b CO, par nature',
  'statements.patrimoineUi': 'Patrimoine',
  'statements.patrimoineLegal': 'Patrimoine',
  'statements.patrimoineArticle': 'art. 957 al. 2 CO',
  'statements.exercice': 'exercice {year}',

  'statements.loadingBilan': 'Chargement du bilan',
  'statements.loadingCr': 'Chargement du compte de résultat',
  'statements.bilanFailed': 'Le bilan n’a pas pu être établi',
  'statements.crFailed': 'Le compte de résultat n’a pas pu être établi',

  'statements.collapseZero': 'Masquer les postes à zéro',
  'statements.relatedParty': 'partie liée',
  'statements.relatedPartyTitle': 'art. 959a al. 4 CO — présenté séparément',
  'statements.derived': 'dérivé',
  'statements.derivedTitle': 'Calculé depuis le compte de résultat, jamais comptabilisé',
  'statements.groupTotal': 'Total {group}',
  'statements.totalActif': 'Total actif',
  'statements.totalPassif': 'Total passif',
  'statements.resultat': 'Résultat de l’exercice',
  'statements.resultatNote': 'reporté dans les fonds propres depuis le compte de résultat',
  'statements.crLead':
    'Chaque poste liste les comptes qui l’alimentent. Suivez-en un pour voir ses écritures dans le grand livre. Les montants sont des valeurs absolues — le sens de chaque poste est fixé par l’article, et seul le résultat en pied est signé.',

  'statements.reading': 'Lecture',
  'statements.viewYear': 'Année',
  'statements.viewMonth': 'Par mois',

  'statements.balanced':
    'Actif = passif. Les deux côtés totalisent {amount} : le bilan s’équilibre au centime.',
  'statements.unbalancedTitle': 'Ce bilan ne s’équilibre pas.',
  'statements.unbalancedBody':
    'Actif {actif} contre passif {passif}, soit un écart de {ecart}. Une écriture manque d’un côté. Ne déposez pas ce document, et ne le corrigez pas en déplaçant un poste — c’est le compte de l’écriture qui est faux.',

  'statements.postedOnlyLead': 'Écritures comptabilisées uniquement.',
  'statements.postedOnlyStaged':
    '{n} écritures en attente sont exclues de tous les chiffres présentés ici — une écriture en attente n’a pas de signification convenue et ne touche jamais un état. Le grand livre les montre : un détail peut donc en lister plus qu’un poste n’en compte.',
  'statements.postedOnlyStagedOne':
    '{n} écriture en attente est exclue de tous les chiffres présentés ici — une écriture en attente n’a pas de signification convenue et ne touche jamais un état. Le grand livre les montre : un détail peut donc en lister plus qu’un poste n’en compte.',
  'statements.postedOnlyNone':
    'Les écritures en attente ne touchent jamais un état. Il n’y en a aucune dans ce livre et cet exercice : toutes les écritures ci-dessous sont comptées.',

  'statements.simplifiedTitle': '{book} n’a pas de {statement}, et c’est normal.',
  'statements.simplifiedBody':
    'La comptabilité simplifiée, ce sont les recettes et les dépenses plus un état du patrimoine. Il n’y a pas de partie double derrière, donc {because} — la seconde moitié de ce que la loi exige est l’état du patrimoine.',
  'statements.simplifiedBecauseBilan':
    'il n’y a pas de soldes à répartir dans les groupes de l’art. 959a',
  'statements.simplifiedBecauseCr':
    'il n’y a pas de comptes de charges et de produits à répartir dans les postes de l’art. 959b',
  'statements.openPatrimoine': 'Ouvrir l’état du patrimoine',
  'statements.fromTerminal': 'Depuis le terminal : {suggestion}',
  'statements.monthlyHeader': 'Compte de résultat',
  'statements.monthlyResult': 'Résultat',
  'statements.monthlyResultGloss': 'Résultat',
  'statements.monthlyNoticeLead': 'Une vue mensuelle sert à lire, pas à déposer.',
  'statements.monthlyNoticeBody':
    'L’art. 959b CO définit le compte de résultat comme un état annuel. Un mois n’est pas une période de reporting légale et aucune colonne ci-dessous n’est un document déposable. Les chiffres ne sont pas des approximations : chaque mois est dérivé exactement comme l’année, et les douze totalisent l’année dans la dernière colonne.',
  'statements.unmapped': 'non affecté',
  'statements.noDrillRi':
    'Ce livre tient des recettes et des dépenses selon l’art. 957 al. 2 CO. Son journal n’a pas de correspondance avec un plan comptable : il n’y a donc rien à détailler par numéro de compte.',
  'statements.noDrillUnknown':
    'Le type de journal tenu par ce livre n’est pas encore connu : ce détail n’est donc pas accessible.',
  'patrimoine.loading': 'Chargement de l’état du patrimoine',
  'patrimoine.loadError': 'Impossible de charger l’état du patrimoine',
  'patrimoine.leadSimplified':
    'La comptabilité simplifiée, ce sont les recettes et les dépenses plus ceci. C’est un instantané établi de ce que l’activité détient et doit à une date donnée — pas un bilan, et pas dérivé d’écritures.',
  'patrimoine.leadDouble':
    'Un instantané établi de ce qu’un livre détient et doit à une date donnée. Il est exigé des livres simplifiés (art. 957 al. 2 CO) et facultatif pour celui-ci, qui indique son patrimoine net du côté des fonds propres de son bilan.',
  'patrimoine.none': 'Aucun état n’a été établi pour ce livre.',
  'patrimoine.noneSimplified':
    '{book} tient une comptabilité simplifiée : l’art. 957 al. 2 CO lui demande donc un tel état à côté de ses recettes et dépenses. Aucun n’est encore enregistré.',
  'patrimoine.noneDoubleBefore':
    '{book} tient une comptabilité en partie double : il n’est donc pas tenu d’en établir un — son patrimoine net est le côté des fonds propres de',
  'patrimoine.noneDoubleLink': 'son bilan',
  'patrimoine.noneDoubleAfter': '. Rien ne manque ici.',
  'patrimoine.newestFirst':
    'Du plus récent au plus ancien. Chaque état se suffit à lui-même — ce sont des documents établis, pas des révisions les uns des autres.',
  'patrimoine.asOf': 'Au',
  'patrimoine.compiled': 'établi le',
  'patrimoine.noItems': 'Cet état n’enregistre aucun poste.',
  'patrimoine.netWorth': 'Patrimoine net',
  'patrimoine.totalNote':
    'Le total est additionné à la lecture depuis les postes ci-dessus et n’est jamais stocké : il ne peut donc pas être en désaccord avec eux.',
  'entry.noLines': 'Cette écriture n’a aucune ligne.',
  'piece.noDocument': 'aucun document',
  'piece.document': 'Document',
  'piece.noChecksum': 'aucune empreinte',
  'table.nothingHere': 'Rien pour l’instant.',
  'table.clearSearch': 'Effacer la recherche',
  'table.searchMatches': '{n} sur {total} affichées',
  'dashboard.notSetUp': 'Votre compte n’est pas encore configuré',
  'dashboard.notSetUpBody':
    'La connexion aurait dû achever la configuration de votre compte. L’opération est au mieux et idempotente : vous déconnecter puis vous reconnecter la relance.',
  'dashboard.notSetUpBody2':
    'Si l’échec persiste, le journal du serveur en porte la raison — {reason}. Les réglages de votre compte restent accessibles à {path}.',
}
