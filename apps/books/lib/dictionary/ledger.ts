// The ledger: the grand livre and the recettes-dépenses journal, the entry
// detail page, and the post-entry form.
//
// ── THE DOCUMENT'S NAME COMES FROM `lib/journal.ts`, NOT FROM HERE ─────────
// `JOURNAL_NAME` already carries `{fr, en}` for both journals, and the ledger
// heading follows the same rule the statement headings do: the reader's language
// as the h1, the legal French beneath, and nothing beneath when the two are the
// same string. It is served from that table rather than duplicated here, because
// two copies of "Grand livre" is one to go stale.

export const en = {
  'ledger.resolvingJournal': 'Resolving which journal this book keeps',
  'ledger.subheading': '{book} · exercice {year}',
  'ledger.riNoteBefore':
    'This book is kept under art. 957 al. 2 CO — recettes and dépenses, with no double entry behind them. There are no accounts and no posting step: a movement is a fact on arrival. Its net worth is on',
  'ledger.riNoteLink': 'the patrimoine statement',
  'ledger.riNoteAfter': ', which is the other half of what that article requires.',

  'ledger.filtered': 'Filtered',
  'ledger.filterAccount': 'account {value}',
  'ledger.filterStatus': 'status {value}',
  'ledger.filterRecognition': 'recognition {value}',
  'ledger.removeFilter': 'Remove the {label} filter',
  'ledger.accountFilterNote':
    'Whole entries that touch this account — both sides are shown, not just the matching line.',
  'ledger.ignoredLead': 'The address asked to filter by {fields}, and',
  'ledger.ignoredRi':
    'this journal has neither a posting status nor accounts to filter by. The list below is the whole journal, unfiltered — the drill-down you followed was built for a double-entry book.',
  'ledger.ignoredUnknown':
    'which journal this book keeps is not known yet, so no filter has been applied. The list below is unfiltered.',
  'ledger.and': 'and',

  'ledger.colAccountName': 'Account',
  'ledger.colNo': 'N°',
  'ledger.colDate': 'Date',
  'ledger.colEntry': 'Entry',
  'ledger.colMovement': 'Movement',
  'ledger.colCategory': 'Category',
  'ledger.colDirection': 'Direction',
  'ledger.colAmount': 'Amount',
  'ledger.colRecognition': 'Recognition',
  'ledger.colEvidence': 'Evidence',
  'ledger.colStatus': 'Status',
  'ledger.colNumber': '#',

  // ── THE RESULT COUNT ─────────────────────────────────────────────────
  // One number, never two. `GET …/entries` serves no total of any kind, so
  // "N of M" is a sentence this screen has no figure for, and a second
  // placeholder in any of these is a claim the wire cannot support.
  // `lib/count-honesty.test.ts` fails on one.
  //
  // ── THE CAVEAT IS NOW CONDITIONAL, AND IT WAS WRONG BEFORE (2026-08-21) ──
  // Every one of these said "on this page" and printed
  // `ledger.countNotTotal` beside it, unconditionally. That was over-cautious
  // to the point of being inaccurate in three of the four cases:
  //
  //   · `listRiEntries` takes NO options and applies NO limit — the
  //     recettes-dépenses journal is served WHOLE. Its count was always a
  //     true total and the page disclaimed it anyway.
  //   · the grand livre is capped, but the ledger now asks for `LEDGER_LIMIT`
  //     and can SEE when it came back full. Under the cap, everything the
  //     filter matched was returned and the count is true.
  //
  // A caveat printed on a figure that does not need one is not free: it
  // teaches the reader to skip caveats, and this app prints several that
  // genuinely matter. So it is printed when it is TRUE — at the cap — and the
  // count stands alone otherwise.
  'ledger.countOne': '{n} entry',
  'ledger.countMany': '{n} entries',
  'ledger.riCountOne': '{n} movement',
  'ledger.riCountMany': '{n} movements',
  'ledger.countNotTotal': 'what this page loaded, not a count of the journal',
  // Printed only when `rows.length === LEDGER_LIMIT`, which is the one state in
  // which the list really is short and nothing on the wire says so.
  'ledger.countAtCap':
    'this is the most the server will serve at once — the journal may hold more',

  // ── Section labels and the totals strip (2026-08-21) ────────────────────
  'ledger.entriesLabel': 'Écritures',
  'ledger.movementsLabel': 'Movements',
  'ledger.totalDebit': 'Debit',
  'ledger.totalCredit': 'Credit',
  'ledger.totalNet': 'Net movement',
  // What the figures above are OF. Every derived figure in this app says what
  // it was computed from — `<RunFigures>` is the precedent.
  'ledger.totalBasis': 'account {account}, {lines} lines on this page',
  'ledger.totalRiBasis': 'the {n} movements listed below',
  'ledger.totalNeutral': 'Neutral',
  'ledger.totalNeutralBasis': 'in neither total — art. 957 al. 2, own-account transfers',
  'ledger.unknownDirection':
    '{n} movements carry a direction this page does not know, and are counted in no total above. They are listed below with the direction the server sent. This is a frontend that has fallen behind the data, not a problem with the records.',

  'ledger.emptyFiltered': 'No entry matches these filters.',
  'ledger.emptyFilteredBody':
    'The book has entries; none of them satisfy every filter above at once.',
  'ledger.empty': 'No entries in this exercice.',
  'ledger.emptyBody': 'Nothing has been posted or staged for {book} in {year}.',
  'ledger.riEmptyFiltered': 'No movement matches that filter.',
  'ledger.riEmptyFilteredBody':
    'The journal has movements; none of them are in that recognition state.',
  'ledger.riEmpty': 'No movements in this exercice.',
  'ledger.riEmptyBody': 'Nothing has been recorded for {book} in {year}.',
  'ledger.riFootnote':
    'A movement is shown unsigned and its direction is a column: a {neutral} transfer between your own accounts is recorded here and counts in neither recettes nor dépenses. These rows have no detail page — the two journals number themselves separately, so this #number is not an écriture’s.',

  'ledger.loadingJournal': 'Loading the journal',
  'ledger.noSuchBook': 'No book by that name.',
  'ledger.noSuchBookBody':
    'The address asks for {slug}, and this account has no book with that name. Choose one from the switcher above.',
  'ledger.unknownJournal': 'This book keeps a journal this version does not know.',
  'ledger.unknownJournalBody':
    '{book} records its bookkeeping regime as {regime}, and this app knows how to read a journal for a double-entry book and for a simplified one.',
  'ledger.unknownJournalBody2':
    'Nothing has been requested, because the shape of the answer is what is unknown — showing you one of the two would be a guess. {command} reads it either way.',

  // ── the entry detail page ───────────────────────────────────────────────
  'entry.loading': 'Loading the entry',
  'entry.failed': 'This entry could not be loaded',
  'entry.notFound': 'No entry #{n} in this book.',
  'entry.notFoundBody':
    'The two journals number themselves separately, so a #number from one names a different record — or none — in the other. Nothing here was guessed at.',
  'entry.backToLedger': 'Back to the journal',
  'entry.whatItMeans': 'What this means',
  'entry.noExplanation': 'No explanation has been recorded. That is why it is on the worklist.',
  'entry.lines': 'Lines',
  'entry.colAccount': 'Account',
  'entry.debit': 'Débit',
  'entry.credit': 'Crédit',
  'entry.evidence': 'Evidence',
  'entry.evidenceNote': 'Evidence note',
  'entry.history': 'History',
  'entry.neverChanged': 'This entry has never been changed.',
  'entry.source': 'Source',
  'entry.noSource': 'No source is recorded for this entry.',
  'entry.counterparty': 'Counterparty',
  'entry.journalNo': 'Journal n°',
  // ── The headline strip (2026-08-21) ──────────────────────────────────
  // "How much was it" is the first question anybody asks of an écriture, and
  // this page could not answer it without the reader adding up the lines.
  'entry.numberTitle': 'The entry’s address — what /ledger/{n} and bk books entry show take',
  'entry.journalNoBasis': 'gapless within this book and year',
  'entry.creditSide': 'Credit side',
  'entry.unbalancedBasis': 'debit side — this entry does not balance yet',
  'entry.unbalancedNote': 'a staged entry may be unbalanced; posting refuses until it is not',
  'entry.postedOn': 'Posted on',
  'entry.compliance': 'Compliance',
  'entry.transaction': 'Transaction',
  'entry.notANumber': '{value} is not an entry number.',
  'entry.notANumberBody':
    'An entry is addressed by its #number — a positive integer. The general ledger lists them.',
  'entry.riNoEcritures': '{book} keeps no écritures.',
  'entry.riNoEcrituresBody':
    'Movement #{n} is a recette or a dépense under art. 957 al. 2 CO — one amount and a direction, with no debit, no credit and no posting step. There is no detail screen for one yet; the journal shows every field it has.',
  'entry.backToRi': 'Back to receipts and expenses',
  'entry.notScoped':
    'An entry is addressed by its workspace #number, so the book and fiscal year selectors above do not filter this screen and it does not name a book — this record does not carry one.',
  'entry.posting': 'Posting',
  'entry.stagedNote':
    'This entry is staged. It is recorded and it counts in nothing: the balance sheet and the income statement both derive from posted entries only.',
  'entry.blockedNote':
    'A compliance pass has blocked this entry, so posting it will be refused. The refusal is the server’s and it carries the pass’s own way out — the panel above has it too.',
  'entry.whatThisIs': 'What this is',
  'entry.nobodySaid':
    'Nobody has said yet what this entry means. That is what the Recognition screen is for.',
  'entry.ecriture': 'The écriture',
  'entry.originalCurrency': 'Original currency',
  'entry.originalAmount': 'Original amount',
  'entry.rate': 'Rate',
  'entry.rateSource': 'Rate source',
  'entry.fxNote':
    'Recorded as the issuer stated it. The écriture above is in CHF and is what the books hold; nothing here is used to derive a figure.',
  'entry.vat': 'VAT',
  'entry.amount': 'Amount',
  'entry.inputClaimed': 'Input claimed',
  'entry.yes': 'Yes',
  'entry.no': 'No',
  'entry.vatNote':
    'Independent of the evidence tier, always. A bank record can support a profit-tax deduction (LIFD art. 58) and never an input VAT claim (LTVA art. 26).',
  'entry.supportingDocument': 'Supporting document',
  'entry.relatedParty': 'Related party — art. 959a al. 4 CO',
  'entry.counterpart': 'Counterpart',
  'entry.kind': 'Kind',
  'entry.mirrorEntry': 'Mirror entry',
  'entry.notRecorded': 'Not recorded',
  'entry.idValue': 'id {id}',
  'entry.noJustification':
    'No arm’s-length justification is recorded. That absence is the audit risk.',
  'entry.provenance': 'Provenance',
  'entry.matchedRule': 'Matched rule',
  'entry.none': 'None',
  'entry.reverses': 'Reverses',
  'entry.nothing': 'Nothing',
  'entry.provenanceNote':
    'Source, rule, mirror and reversal are internal ids and are not addressable from this app. The journal n° is the statutory one, gapless within the book and the year — it is not the #number in the header, and the two are not interchangeable.',

  // ── <PostEntryForm> ─────────────────────────────────────────────────────
  'post.title': 'Post this entry',
  'post.body':
    'Posting is irreversible. A posted entry counts in the balance sheet and the income statement, its lines become accounting facts, and the only correction afterwards is a reversing entry.',
  'post.confirmLabel': 'Type the entry number to confirm',
  'post.confirmPlaceholder': 'the #number above',
  'post.confirmNote':
    'Repeated back rather than clicked through — this is the same discipline the CLI’s irreversible verbs use, and for the same reason: a confirmation nobody has to read is not one.',
  'post.button': 'Post entry #{n}',
  'post.posting': 'Posting…',
  'post.cancel': 'Cancel',
  'post.posted': 'Entry #{n} is posted.',
  'post.cannotWrite': 'This session cannot post entries.',
  'post.mismatch': 'That is not this entry’s number.',
  'post.cannotWriteHere': 'This session cannot change records, so this entry cannot be posted here.',
  'post.open': 'Post this entry',
  'post.cannotUndo': 'This cannot be undone.',
  'post.fixedItem':
    'The date, the amounts and the accounts of this entry are fixed from now on. Nobody can change them — not you, not an agent, not the database owner. A correction becomes a new reversing entry sitting beside this one.',
  'post.meaningItem':
    'What it means can still be revised. The explanation, the counterparty, the recognition state and the supporting document stay open, and each revision keeps what was there before.',
  'post.countsItem':
    'It starts counting in the balance sheet and the income statement. Staged entries are excluded from both.',
  'post.restated': 'Posting #{number} — journal n° {journalNo} — {label}',
  'post.typeToConfirm': 'Type {number} to confirm',
  'post.submit': 'Post entry',
  'post.why':
    'The entry’s own #number, so that this is typed against the record in front of you rather than pressed. The database checks the entry again at the last moment — balanced, at least two lines, every line mapped — and refuses in its own words if it is not.',
  'post.verdictBlocked':
    'That is a compliance pass refusing, not the books. The entry is unchanged and still staged. There is no override: what clears it is a fresh verdict from a pass that no longer finds the problem.',
  'post.guardRefused':
    'That is the database refusing at the last moment, in its own words. The entry was not posted and nothing about it changed.',
  'post.alreadyLead': 'Already posted.',
  'post.alreadyBody':
    'Entry #{number} (journal n° {journalNo}) was in the books before this. Nothing changed, and that is not a failure — this write is deliberately safe to repeat, because the agents that drive this product retry.',
  'post.postedLead': 'Posted.',
  'post.postedBody':
    'Entry #{number} is journal n° {journalNo} and is now part of the record. Its amounts and accounts are fixed; a correction from here is a new reversing entry.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'ledger.resolvingJournal': 'Détermination du journal tenu par ce livre',
  'ledger.subheading': '{book} · exercice {year}',
  'ledger.riNoteBefore':
    'Ce livre est tenu selon l’art. 957 al. 2 CO — recettes et dépenses, sans partie double derrière. Il n’y a ni comptes ni étape de comptabilisation : un mouvement est un fait dès son arrivée. Son patrimoine net figure sur',
  'ledger.riNoteLink': 'l’état du patrimoine',
  'ledger.riNoteAfter': ', qui est l’autre moitié de ce qu’exige cet article.',

  'ledger.filtered': 'Filtré',
  'ledger.filterAccount': 'compte {value}',
  'ledger.filterStatus': 'statut {value}',
  'ledger.filterRecognition': 'reconnaissance {value}',
  'ledger.removeFilter': 'Retirer le filtre {label}',
  'ledger.accountFilterNote':
    'Les écritures entières qui touchent ce compte — les deux côtés sont affichés, pas seulement la ligne correspondante.',
  'ledger.ignoredLead': 'L’adresse demandait de filtrer par {fields}, et',
  'ledger.ignoredRi':
    'ce journal n’a ni statut de comptabilisation ni comptes sur lesquels filtrer. La liste ci-dessous est le journal entier, non filtré — le détail que vous avez suivi a été conçu pour un livre en partie double.',
  'ledger.ignoredUnknown':
    'le type de journal tenu par ce livre n’est pas encore connu : aucun filtre n’a donc été appliqué. La liste ci-dessous n’est pas filtrée.',
  'ledger.and': 'et',

  'ledger.colAccountName': 'Compte',
  'ledger.colNo': 'N°',
  'ledger.colDate': 'Date',
  'ledger.colEntry': 'Écriture',
  'ledger.colMovement': 'Mouvement',
  'ledger.colCategory': 'Catégorie',
  'ledger.colDirection': 'Sens',
  'ledger.colAmount': 'Montant',
  'ledger.colRecognition': 'Reconnaissance',
  'ledger.colEvidence': 'Pièce',
  'ledger.colStatus': 'Statut',
  'ledger.colNumber': '#',

  'ledger.countOne': '{n} écriture',
  'ledger.countMany': '{n} écritures',
  'ledger.riCountOne': '{n} mouvement',
  'ledger.riCountMany': '{n} mouvements',
  'ledger.countNotTotal': 'ce que cette page a chargé, et non un décompte du journal',
  'ledger.countAtCap':
    'c’est le maximum que le serveur renvoie d’un coup — le journal peut en contenir davantage',

  'ledger.entriesLabel': 'Écritures',
  'ledger.movementsLabel': 'Mouvements',
  'ledger.totalDebit': 'Débit',
  'ledger.totalCredit': 'Crédit',
  'ledger.totalNet': 'Mouvement net',
  'ledger.totalBasis': 'compte {account}, {lines} lignes sur cette page',
  'ledger.totalRiBasis': 'les {n} mouvements listés ci-dessous',
  'ledger.totalNeutral': 'Neutre',
  'ledger.totalNeutralBasis':
    'dans aucun des deux totaux — art. 957 al. 2, virements entre comptes propres',
  'ledger.unknownDirection':
    '{n} mouvements portent un sens que cette page ne connaît pas ; ils ne sont comptés dans aucun total ci-dessus. Ils figurent ci-dessous avec le sens envoyé par le serveur. C’est une interface en retard sur les données, et non un problème dans les enregistrements.',

  'ledger.emptyFiltered': 'Aucune écriture ne correspond à ces filtres.',
  'ledger.emptyFilteredBody':
    'Le livre contient des écritures ; aucune ne satisfait tous les filtres ci-dessus à la fois.',
  'ledger.empty': 'Aucune écriture dans cet exercice.',
  'ledger.emptyBody': 'Rien n’a été comptabilisé ni mis en attente pour {book} en {year}.',
  'ledger.riEmptyFiltered': 'Aucun mouvement ne correspond à ce filtre.',
  'ledger.riEmptyFilteredBody':
    'Le journal contient des mouvements ; aucun n’est dans cet état de reconnaissance.',
  'ledger.riEmpty': 'Aucun mouvement dans cet exercice.',
  'ledger.riEmptyBody': 'Rien n’a été enregistré pour {book} en {year}.',
  'ledger.riFootnote':
    'Un mouvement est affiché sans signe et son sens est une colonne : un transfert {neutral} entre vos propres comptes est enregistré ici et ne compte ni en recettes ni en dépenses. Ces lignes n’ont pas de page de détail — les deux journaux se numérotent séparément, ce #numéro n’est donc pas celui d’une écriture.',

  'ledger.loadingJournal': 'Chargement du journal',
  'ledger.noSuchBook': 'Aucun livre de ce nom.',
  'ledger.noSuchBookBody':
    'L’adresse demande {slug}, et ce compte n’a aucun livre de ce nom. Choisissez-en un dans le sélecteur ci-dessus.',
  'ledger.unknownJournal': 'Ce livre tient un journal que cette version ne connaît pas.',
  'ledger.unknownJournalBody':
    '{book} enregistre son régime comptable comme {regime}, et cette application sait lire un journal de livre en partie double et de livre simplifié.',
  'ledger.unknownJournalBody2':
    'Rien n’a été demandé, car c’est précisément la forme de la réponse qui est inconnue — vous en montrer l’une des deux serait une supposition. {command} le lit dans les deux cas.',

  'entry.loading': 'Chargement de l’écriture',
  'entry.failed': 'Impossible de charger cette écriture',
  'entry.notFound': 'Aucune écriture #{n} dans ce livre.',
  'entry.notFoundBody':
    'Les deux journaux se numérotent séparément : un #numéro de l’un désigne un enregistrement différent — ou aucun — dans l’autre. Rien ici n’a été deviné.',
  'entry.backToLedger': 'Retour au journal',
  'entry.whatItMeans': 'Ce que cela signifie',
  'entry.noExplanation':
    'Aucune explication n’a été enregistrée. C’est pour cela qu’elle est dans la file.',
  'entry.lines': 'Lignes',
  'entry.colAccount': 'Compte',
  'entry.debit': 'Débit',
  'entry.credit': 'Crédit',
  'entry.evidence': 'Pièce justificative',
  'entry.evidenceNote': 'Note sur la pièce',
  'entry.history': 'Historique',
  'entry.neverChanged': 'Cette écriture n’a jamais été modifiée.',
  'entry.source': 'Source',
  'entry.noSource': 'Aucune source n’est enregistrée pour cette écriture.',
  'entry.counterparty': 'Contrepartie',
  'entry.journalNo': 'N° de journal',
  'entry.numberTitle': 'L’adresse de l’écriture — ce que prennent /ledger/{n} et bk books entry show',
  'entry.journalNoBasis': 'sans lacune dans ce livre et cet exercice',
  'entry.creditSide': 'Côté crédit',
  'entry.unbalancedBasis': 'côté débit — cette écriture ne s’équilibre pas encore',
  'entry.unbalancedNote':
    'une écriture en attente peut être déséquilibrée ; la comptabilisation refuse tant qu’elle l’est',
  'entry.postedOn': 'Comptabilisée le',
  'entry.compliance': 'Conformité',
  'entry.transaction': 'Transaction',
  'entry.notANumber': '{value} n’est pas un numéro d’écriture.',
  'entry.notANumberBody':
    'Une écriture s’adresse par son #numéro — un entier positif. Le grand livre les liste.',
  'entry.riNoEcritures': '{book} ne tient pas d’écritures.',
  'entry.riNoEcrituresBody':
    'Le mouvement #{n} est une recette ou une dépense au sens de l’art. 957 al. 2 CO — un montant et un sens, sans débit, sans crédit et sans étape de comptabilisation. Il n’existe pas encore d’écran de détail pour un tel mouvement ; le journal en montre tous les champs.',
  'entry.backToRi': 'Retour aux recettes et dépenses',
  'entry.notScoped':
    'Une écriture s’adresse par son #numéro d’espace de travail : les sélecteurs de livre et d’exercice ci-dessus ne filtrent donc pas cet écran, et celui-ci ne nomme aucun livre — cet enregistrement n’en porte pas.',
  'entry.posting': 'Comptabilisation',
  'entry.stagedNote':
    'Cette écriture est en attente. Elle est enregistrée et ne compte dans rien : le bilan et le compte de résultat dérivent tous deux des seules écritures comptabilisées.',
  'entry.blockedNote':
    'Un contrôle de conformité a bloqué cette écriture : sa comptabilisation sera refusée. Le refus est celui du serveur et il porte la sortie prévue par le contrôle — le panneau ci-dessus l’indique également.',
  'entry.whatThisIs': 'Ce que c’est',
  'entry.nobodySaid':
    'Personne n’a encore dit ce que signifie cette écriture. C’est à cela que sert l’écran Reconnaissance.',
  'entry.ecriture': 'L’écriture',
  'entry.originalCurrency': 'Monnaie d’origine',
  'entry.originalAmount': 'Montant d’origine',
  'entry.rate': 'Cours',
  'entry.rateSource': 'Source du cours',
  'entry.fxNote':
    'Enregistré tel que l’émetteur l’a indiqué. L’écriture ci-dessus est en CHF et c’est elle que contiennent les livres ; rien ici ne sert à dériver un chiffre.',
  'entry.vat': 'TVA',
  'entry.amount': 'Montant',
  'entry.inputClaimed': 'Impôt préalable déduit',
  'entry.yes': 'Oui',
  'entry.no': 'Non',
  'entry.vatNote':
    'Indépendant du niveau de pièce, toujours. Un relevé bancaire peut justifier une déduction pour l’impôt sur le bénéfice (art. 58 LIFD) et jamais une déduction de l’impôt préalable (art. 26 LTVA).',
  'entry.supportingDocument': 'Pièce justificative',
  'entry.relatedParty': 'Partie liée — art. 959a al. 4 CO',
  'entry.counterpart': 'Contrepartie',
  'entry.kind': 'Nature',
  'entry.mirrorEntry': 'Écriture miroir',
  'entry.notRecorded': 'Non enregistré',
  'entry.idValue': 'id {id}',
  'entry.noJustification':
    'Aucune justification de pleine concurrence n’est enregistrée. Cette absence est le risque d’audit.',
  'entry.provenance': 'Provenance',
  'entry.matchedRule': 'Règle appliquée',
  'entry.none': 'Aucune',
  'entry.reverses': 'Extourne',
  'entry.nothing': 'Rien',
  'entry.provenanceNote':
    'La source, la règle, le miroir et l’extourne sont des identifiants internes et ne sont pas adressables depuis cette application. Le n° de journal est le numéro légal, sans lacune dans le livre et l’exercice — ce n’est pas le #numéro en en-tête, et les deux ne sont pas interchangeables.',

  'post.title': 'Comptabiliser cette écriture',
  'post.body':
    'La comptabilisation est irréversible. Une écriture comptabilisée compte dans le bilan et le compte de résultat, ses lignes deviennent des faits comptables, et la seule correction possible ensuite est une écriture d’extourne.',
  'post.confirmLabel': 'Saisissez le numéro de l’écriture pour confirmer',
  'post.confirmPlaceholder': 'le #numéro ci-dessus',
  'post.confirmNote':
    'Redemandé plutôt que confirmé d’un clic — c’est la discipline qu’appliquent les verbes irréversibles du CLI, et pour la même raison : une confirmation que personne n’a besoin de lire n’en est pas une.',
  'post.button': 'Comptabiliser l’écriture #{n}',
  'post.posting': 'Comptabilisation…',
  'post.cancel': 'Annuler',
  'post.posted': 'L’écriture #{n} est comptabilisée.',
  'post.cannotWrite': 'Cette session ne peut pas comptabiliser d’écritures.',
  'post.mismatch': 'Ce n’est pas le numéro de cette écriture.',
  'post.cannotWriteHere':
    'Cette session ne peut pas modifier d’enregistrements : cette écriture ne peut donc pas être comptabilisée ici.',
  'post.open': 'Comptabiliser cette écriture',
  'post.cannotUndo': 'Ceci est irréversible.',
  'post.fixedItem':
    'La date, les montants et les comptes de cette écriture sont désormais figés. Personne ne peut les modifier — ni vous, ni un agent, ni le propriétaire de la base de données. Une correction devient une nouvelle écriture d’extourne placée à côté de celle-ci.',
  'post.meaningItem':
    'Sa signification reste révisable. L’explication, la contrepartie, l’état de reconnaissance et la pièce justificative restent ouverts, et chaque révision conserve ce qui précédait.',
  'post.countsItem':
    'Elle commence à compter dans le bilan et le compte de résultat. Les écritures en attente sont exclues des deux.',
  'post.restated': 'Comptabilisation de #{number} — n° de journal {journalNo} — {label}',
  'post.typeToConfirm': 'Saisissez {number} pour confirmer',
  'post.submit': 'Comptabiliser',
  'post.why':
    'Le #numéro de l’écriture elle-même, afin que ceci soit saisi face à l’enregistrement plutôt que cliqué. La base de données revérifie l’écriture au dernier moment — équilibrée, au moins deux lignes, chaque ligne affectée — et refuse dans ses propres termes si ce n’est pas le cas.',
  'post.verdictBlocked':
    'C’est un contrôle de conformité qui refuse, pas les livres. L’écriture est inchangée et toujours en attente. Il n’y a pas de dérogation : ce qui la débloque est un nouveau verdict d’un contrôle qui ne trouve plus le problème.',
  'post.guardRefused':
    'C’est la base de données qui refuse au dernier moment, dans ses propres termes. L’écriture n’a pas été comptabilisée et rien n’a changé la concernant.',
  'post.alreadyLead': 'Déjà comptabilisée.',
  'post.alreadyBody':
    'L’écriture #{number} (n° de journal {journalNo}) figurait déjà dans les livres. Rien n’a changé, et ce n’est pas un échec — cette écriture est volontairement sûre à répéter, car les agents qui pilotent ce produit réessaient.',
  'post.postedLead': 'Comptabilisée.',
  'post.postedBody':
    'L’écriture #{number} porte le n° de journal {journalNo} et fait désormais partie du registre. Ses montants et ses comptes sont figés ; une correction à partir d’ici est une nouvelle écriture d’extourne.',
}
