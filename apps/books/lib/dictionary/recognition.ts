// Recognition: the worklist, the resolve form, the rules panel, and the history
// trail that every one of them renders.
//
// ── WHAT AN EXPLANATION IS FILED IN IS NOT THIS FILE'S BUSINESS ────────────
// `<ResolveForm>` writes `explanation: { en: text }` — the ENGLISH side of the
// pair, whatever language the reader is in. That is a deliberate open question
// and it is written down in the form itself, not here: a French reader writing
// French prose into an `en` field is a data problem for the backend to answer,
// not something a dictionary can fix.

export const en = {
  'rec.title': 'Recognition',
  'rec.subheading': '{book} · exercice {year}',
  'rec.lead':
    'Money that moved without an agreed meaning waits here. Explaining a row is the whole product — and every explanation can teach a rule, so the next payment like it explains itself.',
  'rec.needsAHuman': 'Needs a human',
  'rec.toExplainCaption': 'To explain',
  'rec.awaitingMatchCaption': 'Awaiting a document',
  'rec.toExplain': '{n} to explain',
  'rec.awaitingMatch': '{n} awaiting a document match',
  'rec.loading': 'Loading the worklist',
  'rec.worklist': 'worklist',
  'rec.failed': 'The worklist could not be loaded',
  'rec.footnote':
    'An unrecognized entry does not post blind. An inferred one carries something’s best guess and is waiting for a person to agree with it.',

  // ── <Worklist> ──────────────────────────────────────────────────────────
  'rec.allExplained': 'Everything is explained.',
  'rec.allExplainedBody':
    'Nothing in {book} for {year} is waiting for a human. That is the goal state, not an empty screen.',
  'rec.thisBook': 'this book',
  'rec.thisYear': 'this year',
  'rec.was': 'was',
  'rec.inferredLead': 'Something already proposed a meaning for this.',
  'rec.inferredLink': 'Read it on the entry',
  'rec.inferredAfter': 'before confirming — the worklist does not carry it.',
  'rec.ruleTaught': 'rule #{n} taught',
  'rec.leftWorklist':
    'It has left the worklist. It stays here, showing what it was, until you reload.',
  'rec.cannotWrite': 'This session cannot change records.',
  'rec.explainThis': 'Explain this',
  'rec.suggestionsHeading': 'A rule would explain this — nothing has applied it',
  'rec.useThisExplanation': 'use this explanation',

  // ── THESE THREE WERE ONE SENTENCE ACROSS TWO PLACES, AND NOW ARE NOT ──
  // `pieceLead` used to end on "and" and each ROW finished the sentence in
  // lower case. It was rendered once per pièce, so the seeded book showed the
  // same 180 characters six times down a column — a wall a reader learns to
  // skip, and skipping it means missing the half that actually differs.
  //
  // The lead is now rendered ONCE above the list (`<Worklist>`), so it has to
  // stand as a complete sentence, and the per-row halves have to start as one.
  // The information is identical; only where it is said changed.
  'rec.pieceLead':
    'This is a document, not a transaction. Explaining is not what it needs — a pièce is attached to the entry it proves.',
  'rec.pieceCould': 'Could document {numbers}.',
  'rec.pieceNoMatch': 'Nothing in the books matches its amount and date yet.',
  'rec.pieceLink': 'Open it in supporting documents',
  'rec.readOnlyUnknownJournal':
    'Read-only for now. Which journal this book keeps has not been established yet, and this row’s #number means one thing in the grand livre and another in a recettes-dépenses journal. Resolving before that is settled would be a write against a book chosen by a guess.',
  'rec.readOnlyWrongJournal':
    'Read-only. A {kind} row cannot be resolved in this book’s journal — the two number series overlap, so resolving it by its number would address an unrelated record.',

  // ── <ResolveForm> ───────────────────────────────────────────────────────
  'resolve.riJournalNote':
    'This movement is resolved in {book}’s recettes-dépenses journal, named in the request — the grand livre numbers itself separately and is not reachable from here.',
  'resolve.whatWasThis': 'What was this money?',
  'resolve.explanationPlaceholder': 'e.g. team lunch after the March release — business meal',
  'resolve.explanationNote':
    'This is the product. It is kept forever, and the row keeps what it said before.',
  'resolve.conclusion': 'Conclusion',
  'resolve.oneOff': 'One-off',
  'resolve.recurring': 'Recurring',
  'resolve.optional': '(optional)',
  'resolve.counterparty': 'Counterparty',
  'resolve.counterpartyPlaceholder': 'Who was on the other side',
  'resolve.account': 'Account',
  'resolve.riNoAccount':
    'This book keeps recettes and dépenses under art. 957 al. 2 CO. Its movements have no lines and no accounts, so there is nothing to map. Everything else on this form applies.',
  'resolve.postedNoAccount':
    'This entry is posted: its lines are accounting facts and the account cannot be changed. A correction is a reversing entry. Everything else on this form still applies.',
  'resolve.leaveUnassigned': 'Leave unassigned',
  'resolve.fillsStagedLine': 'Fills the staged line that has none.',
  'resolve.evidenceNote': 'Evidence note',
  'resolve.evidencePlaceholder': 'What document backs this, or why there is none',
  'resolve.teachRule': 'Teach a rule from this',
  'resolve.teachRuleNote':
    'Future payments matching it will explain themselves. The rule is keyed to the PAIR (this entry’s source, the fragment below) — the same merchant on another card is a new fact and comes back here.',
  'resolve.fragment': 'Fragment matched against future labels',
  'resolve.expectedAmount': 'Expected amount',
  'resolve.anyAmount': 'blank = any amount',
  'resolve.tolerance': 'Tolerance',
  'resolve.exact': 'blank = exact',
  'resolve.cadence': 'Cadence',
  'resolve.cadencePlaceholder': 'monthly, quarterly, weekly',
  'resolve.cadenceNote': 'Documentation only — the matcher does not read it.',
  'resolve.learnedFrom': 'Learned from',
  'resolve.saving': 'Saving…',
  'resolve.resolveAndTeach': 'Resolve and teach a rule',
  'resolve.resolve': 'Resolve',
  'resolve.writeFirst': 'Write the explanation first — that is what is being saved.',

  // ── <RulesPanel> ────────────────────────────────────────────────────────
  'rules.title': 'Recognition rules',
  // ── THE SEARCH BOX ───────────────────────────────────────────────────
  // The whole rules list is in hand, so "{n} of {total}" is a figure this
  // screen actually has — unlike the ledger's count, which has no total on the
  // wire. Both numbers are real here.
  'rules.searchLabel': 'Search the rules',
  'rules.searchPlaceholder': 'merchant, explanation, account…',
  'rules.searchEmpty': 'No rule matches that search.',
  'rules.searchEmptyBody':
    'The search reads what this table shows: the merchant, the explanation and its note, the account, the origin, the source and the cadence. Nothing else is matched.',
  'rules.lead':
    'Inspectable data, not logic written into the app. The match key is the pair (source account, merchant) — never the merchant alone, so a familiar name on a source nobody tracks comes back to the list above rather than explaining itself.',
  'rules.colKey': 'Key: (source, merchant)',
  'rules.noSource': 'no source',
  'rules.source': 'source {id}',
  'rules.notMatchedOn': '{interval} (not matched on)',
  'rules.colExplanation': 'Explanation',
  'rules.noExplanation': 'no explanation',
  'rules.colAccount': 'Posts to',
  'rules.colOrigin': 'Origin',
  'rules.notRecorded': 'not recorded',
  'rules.colTaughtBy': 'Taught by',
  'rules.knownFirst': 'no entry — known first',
  'rules.notAddressable': 'taught here — not addressable yet',
  'rules.notAddressableTitle':
    'Taught by an entry in this book. The number the API returns for a simplified book resolves against the double-entry journal, so it is not shown rather than shown wrong.',
  'rules.colSince': 'Since',
  'rules.colActive': 'Active',
  'rules.yes': 'yes',
  'rules.no': 'no',
  'rules.emptyTitle': 'This book has taught the app nothing yet.',
  'rules.emptyBody':
    'A rule is created either by resolving an entry above, or here — when the knowledge arrives before the money does.',
  'rules.addRule': 'Add a rule the app has not been taught',
  'rules.formLead':
    'For knowledge that arrives before the money — a signed lease, a subscription. A rule taught by resolving an entry is created up there instead, and records which entry taught it.',
  'rules.fragment': 'Fragment matched against the raw label',
  'rules.accountLabel': 'Account a match posts to',
  'rules.explanationLabel': 'Explanation a match will carry',
  'rules.explanationPlaceholder': 'Prilly office rent — commercial lease',
  'rules.cadenceDocOnly': '(documentation only)',
  'rules.sourceless':
    'A rule added here has no source, so it matches only entries that arrived without one. The source register is not built yet — until it is, teach a rule by resolving an entry above and the server keys it to that entry’s own source.',
  'rules.created': 'Rule #{n} created.',
  'rules.creating': 'Creating…',
  'rules.create': 'Create rule',
  'rules.cadencePlaceholder': 'monthly',
  'rules.cancel': 'Cancel',
  'history.neverChecked': 'never checked',
  'history.counterparty': 'counterparty: {name}',
} as const

