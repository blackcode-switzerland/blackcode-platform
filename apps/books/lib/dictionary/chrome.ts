// The shell, the shared screen states, and the words that are on screen no
// matter which of the thirteen screens you are looking at.
//
// ── ONE FILE PER AREA, AND EACH FILE OWES BOTH LANGUAGES ───────────────────
// `fr` is typed `Record<keyof typeof en, string>`, so an English string added
// here without its French is a `tsc` error in THIS file rather than a blank on
// screen three screens away. That is the strong half of the guard
// (`lib/dictionary/index.ts` explains the weak half and why both exist).

export const en = {
  'chrome.signedIn': 'Signed in',
  'chrome.settings': 'Settings',
  'chrome.signOut': 'Sign out',
  'chrome.cancel': 'Cancel',
  'chrome.signOutTitle': 'Sign out?',
  'chrome.signOutBody': 'You will be redirected to the login page.',
  'chrome.toggleTheme': 'Toggle theme',
  'chrome.languageSwitchTo': 'Switch language',
  'chrome.openMenu': 'Open menu',
  'chrome.closeMenu': 'Close menu',
  'chrome.menu': 'Menu',
  'chrome.book': 'Book',
  'chrome.fiscalYear': 'Fiscal year',
  'chrome.noSuchBook': '{slug} — no such book',
  'chrome.closed': 'closed',
  // The consequence, not the word — "closed" alone does not say it is final.
  'chrome.closedTitle':
    'This fiscal year has been closed. Nothing can be posted into it, and there is no reopen.',
  'chrome.yearClosed': '{year} — closed',
  'chrome.appName': 'b/books',

  // ── the three shared screen states ──────────────────────────────────────
  'state.loading': 'Loading',
  'state.loadingThing': 'Loading {thing}',
  'state.errorTitle': 'This could not be loaded',
  'state.errorTitleThing': '{thing} could not be loaded',
  'state.errorFallback': 'The request did not complete.',
  'state.seededLead': 'Seeded data.',
  'state.seededBody':
    'These books come from the mockup fixture, not from the database. Amounts, dates and documents are examples.',
  'state.notBuilt': '{screen} is not built yet.',
  'state.notBuiltLayout': 'Its layout is specified by {mockup} in the mockup.',

  // ── the unknown-book refusal, which every screen renders ────────────────
  'frame.noSuchBookTitle': 'There is no book called {slug}.',
  'frame.noSuchBookBody':
    'The address bar is asking for a book this account does not have. Pick one from the control in the top bar.',
} as const

export const fr: Record<keyof typeof en, string> = {
  'chrome.signedIn': 'Connecté',
  'chrome.settings': 'Réglages',
  'chrome.signOut': 'Se déconnecter',
  'chrome.cancel': 'Annuler',
  'chrome.signOutTitle': 'Se déconnecter ?',
  'chrome.signOutBody': 'Vous serez redirigé vers la page de connexion.',
  'chrome.toggleTheme': 'Changer de thème',
  'chrome.languageSwitchTo': 'Changer de langue',
  'chrome.openMenu': 'Ouvrir le menu',
  'chrome.closeMenu': 'Fermer le menu',
  'chrome.menu': 'Menu',
  'chrome.book': 'Livre',
  'chrome.fiscalYear': 'Exercice',
  'chrome.noSuchBook': '{slug} — livre inconnu',
  'chrome.closed': 'clôturé',
  'chrome.closedTitle':
    'Cet exercice a été clôturé. Plus rien ne peut y être comptabilisé, et il n’y a pas de réouverture.',
  'chrome.yearClosed': '{year} — clôturé',
  'chrome.appName': 'b/books',

  'state.loading': 'Chargement',
  'state.loadingThing': 'Chargement — {thing}',
  'state.errorTitle': 'Impossible de charger cet élément',
  'state.errorTitleThing': 'Impossible de charger : {thing}',
  'state.errorFallback': 'La requête n’a pas abouti.',
  'state.seededLead': 'Données de démonstration.',
  'state.seededBody':
    'Ces livres proviennent du jeu de démonstration, pas de la base de données. Les montants, les dates et les documents sont des exemples.',
  'state.notBuilt': '{screen} n’est pas encore construit.',
  'state.notBuiltLayout': 'Sa maquette est décrite par {mockup} dans le mockup.',

  'frame.noSuchBookTitle': 'Il n’existe aucun livre nommé {slug}.',
  'frame.noSuchBookBody':
    'La barre d’adresse demande un livre que ce compte ne possède pas. Choisissez-en un dans le contrôle en haut de la page.',
}
