// The overview — the book index, the cross-book rollup, and the two shared
// blocks the patrimoine screen reuses (`<BookFacts>`, `<BookTodayNotice>`).
//
// ── SINGULAR AND PLURAL ARE SEPARATE ENTRIES, NOT A TERNARY IN JSX ─────────
// `{n === 1 ? 'book has' : 'books have'}` works in English and does not survive
// translation: French agreement reaches the article, the noun, the verb and the
// participle, and which of them move differs per sentence. Every count sentence
// here is therefore two whole entries.

export const en = {
  'overview.loading': 'Loading your books',
  'overview.loadError': 'Your books could not be loaded',
  'overview.titleOne': 'Your book',
  'overview.titleMany': 'Your books',
  'overview.leadOne': 'One set of accounts. Everything else in the app is scoped to it.',
  'overview.leadMany':
    'Each one is a separate set of accounts. The control in the top bar chooses which one every other screen is about.',
  'overview.figuresFailed': 'The figures could not be loaded',
  'overview.noSeat': 'No registered seat',
  'overview.loadingFigures': 'Loading its figures…',
  'overview.noFiguresServed': 'No figures were served for this book.',
  'overview.noExercice':
    'No fiscal year is open yet, so there is nothing to derive. A book gets its accounts when it is created; the exercice is a second step.',
  'overview.resultatYear': 'Résultat {year}',
  'overview.balance': 'Balance',
  'overview.balances': 'Actif = passif',
  'overview.doesNotBalance': 'Does not balance',
  'overview.recettes': 'Recettes',
  'overview.depenses': 'Dépenses',
  'overview.riNote':
    'Simplified bookkeeping, art. 957 al. 2 CO. That result is CASH in minus cash out — not a profit: there are no accruals and no depreciation behind it. This book has no balance sheet;',
  'overview.riNoteLink': 'its net worth is the patrimoine statement',
  'overview.entriesCount': '{n} entries',
  'overview.toResolveCount': '{n} to resolve',
  'overview.stagedCount': '{n} staged',
  'overview.taxLink': 'Statutory tax snapshot',

  // ── The three tables (2026-08-21) ────────────────────────────────────────
  // The books were three stacked cards of eight label-above-value fields each.
  // They are rows now, and the figures split by REGIME rather than sharing one
  // header, because a double-entry book and a simplified one do not have the
  // same figures and a column head that is true for one row and false for the
  // next is worse than two tables.
  'overview.booksLabel': 'The books',
  'overview.booksNote':
    'Open a book to read its grand livre. What still needs explaining is on its recognition page.',
  'overview.doubleEntryBooks': 'Double-entry books — this year',
  'overview.simplifiedBooks': 'Simplified books — this year',
  'overview.book': 'Book',
  'overview.year': 'Year',
  'overview.resultat': 'Résultat',
  'overview.toResolve': 'To resolve',
  'overview.staged': 'Staged',
  'overview.noFiguresShort': 'No figures served',
  'overview.noExerciceShort': 'No fiscal year open',
  'overview.rollupFiguresLabel': 'The four totals',

  'overview.rollupTitle': 'Across all your books',
  'overview.rollupLead':
    'An informational aggregation over {books} books, and never a consolidation under art. 963 CO. Nothing is eliminated: a loan between two of your books is counted on both sides, because the question this answers is what you hold, not what a group balance sheet would say. It has no standing in any filing.',
  'overview.combinedResult': 'Combined result',
  'overview.entries': 'Entries',
  'overview.needAHuman': 'Need a human',
  'overview.coverOne':
    'Total actif covers the {n} double-entry book.',
  'overview.coverMany': 'Total actif covers the {n} double-entry books.',
  'overview.coverRiOne':
    'Total actif covers the {n} double-entry books — the {ri} simplified book has no balance sheet and contributes nothing to it.',
  'overview.coverRiMany':
    'Total actif covers the {n} double-entry books — the {ri} simplified books have no balance sheet and contribute nothing to it.',
  'overview.mixedResult':
    'The combined result adds accrual profits to a cash result, which are different kinds of number. It is an order of magnitude, not a figure to file.',
  'overview.withoutExerciceOne':
    '{n} book has no fiscal year open and contributes nothing to any total above.',
  'overview.withoutExerciceMany':
    '{n} books have no fiscal year open and contribute nothing to any total above.',
  'overview.stagedExcludedOne':
    '{n} staged entry is excluded from every figure above — staged money has no agreed meaning and never touches a statement.',
  'overview.stagedExcludedMany':
    '{n} staged entries are excluded from every figure above — staged money has no agreed meaning and never touches a statement.',

  // ── <BookFacts> ─────────────────────────────────────────────────────────
  'facts.legalForm': 'Legal form',
  'facts.regime': 'Regime',
  'facts.doubleEntry': 'Double entry',
  'facts.simplified': 'Simplified (art. 957 al. 2)',
  'facts.vat': 'VAT',
  'facts.vatRegistered': 'Registered',
  'facts.vatNot': 'Not registered',
  'facts.audit': 'Audit',
  'facts.fte': 'FTE',

  // ── <BookTodayNotice> ───────────────────────────────────────────────────
  'today.title': 'Nothing above was recalculated.',
  'today.body':
    'Every figure on this page is the text the agent filed with its answer. This app does not recompute one and cannot: a filed value is prose with numbers in it, and nothing on the record says which figure this app serves it came from. A fresh answer means asking the agent again, outside this app — the record stands either way.',
  'today.checking': 'Checking what the book holds today…',
  'today.couldNotLookLead': 'This screen could not look at the book.',
  'today.couldNotLookBody':
    'No entries were served for {year}, so nothing was compared — which is not the same as nothing having changed.',
  'today.selectedYear': 'the selected year',
  'today.thisYear': 'this year',
  'today.theSelectedBook': 'the selected book',
  'today.whatItCanCheckOne':
    'What it can check is {book}. Of the {n} entry it serves for {year}:',
  'today.whatItCanCheckMany':
    'What it can check is {book}. Of the {n} entries it serves for {year}:',
  'today.datedOne': '{n} is dated on or after {date}, the day this answer was filed.',
  'today.datedMany': '{n} are dated on or after {date}, the day this answer was filed.',
  'today.stagedOne':
    '{n} is staged — recorded, and counting in nothing. The balance sheet, the income statement and every derived figure exclude them.',
  'today.stagedMany':
    '{n} are staged — recorded, and counting in nothing. The balance sheet, the income statement and every derived figure exclude them.',
  'today.caveat':
    'Neither line is a recomputation of anything above, and neither is a verdict on this answer. A booking date is when the money moved rather than when the row was written, so an entry back-dated into an earlier month is invisible to the first one.',
  'today.riNoStaged':
    'This book keeps recettes-dépenses, which has no posting status, so there is no staged count to give.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'overview.loading': 'Chargement de vos livres',
  'overview.loadError': 'Impossible de charger vos livres',
  'overview.titleOne': 'Votre livre',
  'overview.titleMany': 'Vos livres',
  'overview.leadOne':
    'Un seul jeu de comptes. Tout le reste de l’application s’y rapporte.',
  'overview.leadMany':
    'Chacun est un jeu de comptes distinct. Le contrôle en haut de la page choisit celui dont parlent tous les autres écrans.',
  'overview.figuresFailed': 'Impossible de charger les chiffres',
  'overview.noSeat': 'Aucun siège inscrit',
  'overview.loadingFigures': 'Chargement de ses chiffres…',
  'overview.noFiguresServed': 'Aucun chiffre n’a été servi pour ce livre.',
  'overview.noExercice':
    'Aucun exercice n’est encore ouvert : il n’y a donc rien à dériver. Un livre reçoit ses comptes à sa création ; l’exercice est une seconde étape.',
  'overview.resultatYear': 'Résultat {year}',
  'overview.balance': 'Équilibre',
  'overview.balances': 'Actif = passif',
  'overview.doesNotBalance': 'Ne s’équilibre pas',
  'overview.recettes': 'Recettes',
  'overview.depenses': 'Dépenses',
  'overview.riNote':
    'Comptabilité simplifiée, art. 957 al. 2 CO. Ce résultat est l’encaissement moins le décaissement — pas un bénéfice : il n’y a derrière ni régularisation ni amortissement. Ce livre n’a pas de bilan ;',
  'overview.riNoteLink': 'son patrimoine net est l’état du patrimoine',
  'overview.entriesCount': '{n} écritures',
  'overview.toResolveCount': '{n} à traiter',
  'overview.stagedCount': '{n} en attente',
  'overview.taxLink': 'Aperçu fiscal légal',

  'overview.booksLabel': 'Les livres',
  'overview.booksNote':
    'Ouvrez un livre pour lire son grand livre. Ce qui reste à expliquer se trouve sur sa page de reconnaissance.',
  'overview.doubleEntryBooks': 'Livres en partie double — cet exercice',
  'overview.simplifiedBooks': 'Livres simplifiés — cet exercice',
  'overview.book': 'Livre',
  'overview.year': 'Exercice',
  'overview.resultat': 'Résultat',
  'overview.toResolve': 'À traiter',
  'overview.staged': 'En attente',
  'overview.noFiguresShort': 'Aucun chiffre servi',
  'overview.noExerciceShort': 'Aucun exercice ouvert',
  'overview.rollupFiguresLabel': 'Les quatre totaux',

  'overview.rollupTitle': 'Tous livres confondus',
  'overview.rollupLead':
    'Une agrégation informative sur {books} livres, et jamais une consolidation au sens de l’art. 963 CO. Rien n’est éliminé : un prêt entre deux de vos livres est compté des deux côtés, car la question à laquelle cela répond est ce que vous détenez, non ce que dirait un bilan de groupe. Cela n’a aucune valeur dans un dépôt.',
  'overview.combinedResult': 'Résultat combiné',
  'overview.entries': 'Écritures',
  'overview.needAHuman': 'À traiter',
  'overview.coverOne': 'Le total actif couvre le {n} livre en partie double.',
  'overview.coverMany': 'Le total actif couvre les {n} livres en partie double.',
  'overview.coverRiOne':
    'Le total actif couvre les {n} livres en partie double — le {ri} livre simplifié n’a pas de bilan et n’y contribue en rien.',
  'overview.coverRiMany':
    'Le total actif couvre les {n} livres en partie double — les {ri} livres simplifiés n’ont pas de bilan et n’y contribuent en rien.',
  'overview.mixedResult':
    'Le résultat combiné additionne des bénéfices en comptabilité d’engagement et un résultat de trésorerie, qui sont des grandeurs de nature différente. C’est un ordre de grandeur, pas un chiffre à déposer.',
  'overview.withoutExerciceOne':
    '{n} livre n’a aucun exercice ouvert et ne contribue à aucun total ci-dessus.',
  'overview.withoutExerciceMany':
    '{n} livres n’ont aucun exercice ouvert et ne contribuent à aucun total ci-dessus.',
  'overview.stagedExcludedOne':
    '{n} écriture en attente est exclue de tous les chiffres ci-dessus — une écriture en attente n’a pas de signification convenue et ne touche jamais un état.',
  'overview.stagedExcludedMany':
    '{n} écritures en attente sont exclues de tous les chiffres ci-dessus — une écriture en attente n’a pas de signification convenue et ne touche jamais un état.',

  'facts.legalForm': 'Forme juridique',
  'facts.regime': 'Régime',
  'facts.doubleEntry': 'Partie double',
  'facts.simplified': 'Simplifiée (art. 957 al. 2)',
  'facts.vat': 'TVA',
  'facts.vatRegistered': 'Assujetti',
  'facts.vatNot': 'Non assujetti',
  'facts.audit': 'Révision',
  'facts.fte': 'EPT',

  'today.title': 'Rien de ce qui précède n’a été recalculé.',
  'today.body':
    'Chaque chiffre de cette page est le texte que l’agent a déposé avec sa réponse. Cette application n’en recalcule aucun et ne le peut pas : une valeur déposée est de la prose contenant des nombres, et rien dans l’enregistrement ne dit de quel chiffre servi par cette application elle provient. Obtenir une réponse fraîche suppose de réinterroger l’agent, hors de cette application — l’enregistrement demeure dans les deux cas.',
  'today.checking': 'Vérification de l’état actuel du livre…',
  'today.couldNotLookLead': 'Cet écran n’a pas pu consulter le livre.',
  'today.couldNotLookBody':
    'Aucune écriture n’a été servie pour {year} : rien n’a donc été comparé — ce qui n’est pas la même chose que rien n’a changé.',
  'today.selectedYear': 'l’année sélectionnée',
  'today.thisYear': 'cette année',
  'today.theSelectedBook': 'le livre sélectionné',
  'today.whatItCanCheckOne':
    'Ce qu’il peut vérifier, c’est {book}. Sur la {n} écriture qu’il sert pour {year} :',
  'today.whatItCanCheckMany':
    'Ce qu’il peut vérifier, c’est {book}. Sur les {n} écritures qu’il sert pour {year} :',
  'today.datedOne':
    '{n} est datée du {date} ou après, jour du dépôt de cette réponse.',
  'today.datedMany':
    '{n} sont datées du {date} ou après, jour du dépôt de cette réponse.',
  'today.stagedOne':
    '{n} est en attente — enregistrée, et comptant dans rien. Le bilan, le compte de résultat et tout chiffre dérivé l’excluent.',
  'today.stagedMany':
    '{n} sont en attente — enregistrées, et comptant dans rien. Le bilan, le compte de résultat et tout chiffre dérivé les excluent.',
  'today.caveat':
    'Aucune de ces deux lignes n’est un recalcul de ce qui précède, ni un jugement sur cette réponse. Une date de comptabilisation est celle du mouvement d’argent et non celle de l’écriture : une écriture antidatée dans un mois antérieur est invisible pour la première.',
  'today.riNoStaged':
    'Ce livre tient des recettes-dépenses, qui n’a pas de statut de comptabilisation : il n’y a donc pas de nombre d’écritures en attente à donner.',
}
