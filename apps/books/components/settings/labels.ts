'use client'

// The shared account kit's words, from this app's EN/FR dictionary.
//
// `@blackcode/platform-ui/account/*` carries English defaults and no product
// copy for anybody else; b/books is the one app that has to say every word in
// two languages, so it builds the whole object here, once, and every settings
// tab passes it.
//
// It returns the WHOLE `AccountLabels`, not a `Partial`, on purpose: the kit
// merges a partial over English defaults, so a key added to the kit and missed
// here would render English on a French page with every suite green
// (`hardcoded-strings.test.ts` cannot see a string it never meets). Typed whole,
// the missed key is a `tsc` error in this file.

import type { AccountLabels } from '@blackcode/platform-ui/account/labels'
import { useT } from '@/lib/i18n'

export function useAccountLabels(): AccountLabels {
  const t = useT()
  return {
    profile: t('settings.tab.profile'),
    account: t('settings.tab.account'),
    tokens: t('settings.tab.tokens'),
    preferences: t('settings.tab.preferences'),

    profileTitle: t('settings.profile.title'),
    profileDescription: t('settings.profile.note'),
    photo: t('settings.profile.photo'),
    uploadPhoto: t('settings.profile.uploadPhoto'),
    removePhoto: t('settings.profile.removePhoto'),
    photoHint: t('settings.profile.photoHint'),
    photoFromGoogle: t('settings.profile.photoFromGoogle'),
    email: t('settings.profile.email'),
    signedInWithPassword: t('settings.profile.viaPassword'),
    signedInWithGoogle: t('settings.profile.viaGoogle'),
    name: t('settings.profile.name'),
    namePlaceholder: t('settings.profile.namePlaceholder'),
    tagline: t('settings.profile.tagline'),
    taglineHint: t('settings.profile.taglineHint'),
    save: t('settings.profile.save'),
    saving: t('settings.profile.saving'),

    signedInTitle: t('settings.account.signedIn'),
    signedInDescription: t('settings.account.signedInNote'),
    signOut: t('chrome.signOut'),
    passwordTitle: t('settings.account.password'),
    passwordDescription: t('settings.account.passwordNote'),
    changePassword: t('settings.account.changePassword'),

    newTokenTitle: t('settings.tokens.new'),
    newTokenDescription: t('settings.tokens.newNote'),
    tokenNamePlaceholder: t('settings.tokens.namePlaceholder'),
    create: t('settings.tokens.create'),
    creating: t('settings.tokens.creating'),
    copyNowTitle: t('settings.tokens.copyNow'),
    copyNowDescription: t('settings.tokens.copyNowNote'),
    copy: t('settings.tokens.copy'),
    done: t('settings.tokens.hide'),
    yourTokens: t('settings.tokens.yours'),
    noTokens: t('settings.tokens.noneTitle'),
    noTokensHint: t('settings.tokens.noneHint', { login: 'bk login' }),
    created: (when) => t('settings.tokens.createdOn', { when }),
    lastUsed: (when) => t('settings.tokens.lastUsed', { when }),
    neverUsed: t('settings.tokens.neverUsed'),
    expires: (when) => t('settings.tokens.expires', { when }),
    revoke: t('settings.tokens.revoke'),
    revokeTitle: (name) => t('settings.tokens.revokeTitle', { name }),
    revokeDescription: t('settings.tokens.revokeNote'),
    cancel: t('settings.tokens.cancel'),

    appearanceTitle: t('settings.appearance'),
    appearanceDescription: t('settings.appearanceNote'),
    light: t('settings.theme.light'),
    dark: t('settings.theme.dark'),
    system: t('settings.theme.system'),
  }
}
