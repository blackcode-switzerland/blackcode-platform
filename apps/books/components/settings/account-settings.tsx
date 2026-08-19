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
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { ErrorState, Loading } from '@/components/states'
import { Section } from './section'

export function AccountSettings({ otherApps }: { otherApps: { name: string; url: string }[] }) {
  const me = useMe()
  const [changing, setChanging] = useState(false)

  if (me.isLoading) return <Loading rows={4} label="Loading your account" />
  if (me.error) return <ErrorState error={me.error} title="Your account could not be loaded" />
  if (!me.data) return null

  return (
    <div className="space-y-4">
      <Section
        title="Signed in"
        note="One account, one sign-in, every blackcode app. Signing out here signs you out everywhere."
      >
        <p className="text-sm text-foreground">{me.data.email}</p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <LogOut size={15} />
          Sign out
        </button>
      </Section>

      <Section
        title="Password"
        note="One password for every blackcode app. Changing it here signs you out everywhere, including this session."
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
            You sign in with Google, so there is no blackcode password to change here. Google owns
            that credential and it is changed in your Google account.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            <KeyRound size={15} />
            Change password
          </button>
        )}
      </Section>

      <Section title="Your b/books data">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">
            This app cannot delete what it holds for you, and that is the law rather than a
            limitation of the software.
          </span>{' '}
          Art. 958f CO requires the books and their supporting documents to be kept for ten years,
          and the database refuses the delete rather than relying on anybody remembering. Other apps
          offer to remove your data; this one is not able to, and what closing a blackcode account
          means for accounting records has not been settled.
        </p>
        <p className="flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-primary-strong" />
          <span>
            Ask before you close a blackcode account from another app, rather than closing it and
            finding out what happened to the books afterwards.
          </span>
        </p>
      </Section>

      <Section
        title="Elsewhere in blackcode"
        note="Your account is one row shared by every app. These are the other places it works."
      >
        {otherApps.length === 0 ? (
          // The address book is empty rather than "you have access to nothing" —
          // `platform.apps` is which apps EXIST, not which you can reach, and
          // saying otherwise would be a grant claim this deployment cannot make.
          <p className="text-[13px] text-muted-foreground">
            No other blackcode app is registered in this deployment&rsquo;s address book.
          </p>
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
          Users, error events and the drift reconcilers are platform-wide — the same rows whichever
          app you ask. b/books has no administration screens of its own and will not grow any.
        </p>
      </Section>
    </div>
  )
}
