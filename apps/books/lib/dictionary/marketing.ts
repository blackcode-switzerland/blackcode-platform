// The signed-out surface: the marketing page, the login card, the reset flow,
// the CLI authorize page, and the two "there is nothing here yet" screens.
//
// ── THESE STRINGS ARE READ BEFORE ANYBODY HAS A LOCALE COLUMN ──────────────
// Nobody on `/` or `/login` has a session, so the language on these screens is
// whatever the COOKIE and `Accept-Language` resolve to. That is the whole reason
// the resolution order continues past the user record, and it is why the switch
// writes a cookie as well as the column: a person who chooses French, signs out
// and lands back on `/login` should not be greeted in English by a product that
// knows better.

export const en = {
  'site.footer': 'b/books — a blackcode product.',
  'site.home': 'b/books home',
  'site.signIn': 'Sign in',
  'site.createAccount': 'Create an account',

  'landing.eyebrow': 'Statutory bookkeeping',
  'landing.headline': 'Books you can defend, line by line.',
  'landing.lede':
    'b/books keeps double-entry accounts for as many books as you have. Every entry says what it means, what evidence stands behind it, and where that evidence lives — because in ten years’ time that is the only thing anybody will ask.',
  'landing.whatItDoes': 'What it does.',
  'landing.f1.title': 'One book, or several',
  'landing.f1.copy':
    'A company, a second company, a self-employment activity — each is its own set of books with its own chart, its own year and its own balance. Switching between them is one control, not one login.',
  'landing.f2.title': 'Every entry is explained',
  'landing.f2.copy':
    'The bank text a transaction arrived with is never overwritten. What the entry MEANS is recorded beside it, along with whether that was recognised automatically or decided by a person.',
  'landing.f3.title': 'Evidence is a first-class field',
  'landing.f3.copy':
    'What document stands behind an entry, and what that document is good for, are recorded per entry — and the two legal consequences, profit tax and input VAT, are tracked separately because they are separate.',
  'landing.f4.title': 'The statements are the statute',
  'landing.f4.copy':
    'Balance sheet and income statement in the order art. 959a and 959b CO give, with the wording they give. Lines that are zero this year still appear, because the list is the law and not a view of the data.',
  'landing.f5.title': 'Where the money actually comes from',
  'landing.f5.copy':
    'A register of every bank, card, processor and document feed, and whether each one is current. A gap in a feed is a gap in the books, and it is shown as one.',
  'landing.f6.title': 'Driven by the agents you run',
  'landing.f6.copy':
    'Ingest, matching and reconciliation happen outside this app. What you get here is the ledger, the reasoning behind it, and the small number of decisions that need a person.',
  'landing.agentEyebrow': 'Agent-first',
  'landing.agentHeadline': 'The work happens outside. This is where you check it.',
  'landing.agentP1':
    'b/books is operated by people in this web app and by agents through {bk}, one Go binary on npm. There is no HTTP API to learn and no reference to keep in sync: {guide} ships inside the binary, so it describes exactly the version you are running, offline.',
  'landing.agentP2':
    'Anything that changes without a release — the vocabularies, the VAT rates, which books you have — comes from {meta}, live. That is why none of it is printed on this page.',
  'landing.agentP3':
    'There is no chat box here and no assistant in the corner. Judgement belongs to the agent that does the ingest, or to you; this app’s job is to show you what was decided and let you change it.',
  'landing.lawTitle': 'What the law asks of a set of books',
  'landing.law1.term': 'art. 957 CO — who must keep them',
  'landing.law1.def':
    'A company keeps full double-entry accounts. There is no turnover threshold that lets one out.',
  'landing.law2.term': 'art. 958f CO — for how long',
  'landing.law2.def':
    'Ten years, and a digital copy counts only if its integrity can be shown. That is why documents are referenced with a hash taken at capture rather than uploaded.',
  'landing.law3.term': 'art. 959a / 959b CO — what they must look like',
  'landing.law3.def':
    'A fixed structure, in a fixed order. The balance sheet and income statement here are that structure, not a report built on top of it.',
  'landing.ctaHeadline': 'Open the books.',
  'landing.ctaBody': 'Sign in with your blackcode account — the same one the other blackcode apps use.',

  // ── the login card ──────────────────────────────────────────────────────
  'login.tagline': 'Swiss statutory bookkeeping',
  'login.tabSignIn': 'Sign in',
  'login.tabSignUp': 'Create account',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.name': 'Name',
  'login.namePlaceholder': 'Your name',
  'login.forgot': 'Forgot password?',
  'login.signingIn': 'Signing in…',
  'login.creating': 'Creating…',
  'login.create': 'Create account',
  'login.google': 'Continue with Google',
  'login.or': 'or',
  'login.badCredentials': 'That email and password do not match an account.',
  'login.passwordHint': 'At least 8 characters',
  'login.emailPlaceholder': 'you@blackcode.ch',
  'login.accountCreated': 'Account created. Please sign in.',
  'login.passwordUpdated':
    'Password updated. Sign in with your new password — every other blackcode app was signed out too.',
  'login.shared':
    'Your blackcode account is the same one across every blackcode app. New addresses have to be approved by a super admin before they can sign up, and a password reset here is a password reset everywhere.',

  // ── the password reset / change flow ────────────────────────────────────
  'reset.title': 'Reset your password',
  'reset.titleChange': 'Change your password',
  'reset.askBody':
    'Enter your account email and we will send you a 6-digit code to reset your password.',
  'reset.askBodyAuthenticated':
    'We will send a 6-digit code to your account email. Setting a new password signs you out of every blackcode app, including this session.',
  'reset.send': 'Send code',
  'reset.sending': 'Sending…',
  'reset.sent': 'We sent a 6-digit code to {email}. It expires shortly.',
  'reset.code': 'Code',
  'reset.newPassword': 'New password',
  'reset.confirm': 'Set password',
  'reset.confirming': 'Setting…',
  'reset.done': 'Password set. Sign in with it.',
  'reset.cancel': 'Cancel',
  'reset.back': 'Use a different email',
  'reset.askBodyAuthenticated2':
    'We will email a 6-digit code to confirm it is you, then you can set a new password.',
  'reset.codeGoesTo': 'The code goes to {email}',
  'reset.sentBody': 'We sent a 6-digit code to {email}. Enter it below with your new password.',
  'reset.verificationCode': 'Verification code',
  'reset.confirmNewPassword': 'Confirm new password',
  'reset.reenter': 'Re-enter password',
  'reset.setNewPassword': 'Set new password',
  'reset.resend': 'Resend code',
  'reset.resendIn': 'Resend in {seconds}s',
  'reset.showPassword': 'Show password',
  'reset.hidePassword': 'Hide password',
  'reset.codeSent': 'Verification code sent',
  'reset.passwordUpdated': 'Password updated',
  'reset.badEmail': 'Enter a valid email address.',
  'reset.badCode': 'Enter the 6-digit code from your email.',
  'reset.tooShort': 'Password must be at least 8 characters.',
  'reset.mismatch': 'Passwords do not match.',

  // ── /cli/authorize ──────────────────────────────────────────────────────
  'cli.title': 'Authorize the b/books CLI',
  'cli.body':
    'A terminal on this machine asked to sign in as you. Approving this mints an API token and hands it back — the same token every blackcode app accepts, not a b/books-only one.',
  'cli.approve': 'Authorize',
  'cli.approving': 'Authorizing…',
  'cli.deny': 'Cancel',
  'cli.done': 'Authorized. You can close this tab and go back to the terminal.',
  'cli.badCallback':
    'This link does not name a loopback address, so it is not a request from a terminal on this machine. Nothing was authorized.',
  'cli.tokenName': 'Token name',
  'cli.revokeLater': 'You can revoke it later from Settings → API tokens, in any blackcode app.',
  'cli.noRedirect': 'The server authorized the request but returned no callback URL.',
  'cli.signedInAs': 'Signed in as {email}',
  'cli.willSendTo': 'A new API token will be created and sent to your terminal at:',
  'cli.notBooksSpecific':
    'This token is not specific to b/books. It is your blackcode token and it works against every app your account can reach. Revoke it from Settings → API tokens, in any of them.',
  'cli.missingParams': 'Missing parameters',
  'cli.missingParamsBody':
    'This authorization request has no callback URL or no state token. Re-run {login} from your terminal.',
  'cli.invalidCallback': 'Invalid callback',
  'cli.invalidCallbackBody':
    'The callback is not a localhost loopback. Refusing to send a token to an external host — the credential this page mints works against every blackcode app, not only this one.',
  'cli.back': '← Back to b/books',

  // ── no books ────────────────────────────────────────────────────────────
  'noBooks.title': 'You have no books yet',
  'noBooks.p1':
    'A book is one legal entity’s complete set of accounts — a company, or a self-employment activity. It has its own chart of accounts, its own fiscal year and its own balance sheet, and it never mixes with another one.',
  'noBooks.p2':
    'You can have as many as you need. Everything else in b/books — the ledger, the statements, the recognition queue — is scoped to whichever one you are looking at.',
  'noBooks.openingOne': 'Opening one',
  'noBooks.openingBody':
    'From a terminal, with the {bk} CLI. It is not a form in this app on purpose: the legal form fixes which bookkeeping rules the entity is kept under for its whole life, and the registered seat decides the cantonal and communal tax parameters every later figure is computed with. Neither can be changed afterwards by editing a field.',
  'noBooks.formsLead': 'SA',
  'noBooks.formsBody':
    '{sa} for a capital company, which is always double-entry, or {ri} for a sole proprietorship, which is kept simplified unless you say otherwise. The book arrives with the Swiss PME chart of accounts already in it. Then open its first fiscal year with {exercice} — nothing can be posted until there is one.',
  'noBooks.noCli': 'No {bk} yet? Run {login} once and it will bring you back here to authorize it.',
  'noBooks.signedInAs':
    'Signed in as {email}. Your blackcode account works across every blackcode app.',

  // ── no exercice ─────────────────────────────────────────────────────────
  'noExercice.thisBook': 'This book',
  'noExercice.title': '{book} has no fiscal year open yet.',
  'noExercice.body':
    'There is nothing to derive, so there is no {statement} to show. A book gets its chart of accounts when it is created; opening an exercice is a second step, and every book starts here.',
  'noExercice.fromTerminal': 'From the terminal: {suggestion}',
} as const

