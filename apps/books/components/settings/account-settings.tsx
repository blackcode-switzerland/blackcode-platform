'use client'

// Account — signing in, the password, and the two things this app will not
// pretend to do.
//
// ===========================================================================
// THE PASSWORD FORM ARRIVED ON 2026-08-19, AND WHAT IT REPLACED MATTERED
// ===========================================================================
// This tab used to carry a paragraph saying "b/books has no password form yet —
// change or reset it from b/issues or b/sales". That was true and it was the
// same shape of answer b/sales gave until it got `platform-email`: a person
// sent to another product to operate a credential they were already
// authenticated with. b/books took fullstack ownership and mounted
// `/api/me/password/*` the same day, so the paragraph is a form now.
//
// **It is still one password.** Changing it here changes it for every blackcode
// app, and it signs this session out along with all the others — which is the
// point of a password change and is a surprise if nobody says it first. The
// warning is above the button, not in a toast afterwards.
//
// ===========================================================================
// CLOSING AN ACCOUNT IS AN OPEN QUESTION, NOT A MISSING BUTTON
// ===========================================================================
// Every app has to answer "what do you hold for this person, and how do you
// remove it" (`AppContext.footprint`). **b/books legally cannot remove it:** art.
// 958f CO requires the books and their supporting documents to be kept for ten
// years, and a database trigger refuses the delete. No other app has hit this,
// and the platform's account-close flow has never had to handle an app that
// refuses.
//
// That is a platform decision and it is above this page. What the page must not
// do meanwhile is offer a button whose outcome nobody has decided, or repeat a
// reassuring sentence from another app that is not true here. So it says what is
// true and stops.

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { KeyRound, LogOut, ShieldAlert } from 'lucide-react'
import { useMe } from '@/lib/hooks'
import { useT } from '@/lib/i18n'
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { ErrorState, Loading } from '@/components/states'
import { Section } from './section'

export function AccountSettings({ otherApps }: { otherApps: { name: string; url: string }[] }) {
  const me = useMe()
  const t = useT()
  const [changing, setChanging] = useState(false)

  if (me.isLoading) return <Loading rows={4} label={t('settings.profile.loading')} />
  if (me.error) return <ErrorState error={me.error} title={t('settings.profile.loadError')} />
  if (!me.data) return null

  return (
    <div className="space-y-4">
      <Section
        title={t('settings.account.signedIn')}
        note={t('settings.account.signedInNote')}
      >
        <p className="text-sm text-foreground">{me.data.email}</p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <LogOut size={15} />
          {t('chrome.signOut')}
        </button>
      </Section>

      <Section
        title={t('settings.account.password')}
        note={t('settings.account.passwordNote')}
      >
        {changing ? (
          <PasswordResetFlow
            authenticated
            presetEmail={me.data.email}
            onCancel={() => setChanging(false)}
            // The session this request was made with is invalid the moment
            // `password_changed_at` moves, so staying on the page would mean the
            // next thing the reader clicks 401s for no visible reason. Sending
            // them to sign in is what actually happened, made visible.
            onDone={() => signOut({ callbackUrl: '/login' })}
          />
        ) : me.data.connected_google ? (
          // A Google-only account has no password to change, and offering the
          // form would send a code for a credential that is not how they get in.
          // They can still set one — that is what the logged-out reset flow
          // does — but the honest thing to say first is where their sign-in
          // actually comes from.
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t('settings.account.passwordViaGoogle')}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <KeyRound size={15} />
            {t('settings.account.changePassword')}
          </button>
        )}
      </Section>

      <Section title={t('settings.account.dataTitle')}>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{t('settings.account.dataLead')}</span>{' '}
          {t('settings.account.dataBody')}
        </p>
        <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-primary-strong" />
          <span>{t('settings.account.dataWarning')}</span>
        </p>
      </Section>

      <Section
        title={t('settings.account.elsewhere')}
        note={t('settings.account.elsewhereNote')}
      >
        {otherApps.length === 0 ? (
          // The address book is empty rather than "you have access to nothing" —
          // `platform.apps` is which apps EXIST, not which you can reach, and
          // saying otherwise would be a grant claim this deployment cannot make.
          <p className="text-[13px] text-muted-foreground">{t('settings.account.noOtherApps')}</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {otherApps.map((a) => (
              <li key={a.url}>
                <a
                  href={a.url}
                  className="text-primary-strong hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {t('settings.account.platformWide')}
        </p>
      </Section>
    </div>
  )
}