export const fr: Record<keyof typeof en, string> = {
  'rec.title': 'Reconnaissance',
  'rec.subheading': '{book} · exercice {year}',
  'rec.lead':
    'L’argent qui a bougé sans signification convenue attend ici. Expliquer une ligne, c’est tout le produit — et chaque explication peut enseigner une règle, de sorte que le prochain paiement du même type s’explique tout seul.',
  'rec.needsAHuman': 'À traiter',
  'rec.toExplainCaption': 'À expliquer',
  'rec.awaitingMatchCaption': 'En attente d’une pièce',
  'rec.toExplain': '{n} à expliquer',
  'rec.awaitingMatch': '{n} en attente d’une pièce',
  'rec.loading': 'Chargement de la file',
  'rec.worklist': 'file de traitement',
  'rec.failed': 'Impossible de charger la file',
  'rec.footnote':
    'Une écriture non reconnue n’est pas comptabilisée à l’aveugle. Une écriture inférée porte la meilleure hypothèse de quelque chose et attend qu’une personne l’approuve.',

  'rec.allExplained': 'Tout est expliqué.',
  'rec.allExplainedBody':
    'Rien dans {book} pour {year} n’attend une personne. C’est l’état visé, pas un écran vide.',
  'rec.thisBook': 'ce livre',
  'rec.thisYear': 'cette année',
  'rec.was': 'était',
  'rec.inferredLead': 'Quelque chose a déjà proposé une signification pour ceci.',
  'rec.inferredLink': 'Lisez-la sur l’écriture',
  'rec.inferredAfter': 'avant de confirmer — la file ne la transporte pas.',
  'rec.ruleTaught': 'règle #{n} enseignée',
  'rec.leftWorklist':
    'Elle a quitté la file. Elle reste ici, montrant ce qu’elle était, jusqu’au rechargement.',
  'rec.cannotWrite': 'Cette session ne peut pas modifier d’enregistrements.',
  'rec.explainThis': 'Expliquer',
  'rec.suggestionsHeading': 'Une règle expliquerait ceci — rien ne l’a appliquée',
  'rec.useThisExplanation': 'utiliser cette explication',

  'rec.pieceLead':
    'Ceci est un document, pas une transaction. L’expliquer n’est pas ce dont il a besoin — une pièce est rattachée à l’écriture qu’elle prouve.',
  'rec.pieceCould': 'Celle-ci pourrait justifier {numbers}.',
  'rec.pieceNoMatch': 'Rien dans les livres ne correspond encore à son montant et à sa date.',
  'rec.pieceLink': 'Ouvrir dans les pièces justificatives',
  'rec.readOnlyUnknownJournal':
    'En lecture seule pour l’instant. Le type de journal tenu par ce livre n’est pas encore établi, et le #numéro de cette ligne désigne une chose dans le grand livre et une autre dans un journal de recettes-dépenses. Traiter avant que ce soit tranché serait écrire dans un livre choisi au hasard.',
  'rec.readOnlyWrongJournal':
    'En lecture seule. Une ligne de type {kind} ne peut pas être traitée dans le journal de ce livre — les deux séries de numéros se recouvrent, et la traiter par son numéro viserait un enregistrement sans rapport.',

  'resolve.riJournalNote':
    'Ce mouvement est traité dans le journal recettes-dépenses de {book}, nommé dans la requête — le grand livre se numérote séparément et n’est pas accessible depuis ici.',
  'resolve.whatWasThis': 'De quel argent s’agissait-il ?',
  'resolve.explanationPlaceholder':
    'p. ex. repas d’équipe après la livraison de mars — repas d’affaires',
  'resolve.explanationNote':
    'C’est le produit. C’est conservé pour toujours, et la ligne garde ce qu’elle disait avant.',
  'resolve.conclusion': 'Conclusion',
  'resolve.oneOff': 'Ponctuel',
  'resolve.recurring': 'Récurrent',
  'resolve.optional': '(facultatif)',
  'resolve.counterparty': 'Contrepartie',
  'resolve.counterpartyPlaceholder': 'Qui était en face',
  'resolve.account': 'Compte',
  'resolve.riNoAccount':
    'Ce livre tient des recettes et des dépenses selon l’art. 957 al. 2 CO. Ses mouvements n’ont ni lignes ni comptes : il n’y a donc rien à affecter. Tout le reste de ce formulaire s’applique.',
  'resolve.postedNoAccount':
    'Cette écriture est comptabilisée : ses lignes sont des faits comptables et le compte ne peut pas être modifié. Une correction est une écriture d’extourne. Tout le reste de ce formulaire s’applique encore.',
  'resolve.leaveUnassigned': 'Laisser non affecté',
  'resolve.fillsStagedLine': 'Complète la ligne en attente qui n’en a pas.',
  'resolve.evidenceNote': 'Note sur la pièce',
  'resolve.evidencePlaceholder': 'Quel document justifie ceci, ou pourquoi il n’y en a pas',
  'resolve.teachRule': 'Enseigner une règle à partir de ceci',
  'resolve.teachRuleNote':
    'Les paiements futurs qui y correspondent s’expliqueront d’eux-mêmes. La règle est indexée sur le COUPLE (la source de cette écriture, le fragment ci-dessous) — le même commerçant sur une autre carte est un fait nouveau et revient ici.',
  'resolve.fragment': 'Fragment recherché dans les libellés futurs',
  'resolve.expectedAmount': 'Montant attendu',
  'resolve.anyAmount': 'vide = n’importe quel montant',
  'resolve.tolerance': 'Tolérance',
  'resolve.exact': 'vide = exact',
  'resolve.cadence': 'Cadence',
  'resolve.cadencePlaceholder': 'mensuel, trimestriel, hebdomadaire',
  'resolve.cadenceNote': 'Documentation seulement — le moteur de correspondance ne la lit pas.',
  'resolve.learnedFrom': 'Origine',
  'resolve.saving': 'Enregistrement…',
  'resolve.resolveAndTeach': 'Traiter et enseigner une règle',
  'resolve.resolve': 'Traiter',
  'resolve.writeFirst': 'Écrivez d’abord l’explication — c’est elle qui est enregistrée.',

  'rules.title': 'Règles de reconnaissance',
  'rules.searchLabel': 'Rechercher dans les règles',
  'rules.searchPlaceholder': 'commerçant, explication, compte…',
  'rules.searchEmpty': 'Aucune règle ne correspond à cette recherche.',
  'rules.searchEmptyBody':
    'La recherche lit ce que ce tableau affiche : le commerçant, l’explication et sa note, le compte, l’origine, la source et la cadence. Rien d’autre n’est comparé.',
  'rules.lead':
    'Des données inspectables, et non une logique écrite dans l’application. La clé de correspondance est le couple (compte source, commerçant) — jamais le commerçant seul, de sorte qu’un nom familier sur une source non suivie revient dans la liste ci-dessus au lieu de s’expliquer tout seul.',
  'rules.colKey': 'Clé : (source, commerçant)',
  'rules.noSource': 'sans source',
  'rules.source': 'source {id}',
  'rules.notMatchedOn': '{interval} (non pris en compte)',
  'rules.colExplanation': 'Explication',
  'rules.noExplanation': 'aucune explication',
  'rules.colAccount': 'Comptabilise vers',
  'rules.colOrigin': 'Origine',
  'rules.notRecorded': 'non renseigné',
  'rules.colTaughtBy': 'Enseignée par',
  'rules.knownFirst': 'aucune écriture — connue d’abord',
  'rules.notAddressable': 'enseignée ici — pas encore adressable',
  'rules.notAddressableTitle':
    'Enseignée par une écriture de ce livre. Le numéro renvoyé par l’API pour un livre simplifié se résout dans le journal en partie double : il n’est donc pas affiché plutôt qu’affiché faux.',
  'rules.colSince': 'Depuis',
  'rules.colActive': 'Active',
  'rules.yes': 'oui',
  'rules.no': 'non',
  'rules.emptyTitle': 'Ce livre n’a encore rien enseigné à l’application.',
  'rules.emptyBody':
    'Une règle se crée soit en traitant une écriture ci-dessus, soit ici — quand la connaissance arrive avant l’argent.',
  'rules.addRule': 'Ajouter une règle que l’application n’a pas apprise',
  'rules.formLead':
    'Pour une connaissance qui arrive avant l’argent — un bail signé, un abonnement. Une règle enseignée en traitant une écriture se crée là-haut et enregistre quelle écriture l’a enseignée.',
  'rules.fragment': 'Fragment recherché dans le libellé brut',
  'rules.accountLabel': 'Compte vers lequel comptabiliser',
  'rules.explanationLabel': 'Explication que portera une correspondance',
  'rules.explanationPlaceholder': 'Loyer du bureau de Prilly — bail commercial',
  'rules.cadenceDocOnly': '(documentation seulement)',
  'rules.sourceless':
    'Une règle ajoutée ici n’a pas de source : elle ne correspond donc qu’aux écritures arrivées sans source. Le registre des sources n’est pas encore construit — d’ici là, enseignez une règle en traitant une écriture ci-dessus et le serveur l’indexera sur la source de cette écriture.',
  'rules.created': 'Règle #{n} créée.',
  'rules.creating': 'Création…',
  'rules.create': 'Créer la règle',
  'rules.cadencePlaceholder': 'mensuel',
  'rules.cancel': 'Annuler',
  'history.neverChecked': 'jamais vérifié',
  'history.counterparty': 'contrepartie : {name}',
}
