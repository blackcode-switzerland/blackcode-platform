// The DERIVED readings: the management view (compta analytique), its chart and
// its cost breakdown, and the recorded analyses screen with its verdict and
// history panels.
//
// One area because they are one family — nothing here is a statutory document,
// everything here is arithmetic over the book or an agent's filed answer about
// it, and the two screens share `<RunFigures>`, `<FlowsChart>`,
// `<CostBreakdown>` and `<BookTodayNotice>` between them.

export const en = {
  // ── management view ─────────────────────────────────────────────────────
  'mgmt.uiName': 'Management view',
  'mgmt.legalName': 'Compta analytique',
  'mgmt.loading': 'Loading the management view',
  'mgmt.failed': 'The management view could not be derived',
  'mgmt.noticeLead': 'Management accounting — informational, not statutory.',
  'mgmt.noticeBody':
    'Arithmetic over this book’s own movements. Nothing on this page is filed and nothing on it is stored: every figure is derived when the page is opened.',
  'mgmt.noticeStaged':
    'Staged entries are excluded everywhere on this page, exactly as they are from the balance sheet and the income statement, so an unexplained backlog is invisible here.',
  'mgmt.noticeNeutral':
    'A transfer between your own accounts is logged in the book and counts in neither direction, so it is in none of these figures.',
  'mgmt.flowsTitle': 'Revenue against charges, per month',
  'mgmt.flowsLeadPosted':
    'Posted écritures only, and only the months that carry a movement. Months with nothing in them are absent from the series rather than drawn at zero — this is what the books hold, not a twelve-month shape with holes filled in.',
  'mgmt.flowsLeadAll':
    'Only the months that carry a movement. Months with nothing in them are absent from the series rather than drawn at zero — this is what the books hold, not a twelve-month shape with holes filled in.',
  'mgmt.breakdownTitle': 'Where the money goes — charges by category',
  'mgmt.breakdownLeadRi':
    'This book keeps recettes-dépenses, so a bucket is the category carried by each dépense rather than a mapping from ledger accounts. An uncategorised movement lands in its own named bucket instead of vanishing — the total is still the total.',
  'mgmt.breakdownLeadChart':
    'An inspectable mapping from ledger accounts to a cost bucket, and never a statutory line. A bucket with no postings this year is still on the screen: the set of buckets is configuration, so an absent one would say the bucket does not exist.',
  'mgmt.gapLead': 'This total is smaller than the charges above.',
  'mgmt.gapBody':
    'The breakdown counts only the accounts a category claims; the monthly series counts every charge account in the book. The difference is charges sitting in no active category.',
  'mgmt.retiredOne': '{n} retired category.',
  'mgmt.retiredMany': '{n} retired categories.',
  'mgmt.retiredBody':
    'A retired bucket is not deleted — a past analysis may cite a breakdown that used it — and its accounts are counted in no bar above:',
  'mgmt.footnote':
    'Runway, the recorded analyses and the tax position are not on this page. The first two arrive with the Analyses screen; the tax snapshot has its own screen and its own derivation, and a second copy of it here would be the one that went stale.',

  // ── <RunFigures> ────────────────────────────────────────────────────────
  'run.exerciceTotals': 'Exercice totals',
  'run.revenue': 'Revenue',
  'run.charges': 'Charges',
  'run.net': 'Net',

  // ── The runway, built 2026-08-21 from the bilan's trésorerie line ────────
  // `lib/runway.ts` refuses in four distinct ways and each one is a sentence
  // here, because *why there is no figure* is what the reader needs. None of
  // them is an error: a profitable book simply has no runway.
  'run.runway': 'Runway',
  'run.runwayMonths': '{n} months',
  'run.runwayBasis': 'CHF {cash} cash ÷ CHF {burn} a month, over {n} months served',
  'run.runwayNoBilan': 'this book keeps no balance sheet, so it states no cash',
  'run.runwayNoCash': 'the balance sheet carries no trésorerie position',
  'run.runwayNoMonths': 'nothing has been posted this year, so there is no rate',
  'run.runwayNotBurning': 'this book is not consuming cash — there is nothing to run out',
  'run.hintRiIn': 'recettes, cash basis',
  'run.hintRiOut': 'dépenses, cash basis',
  'run.hintRiNet': 'recettes − dépenses',
  'run.hintGlIn': 'class 3 accounts, posted',
  'run.hintGlOut': 'every other CR class, posted',
  'run.hintGlNet': 'revenue − charges',
  'run.hintUnknownIn': 'money in',
  'run.hintUnknownOut': 'money out',
  'run.hintUnknownNet': 'in − out',
  'run.emptyYear':
    'No month of this exercice carries a movement yet, so these totals are zero rather than unknown.',
  'run.summedOne':
    'Summed over the {n} month of this exercice that carries a movement — not over the whole year. A month with nothing in it is absent from the series entirely.',
  'run.summedMany':
    'Summed over the {n} months of this exercice that carry a movement — not over the whole year. A month with nothing in it is absent from the series entirely.',
  'run.backlog':
    'An unexplained backlog of staged entries understates the charges here; that is what the recognition worklist is for.',

  // ── <FlowsChart> ────────────────────────────────────────────────────────
  'chart.empty':
    'No month of this exercice carries a movement, so there is no series to draw. This is an empty year, not a failure.',
  'chart.altOne':
    'Revenue against charges for {n} month. The figures are in the table below.',
  'chart.altMany':
    'Revenue against charges for {n} months. The figures are in the table below.',
  'chart.hint':
    'Hover a column for its exact figure — every one of them is in the table below. Ticks are scale marks in CHF, not amounts.',
  'chart.caption':
    'Revenue and charges per month, for the months this book holds a movement in. The same figures are in the table that follows.',
  'chart.tableCaption': 'Revenue and charges per month',
  'chart.month': 'Month',
  'chart.amountsInChf': 'Amounts in CHF.',
  'chart.gapLead': 'A month is missing between these.',
  'chart.gapBody':
    'The series carries only months that hold a movement, and the columns are evenly spaced — so two neighbouring columns here are not always two consecutive months. Nothing has been drawn across the gap.',

  // ── <CostBreakdown> ─────────────────────────────────────────────────────
  'cost.emptyRi':
    'A book kept under art. 957 al. 2 CO has no chart of accounts, so there are no accounts to group into cost categories and no breakdown to derive. Its movements carry their own category, and the journal shows them.',
  'cost.emptyChart':
    'This book has no cost categories configured, so there is no breakdown to derive. Create one from the terminal with {command}.',
  'cost.noPostings': 'no postings',
  'cost.linesOne': '{n} line',
  'cost.linesMany': '{n} lines',
  'cost.hide': 'Hide',
  'cost.detail': 'Detail',
  'cost.total': 'Total, categorised charges',
  // ── THE BAR'S TOOLTIP ────────────────────────────────────────────────
  // It sits on the TRACK, not on the bar, so a zero bucket — which draws no
  // mark, deliberately — still has one. `cost.barTipZero` is what that bucket
  // says, and it says the zero rather than leaving the reader hovering a bar
  // that is not there.
  'cost.barTip': '{label} — {amount}, {pct}% of categorised charges',
  'cost.barTipNoShare': '{label} — {amount}',
  'cost.barTipZero': '{label} — {amount}. Nothing was posted to it in this exercice.',

  // ── the analyses journal ────────────────────────────────────────────────
  'analyses.uiName': 'What your agents were asked',
  'analyses.legalName': 'Analyses',
  'analyses.leadA':
    'Every what-if an agent answered for this book, as it filed it. The asking happens outside this app: you put the question to Companion or to Claude Code, the agent reads this book’s data and files its answer here.',
  'analyses.leadB': 'Nothing on this screen is recalculated and nothing on it can be edited',
  'analyses.leadC': '— a drifted answer is answered again, and both records stand.',
  'analyses.notFiltered':
    'The year selector above does not filter this list. An analysis belongs to a book and not to a fiscal year, so this is every answer filed for {book}, newest first.',
  'analyses.loading': 'Loading the analyses',
  'analyses.failed': 'The analyses could not be loaded',
  'analyses.empty': 'No analysis has been filed for this book.',
  'analyses.emptyBody':
    'Ask your agent — Companion, or Claude Code, outside this app — and its answer lands here as a record. There is no way to write one from this screen, deliberately: the answer and the figures it rested on are filed together by whoever produced them.',
  'analyses.askedBy': 'asked by {who}',
  'analyses.runwayAfterLabel': 'Runway after',
  'analyses.runwayMonths': '{n} mo',
  'analyses.inputsLabel': 'Inputs',
  'analyses.runwayAfter': 'runway after: {n} months',
  'analyses.inputsOne': '{n} recorded input',
  'analyses.inputsMany': '{n} recorded inputs',
  'analyses.openRecord': 'Open the record',

  // ── one analysis ────────────────────────────────────────────────────────
  'analysis.title': 'Analysis',
  'analysis.all': 'All analyses',
  'analysis.notANumber': '{value} is not an analysis number.',
  'analysis.notANumberBody':
    'An analysis is addressed by its workspace #number. The journal lists them, and {command} prints them.',
  'analysis.loading': 'Loading the analysis',
  'analysis.failed': 'This analysis could not be loaded',
  'analysis.book': 'book {slug}',
  'analysis.otherBookLead': 'This record belongs to another book.',
  'analysis.otherBookBody':
    'The selector above says {selected}; analysis #{number} was filed for {filed}. The record below is that book’s, unchanged — and the check further down describes the book the selector names, not this one.',
  'analysis.theAnswer': 'The answer',
  'analysis.runwayUnder': 'Runway under this scenario: {n} months.',
  'analysis.runwayNoDelta':
    'The record does not carry the runway before it, so this is the scenario’s figure and not a change.',
  'analysis.figuresTitle': 'The figures it gave',
  'analysis.readTitle': 'What the agent read',
  'analysis.readLead':
    'The inputs filed WITH the answer — a snapshot at the moment it was given, kept exactly as it was written.',
  'analysis.immutable':
    'This record cannot be edited or deleted through this product: there is no update route and no delete route, here or in {bk}. A better answer is a new one, and both stand. {command} prints it as stored.',

  // ── <FiguresTable> / <NoSnapshotNotice> ─────────────────────────────────
  'figures.hrefNote':
    'The addresses under each label are what the agent recorded as its source. They are references on the record, not links — this app does not serve them and cannot promise where one points.',
  'figures.droppedOne':
    '{n} further row is on this record and could not be read: it is missing a label or a value. Nothing was guessed and nothing was filled in. {command} prints the record as stored.',
  'figures.droppedMany':
    '{n} further rows are on this record and could not be read: they are missing a label or a value. Nothing was guessed and nothing was filled in. {command} prints the record as stored.',
  'figures.unreadableLead': 'This record’s snapshot could not be read.',
  'figures.unreadableBody':
    'The rows are on the record but none of them carries both a label and a value, so there is nothing this screen can show without inventing it.',
  'figures.noSnapshotLead': 'This answer was filed without a snapshot.',
  'figures.noSnapshotBody':
    'Nothing records what the agent read to produce it, so there is no way to tell what it rested on — or whether that has since changed. Analyses filed through {command} cannot be: the route refuses a based_on item with no label or value.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'mgmt.uiName': 'Vue de gestion',
  'mgmt.legalName': 'Compta analytique',
  'mgmt.loading': 'Chargement de la vue de gestion',
  'mgmt.failed': 'La vue de gestion n’a pas pu être établie',
  'mgmt.noticeLead': 'Comptabilité analytique — informative, non légale.',
  'mgmt.noticeBody':
    'De l’arithmétique sur les mouvements propres à ce livre. Rien sur cette page n’est déposé et rien n’y est stocké : chaque chiffre est dérivé à l’ouverture de la page.',
  'mgmt.noticeStaged':
    'Les écritures en attente sont exclues partout sur cette page, exactement comme elles le sont du bilan et du compte de résultat : un arriéré non expliqué y est donc invisible.',
  'mgmt.noticeNeutral':
    'Un transfert entre vos propres comptes est enregistré dans le livre et ne compte dans aucun sens : il n’entre donc dans aucun de ces chiffres.',
  'mgmt.flowsTitle': 'Produits et charges, par mois',
  'mgmt.flowsLeadPosted':
    'Écritures comptabilisées uniquement, et seulement les mois porteurs d’un mouvement. Les mois sans rien ne figurent pas dans la série plutôt que d’être tracés à zéro — c’est ce que contiennent les livres, pas une forme sur douze mois dont les trous auraient été comblés.',
  'mgmt.flowsLeadAll':
    'Seulement les mois porteurs d’un mouvement. Les mois sans rien ne figurent pas dans la série plutôt que d’être tracés à zéro — c’est ce que contiennent les livres, pas une forme sur douze mois dont les trous auraient été comblés.',
  'mgmt.breakdownTitle': 'Où va l’argent — charges par catégorie',
  'mgmt.breakdownLeadRi':
    'Ce livre tient des recettes-dépenses : un poste est donc la catégorie portée par chaque dépense, et non une correspondance depuis des comptes du grand livre. Un mouvement sans catégorie arrive dans son propre poste nommé plutôt que de disparaître — le total reste le total.',
  'mgmt.breakdownLeadChart':
    'Une correspondance inspectable des comptes du grand livre vers un poste de coût, et jamais une ligne légale. Un poste sans écriture cette année reste affiché : l’ensemble des postes est de la configuration, donc son absence signifierait que le poste n’existe pas.',
  'mgmt.gapLead': 'Ce total est inférieur aux charges ci-dessus.',
  'mgmt.gapBody':
    'La répartition ne compte que les comptes revendiqués par une catégorie ; la série mensuelle compte tous les comptes de charges du livre. L’écart, ce sont les charges qui ne relèvent d’aucune catégorie active.',
  'mgmt.retiredOne': '{n} catégorie retirée.',
  'mgmt.retiredMany': '{n} catégories retirées.',
  'mgmt.retiredBody':
    'Un poste retiré n’est pas supprimé — une analyse passée peut citer une répartition qui l’utilisait — et ses comptes ne sont comptés dans aucune barre ci-dessus :',
  'mgmt.footnote':
    'Le point mort, les analyses enregistrées et la position fiscale ne figurent pas sur cette page. Les deux premiers arrivent avec l’écran Analyses ; l’aperçu fiscal a son propre écran et sa propre dérivation, et une seconde copie ici serait celle qui se périmerait.',

  'run.exerciceTotals': 'Totaux de l’exercice',
  'run.revenue': 'Produits',
  'run.charges': 'Charges',
  'run.net': 'Net',

  'run.runway': 'Autonomie',
  'run.runwayMonths': '{n} mois',
  'run.runwayBasis':
    'CHF {cash} de trésorerie ÷ CHF {burn} par mois, sur {n} mois servis',
  'run.runwayNoBilan': 'ce livre ne tient pas de bilan et n’indique donc aucune trésorerie',
  'run.runwayNoCash': 'le bilan ne porte aucune position trésorerie',
  'run.runwayNoMonths': 'rien n’a été comptabilisé cette année : il n’y a pas de rythme',
  'run.runwayNotBurning':
    'ce livre ne consomme pas de trésorerie — il n’y a rien qui puisse s’épuiser',
  'run.hintRiIn': 'recettes, base encaissement',
  'run.hintRiOut': 'dépenses, base décaissement',
  'run.hintRiNet': 'recettes − dépenses',
  'run.hintGlIn': 'comptes de classe 3, comptabilisés',
  'run.hintGlOut': 'toutes les autres classes du CR, comptabilisées',
  'run.hintGlNet': 'produits − charges',
  'run.hintUnknownIn': 'entrées',
  'run.hintUnknownOut': 'sorties',
  'run.hintUnknownNet': 'entrées − sorties',
  'run.emptyYear':
    'Aucun mois de cet exercice ne porte encore de mouvement : ces totaux sont donc à zéro et non inconnus.',
  'run.summedOne':
    'Cumulé sur le {n} mois de cet exercice porteur d’un mouvement — pas sur l’année entière. Un mois sans rien est entièrement absent de la série.',
  'run.summedMany':
    'Cumulé sur les {n} mois de cet exercice porteurs d’un mouvement — pas sur l’année entière. Un mois sans rien est entièrement absent de la série.',
  'run.backlog':
    'Un arriéré d’écritures en attente non expliqué sous-estime les charges présentées ici ; c’est à cela que sert la file de reconnaissance.',

  'chart.empty':
    'Aucun mois de cet exercice ne porte de mouvement : il n’y a donc pas de série à tracer. C’est une année vide, pas un échec.',
  'chart.altOne':
    'Produits et charges sur {n} mois. Les chiffres figurent dans le tableau ci-dessous.',
  'chart.altMany':
    'Produits et charges sur {n} mois. Les chiffres figurent dans le tableau ci-dessous.',
  'chart.hint':
    'Survolez une colonne pour son chiffre exact — ils figurent tous dans le tableau ci-dessous. Les graduations sont des repères d’échelle en CHF, pas des montants.',
  'chart.caption':
    'Produits et charges par mois, pour les mois où ce livre porte un mouvement. Les mêmes chiffres figurent dans le tableau qui suit.',
  'chart.tableCaption': 'Produits et charges par mois',
  'chart.month': 'Mois',
  'chart.amountsInChf': 'Montants en CHF.',
  'chart.gapLead': 'Un mois manque entre ces deux-là.',
  'chart.gapBody':
    'La série ne porte que les mois contenant un mouvement, et les colonnes sont régulièrement espacées — deux colonnes voisines ne sont donc pas toujours deux mois consécutifs. Rien n’a été tracé par-dessus la lacune.',

  'cost.emptyRi':
    'Un livre tenu selon l’art. 957 al. 2 CO n’a pas de plan comptable : il n’y a donc pas de comptes à regrouper en postes de coûts ni de répartition à dériver. Ses mouvements portent leur propre catégorie, et le journal les montre.',
  'cost.emptyChart':
    'Ce livre n’a aucune catégorie de coûts configurée : il n’y a donc pas de répartition à dériver. Créez-en une depuis le terminal avec {command}.',
  'cost.noPostings': 'aucune écriture',
  'cost.linesOne': '{n} ligne',
  'cost.linesMany': '{n} lignes',
  'cost.hide': 'Masquer',
  'cost.detail': 'Détail',
  'cost.total': 'Total des charges catégorisées',
  'cost.barTip': '{label} — {amount}, {pct}% des charges catégorisées',
  'cost.barTipNoShare': '{label} — {amount}',
  'cost.barTipZero': '{label} — {amount}. Rien n’y a été comptabilisé dans cet exercice.',

  'analyses.uiName': 'Ce que vos agents ont été chargés d’examiner',
  'analyses.legalName': 'Analyses',
  'analyses.leadA':
    'Chaque scénario auquel un agent a répondu pour ce livre, tel qu’il l’a déposé. La demande se fait hors de cette application : vous posez la question à Companion ou à Claude Code, l’agent lit les données de ce livre et dépose sa réponse ici.',
  'analyses.leadB': 'Rien sur cet écran n’est recalculé et rien n’y est modifiable',
  'analyses.leadC': '— une réponse devenue caduque est reposée, et les deux enregistrements demeurent.',
  'analyses.notFiltered':
    'Le sélecteur d’exercice ci-dessus ne filtre pas cette liste. Une analyse appartient à un livre et non à un exercice : voici donc toutes les réponses déposées pour {book}, de la plus récente à la plus ancienne.',
  'analyses.loading': 'Chargement des analyses',
  'analyses.failed': 'Impossible de charger les analyses',
  'analyses.empty': 'Aucune analyse n’a été déposée pour ce livre.',
  'analyses.emptyBody':
    'Interrogez votre agent — Companion, ou Claude Code, hors de cette application — et sa réponse arrive ici sous forme d’enregistrement. Il n’y a délibérément aucun moyen d’en rédiger une depuis cet écran : la réponse et les chiffres sur lesquels elle reposait sont déposés ensemble par qui les a produits.',
  'analyses.askedBy': 'demandé par {who}',
  'analyses.runwayAfterLabel': 'Autonomie après',
  'analyses.runwayMonths': '{n} mois',
  'analyses.inputsLabel': 'Entrées',
  'analyses.runwayAfter': 'autonomie après : {n} mois',
  'analyses.inputsOne': '{n} donnée enregistrée',
  'analyses.inputsMany': '{n} données enregistrées',
  'analyses.openRecord': 'Ouvrir l’enregistrement',

  'analysis.title': 'Analyse',
  'analysis.all': 'Toutes les analyses',
  'analysis.notANumber': '{value} n’est pas un numéro d’analyse.',
  'analysis.notANumberBody':
    'Une analyse s’adresse par son #numéro d’espace de travail. Le journal les liste, et {command} les imprime.',
  'analysis.loading': 'Chargement de l’analyse',
  'analysis.failed': 'Impossible de charger cette analyse',
  'analysis.book': 'livre {slug}',
  'analysis.otherBookLead': 'Cet enregistrement appartient à un autre livre.',
  'analysis.otherBookBody':
    'Le sélecteur ci-dessus indique {selected} ; l’analyse #{number} a été déposée pour {filed}. L’enregistrement ci-dessous est celui de ce livre-là, inchangé — et la vérification plus bas décrit le livre que nomme le sélecteur, pas celui-ci.',
  'analysis.theAnswer': 'La réponse',
  'analysis.runwayUnder': 'Autonomie dans ce scénario : {n} mois.',
  'analysis.runwayNoDelta':
    'L’enregistrement ne porte pas l’autonomie antérieure : ce chiffre est donc celui du scénario et non une variation.',
  'analysis.figuresTitle': 'Les chiffres qu’il a donnés',
  'analysis.readTitle': 'Ce que l’agent a lu',
  'analysis.readLead':
    'Les données déposées AVEC la réponse — un instantané au moment où elle a été donnée, conservé exactement tel qu’il a été écrit.',
  'analysis.immutable':
    'Cet enregistrement ne peut être ni modifié ni supprimé par ce produit : il n’existe ni route de mise à jour ni route de suppression, ni ici ni dans {bk}. Une meilleure réponse est une nouvelle réponse, et les deux demeurent. {command} l’imprime tel que stocké.',

  'figures.hrefNote':
    'Les adresses sous chaque intitulé sont ce que l’agent a enregistré comme sa source. Ce sont des références sur l’enregistrement, pas des liens — cette application ne les sert pas et ne peut pas garantir où elles pointent.',
  'figures.droppedOne':
    '{n} ligne supplémentaire figure sur cet enregistrement et n’a pas pu être lue : il lui manque un intitulé ou une valeur. Rien n’a été deviné et rien n’a été complété. {command} imprime l’enregistrement tel que stocké.',
  'figures.droppedMany':
    '{n} lignes supplémentaires figurent sur cet enregistrement et n’ont pas pu être lues : il leur manque un intitulé ou une valeur. Rien n’a été deviné et rien n’a été complété. {command} imprime l’enregistrement tel que stocké.',
  'figures.unreadableLead': 'L’instantané de cet enregistrement n’a pas pu être lu.',
  'figures.unreadableBody':
    'Les lignes figurent sur l’enregistrement mais aucune ne porte à la fois un intitulé et une valeur : il n’y a donc rien que cet écran puisse afficher sans l’inventer.',
  'figures.noSnapshotLead': 'Cette réponse a été déposée sans instantané.',
  'figures.noSnapshotBody':
    'Rien n’enregistre ce que l’agent a lu pour la produire : il n’y a donc aucun moyen de savoir sur quoi elle reposait — ni si cela a changé depuis. Les analyses déposées via {command} ne le peuvent pas : la route refuse un élément based_on sans intitulé ni valeur.',
}
