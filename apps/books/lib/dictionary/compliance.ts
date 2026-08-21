// The compliance register, its review form, and the verdict panel — plus the
// four FACE tables in `lib/compliance.ts` and `lib/verdict.ts`.
//
// ── THOSE TABLES HOLD KEYS, NOT WORDS, SINCE 2026-08-20 ────────────────────
// `verdictFace`, `reviewStateFace`, `severityFace` and `provenanceOf` are pure
// functions in `lib/` and cannot call a hook, so they return `labelKey` and
// `meaningKey`. `lib/compliance.test.ts` and `lib/verdict.test.ts` assert
// through this dictionary — the assertion is on the ENGLISH TEXT the key
// resolves to, so what those tests check is unchanged, and they now check the
// French exists too.

export const en = {
  'compliance.uiName': 'Compliance rules',
  'compliance.legalName': 'Règles de conformité',
  'compliance.subheading': 'Every book · art. 957 ff. CO and the tax and VAT statutes each rule cites',
  'compliance.registerLabel': 'The rules',
  'compliance.leadA':
    'The statutory checks this product knows about, researched against Fedlex with the article each one rests on.',
  'compliance.leadB': 'They are the same for every book',
  'compliance.leadC':
    ', so the selectors above do not filter this page — and nothing here is evaluated against your records. A compliance pass is an external agent run; this is the register it cites.',
  'compliance.loading': 'Loading the compliance rules',
  'compliance.failed': 'The rules could not be loaded',
  'compliance.draftsOne': '{n} of {total} rule is still draft.',
  'compliance.draftsMany': '{n} of {total} rules are still draft.',
  'compliance.draftsBody':
    'That is where every rule starts and it is not a problem with any of them: an agent read the article, and reading an article is not a fiduciary’s sign-off. Signing one off is recorded against your name and cannot be taken back.',
  'compliance.unknownSeverity': 'This build does not know this severity.',
  'compliance.unknownState': 'This build does not know this state.',
  'compliance.unknownSuffix': '{value} (unknown)',
  'compliance.unknownProvenance': '{value} (a provenance this build does not know)',
  'compliance.checkSummary': 'The check, and what it costs',
  'compliance.triggersWhen': 'Triggers when',
  'compliance.checkLogic': 'Check logic',
  'compliance.checkLogicCorrected': 'Check logic — as corrected',
  'compliance.checkLogicOriginal': 'Check logic — as researched, superseded',
  'compliance.consequence': 'If it is violated',
  'compliance.signedOffBy': 'Signed off by {name}',
  'compliance.signedOffOn': 'on',

  // ── the four face tables ────────────────────────────────────────────────
  'face.reviewDraft': 'Draft',
  'face.reviewDraftMeaning':
    'Researched against Fedlex and waiting for a human. This is where every rule starts; it is not a problem with the rule.',
  'face.reviewApproved': 'Approved',
  'face.reviewApprovedMeaning':
    'Signed off as written. The check logic below is the wording that stands.',
  'face.reviewEdited': 'Edited',
  'face.reviewEditedMeaning':
    'Signed off with corrected wording. The original is kept beside it — a review replaces nothing.',
  'face.reviewRejected': 'Rejected',
  'face.reviewRejectedMeaning':
    'Signed off as wrong. The rule is kept, because a verdict may cite it forever.',
  'face.severityBlocker': 'Blocker',
  'face.severityBlockerMeaning':
    'Violating it makes the books or a filing wrong, not merely untidy.',
  'face.severityWarning': 'Warning',
  'face.severityWarningMeaning': 'Violating it creates exposure that has to be explained.',
  'face.severityInfo': 'Info',
  'face.severityInfoMeaning':
    'A permission or a threshold worth knowing. Nothing is violated by it.',
  'face.provenanceFedlex': 'Verified in Fedlex',
  'face.provenanceFedlexMeaning':
    'The agent read the cited article in the federal law collection.',
  'face.provenanceDoctrine': 'Inferred from doctrine',
  'face.provenanceDoctrineMeaning':
    'A reading of the cited article rather than a quotation of it. The article says less than the rule does.',
  'face.provenanceFiduciary': 'Needs a fiduciary',
  'face.provenanceFiduciaryMeaning':
    'The source itself is not settled. A fiduciary has to confirm how the article applies before this rule is relied on.',
  'face.verdictAccepted': 'Accepted',
  'face.verdictAcceptedMeaning':
    'A compliance pass read this entry against the rules and raised nothing.',
  'face.verdictWarning': 'Accepted with a warning',
  'face.verdictWarningMeaning':
    'A compliance pass raised something that does not stop the entry. It still posts; the warning stands on the record.',
  'face.verdictBlocked': 'Blocked',
  'face.verdictBlockedMeaning':
    'This entry refuses to post until what the verdict flagged is resolved.',
  'face.verdictNeverChecked': 'Never checked',
  'face.verdictNeverCheckedMeaning':
    'No compliance pass has looked at this entry. That is not the same as a clean one — nothing has been asserted about it either way.',
  'face.verdictUnknown': 'Unrecognised verdict',
  'face.verdictUnknownMeaning':
    'A compliance pass filed a verdict this build does not know. It is shown as filed rather than read as a pass or a refusal.',

  // ── <ComplianceReviewForm> ──────────────────────────────────────────────
  'review.cannotWrite': 'This session cannot change records, so this rule cannot be signed off here.',
  'review.open': 'Review this rule',
  'review.legend': 'Sign off {rule}',
  'review.approve': 'Approve',
  'review.approveWhat':
    'The rule stands as written. Its check logic below is the wording that applies.',
  'review.edit': 'Edit',
  'review.editWhat':
    'The rule is right in substance and wrong in wording. Your correction is recorded beside the original, which is kept — a review replaces nothing.',
  'review.reject': 'Reject',
  'review.rejectWhat':
    'The rule is wrong. It is kept rather than deleted, because a compliance verdict already filed may cite it forever, and marked so nothing relies on it.',
  'review.correctedWording': 'The corrected wording',
  'review.correctedPlaceholder': 'The check logic as it should read',
  'review.correctedNote':
    'The original stays on the record beside this. Both are shown, so a reader can see what was corrected — which is the point of an edit rather than a rewrite.',
  'review.note': 'Note',
  'review.notePlaceholder': 'Why, in one line',
  'review.wordingMissing':
    'An edit needs the corrected wording. Recording one without it is refused — an edit that changes nothing is an approval under another name.',
  'review.continue': 'Continue',
  'review.cancel': 'Cancel',
  'review.cannotTakeBack': 'This cannot be taken back.',
  'review.item1':
    'The review is recorded against your account and this moment. There is no un-review: a rule cannot be returned to draft, because that would erase the fact that somebody looked.',
  'review.item2':
    'The rule is never deleted, whatever you choose. A compliance verdict already filed may cite it forever.',
  'review.item3': 'Recording {choice} on {rule} — {citation}.',
  'review.recording': 'Recording…',
  'review.record': 'Record the review',
  'review.back': 'Back',
  'review.nothingRecorded': 'Nothing was recorded. The rule is exactly as it was.',
  'review.recordedLead': 'Recorded.',
  'review.recordedBody':
    '{rule} is {state}{by}. It stays on the register, and there is no way to undo this.',
  'review.recordedBy': ' · signed off by {name}',

  // ── <VerdictPanel> ──────────────────────────────────────────────────────
  'verdict.neverCheckedNote':
    'A compliance pass runs outside this app and files its answer back through {command}. There is no button here that would produce one: this app computes no compliance judgment of its own, deliberately.',
  'verdict.noRules':
    'This verdict names no rule. Every verdict filed through the route must name at least one, so nothing here says what it was based on.',
  'verdict.triggered': 'Triggered:',
  'verdict.worstCase': 'Worst case:',
  'verdict.willNotPost': 'This entry will not post while the verdict stands.',
  'verdict.wayOut': 'The way out, as the pass filed it:',
  'verdict.noResolution':
    'The pass did not file a resolution in a form this screen can print, so there is no sentence to quote. {command} prints the verdict as stored.',
  'verdict.noOverride':
    'There is no override and there is no force flag. What clears it is a fresh verdict from a pass that no longer finds the problem — or a correction to what it found.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'compliance.uiName': 'Règles de conformité',
  'compliance.legalName': 'Règles de conformité',
  'compliance.subheading':
    'Tous livres · art. 957 ss CO et les dispositions fiscales et TVA que chaque règle cite',
  'compliance.registerLabel': 'Les règles',
  'compliance.leadA':
    'Les contrôles légaux que ce produit connaît, recherchés dans Fedlex avec l’article sur lequel chacun repose.',
  'compliance.leadB': 'Ils sont identiques pour tous les livres',
  'compliance.leadC':
    ', les sélecteurs ci-dessus ne filtrent donc pas cette page — et rien ici n’est évalué contre vos enregistrements. Un contrôle de conformité est l’exécution d’un agent externe ; ceci est le registre qu’il cite.',
  'compliance.loading': 'Chargement des règles de conformité',
  'compliance.failed': 'Impossible de charger les règles',
  'compliance.draftsOne': '{n} règle sur {total} est encore à l’état de brouillon.',
  'compliance.draftsMany': '{n} règles sur {total} sont encore à l’état de brouillon.',
  'compliance.draftsBody':
    'C’est l’état de départ de chaque règle et ce n’est un problème pour aucune d’elles : un agent a lu l’article, et lire un article n’est pas la validation d’un fiduciaire. Valider une règle est enregistré à votre nom et ne peut pas être repris.',
  'compliance.unknownSeverity': 'Cette version ne connaît pas cette gravité.',
  'compliance.unknownState': 'Cette version ne connaît pas cet état.',
  'compliance.unknownSuffix': '{value} (inconnu)',
  'compliance.unknownProvenance': '{value} (une provenance que cette version ne connaît pas)',
  'compliance.checkSummary': 'Le contrôle, et ce qu’il coûte',
  'compliance.triggersWhen': 'Se déclenche quand',
  'compliance.checkLogic': 'Logique du contrôle',
  'compliance.checkLogicCorrected': 'Logique du contrôle — telle que corrigée',
  'compliance.checkLogicOriginal': 'Logique du contrôle — telle que recherchée, remplacée',
  'compliance.consequence': 'En cas de violation',
  'compliance.signedOffBy': 'Validée par {name}',
  'compliance.signedOffOn': 'le',

  'face.reviewDraft': 'Brouillon',
  'face.reviewDraftMeaning':
    'Recherchée dans Fedlex et en attente d’une personne. C’est là que commence chaque règle ; ce n’est pas un problème avec la règle.',
  'face.reviewApproved': 'Approuvée',
  'face.reviewApprovedMeaning':
    'Validée telle quelle. La logique du contrôle ci-dessous est la formulation qui fait foi.',
  'face.reviewEdited': 'Corrigée',
  'face.reviewEditedMeaning':
    'Validée avec une formulation corrigée. L’originale est conservée à côté — une revue ne remplace rien.',
  'face.reviewRejected': 'Rejetée',
  'face.reviewRejectedMeaning':
    'Validée comme erronée. La règle est conservée, car un verdict peut la citer indéfiniment.',
  'face.severityBlocker': 'Bloquante',
  'face.severityBlockerMeaning':
    'La violer rend les livres ou un dépôt faux, et pas seulement peu soignés.',
  'face.severityWarning': 'Avertissement',
  'face.severityWarningMeaning': 'La violer crée une exposition qu’il faudra expliquer.',
  'face.severityInfo': 'Information',
  'face.severityInfoMeaning':
    'Une faculté ou un seuil qu’il vaut la peine de connaître. Rien n’est violé par elle.',
  'face.provenanceFedlex': 'Vérifiée dans Fedlex',
  'face.provenanceFedlexMeaning':
    'L’agent a lu l’article cité dans le recueil du droit fédéral.',
  'face.provenanceDoctrine': 'Déduite de la doctrine',
  'face.provenanceDoctrineMeaning':
    'Une lecture de l’article cité plutôt qu’une citation de celui-ci. L’article dit moins que la règle.',
  'face.provenanceFiduciary': 'Requiert un fiduciaire',
  'face.provenanceFiduciaryMeaning':
    'La source elle-même n’est pas arrêtée. Un fiduciaire doit confirmer comment l’article s’applique avant que l’on se fie à cette règle.',
  'face.verdictAccepted': 'Acceptée',
  'face.verdictAcceptedMeaning':
    'Un contrôle de conformité a lu cette écriture au regard des règles et n’a rien soulevé.',
  'face.verdictWarning': 'Acceptée avec un avertissement',
  'face.verdictWarningMeaning':
    'Un contrôle de conformité a soulevé quelque chose qui n’arrête pas l’écriture. Elle se comptabilise quand même ; l’avertissement demeure au dossier.',
  'face.verdictBlocked': 'Bloquée',
  'face.verdictBlockedMeaning':
    'Cette écriture refuse de se comptabiliser tant que ce que le verdict a signalé n’est pas résolu.',
  'face.verdictNeverChecked': 'Jamais vérifiée',
  'face.verdictNeverCheckedMeaning':
    'Aucun contrôle de conformité n’a examiné cette écriture. Ce n’est pas la même chose qu’une écriture propre — rien n’a été affirmé à son sujet dans un sens ou dans l’autre.',
  'face.verdictUnknown': 'Verdict non reconnu',
  'face.verdictUnknownMeaning':
    'Un contrôle de conformité a déposé un verdict que cette version ne connaît pas. Il est affiché tel que déposé plutôt que lu comme un succès ou un refus.',

  'review.cannotWrite':
    'Cette session ne peut pas modifier d’enregistrements : cette règle ne peut donc pas être validée ici.',
  'review.open': 'Examiner cette règle',
  'review.legend': 'Valider {rule}',
  'review.approve': 'Approuver',
  'review.approveWhat':
    'La règle tient telle qu’écrite. Sa logique de contrôle ci-dessous est la formulation qui s’applique.',
  'review.edit': 'Corriger',
  'review.editWhat':
    'La règle est juste sur le fond et fausse dans sa formulation. Votre correction est enregistrée à côté de l’originale, qui est conservée — une revue ne remplace rien.',
  'review.reject': 'Rejeter',
  'review.rejectWhat':
    'La règle est fausse. Elle est conservée plutôt que supprimée, car un verdict de conformité déjà déposé peut la citer indéfiniment, et marquée pour que rien ne s’y fie.',
  'review.correctedWording': 'La formulation corrigée',
  'review.correctedPlaceholder': 'La logique du contrôle telle qu’elle devrait se lire',
  'review.correctedNote':
    'L’originale reste au dossier à côté de celle-ci. Les deux sont affichées, de sorte qu’un lecteur voie ce qui a été corrigé — c’est tout l’intérêt d’une correction plutôt que d’une réécriture.',
  'review.note': 'Note',
  'review.notePlaceholder': 'Pourquoi, en une ligne',
  'review.wordingMissing':
    'Une correction exige la formulation corrigée. En enregistrer une sans elle est refusé — une correction qui ne change rien est une approbation sous un autre nom.',
  'review.continue': 'Continuer',
  'review.cancel': 'Annuler',
  'review.cannotTakeBack': 'Ceci ne peut pas être repris.',
  'review.item1':
    'La revue est enregistrée à votre compte et à cet instant. Il n’y a pas d’annulation de revue : une règle ne peut pas revenir au brouillon, car cela effacerait le fait que quelqu’un l’a examinée.',
  'review.item2':
    'La règle n’est jamais supprimée, quel que soit votre choix. Un verdict de conformité déjà déposé peut la citer indéfiniment.',
  'review.item3': 'Enregistrement de « {choice} » sur {rule} — {citation}.',
  'review.recording': 'Enregistrement…',
  'review.record': 'Enregistrer la revue',
  'review.back': 'Retour',
  'review.nothingRecorded': 'Rien n’a été enregistré. La règle est exactement telle qu’elle était.',
  'review.recordedLead': 'Enregistré.',
  'review.recordedBody':
    '{rule} est {state}{by}. Elle reste au registre, et il n’y a aucun moyen d’annuler ceci.',
  'review.recordedBy': ' · validée par {name}',

  'verdict.neverCheckedNote':
    'Un contrôle de conformité s’exécute hors de cette application et y dépose sa réponse via {command}. Il n’y a ici aucun bouton qui en produirait un : cette application ne calcule aucun jugement de conformité propre, délibérément.',
  'verdict.noRules':
    'Ce verdict ne nomme aucune règle. Tout verdict déposé par la route doit en nommer au moins une : rien ici ne dit donc sur quoi il se fondait.',
  'verdict.triggered': 'Déclenché :',
  'verdict.worstCase': 'Pire cas :',
  'verdict.willNotPost':
    'Cette écriture ne se comptabilisera pas tant que le verdict tient.',
  'verdict.wayOut': 'La sortie, telle que déposée par le contrôle :',
  'verdict.noResolution':
    'Le contrôle n’a pas déposé de résolution sous une forme que cet écran puisse imprimer : il n’y a donc pas de phrase à citer. {command} imprime le verdict tel que stocké.',
  'verdict.noOverride':
    'Il n’y a pas de dérogation et pas d’option de forçage. Ce qui la lève est un nouveau verdict d’un contrôle qui ne trouve plus le problème — ou une correction de ce qu’il a trouvé.',
}
