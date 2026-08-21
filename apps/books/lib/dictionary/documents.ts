// Supporting documents: the pièces inbox and the match form.

export const en = {
  'docs.uiName': 'Supporting documents',
  'docs.legalName': 'Pièces justificatives',
  'docs.lead':
    'Every entry needs its document (art. 957a al. 3 CO), kept ten years (art. 958f). Google Drive is the inbox and the human view; the legal archive is a separate immutable copy. b/books keeps references, hashes and capture dates — never the file itself.',
  'docs.noBalanceLead': 'Nothing here changes a balance.',
  'docs.noBalanceBody':
    'A document is not an écriture: it lands staged, it never posts, and no statement reads this table. This list is the whole inbox and is not filtered by book — a scanned receipt does not always say whose it is, and saying so is one of the judgments this screen is for.',
  'docs.inbox': 'Inbox',
  'docs.counts': '{toHandle} to handle · {total} in all',
  'docs.loading': 'Loading the inbox',
  'docs.failed': 'The inbox could not be loaded',
  'docs.howTitle': 'How documents get here',
  'docs.how1a':
    'Paper receipts are scanned with the stock Google Drive app into an inbox folder. A stateless worker polls it, a vision model extracts the fields against a fixed schema, and deterministic checks — the sum, the Swiss VAT rates, the date — run',
  'docs.how1b': 'outside the model, on the server',
  'docs.how1c':
    '. The worker’s own verdict is stored as evidence of what it claimed and is read by nothing.',
  'docs.how2':
    'Everything lands staged. A document that fails validation lands anyway, flagged, because a bad sum is exactly the document a human must see — refusing it at the door would hide it in the worker’s retry queue. Two documents with the same content are both kept, for the same reason: a refund and a re-scan look identical and mean different money.',
  'docs.how3':
    'There is no upload control on this screen and there is not meant to be one — documents are Drive references, and the ingest route is a door an external worker posts to with a token.',

  'inbox.empty': 'The inbox is empty.',
  'inbox.emptyBody':
    'Nothing has been captured yet. Documents arrive here from the Drive worker, never as an upload — there is no file picker in this product, and there is not meant to be.',
  'inbox.hideDetail': 'Hide detail',
  'inbox.showDetail': 'Show detail',
  'inbox.detail': 'Detail',
  'inbox.pieceNumber': 'pièce #{n}',
  'inbox.noBookYet': 'no book yet',
  'inbox.needsReviewLead': 'A person needs to look at this.',
  'inbox.needsReviewFallback': 'The server flagged it during validation.',
  'inbox.needsReviewTail':
    'It landed anyway, and that is deliberate — refusing it at the door would hide it in the worker’s retry queue.',
  'inbox.duplicateLead': 'Same content as pièce #{n}.',
  'inbox.duplicateBody':
    'Flagged, never dropped: a refund and a re-scan look identical and mean different money, so which one this is stays a human’s call.',
  'inbox.documentsBefore': 'Documents',
  'inbox.entryLink': 'entry #{n}',
  'inbox.riEntry': 'recettes-dépenses #{n}',
  'inbox.documentsAfter':
    '. Matching writes the entry’s pièce reference and deliberately does not change its evidence tier — whether a receipt turns partial into full is a sufficiency judgment, and judgments stay human.',

  'inbox.received': 'Received',
  'inbox.document': 'Document',
  'inbox.driveFileId': 'Drive file id',
  'inbox.checksum': 'Checksum',
  'inbox.noChecksum': 'none recorded — duplicate detection cannot see this document',
  'inbox.ticket': 'Ticket',
  'inbox.paidBy': 'Paid by',
  'inbox.confidence': 'Extractor confidence',
  'inbox.confidenceShort': 'Confidence',
  // The title on an ABSENT confidence. It has to say what the em dash means,
  // because an absent confidence and a confidence of zero are different claims
  // about the same document — see `confidence()` in `lib/format.ts`.
  'inbox.confidenceAbsent':
    'The extractor reported no confidence for this document. That is not the same as a confidence of zero.',
  'inbox.lines': 'Lines',
  'inbox.noLines':
    'None. The document carries a total with nothing itemised behind it — a card slip rather than a receipt. That is why the sum check below cannot pass.',
  'inbox.colLine': 'Line',
  'inbox.colQty': 'Qty',
  'inbox.colAmount': 'Amount',
  'inbox.colVat': 'TVA',
  'inbox.total': 'Total',
  'inbox.validation': 'Validation — recomputed here',
  'inbox.checkSum': 'lines sum to the total',
  'inbox.checkRates': 'VAT rates in force',
  'inbox.checkDate': 'date plausible',
  'inbox.workerDisagreesPassed': 'The worker claimed this passed, and the server disagrees.',
  'inbox.workerDisagreesFailed': 'The worker claimed this failed, and the server disagrees.',
  'inbox.workerDisagreesBody':
    'Its verdict is stored as evidence of what it said and is read by nothing — every check above was recomputed here from the payload’s own arithmetic. This is the one shown, and the one to act on.',
  'inbox.recomputed':
    'Recomputed on the server from the payload’s own arithmetic. The worker’s own verdict is stored inside the extraction as evidence of what it claimed, and is read by nothing.',
  'inbox.extractorNotes': 'Extractor notes',
  'inbox.note': 'Note',

  'match.cannotWrite':
    'This session cannot change records, so this document cannot be attached here.',
  'match.open': 'Attach to an entry',
  'match.label': 'Which entry does this document prove?',
  'match.attach': 'Attach',
  'match.attaching': 'Attaching…',
  'match.cancel': 'Cancel',
  'match.journalGrandLivre': 'the grand livre',
  'match.journalRi': 'this book’s recettes-dépenses journal',
  'match.journalBefore': 'This number is read in',
  'match.journalAfter':
    ', decided by this document’s own book — so the same number in another book cannot be reached from here. If it names nothing there, the attach is refused rather than applied elsewhere.',
  'match.journalUnknown':
    'This document names a book this account does not have in hand, so which journal the number is read in cannot be shown. The server decides it either way; a number that names nothing is refused, never applied elsewhere.',
  'match.writesNote':
    'Attaching writes the entry’s document reference, its checksum and its capture date. It does NOT change the entry’s evidence tier — whether this receipt is sufficient proof is a judgment, and this gives you the material to make it. A document proves one entry; there is no undo.',
  'match.oneDocumentNote':
    'And the entry must not already have one. An entry cites one document; if the one you name already carries a pièce the attach is refused rather than replacing it, in either journal. Swapping a document out is not built, deliberately — evidence that can be quietly replaced is evidence that proves nothing.',
  'match.notANumber':
    '“{value}” is not an entry number. Entry numbers are whole numbers from 1 up, as shown on {journal}.',
  'match.theEntry': 'the entry',
  'match.notFound':
    'Nothing is numbered #{entry} in {journal}, so there is nothing to attach this document to. Check the number on the entry itself. (The server answered 404 with no explanation — the route discards its own reason here, and that is raised with the backend.)',
  'match.thisJournal': 'this document’s journal',
  'match.attributionLead':
    'This document does not say which book it belongs to, and attaching it decides that.',
  'match.attributionBody':
    'In the same write, it is filed under the book of whichever entry you name — so this is two changes, not one, and neither can be undone. Until then it belongs to no book, which is why its number is read in {journal}: a document nobody has attributed cannot reach a personal recettes-dépenses journal.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'docs.uiName': 'Pièces justificatives',
  'docs.legalName': 'Pièces justificatives',
  'docs.lead':
    'Chaque écriture a besoin de sa pièce (art. 957a al. 3 CO), conservée dix ans (art. 958f). Google Drive est la boîte de réception et la vue humaine ; l’archive légale est une copie immuable distincte. b/books conserve des références, des empreintes et des dates de capture — jamais le fichier lui-même.',
  'docs.noBalanceLead': 'Rien ici ne modifie un solde.',
  'docs.noBalanceBody':
    'Une pièce n’est pas une écriture : elle arrive en attente, elle n’est jamais comptabilisée, et aucun état ne lit cette table. Cette liste est la boîte de réception entière et n’est pas filtrée par livre — un reçu scanné ne dit pas toujours à qui il appartient, et le dire est l’un des jugements auxquels cet écran sert.',
  'docs.inbox': 'Boîte de réception',
  'docs.counts': '{toHandle} à traiter · {total} au total',
  'docs.loading': 'Chargement de la boîte de réception',
  'docs.failed': 'Impossible de charger la boîte de réception',
  'docs.howTitle': 'Comment les pièces arrivent ici',
  'docs.how1a':
    'Les reçus papier sont scannés avec l’application Google Drive standard dans un dossier de réception. Un worker sans état l’interroge, un modèle de vision en extrait les champs selon un schéma fixe, et des contrôles déterministes — la somme, les taux de TVA suisses, la date — s’exécutent',
  'docs.how1b': 'en dehors du modèle, sur le serveur',
  'docs.how1c':
    '. Le verdict propre au worker est conservé comme preuve de ce qu’il a affirmé et n’est lu par rien.',
  'docs.how2':
    'Tout arrive en attente. Une pièce qui échoue à la validation arrive quand même, signalée, car une somme fausse est précisément la pièce qu’un humain doit voir — la refuser à la porte la cacherait dans la file de reprise du worker. Deux pièces au contenu identique sont toutes deux conservées, pour la même raison : un remboursement et un nouveau scan se ressemblent et signifient un argent différent.',
  'docs.how3':
    'Il n’y a pas de contrôle de téléversement sur cet écran et il n’est pas prévu d’en avoir — les pièces sont des références Drive, et la route d’ingestion est une porte à laquelle un worker externe poste avec un jeton.',

  'inbox.empty': 'La boîte de réception est vide.',
  'inbox.emptyBody':
    'Rien n’a encore été capturé. Les pièces arrivent ici depuis le worker Drive, jamais par téléversement — il n’y a pas de sélecteur de fichier dans ce produit, et il n’est pas prévu d’en avoir.',
  'inbox.hideDetail': 'Masquer le détail',
  'inbox.showDetail': 'Afficher le détail',
  'inbox.detail': 'Détail',
  'inbox.pieceNumber': 'pièce #{n}',
  'inbox.noBookYet': 'aucun livre pour l’instant',
  'inbox.needsReviewLead': 'Une personne doit examiner ceci.',
  'inbox.needsReviewFallback': 'Le serveur l’a signalée lors de la validation.',
  'inbox.needsReviewTail':
    'Elle est arrivée quand même, et c’est délibéré — la refuser à la porte la cacherait dans la file de reprise du worker.',
  'inbox.duplicateLead': 'Même contenu que la pièce #{n}.',
  'inbox.duplicateBody':
    'Signalée, jamais écartée : un remboursement et un nouveau scan se ressemblent et signifient un argent différent ; savoir de laquelle il s’agit reste une décision humaine.',
  'inbox.documentsBefore': 'Justifie',
  'inbox.entryLink': 'l’écriture #{n}',
  'inbox.riEntry': 'recettes-dépenses #{n}',
  'inbox.documentsAfter':
    '. Le rattachement écrit la référence de pièce de l’écriture et ne change délibérément pas son niveau de preuve — savoir si un reçu fait passer de partiel à complet est un jugement de suffisance, et les jugements restent humains.',

  'inbox.received': 'Reçue',
  'inbox.document': 'Document',
  'inbox.driveFileId': 'Identifiant du fichier Drive',
  'inbox.checksum': 'Empreinte',
  'inbox.noChecksum':
    'aucune enregistrée — la détection de doublons ne peut pas voir cette pièce',
  'inbox.ticket': 'Ticket',
  'inbox.paidBy': 'Payé par',
  'inbox.confidence': 'Confiance de l’extracteur',
  'inbox.confidenceShort': 'Confiance',
  'inbox.confidenceAbsent':
    'L’extracteur n’a indiqué aucune confiance pour ce document. Ce n’est pas la même chose qu’une confiance nulle.',
  'inbox.lines': 'Lignes',
  'inbox.noLines':
    'Aucune. La pièce porte un total sans rien de détaillé derrière — un ticket de carte plutôt qu’un reçu. C’est pourquoi le contrôle de la somme ci-dessous ne peut pas passer.',
  'inbox.colLine': 'Ligne',
  'inbox.colQty': 'Qté',
  'inbox.colAmount': 'Montant',
  'inbox.colVat': 'TVA',
  'inbox.total': 'Total',
  'inbox.validation': 'Validation — recalculée ici',
  'inbox.checkSum': 'les lignes totalisent le montant',
  'inbox.checkRates': 'taux de TVA en vigueur',
  'inbox.checkDate': 'date plausible',
  'inbox.workerDisagreesPassed':
    'Le worker a affirmé que cela passait, et le serveur n’est pas d’accord.',
  'inbox.workerDisagreesFailed':
    'Le worker a affirmé que cela échouait, et le serveur n’est pas d’accord.',
  'inbox.workerDisagreesBody':
    'Son verdict est conservé comme preuve de ce qu’il a dit et n’est lu par rien — chaque contrôle ci-dessus a été recalculé ici à partir de l’arithmétique de la charge utile. C’est celui qui est affiché, et celui sur lequel agir.',
  'inbox.recomputed':
    'Recalculé sur le serveur à partir de l’arithmétique de la charge utile. Le verdict propre au worker est conservé dans l’extraction comme preuve de ce qu’il a affirmé, et n’est lu par rien.',
  'inbox.extractorNotes': 'Notes de l’extracteur',
  'inbox.note': 'Note',

  'match.cannotWrite':
    'Cette session ne peut pas modifier d’enregistrements : cette pièce ne peut donc pas être rattachée ici.',
  'match.open': 'Rattacher à une écriture',
  'match.label': 'Quelle écriture cette pièce justifie-t-elle ?',
  'match.attach': 'Rattacher',
  'match.attaching': 'Rattachement…',
  'match.cancel': 'Annuler',
  'match.journalGrandLivre': 'le grand livre',
  'match.journalRi': 'le journal recettes-dépenses de ce livre',
  'match.journalBefore': 'Ce numéro est lu dans',
  'match.journalAfter':
    ', déterminé par le livre propre à cette pièce — le même numéro dans un autre livre n’est donc pas atteignable depuis ici. S’il ne désigne rien là-bas, le rattachement est refusé plutôt qu’appliqué ailleurs.',
  'match.journalUnknown':
    'Cette pièce nomme un livre dont ce compte ne dispose pas : le journal dans lequel le numéro est lu ne peut donc pas être affiché. Le serveur le détermine dans tous les cas ; un numéro qui ne désigne rien est refusé, jamais appliqué ailleurs.',
  'match.writesNote':
    'Le rattachement écrit la référence de la pièce, son empreinte et sa date de capture sur l’écriture. Il ne change PAS le niveau de preuve de l’écriture — savoir si ce reçu constitue une preuve suffisante est un jugement, et ceci vous en donne la matière. Une pièce justifie une écriture ; il n’y a pas d’annulation.',
  'match.oneDocumentNote':
    'Et l’écriture ne doit pas déjà en avoir une. Une écriture cite une seule pièce ; si celle que vous nommez en porte déjà une, le rattachement est refusé plutôt que de la remplacer, dans les deux journaux. Échanger une pièce n’est pas prévu, délibérément — une preuve que l’on peut remplacer discrètement est une preuve qui ne prouve rien.',
  'match.notANumber':
    '« {value} » n’est pas un numéro d’écriture. Les numéros d’écriture sont des entiers à partir de 1, tels qu’affichés sur {journal}.',
  'match.theEntry': 'l’écriture',
  'match.notFound':
    'Rien ne porte le numéro #{entry} dans {journal} : il n’y a donc rien à quoi rattacher cette pièce. Vérifiez le numéro sur l’écriture elle-même. (Le serveur a répondu 404 sans explication — la route écarte sa propre raison à cet endroit, et cela a été signalé au backend.)',
  'match.thisJournal': 'le journal de cette pièce',
  'match.attributionLead':
    'Cette pièce ne dit pas à quel livre elle appartient, et la rattacher tranche ce point.',
  'match.attributionBody':
    'Dans la même écriture, elle est classée sous le livre de l’écriture que vous nommez — cela fait donc deux changements et non un, et aucun ne peut être annulé. D’ici là elle n’appartient à aucun livre, c’est pourquoi son numéro est lu dans {journal} : une pièce que personne n’a attribuée ne peut pas atteindre un journal recettes-dépenses personnel.',
}
