// The four settings tabs, and the language switch that is the reason this
// directory exists.
//
// ── THE TAB LABELS ARE TRANSLATED, THE TAB SET IS NOT NEGOTIABLE ───────────
// Four tabs, the same four b/issues and b/sales carry, in the same order. The
// account is one `platform.users` row across every app, so a person who has
// found their tokens in one app has found them everywhere. Translating a label
// does not move a tab.

export const en = {
  'settings.title': 'Settings',
  'settings.tab.profile': 'Profile',
  'settings.tab.account': 'Account',
  'settings.tab.tokens': 'API tokens',
  'settings.tab.preferences': 'Preferences',

  // ── profile ─────────────────────────────────────────────────────────────
  'settings.profile.title': 'Your blackcode profile',
  'settings.profile.note':
    'This is your account, not a b/books one. The name here is the name every blackcode app shows.',
  'settings.profile.loading': 'Loading your account',
  'settings.profile.loadError': 'Your account could not be loaded',
  'settings.profile.photoUrl': 'Photo URL',
  'settings.profile.photoFromGoogle':
    'Your photo comes from Google and re-syncs each time you sign in with it.',
  'settings.profile.email': 'Email',
  'settings.profile.viaGoogle': 'Signed in with Google. Your photo is synced from there.',
  'settings.profile.viaPassword': 'Signed in with an email and password.',
  'settings.profile.name': 'Name',
  'settings.profile.namePlaceholder': 'Your name',
  'settings.profile.tagline': 'Tagline',
  'settings.profile.taglinePlaceholder': 'What you do here',
  'settings.profile.save': 'Save',
  'settings.profile.saving': 'Saving…',
  'settings.profile.saved': 'Profile saved.',

  // ── account ─────────────────────────────────────────────────────────────
  'settings.account.signedIn': 'Signed in',
  'settings.account.signedInNote':
    'One account, one sign-in, every blackcode app. Signing out here signs you out everywhere.',
  'settings.account.password': 'Password',
  'settings.account.passwordNote':
    'One password for every blackcode app. Changing it here signs you out everywhere, including this session.',
  'settings.account.passwordViaGoogle':
    'You sign in with Google, so there is no blackcode password to change here. Google owns that credential and it is changed in your Google account.',
  'settings.account.changePassword': 'Change password',
  'settings.account.dataTitle': 'Your b/books data',
  'settings.account.dataLead':
    'This app cannot delete what it holds for you, and that is the law rather than a limitation of the software.',
  'settings.account.dataBody':
    'Art. 958f CO requires the books and their supporting documents to be kept for ten years, and the database refuses the delete rather than relying on anybody remembering. Other apps offer to remove your data; this one is not able to, and what closing a blackcode account means for accounting records has not been settled.',
  'settings.account.dataWarning':
    'Ask before you close a blackcode account from another app, rather than closing it and finding out what happened to the books afterwards.',
  'settings.account.elsewhere': 'Elsewhere in blackcode',
  'settings.account.elsewhereNote':
    'Your account is one row shared by every app. These are the other places it works.',
  'settings.account.noOtherApps':
    'No other blackcode app is registered in this deployment’s address book.',
  'settings.account.platformWide':
    'Users, error events and the drift reconcilers are platform-wide — the same rows whichever app you ask. b/books has no administration screens of its own and will not grow any.',

  // ── tokens ──────────────────────────────────────────────────────────────
  'settings.tokens.copyNow': 'Copy it now',
  'settings.tokens.copyNowNote':
    'This is the only time the token is shown. Nothing can display it again — not this page, and not the database, which stores only a hash of it.',
  'settings.tokens.copy': 'Copy',
  'settings.tokens.copied': 'Copied',
  'settings.tokens.copyFailed': 'Could not copy — select the token and copy it by hand',
  'settings.tokens.hide': 'I have it — hide this',
  'settings.tokens.new': 'New token',
  'settings.tokens.newNote':
    'Tokens are how agents reach blackcode. This one works against every app your account can reach, not only b/books.',
  'settings.tokens.namePlaceholder': 'What is it for? e.g. companion-laptop',
  'settings.tokens.create': 'Create',
  'settings.tokens.creating': 'Creating…',
  'settings.tokens.cliHint':
    'From a terminal, {login} does this for you and stores the result — including against this app, with {loginServer}.',
  'settings.tokens.yours': 'Your tokens',
  'settings.tokens.loading': 'Loading your tokens',
  'settings.tokens.loadError': 'Your tokens could not be loaded',
  'settings.tokens.none': 'No tokens yet. Create one above, or run {login} from a terminal.',
  'settings.tokens.lastUsed': 'last used {when}',
  'settings.tokens.neverUsed': 'never used',
  'settings.tokens.expires': 'expires {when}',
  'settings.tokens.revokeNamed': 'Revoke “{name}”',
  'settings.tokens.revoked': 'Revoked “{name}”',
  'settings.tokens.cancel': 'Cancel',

  // ── preferences ─────────────────────────────────────────────────────────
  'settings.appearance': 'Appearance',
  'settings.appearanceNote':
    'Stored in this browser, not on your account — so it does not follow you to another machine, and it does not change what anyone else sees.',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  'settings.language': 'Language',
  // The whole reason both switches exist on one page: the theme is per browser
  // and the language is on the account, and a settings page that does not
  // distinguish the two is how somebody concludes the app lost their choice.
  'settings.languageNote':
    'Stored on your blackcode account, not in this browser — so it follows you to every blackcode app and to every machine you sign in on.',
  'settings.languageStatutory':
    'It does not change what gets filed. The statutory line names of the bilan and the compte de résultat stay French in both languages, because that is the wording art. 959a and 959b CO fix, and anything exported or filed is French whatever you choose here.',
  'settings.languageBrowser': 'Follow my browser',
  'settings.languageBrowserNote':
    'No stored preference — b/books uses your browser’s language and falls back to English.',
  'settings.languageSaved': 'Language saved.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'settings.title': 'Réglages',
  'settings.tab.profile': 'Profil',
  'settings.tab.account': 'Compte',
  'settings.tab.tokens': 'Jetons API',
  'settings.tab.preferences': 'Préférences',

  'settings.profile.title': 'Votre profil blackcode',
  'settings.profile.note':
    'Il s’agit de votre compte, pas d’un compte b/books. Le nom saisi ici est celui qu’affiche chaque application blackcode.',
  'settings.profile.loading': 'Chargement de votre compte',
  'settings.profile.loadError': 'Impossible de charger votre compte',
  'settings.profile.photoUrl': 'URL de la photo',
  'settings.profile.photoFromGoogle':
    'Votre photo provient de Google et se resynchronise à chaque connexion avec Google.',
  'settings.profile.email': 'Adresse e-mail',
  'settings.profile.viaGoogle': 'Connecté avec Google. Votre photo y est synchronisée.',
  'settings.profile.viaPassword': 'Connecté avec une adresse e-mail et un mot de passe.',
  'settings.profile.name': 'Nom',
  'settings.profile.namePlaceholder': 'Votre nom',
  'settings.profile.tagline': 'Description',
  'settings.profile.taglinePlaceholder': 'Ce que vous faites ici',
  'settings.profile.save': 'Enregistrer',
  'settings.profile.saving': 'Enregistrement…',
  'settings.profile.saved': 'Profil enregistré.',

  'settings.account.signedIn': 'Connexion',
  'settings.account.signedInNote':
    'Un compte, une connexion, toutes les applications blackcode. Vous déconnecter ici vous déconnecte partout.',
  'settings.account.password': 'Mot de passe',
  'settings.account.passwordNote':
    'Un seul mot de passe pour toutes les applications blackcode. Le changer ici vous déconnecte partout, y compris de cette session.',
  'settings.account.passwordViaGoogle':
    'Vous vous connectez avec Google : il n’y a donc pas de mot de passe blackcode à changer ici. Cet identifiant appartient à Google et se modifie dans votre compte Google.',
  'settings.account.changePassword': 'Changer le mot de passe',
  'settings.account.dataTitle': 'Vos données b/books',
  'settings.account.dataLead':
    'Cette application ne peut pas supprimer ce qu’elle détient pour vous, et c’est la loi qui l’impose, non une limite du logiciel.',
  'settings.account.dataBody':
    'L’art. 958f CO exige la conservation des livres et de leurs pièces justificatives pendant dix ans ; la base de données refuse la suppression plutôt que de compter sur la mémoire de quiconque. D’autres applications proposent d’effacer vos données ; celle-ci n’en a pas la possibilité, et les conséquences de la fermeture d’un compte blackcode sur des documents comptables n’ont pas encore été tranchées.',
  'settings.account.dataWarning':
    'Renseignez-vous avant de fermer un compte blackcode depuis une autre application, plutôt que de le fermer et de découvrir ensuite ce qu’il est advenu des livres.',
  'settings.account.elsewhere': 'Ailleurs dans blackcode',
  'settings.account.elsewhereNote':
    'Votre compte est une seule ligne partagée par toutes les applications. Voici les autres endroits où il fonctionne.',
  'settings.account.noOtherApps':
    'Aucune autre application blackcode n’est inscrite dans l’annuaire de ce déploiement.',
  'settings.account.platformWide':
    'Les utilisateurs, les journaux d’erreurs et les réconciliateurs sont communs à toute la plateforme — ce sont les mêmes lignes quelle que soit l’application interrogée. b/books n’a pas d’écran d’administration propre et n’en aura pas.',

  'settings.tokens.copyNow': 'Copiez-le maintenant',
  'settings.tokens.copyNowNote':
    'C’est la seule fois où le jeton est affiché. Rien ne peut le réafficher — ni cette page, ni la base de données, qui n’en conserve qu’une empreinte.',
  'settings.tokens.copy': 'Copier',
  'settings.tokens.copied': 'Copié',
  'settings.tokens.copyFailed':
    'Copie impossible — sélectionnez le jeton et copiez-le manuellement',
  'settings.tokens.hide': 'Je l’ai — masquer',
  'settings.tokens.new': 'Nouveau jeton',
  'settings.tokens.newNote':
    'Les jetons sont le moyen par lequel les agents accèdent à blackcode. Celui-ci fonctionne avec toutes les applications accessibles à votre compte, pas seulement b/books.',
  'settings.tokens.namePlaceholder': 'À quoi sert-il ? par ex. portable-compagnon',
  'settings.tokens.create': 'Créer',
  'settings.tokens.creating': 'Création…',
  'settings.tokens.cliHint':
    'Depuis un terminal, {login} fait cela pour vous et conserve le résultat — y compris pour cette application, avec {loginServer}.',
  'settings.tokens.yours': 'Vos jetons',
  'settings.tokens.loading': 'Chargement de vos jetons',
  'settings.tokens.loadError': 'Impossible de charger vos jetons',
  'settings.tokens.none':
    'Aucun jeton pour l’instant. Créez-en un ci-dessus, ou lancez {login} depuis un terminal.',
  'settings.tokens.lastUsed': 'dernier usage {when}',
  'settings.tokens.neverUsed': 'jamais utilisé',
  'settings.tokens.expires': 'expire le {when}',
  'settings.tokens.revokeNamed': 'Révoquer « {name} »',
  'settings.tokens.revoked': '« {name} » révoqué',
  'settings.tokens.cancel': 'Annuler',

  'settings.appearance': 'Apparence',
  'settings.appearanceNote':
    'Enregistré dans ce navigateur, pas sur votre compte — cela ne vous suit donc pas sur une autre machine et ne change rien pour les autres.',
  'settings.theme.light': 'Clair',
  'settings.theme.dark': 'Sombre',
  'settings.theme.system': 'Système',
  'settings.language': 'Langue',
  'settings.languageNote':
    'Enregistrée sur votre compte blackcode, pas dans ce navigateur — elle vous suit donc dans toutes les applications blackcode et sur toutes les machines où vous vous connectez.',
  'settings.languageStatutory':
    'Cela ne change rien à ce qui est déposé. Les intitulés légaux du bilan et du compte de résultat restent en français dans les deux langues, car c’est la formulation fixée par les art. 959a et 959b CO, et tout export ou dépôt est en français quel que soit votre choix ici.',
  'settings.languageBrowser': 'Suivre mon navigateur',
  'settings.languageBrowserNote':
    'Aucune préférence enregistrée — b/books utilise la langue de votre navigateur et revient à l’anglais à défaut.',
  'settings.languageSaved': 'Langue enregistrée.',
}
