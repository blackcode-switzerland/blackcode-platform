// The chart of accounts, the source register, and the manifest table.

export const en = {
  'sources.uiName': 'Chart of accounts',
  'sources.legalName': 'Plan comptable',
  'sources.subheading': '{book} · Swiss PME chart',
  'sources.chartLeadA':
    'This book’s own accounts — copied when it was created, so editing one book’s chart cannot touch another’s.',
  'sources.chartLeadB': 'Legal line',
  'sources.chartLeadC':
    'is the art. 959a / 959b position each account’s balance lands on, and it is the only mapping anybody may change. If a figure on a statement looks wrong, the entry’s account or this mapping is wrong — never the legal category.',
  'sources.colNo': 'N°',
  'sources.colAccount': 'Account',
  'sources.colClass': 'Class',
  'sources.colStatement': 'Statement',
  'sources.colLegalLine': 'Legal line',
  'sources.noAccounts':
    'This book has no accounts, which should not be possible — a chart is installed in the same transaction that creates a book.',

  'sources.title': 'Sources',
  'sources.searchLabel': 'Search the register',
  'sources.searchPlaceholder': 'name, type, book, method…',
  'sources.searchEmpty': 'No source matches that search.',
  'sources.searchEmptyBody':
    'The search reads what this table shows: the name, the type and layer, the book, the import method, the cadence, the computed status, the ledger accounts and the freeform notes.',
  'sources.leadA':
    'Every channel money moves through: banks hold it, cards draw on banks, processors and SaaS spend sit on top. The risk this register exists for is a source that silently stops being imported — so',
  'sources.leadB': 'status is computed from cadence against the last import',
  'sources.leadC':
    ', never ticked by a person. There is nothing on this table to set, and that is what makes the green ones mean anything.',
  'sources.notFilteredLead': 'This register is not filtered by book',
  'sources.notFilteredBody':
    '— the chart above is. A source can feed more than one, and one of them belongs to no book at all, which is the row a filter would hide.',
  'sources.provisioned':
    'Sources are provisioned, not authored — no route creates one, and retirement is the only lifecycle fact a person sets. Open a source for its freeform notes, the raw files pulled from it, its runbook and the worker’s file manifest.',

  'sources.colSource': 'Source',
  'sources.colType': 'Type',
  'sources.colBook': 'Book',
  'sources.notAttributed': 'not attributed',
  'sources.colMethod': 'Import method',
  'sources.notRecorded': 'not recorded',
  'sources.colLastImport': 'Last import',
  'sources.never': 'never',
  'sources.expected': 'expected {cadence}',
  'sources.colStatus': 'Status',
  'sources.windows': 'stale > {stale}d · gap > {gap}d',
  'sources.attentionOne': '{n} source needs attention',
  'sources.attentionMany': '{n} sources need attention',
  'sources.attentionBody':
    '— {names}. Money may be moving through a channel nothing has imported.',
  'sources.registerEmpty':
    'No sources are provisioned in this account. Sources are provisioned rather than authored — there is no route that creates one, and no button here that pretends otherwise.',
  'sources.freeformNote':
    '{n} of these carry freeform notes — quirks, treatment rules and contacts a statement never tells you. Open a source to read them.',

  'manifest.colFile': 'File',
  'manifest.unnamed': 'unnamed',
  'manifest.colCreated': 'Created',
  'manifest.colFetched': 'Fetched',
  'manifest.notYet': 'not yet',
  'manifest.colPiece': 'Pièce',
  'manifest.colState': 'State',
  'manifest.colArchived': 'Archived',
  'manifest.yes': 'yes',
  'manifest.empty': 'No files on record for this source.',
  'manifest.emptyBody':
    'That is an answer, not a failure. A manifest is kept by the Drive worker, and only a source it polls has one — a bank pulled by hand into an archive folder has files on our side without a worker tracking them, and they are in the pulls table above.',
  'manifest.summary':
    '{total} files · {fetched} fetched · {extracted} extracted · {review} in review · {archived} archived',

  // ── the source detail page ──────────────────────────────────────────────
  'source.title': 'Source',
  'source.back': 'Accounts & sources',
  'source.notANumber': '{value} is not a source number.',
  'source.notANumberBody': 'Source numbers are the ones in the register. Nothing was requested.',
  'source.loading': 'Loading this source',
  'source.notFound': 'There is no source #{n} in this account.',
  'source.notFoundBody':
    'Source numbers are the ones in the register. The address is asking for one that does not exist — the request reached the server and was answered.',
  'source.failed': 'This source could not be loaded',
  'source.retiredVerdictBefore':
    'Retired. This is the one lifecycle fact a person sets, and it beats every cadence: the last import was',
  'source.retiredVerdictAfter': 'and nothing is late, because nothing more is expected.',
  'source.neverConnectedVerdict':
    'Nothing has ever been imported from this source, so there is no date to measure a cadence against. That is the whole verdict: the register can say the channel is unconnected, and it cannot tell you whether that is a decision or an oversight.',
  'source.cadenceVerdictBefore': 'Expected {cadence}. Last import',
  'source.cadenceVerdictAfter':
    '— stale after {stale} days, a gap after {gap}. Computed each time this page is read, from the cadence against that date. Nothing here is settable.',
  'source.noCadenceVerdict':
    'No cadence is expected, so nothing can be late. That is why the status can read current over an import from months ago — the difference between quiet and late is the whole reason this is computed rather than ticked.',
  'source.bookLabel': 'Book:',
  'source.notAttributedLead': 'Not attributed to a book.',
  'source.notAttributedBody':
    'Nothing this source carries reaches any statement until somebody says whose it is.',
  'source.notesTitle': 'Notes — how to treat this source',
  'source.noNotes': 'No notes have been written for this source.',
  'source.notesNote':
    'Freeform on purpose: quirks, treatment rules, and what a statement never tells you. Contact details live in the vault and are referenced here, never pasted.',
  'source.ledgerAccounts': 'Ledger accounts fed here',
  'source.noLedgerAccounts':
    'No balance-sheet account is carried for this source. That is normal for a flow or document source — a card, a processor or a Drive folder moves money that settles into a bank account rather than holding any itself.',
  'source.noBookForDrill': 'This source names no book, so there is no ledger to open it in.',
  'source.noRunbookRetired':
    'Nothing records how this source was pulled. It is retired, so nothing more is expected from it — what is lost is the account of how the files above were obtained, which matters for as long as they have to be defensible.',
  'source.noRunbookCadence':
    'Nothing records how this source is pulled, and it is expected {cadence}. That is a gap in the operation and not only in the documentation: the steps live in somebody’s head, and the status above measures whether they were followed.',
  'source.noRunbookNoCadence':
    'Nothing records how this source is pulled. No cadence is expected either, so nothing is overdue — but there is also nothing written down for whoever pulls it next.',
  'source.pullsTitle': 'Files pulled from this source',
  'source.pullsLead':
    'Our copy, on our side. These are pièces comptables — hashed at capture, kept ten years (art. 958f CO). The institution’s portal is a convenience; this is the archive.',
  'source.pullsEmptyDrive':
    'No files have been pulled by hand from this source. A Drive folder is polled by the worker instead, and what it holds is in the manifest below.',
  'source.pullsEmpty':
    'No files have been pulled from this source. For a source imported by hand that is the ordinary state; for one with a cadence it is the thing the status above is measuring.',
  'source.colFile': 'File',
  'source.colPeriod': 'Period / format',
  'source.colHash': 'Hash',
  'source.noHash': 'no hash',
  'source.colPulled': 'Pulled',
  'source.manifestTitle': 'File manifest',
  'source.manifestLead':
    'The worker’s own ledger of this source’s Drive folder — every file it has seen and where each sits in the state machine. It answers “did we miss a file?” as a query, so nobody re-lists Drive to find out.',
  'source.manifestMismatch':
    'This manifest is for source #{served}, not #{asked}. Do not read it as this source’s.',

  // ── <RunbookPanel> ──────────────────────────────────────────────────────
  'runbook.title': 'Pull runbook',
  'runbook.none': 'No pull runbook',
  'runbook.updated': 'updated',
  'runbook.login': 'Login',
  'runbook.noLogin': 'No login URL recorded',
  'runbook.credentials': 'Credentials',
  'runbook.noCredentials': 'No credential reference recorded',
  'runbook.output': 'Expected output',
  'runbook.noOutput': 'No expected output recorded',
  'runbook.cadence': 'Cadence',
  'runbook.manual': 'manual',
  'runbook.windows': 'stale after {stale} days, gap after {gap}',
  'runbook.noCadence': 'no cadence — nothing is expected, so nothing can be late',
  'runbook.steps': 'Steps',
  'runbook.noSteps': 'No steps recorded — this runbook cannot be followed',
  'runbook.vaultLead': 'Credentials are a vault reference',
  'runbook.vaultBody':
    ', never the secret. If a real secret ever appears in this field the bug is upstream, in whoever wrote the runbook, and the fix is to rotate it — nothing this screen can draw would make it safe. A runbook documents buttons a browser presses with credentials the business legally holds.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'sources.uiName': 'Plan comptable',
  'sources.legalName': 'Plan comptable',
  'sources.subheading': '{book} · plan comptable PME suisse',
  'sources.chartLeadA':
    'Les comptes propres à ce livre — copiés à sa création, de sorte que modifier le plan d’un livre ne peut pas toucher celui d’un autre.',
  'sources.chartLeadB': 'Poste légal',
  'sources.chartLeadC':
    'est la position au sens des art. 959a / 959b sur laquelle atterrit le solde de chaque compte, et c’est la seule correspondance que quiconque puisse modifier. Si un chiffre paraît faux sur un état, c’est le compte de l’écriture ou cette correspondance qui est fausse — jamais la catégorie légale.',
  'sources.colNo': 'N°',
  'sources.colAccount': 'Compte',
  'sources.colClass': 'Classe',
  'sources.colStatement': 'État',
  'sources.colLegalLine': 'Poste légal',
  'sources.noAccounts':
    'Ce livre n’a aucun compte, ce qui ne devrait pas être possible — un plan comptable est installé dans la transaction même qui crée un livre.',

  'sources.title': 'Sources',
  'sources.searchLabel': 'Rechercher dans le registre',
  'sources.searchPlaceholder': 'nom, type, livre, méthode…',
  'sources.searchEmpty': 'Aucune source ne correspond à cette recherche.',
  'sources.searchEmptyBody':
    'La recherche lit ce que ce tableau affiche : le nom, le type et la couche, le livre, la méthode d’import, la cadence, le statut calculé, les comptes du grand livre et les notes libres.',
  'sources.leadA':
    'Tous les canaux par lesquels l’argent transite : les banques le détiennent, les cartes tirent sur les banques, les processeurs et les dépenses SaaS se greffent au-dessus. Le risque pour lequel ce registre existe est celui d’une source dont l’import s’arrête silencieusement — donc',
  'sources.leadB': 'le statut est calculé d’après la cadence par rapport au dernier import',
  'sources.leadC':
    ', jamais coché par une personne. Il n’y a rien à régler dans ce tableau, et c’est ce qui donne un sens aux lignes vertes.',
  'sources.notFilteredLead': 'Ce registre n’est pas filtré par livre',
  'sources.notFilteredBody':
    '— le plan comptable ci-dessus l’est. Une source peut alimenter plusieurs livres, et l’une d’elles n’appartient à aucun livre, ce qui est précisément la ligne qu’un filtre masquerait.',
  'sources.provisioned':
    'Les sources sont provisionnées, non créées — aucune route n’en crée, et la mise hors service est le seul fait de cycle de vie qu’une personne décide. Ouvrez une source pour ses notes libres, les fichiers bruts qui en proviennent, son runbook et le manifeste de fichiers du worker.',

  'sources.colSource': 'Source',
  'sources.colType': 'Type',
  'sources.colBook': 'Livre',
  'sources.notAttributed': 'non attribuée',
  'sources.colMethod': 'Méthode d’import',
  'sources.notRecorded': 'non renseignée',
  'sources.colLastImport': 'Dernier import',
  'sources.never': 'jamais',
  'sources.expected': 'attendu {cadence}',
  'sources.colStatus': 'Statut',
  'sources.windows': 'obsolète > {stale} j · lacune > {gap} j',
  'sources.attentionOne': '{n} source demande attention',
  'sources.attentionMany': '{n} sources demandent attention',
  'sources.attentionBody':
    '— {names}. De l’argent transite peut-être par un canal que rien n’a importé.',
  'sources.registerEmpty':
    'Aucune source n’est provisionnée sur ce compte. Les sources sont provisionnées et non créées — aucune route n’en crée, et aucun bouton ici ne prétend le contraire.',
  'sources.freeformNote':
    '{n} d’entre elles portent des notes libres — particularités, règles de traitement et contacts qu’un relevé ne dit jamais. Ouvrez une source pour les lire.',

  'manifest.colFile': 'Fichier',
  'manifest.unnamed': 'sans nom',
  'manifest.colCreated': 'Créé',
  'manifest.colFetched': 'Récupéré',
  'manifest.notYet': 'pas encore',
  'manifest.colPiece': 'Pièce',
  'manifest.colState': 'État',
  'manifest.colArchived': 'Archivé',
  'manifest.yes': 'oui',
  'manifest.empty': 'Aucun fichier enregistré pour cette source.',
  'manifest.emptyBody':
    'C’est une réponse, pas un échec. Un manifeste est tenu par le worker Drive, et seule une source qu’il interroge en possède un — une banque récupérée à la main dans un dossier d’archives a des fichiers de notre côté sans qu’un worker les suive, et ils figurent dans le tableau des récupérations ci-dessus.',
  'manifest.summary':
    '{total} fichiers · {fetched} récupérés · {extracted} extraits · {review} en revue · {archived} archivés',

  'source.title': 'Source',
  'source.back': 'Comptes et sources',
  'source.notANumber': '{value} n’est pas un numéro de source.',
  'source.notANumberBody':
    'Les numéros de source sont ceux du registre. Rien n’a été demandé.',
  'source.loading': 'Chargement de cette source',
  'source.notFound': 'Il n’existe aucune source #{n} sur ce compte.',
  'source.notFoundBody':
    'Les numéros de source sont ceux du registre. L’adresse en demande un qui n’existe pas — la requête a atteint le serveur et a reçu une réponse.',
  'source.failed': 'Impossible de charger cette source',
  'source.retiredVerdictBefore':
    'Hors service. C’est le seul fait de cycle de vie qu’une personne décide, et il l’emporte sur toute cadence : le dernier import date du',
  'source.retiredVerdictAfter': 'et rien n’est en retard, car plus rien n’est attendu.',
  'source.neverConnectedVerdict':
    'Rien n’a jamais été importé depuis cette source : il n’y a donc aucune date à laquelle mesurer une cadence. C’est tout le verdict : le registre peut dire que le canal n’est pas connecté, et il ne peut pas vous dire s’il s’agit d’une décision ou d’un oubli.',
  'source.cadenceVerdictBefore': 'Attendu {cadence}. Dernier import',
  'source.cadenceVerdictAfter':
    '— obsolète après {stale} jours, lacune après {gap}. Calculé à chaque lecture de cette page, d’après la cadence par rapport à cette date. Rien ici n’est réglable.',
  'source.noCadenceVerdict':
    'Aucune cadence n’est attendue : rien ne peut donc être en retard. C’est pourquoi le statut peut afficher « à jour » au-dessus d’un import vieux de plusieurs mois — la différence entre calme et en retard est toute la raison pour laquelle ceci est calculé plutôt que coché.',
  'source.bookLabel': 'Livre :',
  'source.notAttributedLead': 'Non attribuée à un livre.',
  'source.notAttributedBody':
    'Rien de ce que porte cette source n’atteint un état tant que personne n’a dit à qui elle appartient.',
  'source.notesTitle': 'Notes — comment traiter cette source',
  'source.noNotes': 'Aucune note n’a été rédigée pour cette source.',
  'source.notesNote':
    'Volontairement libres : particularités, règles de traitement et ce qu’un relevé ne dit jamais. Les coordonnées vivent dans le coffre et sont référencées ici, jamais collées.',
  'source.ledgerAccounts': 'Comptes du grand livre alimentés ici',
  'source.noLedgerAccounts':
    'Aucun compte de bilan n’est porté pour cette source. C’est normal pour une source de flux ou de documents — une carte, un processeur ou un dossier Drive fait circuler de l’argent qui se règle sur un compte bancaire plutôt que d’en détenir lui-même.',
  'source.noBookForDrill':
    'Cette source ne nomme aucun livre : il n’y a donc pas de grand livre dans lequel l’ouvrir.',
  'source.noRunbookRetired':
    'Rien ne consigne la manière dont cette source était récupérée. Elle est hors service, donc plus rien n’en est attendu — ce qui est perdu, c’est le récit de la façon dont les fichiers ci-dessus ont été obtenus, ce qui importe aussi longtemps qu’ils doivent être défendables.',
  'source.noRunbookCadence':
    'Rien ne consigne la manière dont cette source est récupérée, et elle est attendue {cadence}. C’est une lacune opérationnelle et pas seulement documentaire : les étapes vivent dans la tête de quelqu’un, et le statut ci-dessus mesure si elles ont été suivies.',
  'source.noRunbookNoCadence':
    'Rien ne consigne la manière dont cette source est récupérée. Aucune cadence n’est attendue non plus, donc rien n’est en retard — mais rien n’est écrit non plus pour la prochaine personne qui la récupérera.',
  'source.pullsTitle': 'Fichiers récupérés depuis cette source',
  'source.pullsLead':
    'Notre copie, chez nous. Ce sont des pièces comptables — empreintées à la capture, conservées dix ans (art. 958f CO). Le portail de l’institution est une commodité ; ceci est l’archive.',
  'source.pullsEmptyDrive':
    'Aucun fichier n’a été récupéré à la main depuis cette source. Un dossier Drive est interrogé par le worker à la place, et ce qu’il contient figure dans le manifeste ci-dessous.',
  'source.pullsEmpty':
    'Aucun fichier n’a été récupéré depuis cette source. Pour une source importée à la main, c’est l’état ordinaire ; pour une source avec cadence, c’est ce que mesure le statut ci-dessus.',
  'source.colFile': 'Fichier',
  'source.colPeriod': 'Période / format',
  'source.colHash': 'Empreinte',
  'source.noHash': 'aucune empreinte',
  'source.colPulled': 'Récupéré',
  'source.manifestTitle': 'Manifeste de fichiers',
  'source.manifestLead':
    'Le registre propre au worker pour le dossier Drive de cette source — chaque fichier qu’il a vu et où chacun se situe dans la machine à états. Il répond à « avons-nous manqué un fichier ? » par une requête, sans que personne ait à relister Drive.',
  'source.manifestMismatch':
    'Ce manifeste concerne la source #{served}, pas #{asked}. Ne le lisez pas comme celui de cette source.',

  'runbook.title': 'Runbook de récupération',
  'runbook.none': 'Aucun runbook de récupération',
  'runbook.updated': 'mis à jour le',
  'runbook.login': 'Connexion',
  'runbook.noLogin': 'Aucune URL de connexion enregistrée',
  'runbook.credentials': 'Identifiants',
  'runbook.noCredentials': 'Aucune référence d’identifiant enregistrée',
  'runbook.output': 'Sortie attendue',
  'runbook.noOutput': 'Aucune sortie attendue enregistrée',
  'runbook.cadence': 'Cadence',
  'runbook.manual': 'manuelle',
  'runbook.windows': 'obsolète après {stale} jours, lacune après {gap}',
  'runbook.noCadence': 'aucune cadence — rien n’est attendu, donc rien ne peut être en retard',
  'runbook.steps': 'Étapes',
  'runbook.noSteps': 'Aucune étape enregistrée — ce runbook ne peut pas être suivi',
  'runbook.vaultLead': 'Les identifiants sont une référence de coffre',
  'runbook.vaultBody':
    ', jamais le secret. Si un vrai secret apparaît un jour dans ce champ, le bug est en amont, chez la personne qui a écrit le runbook, et le correctif est de le faire tourner — rien de ce que cet écran pourrait dessiner ne le rendrait sûr. Un runbook documente des boutons qu’un navigateur presse avec des identifiants que l’entreprise détient légalement.',
}
