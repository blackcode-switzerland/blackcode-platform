// The statutory tax snapshot, and the cited-figure component it is built from.
//
// ── THE ESTIMATE LABELS ARE FRENCH IN BOTH LANGUAGES ───────────────────────
// *Impôt cantonal*, *impôt communal*, *impôt fédéral direct*, *impôt sur le
// capital*: these are the names the cantonal and federal filings use, and this
// screen exists to be checked against one. They are the same kind of string as a
// statutory line label — `legal()`'s rule, applied to a screen that has no
// `{fr, en}` pair to apply it through, so it is applied here instead.
//
// What IS translated is everything around them: what the snapshot is, what it is
// not, and every caveat.

export const en = {
  'tax.uiName': 'Statutory tax position',
  'tax.legalName': 'Impôts',
  'tax.back': 'Overview',
  'tax.noticeLead': 'A snapshot, derived when this page was opened, and stored nowhere.',
  'tax.noticeBody':
    'It is not a tax return and it is not a position tracked over time. The two tax figures are ESTIMATES computed from this book’s own parameters; every one of them names the article it rests on, and a figure whose parameter a fiduciary has not confirmed says so beside itself.',
  'tax.loading': 'Deriving the tax position',
  'tax.failed': 'The tax position could not be derived',
  'tax.noneTitle': '{book} has no company tax position.',
  'tax.patrimoineLink': 'Patrimoine — the personal picture this book does keep',

  'tax.theBook': 'The book',
  'tax.resultat': 'Résultat de l’exercice',
  'tax.equity': 'Capitaux propres',
  'tax.bookNote':
    'Both come straight from this book’s statements — the income statement’s result and the balance sheet’s equity, posted entries only. They are figures, not estimates, and everything below is computed from them.',

  'tax.tva': 'TVA',
  'tax.notRegistered':
    'This book is not registered for VAT, so there is no position to state. That is not a zero: a zero would say it is registered and owes nothing.',
  'tax.vatOpening': 'Opening balance due',
  'tax.vatOutput': 'Output VAT this year',
  'tax.vatInput': 'Input VAT claimed this year',
  'tax.vatNet': 'Net due',
  'tax.vatNote':
    'Posted entries only. “Claimed” is the operative word on the third line: input VAT counts here when the entry says it was claimed, and that column is tied to full evidence by the database — a bank record supports a profit-tax deduction and can never support an input VAT claim (art. 26 LTVA).',

  'tax.companyTaxes': 'Company taxes',
  'tax.noParamsLead': 'This book has no tax parameters on record.',
  'tax.noParamsBody':
    'The canton, the commune, the rates and the articles they rest on are properties of the book and this one carries none — so there is no estimate to make. Nothing is defaulted here: a rate taken from another book would be an invented tax bill.',
  'tax.unsettledLead': 'At least one parameter below has not been confirmed by a fiduciary.',
  'tax.unsettledBody': 'Each figure says which, and why, where it stands.',
  'tax.profitTaxHeading': 'Impôt sur le bénéfice — {canton} / {commune}',
  'tax.cantonCommuneNote':
    'The canton and the commune are properties of this book, not of this app.',
  'tax.cantonal': 'Impôt cantonal',
  'tax.communal': 'Impôt communal',
  'tax.ifd': 'Impôt fédéral direct',
  'tax.total': 'Total',
  'tax.rates':
    'Statutory rate {statutory}, effective rate {effective}. They differ because the taxes are themselves deductible, so the rate applied to a pre-tax result is lower than the rate the law names. A figure computed at one and read at the other is wrong by the difference.',
  'tax.lossYear':
    'The result for this exercice is negative, so the profit tax computes as zero. A loss is not a refund — it is zero tax on no profit.',

  'tax.capitalTax': 'Impôt sur le capital',
  'tax.capitalWorking':
    'Gross {gross} on this book’s equity, less {credited} credited against the cantonal and communal profit tax.',
  'tax.capitalNote':
    'The credit only bites in a loss or low-profit year: where there is profit tax to absorb it, the capital tax is largely imputed away. That is why the gross and the credit are both on the page — whether the imputation applies exactly this way is the open question above, and the two figures are what let a reader apply either reading.',
  'tax.footnote':
    'Every figure here is derived when the page is opened and none of it is stored. {command} prints the same snapshot.',

  // ── <CitedFigure> ───────────────────────────────────────────────────────
  'cited.noArticle': 'No article is recorded for this figure in this book’s tax parameters.',
  'cited.notConfirmed': 'Not confirmed by a fiduciary.',
  'cited.notConfirmedDefault':
    'This book’s parameters do not record that anybody has settled this one, so the figure is an estimate on an unsettled basis.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'tax.uiName': 'Position fiscale légale',
  'tax.legalName': 'Impôts',
  'tax.back': 'Vue d’ensemble',
  'tax.noticeLead': 'Un instantané, dérivé à l’ouverture de cette page et stocké nulle part.',
  'tax.noticeBody':
    'Ce n’est pas une déclaration d’impôt et ce n’est pas une position suivie dans le temps. Les deux chiffres d’impôt sont des ESTIMATIONS calculées à partir des paramètres propres à ce livre ; chacun nomme l’article sur lequel il repose, et un chiffre dont le paramètre n’a pas été confirmé par un fiduciaire le dit à côté de lui.',
  'tax.loading': 'Dérivation de la position fiscale',
  'tax.failed': 'La position fiscale n’a pas pu être établie',
  'tax.noneTitle': '{book} n’a pas de position fiscale d’entreprise.',
  'tax.patrimoineLink': 'Patrimoine — l’image personnelle que ce livre tient bel et bien',

  'tax.theBook': 'Le livre',
  'tax.resultat': 'Résultat de l’exercice',
  'tax.equity': 'Capitaux propres',
  'tax.bookNote':
    'Les deux proviennent directement des états de ce livre — le résultat du compte de résultat et les fonds propres du bilan, écritures comptabilisées uniquement. Ce sont des chiffres, pas des estimations, et tout ce qui suit en est calculé.',

  'tax.tva': 'TVA',
  'tax.notRegistered':
    'Ce livre n’est pas assujetti à la TVA : il n’y a donc pas de position à indiquer. Ce n’est pas un zéro : un zéro dirait qu’il est assujetti et ne doit rien.',
  'tax.vatOpening': 'Solde dû à l’ouverture',
  'tax.vatOutput': 'TVA collectée cette année',
  'tax.vatInput': 'Impôt préalable déduit cette année',
  'tax.vatNet': 'Net dû',
  'tax.vatNote':
    'Écritures comptabilisées uniquement. « Déduit » est le mot déterminant à la troisième ligne : l’impôt préalable compte ici lorsque l’écriture dit qu’il a été déduit, et cette colonne est liée par la base de données à une pièce complète — un relevé bancaire justifie une déduction pour l’impôt sur le bénéfice et ne peut jamais justifier une déduction de l’impôt préalable (art. 26 LTVA).',

  'tax.companyTaxes': 'Impôts de la société',
  'tax.noParamsLead': 'Ce livre ne comporte aucun paramètre fiscal enregistré.',
  'tax.noParamsBody':
    'Le canton, la commune, les taux et les articles sur lesquels ils reposent sont des propriétés du livre, et celui-ci n’en porte aucune — il n’y a donc pas d’estimation à faire. Rien n’est mis par défaut ici : un taux repris d’un autre livre serait une charge fiscale inventée.',
  'tax.unsettledLead': 'Au moins un paramètre ci-dessous n’a pas été confirmé par un fiduciaire.',
  'tax.unsettledBody': 'Chaque chiffre indique lequel, et pourquoi, à l’endroit où il figure.',
  'tax.profitTaxHeading': 'Impôt sur le bénéfice — {canton} / {commune}',
  'tax.cantonCommuneNote':
    'Le canton et la commune sont des propriétés de ce livre, non de cette application.',
  'tax.cantonal': 'Impôt cantonal',
  'tax.communal': 'Impôt communal',
  'tax.ifd': 'Impôt fédéral direct',
  'tax.total': 'Total',
  'tax.rates':
    'Taux légal {statutory}, taux effectif {effective}. Ils diffèrent parce que les impôts sont eux-mêmes déductibles : le taux appliqué à un résultat avant impôt est donc inférieur au taux nommé par la loi. Un chiffre calculé à l’un et lu à l’autre est faux de la différence.',
  'tax.lossYear':
    'Le résultat de cet exercice est négatif : l’impôt sur le bénéfice se calcule donc à zéro. Une perte n’est pas un remboursement — c’est un impôt nul sur un bénéfice nul.',

  'tax.capitalTax': 'Impôt sur le capital',
  'tax.capitalWorking':
    'Brut {gross} sur les fonds propres de ce livre, moins {credited} imputés sur l’impôt cantonal et communal sur le bénéfice.',
  'tax.capitalNote':
    'L’imputation ne mord qu’en année de perte ou de faible bénéfice : lorsqu’il y a de l’impôt sur le bénéfice pour l’absorber, l’impôt sur le capital est largement imputé. C’est pourquoi le brut et l’imputation figurent tous deux sur la page — savoir si l’imputation s’applique exactement ainsi est la question ouverte ci-dessus, et ces deux chiffres permettent d’appliquer l’une ou l’autre lecture.',
  'tax.footnote':
    'Chaque chiffre présenté ici est dérivé à l’ouverture de la page et rien n’en est stocké. {command} imprime le même instantané.',

  'cited.noArticle':
    'Aucun article n’est enregistré pour ce chiffre dans les paramètres fiscaux de ce livre.',
  'cited.notConfirmed': 'Non confirmé par un fiduciaire.',
  'cited.notConfirmedDefault':
    'Les paramètres de ce livre n’enregistrent pas que quelqu’un ait tranché ce point : le chiffre est donc une estimation sur une base non arrêtée.',
}