export const fr: Record<keyof typeof en, string> = {
  'site.footer': 'b/books — un produit blackcode.',
  'site.home': 'Accueil b/books',
  'site.signIn': 'Se connecter',
  'site.createAccount': 'Créer un compte',

  'landing.eyebrow': 'Comptabilité légale',
  'landing.headline': 'Des livres que vous pouvez défendre, ligne par ligne.',
  'landing.lede':
    'b/books tient une comptabilité en partie double pour autant de livres que vous en avez. Chaque écriture dit ce qu’elle signifie, quelle pièce la justifie et où cette pièce se trouve — parce que dans dix ans, c’est la seule chose qu’on vous demandera.',
  'landing.whatItDoes': 'Ce qu’il fait.',
  'landing.f1.title': 'Un livre, ou plusieurs',
  'landing.f1.copy':
    'Une société, une deuxième société, une activité indépendante — chacune a son propre jeu de livres, avec son plan comptable, son exercice et son bilan. Passer de l’un à l’autre est un contrôle, pas une seconde connexion.',
  'landing.f2.title': 'Chaque écriture est expliquée',
  'landing.f2.copy':
    'Le libellé bancaire d’origine n’est jamais écrasé. Ce que l’écriture SIGNIFIE est enregistré à côté, avec l’indication de savoir si cela a été reconnu automatiquement ou décidé par une personne.',
  'landing.f3.title': 'La pièce justificative est un champ à part entière',
  'landing.f3.copy':
    'Quelle pièce justifie une écriture, et ce que cette pièce permet, sont enregistrés par écriture — et les deux conséquences juridiques, impôt sur le bénéfice et impôt préalable, sont suivies séparément parce qu’elles sont distinctes.',
  'landing.f4.title': 'Les états sont la loi',
  'landing.f4.copy':
    'Bilan et compte de résultat dans l’ordre donné par les art. 959a et 959b CO, avec les intitulés qu’ils donnent. Les postes à zéro cette année figurent quand même, parce que la liste est la loi et non une vue des données.',
  'landing.f5.title': 'D’où l’argent vient réellement',
  'landing.f5.copy':
    'Un registre de chaque banque, carte, processeur et flux documentaire, et de leur actualité. Une lacune dans un flux est une lacune dans les livres, et elle est présentée comme telle.',
  'landing.f6.title': 'Piloté par les agents que vous exécutez',
  'landing.f6.copy':
    'L’ingestion, le rapprochement et la réconciliation se font en dehors de cette application. Ce que vous obtenez ici, c’est le grand livre, le raisonnement qui le sous-tend et le petit nombre de décisions qui exigent une personne.',
  'landing.agentEyebrow': 'Conçu pour les agents',
  'landing.agentHeadline': 'Le travail se fait ailleurs. Ici, vous le vérifiez.',
  'landing.agentP1':
    'b/books s’utilise par des personnes dans cette application web et par des agents via {bk}, un binaire Go publié sur npm. Il n’y a pas d’API HTTP à apprendre ni de référence à maintenir : {guide} est embarqué dans le binaire et décrit donc exactement la version que vous exécutez, hors ligne.',
  'landing.agentP2':
    'Tout ce qui change sans nouvelle version — les vocabulaires, les taux de TVA, la liste de vos livres — vient de {meta}, en direct. C’est pourquoi rien de tout cela n’est imprimé sur cette page.',
  'landing.agentP3':
    'Il n’y a pas de fenêtre de discussion ici, ni d’assistant dans un coin. Le jugement appartient à l’agent qui fait l’ingestion, ou à vous ; le rôle de cette application est de vous montrer ce qui a été décidé et de vous laisser le corriger.',
  'landing.lawTitle': 'Ce que la loi exige d’un jeu de livres',
  'landing.law1.term': 'art. 957 CO — qui doit en tenir',
  'landing.law1.def':
    'Une société tient une comptabilité complète en partie double. Aucun seuil de chiffre d’affaires n’en dispense.',
  'landing.law2.term': 'art. 958f CO — pendant combien de temps',
  'landing.law2.def':
    'Dix ans, et une copie numérique ne compte que si son intégrité peut être démontrée. C’est pourquoi les pièces sont référencées par une empreinte prise à la capture plutôt que téléversées.',
  'landing.law3.term': 'art. 959a / 959b CO — à quoi ils doivent ressembler',
  'landing.law3.def':
    'Une structure fixe, dans un ordre fixe. Le bilan et le compte de résultat présentés ici SONT cette structure, et non un rapport construit par-dessus.',
  'landing.ctaHeadline': 'Ouvrez les livres.',
  'landing.ctaBody':
    'Connectez-vous avec votre compte blackcode — le même que celui des autres applications blackcode.',

  'login.tagline': 'Comptabilité légale suisse',
  'login.tabSignIn': 'Se connecter',
  'login.tabSignUp': 'Créer un compte',
  'login.email': 'Adresse e-mail',
  'login.password': 'Mot de passe',
  'login.name': 'Nom',
  'login.namePlaceholder': 'Votre nom',
  'login.forgot': 'Mot de passe oublié ?',
  'login.signingIn': 'Connexion…',
  'login.creating': 'Création…',
  'login.create': 'Créer un compte',
  'login.google': 'Continuer avec Google',
  'login.or': 'ou',
  'login.badCredentials': 'Cette adresse et ce mot de passe ne correspondent à aucun compte.',
  'login.passwordHint': 'Au moins 8 caractères',
  'login.emailPlaceholder': 'vous@blackcode.ch',
  'login.accountCreated': 'Compte créé. Veuillez vous connecter.',
  'login.passwordUpdated':
    'Mot de passe mis à jour. Connectez-vous avec le nouveau — toutes les autres applications blackcode ont également été déconnectées.',
  'login.shared':
    'Votre compte blackcode est le même dans toutes les applications blackcode. Les nouvelles adresses doivent être approuvées par un super administrateur avant de pouvoir s’inscrire, et une réinitialisation du mot de passe ici vaut pour partout.',

  'reset.title': 'Réinitialiser votre mot de passe',
  'reset.titleChange': 'Changer votre mot de passe',
  'reset.askBody':
    'Saisissez l’adresse e-mail de votre compte et nous vous enverrons un code à 6 chiffres pour réinitialiser votre mot de passe.',
  'reset.askBodyAuthenticated':
    'Nous enverrons un code à 6 chiffres à l’adresse de votre compte. Définir un nouveau mot de passe vous déconnecte de toutes les applications blackcode, y compris de cette session.',
  'reset.send': 'Envoyer le code',
  'reset.sending': 'Envoi…',
  'reset.sent': 'Nous avons envoyé un code à 6 chiffres à {email}. Il expire rapidement.',
  'reset.code': 'Code',
  'reset.newPassword': 'Nouveau mot de passe',
  'reset.confirm': 'Définir le mot de passe',
  'reset.confirming': 'Enregistrement…',
  'reset.done': 'Mot de passe défini. Connectez-vous avec.',
  'reset.cancel': 'Annuler',
  'reset.back': 'Utiliser une autre adresse',
  'reset.askBodyAuthenticated2':
    'Nous enverrons un code à 6 chiffres par e-mail pour confirmer votre identité, puis vous pourrez définir un nouveau mot de passe.',
  'reset.codeGoesTo': 'Le code sera envoyé à {email}',
  'reset.sentBody':
    'Nous avons envoyé un code à 6 chiffres à {email}. Saisissez-le ci-dessous avec votre nouveau mot de passe.',
  'reset.verificationCode': 'Code de vérification',
  'reset.confirmNewPassword': 'Confirmer le nouveau mot de passe',
  'reset.reenter': 'Ressaisir le mot de passe',
  'reset.setNewPassword': 'Définir le nouveau mot de passe',
  'reset.resend': 'Renvoyer le code',
  'reset.resendIn': 'Renvoi possible dans {seconds} s',
  'reset.showPassword': 'Afficher le mot de passe',
  'reset.hidePassword': 'Masquer le mot de passe',
  'reset.codeSent': 'Code de vérification envoyé',
  'reset.passwordUpdated': 'Mot de passe mis à jour',
  'reset.badEmail': 'Saisissez une adresse e-mail valide.',
  'reset.badCode': 'Saisissez le code à 6 chiffres reçu par e-mail.',
  'reset.tooShort': 'Le mot de passe doit comporter au moins 8 caractères.',
  'reset.mismatch': 'Les mots de passe ne correspondent pas.',

  'cli.title': 'Autoriser le CLI b/books',
  'cli.body':
    'Un terminal sur cette machine a demandé à se connecter en votre nom. En approuvant, vous émettez un jeton API qui lui est transmis — le même jeton qu’acceptent toutes les applications blackcode, pas un jeton propre à b/books.',
  'cli.approve': 'Autoriser',
  'cli.approving': 'Autorisation…',
  'cli.deny': 'Annuler',
  'cli.done': 'Autorisé. Vous pouvez fermer cet onglet et revenir au terminal.',
  'cli.badCallback':
    'Ce lien ne désigne pas une adresse de boucle locale : il ne provient donc pas d’un terminal de cette machine. Rien n’a été autorisé.',
  'cli.tokenName': 'Nom du jeton',
  'cli.revokeLater':
    'Vous pourrez le révoquer plus tard depuis Réglages → Jetons API, dans n’importe quelle application blackcode.',
  'cli.noRedirect': 'Le serveur a autorisé la demande mais n’a renvoyé aucune URL de rappel.',
  'cli.signedInAs': 'Connecté en tant que {email}',
  'cli.willSendTo': 'Un nouveau jeton API sera créé et envoyé à votre terminal à l’adresse :',
  'cli.notBooksSpecific':
    'Ce jeton n’est pas propre à b/books. C’est votre jeton blackcode et il fonctionne avec toutes les applications accessibles à votre compte. Révoquez-le depuis Réglages → Jetons API, dans l’une d’elles.',
  'cli.missingParams': 'Paramètres manquants',
  'cli.missingParamsBody':
    'Cette demande d’autorisation n’a ni URL de rappel ni jeton d’état. Relancez {login} depuis votre terminal.',
  'cli.invalidCallback': 'Rappel invalide',
  'cli.invalidCallbackBody':
    'Le rappel n’est pas une adresse de boucle locale. Envoi du jeton à un hôte externe refusé — l’identifiant émis par cette page fonctionne avec toutes les applications blackcode, pas seulement celle-ci.',
  'cli.back': '← Retour à b/books',

  'noBooks.title': 'Vous n’avez encore aucun livre',
  'noBooks.p1':
    'Un livre est l’ensemble complet des comptes d’une entité juridique — une société, ou une activité indépendante. Il a son propre plan comptable, son propre exercice et son propre bilan, et il ne se mélange jamais avec un autre.',
  'noBooks.p2':
    'Vous pouvez en avoir autant que nécessaire. Tout le reste de b/books — le grand livre, les états, la file de reconnaissance — porte sur celui que vous consultez.',
  'noBooks.openingOne': 'En ouvrir un',
  'noBooks.openingBody':
    'Depuis un terminal, avec le CLI {bk}. Ce n’est volontairement pas un formulaire dans cette application : la forme juridique fixe pour toute la vie de l’entité les règles comptables qui lui sont applicables, et le siège inscrit détermine les paramètres fiscaux cantonaux et communaux avec lesquels toute figure ultérieure est calculée. Ni l’un ni l’autre ne se corrige ensuite en modifiant un champ.',
  'noBooks.formsLead': 'SA',
  'noBooks.formsBody':
    '{sa} pour une société de capitaux, toujours en partie double, ou {ri} pour une raison individuelle, tenue en comptabilité simplifiée sauf indication contraire. Le livre arrive avec le plan comptable PME suisse déjà en place. Ouvrez ensuite son premier exercice avec {exercice} — rien ne peut être comptabilisé tant qu’il n’y en a pas.',
  'noBooks.noCli':
    'Pas encore de {bk} ? Lancez {login} une fois et vous serez ramené ici pour l’autoriser.',
  'noBooks.signedInAs':
    'Connecté en tant que {email}. Votre compte blackcode fonctionne dans toutes les applications blackcode.',

  'noExercice.thisBook': 'Ce livre',
  'noExercice.title': '{book} n’a encore aucun exercice ouvert.',
  'noExercice.body':
    'Il n’y a rien à dériver, donc aucun {statement} à afficher. Un livre reçoit son plan comptable à sa création ; ouvrir un exercice est une seconde étape, et tout livre commence ici.',
  'noExercice.fromTerminal': 'Depuis le terminal : {suggestion}',
}
