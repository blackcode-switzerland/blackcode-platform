// Every word the shared account-settings screens print, with English defaults.
// Same contract as `../workspace/labels.ts`: an app passes a partial and it is
// merged over these; books builds its object from its EN/FR dictionary. Words
// with a value in them are functions, because French reorders around it.
//
// NO BRAND IN A DEFAULT. b/billing ships rebranded, and its brand-leak guard
// (`apps/billing/lib/no-brand-literal.test.ts`) scans the app, not this package
// — a "blackcode" here would render in the rebranded deployment with that guard
// green. An app that wants its name in a sentence passes the label with its
// `PLATFORM_NAME`.

export interface AccountLabels {
  // tabs
  profile: string
  account: string
  tokens: string
  preferences: string

  // profile
  profileTitle: string
  profileDescription: string
  photo: string
  uploadPhoto: string
  removePhoto: string
  photoHint: string
  photoFromGoogle: string
  email: string
  signedInWithPassword: string
  signedInWithGoogle: string
  name: string
  namePlaceholder: string
  tagline: string
  taglineHint: string
  save: string
  saving: string

  // signed in / password
  signedInTitle: string
  signedInDescription: string
  signOut: string
  passwordTitle: string
  passwordDescription: string
  changePassword: string

  // tokens
  newTokenTitle: string
  newTokenDescription: string
  tokenNamePlaceholder: string
  create: string
  creating: string
  copyNowTitle: string
  copyNowDescription: string
  copy: string
  done: string
  yourTokens: string
  noTokens: string
  noTokensHint: string
  created: (when: string) => string
  lastUsed: (when: string) => string
  neverUsed: string
  expires: (when: string) => string
  revoke: string
  revokeTitle: (name: string) => string
  revokeDescription: string
  cancel: string

  // appearance
  appearanceTitle: string
  appearanceDescription: string
  light: string
  dark: string
  system: string
}

export const DEFAULT_ACCOUNT_LABELS: AccountLabels = {
  profile: 'Profile',
  account: 'Account',
  tokens: 'API tokens',
  preferences: 'Preferences',

  profileTitle: 'Your profile',
  profileDescription: 'This is your account, not one app’s. The name here is the name every app shows.',
  photo: 'Photo',
  uploadPhoto: 'Upload photo',
  removePhoto: 'Remove',
  photoHint: 'A square image reads best. Without one you get your initials, in a colour derived from your name.',
  photoFromGoogle: 'Synced from your Google account on every sign-in.',
  email: 'Email',
  signedInWithPassword: 'Signed in with a password.',
  signedInWithGoogle: 'Signed in with Google.',
  name: 'Name',
  namePlaceholder: 'Your name',
  tagline: 'Tagline',
  taglineHint: 'A short line shown on your member profile.',
  save: 'Save',
  saving: 'Saving…',

  signedInTitle: 'Signed in',
  signedInDescription: 'One account, one sign-in, every app. Signing out here signs you out everywhere.',
  signOut: 'Sign out',
  passwordTitle: 'Password',
  passwordDescription:
    'One password for every app, changed with a one-time code sent to your email. It also sets a password for the first time — for example if you signed up with Google.',
  changePassword: 'Change password',

  newTokenTitle: 'New token',
  newTokenDescription: 'Tokens are how agents reach your apps. One works against every app your account can reach.',
  tokenNamePlaceholder: 'Name, e.g. “laptop CLI”',
  create: 'Create',
  creating: 'Creating…',
  copyNowTitle: 'Copy your token now',
  copyNowDescription: 'It is shown once. Store it somewhere safe — nobody, including you, can see it again.',
  copy: 'Copy',
  done: 'Done',
  yourTokens: 'Your tokens',
  noTokens: 'No tokens',
  noTokensHint: 'Create one above, or run bk login from a terminal.',
  created: (when) => `created ${when}`,
  lastUsed: (when) => `last used ${when}`,
  neverUsed: 'never used',
  expires: (when) => `expires ${when}`,
  revoke: 'Revoke',
  revokeTitle: (name) => `Revoke “${name}”?`,
  revokeDescription: 'Anything using it stops working immediately.',
  cancel: 'Cancel',

  appearanceTitle: 'Appearance',
  appearanceDescription: 'Stored in this browser, not on your account.',
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

export function withAccountDefaults(labels?: Partial<AccountLabels>): AccountLabels {
  return labels ? { ...DEFAULT_ACCOUNT_LABELS, ...labels } : DEFAULT_ACCOUNT_LABELS
}
