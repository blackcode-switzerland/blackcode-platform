'use client'

// The front door: sign in, or create an account.
//
// ===========================================================================
// WHAT THIS REPLACED, AND WHY IT HAD TO GO
// ===========================================================================
// The scaffold's version was unstyled by design — "a scaffold that shipped a
// design is a design every copy has to undo" — and it ended with a paragraph
// telling the reader that `POST /api/auth/register` creates an account. That is
// correct and it is not a sign-up form. It is also the one thing this repo's
// agent-surface contract says never to do: **never present the HTTP API as a way
// to use the product.** Two ways in — the web UI for humans, `bk` for agents.
//
// So this is `apps/sales/components/login-form.tsx`'s shape, which has already
// been through the arguments: tabs rather than two pages, the Google button
// first and marked, one error message for both failures, and the server's own
// refusal shown verbatim.
//
// ===========================================================================
// ONE ACCOUNT ACROSS EVERY BLACKCODE APP
// ===========================================================================
// An account created in issues or sales signs in here, same cookie, same
// session, same password. There is nothing app-specific to build and nothing
// app-specific to explain — and adding a books-only auth path would break the
// property that makes the platform one product.
//
// **Sign-up is gated and the gate is not here.** `isEmailAllowed` (SUPER_ADMINS
// + `platform.email_whitelist`) is checked server-side in the register route
// before any write. It has to be there and not here: the account this creates is
// the SHARED platform account, so an ungated sign-up on books is an ungated
// sign-up on every app. This form only renders what the server refused.
//
// ── THE RESET LINK EXISTS NOW, AND THE NOTE THAT SAID OTHERWISE IS GONE ────
// This header used to explain, at length, that b/books had neither
// `@blackcode/platform-email` nor the `/api/auth/password-reset/*` routes, that
// a link to a flow which 404s is worse than no link, and that adding the routes
// was the backend's side of a wall. Every word of that was true on 2026-08-17
// and none of it is true now: b/books took fullstack ownership on 2026-08-19 and
// mounted both routes the same day.
//
// The footer changed with it. It used to send people to b/issues or b/sales to
// reset a password this app shares — a true recovery, and an odd thing to read
// on the screen you are already standing on.

import { useState } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { GoogleMark } from '@blackcode/platform-ui/ui/google-mark'
import { useRegisterAccount } from '@/lib/account'
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { SiteFrame } from '@/components/site-chrome'
import { useT } from '@/lib/i18n'

type Mode = 'signin' | 'signup' | 'reset'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const t = useT()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  // `?tab=signup` opens on the create-account panel. The marketing page's
  // "Create an account" buttons are the callers, and without this they landed
  // people on the SIGN-IN panel — a CTA that appears not to have worked, on the
  // one screen where a first-time visitor has no idea what they did wrong.
  // Same spelling as issues and sales; a second spelling for the same idea is a
  // link that silently misbehaves when somebody copies it between apps.
  // `reset` is reachable only from the link below, never from a query string:
  // a URL that opens the reset panel is a URL somebody can be sent, and this
  // form is the one screen where a stranger's link should not be able to choose
  // what you are looking at.
  const [mode, setMode] = useState<Mode>(params?.get('tab') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const register = useRegisterAccount()

  /**
   * Change tab. Clears the other tab's error, because a refusal about signing up
   * means nothing on the sign-in panel.
   *
   * `carry` is for the one case where it DOES mean something: an address that
   * already has a blackcode account sends the reader to sign-in, and the reason
   * has to travel with them or the tab silently changes under their hands. The
   * parameter exists rather than relying on calling `setError` after `switchTo`,
   * which works only because of setter ordering and reads like a mistake.
   */
  function switchTo(next: Mode, carry?: string) {
    setMode(next)
    setError(carry ?? null)
  }

  async function signInWith(emailValue: string, passwordValue: string): Promise<boolean> {
    const res = await signIn('credentials', {
      email: emailValue.trim().toLowerCase(),
      password: passwordValue,
      redirect: false,
      callbackUrl,
    })
    if (!res || res.error) return false
    router.push(res.url ?? callbackUrl)
    router.refresh()
    return true
  }

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const ok = await signInWith(email, password)
    setBusy(false)
    if (!ok) {
      // Deliberately one message for "no such user" and "wrong password". Which
      // one it was is exactly the fact an attacker is probing for.
      setError(t('login.badCredentials'))
    }
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await register.run({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      })
      if (!created.ok) {
        // The refusal the SERVER wrote, verbatim, plus its `suggestion`. An
        // invented shorter version would be a second copy of the policy, in the
        // client, where nothing checks it — and the whitelist message is the one
        // a rejected person most needs to be able to act on.
        //
        // Read off the RESULT, not off `register.error`: that is state, and it is
        // still null in this tick. Reading it here is what made every failure say
        // "Could not create your account." See lib/account.ts.
        // An address that already has a blackcode account is not an error the
        // reader should have to re-read the form to understand — it means they
        // already have what they were trying to make. Put them on the sign-in
        // tab, carrying the reason, with the email they typed still in the field.
        if (created.error.status === 409) switchTo('signin', created.message)
        else setError(created.message)
        return
      }
      // Straight in, with the password they just chose — the register route has
      // already minted the workspace, so there is somewhere to land.
      const ok = await signInWith(email, password)
      if (!ok) {
        setError(t('login.accountCreated'))
        switchTo('signin')
      }
    } finally {
      setBusy(false)
    }
  }

  // ── THE GOOGLE BUTTON, DRAWN ONCE AND PLACED FIRST ────────────────────────
  // Position is a claim about which door is the main one, and one click beats
  // filling two fields. An unmarked "Continue with Google" is the shape a
  // phishing page has; the mark is what makes it recognisable at a glance.
  //
  // Rendered here, once, so the sign-in and create-account panels cannot drift
  // apart — they are the same `mode` on one form.
  //
  // It only renders when the deployment actually has Google configured.
  // `lib/auth.ts` builds its provider list from the same two environment
  // variables, so a button that cannot work is never drawn — but the flag has to
  // be passed IN, because `process.env.GOOGLE_CLIENT_ID` is not readable from a
  // client component.
  const googleButton = googleEnabled ? (
    <>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl })}
        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        <GoogleMark size={16} />
        {t('login.google')}
      </button>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('login.or')}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  ) : null

  return (
    <SiteFrame>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center px-6 py-16 sm:py-24">
        <div className="mb-8 text-center">
          {/* `rounded-[14%]` — a PERCENTAGE, deliberately. A fixed radius is a
              different shape at every size: 6px on this 44px mark reads as a
              squircle; the same 6px on the 20px sidebar mark reads as a circle.
              The mark is always square, so a percentage is exactly proportional
              and no future size can get it wrong. */}
          <Image
            src="/logo.png"
            alt="b/"
            width={44}
            height={44}
            priority
            className="mx-auto mb-4 rounded-[14%]"
          />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">b/books</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('login.tagline')}</p>
        </div>

        {/* The tab strip is hidden on the reset panel: it is a THIRD mode with
            only two tabs, so leaving it up would show "Sign in" unselected while
            the reader is halfway through resetting a password, which reads as
            having lost their place. The panel carries its own Cancel. */}
        <div
          className={`mb-5 grid grid-cols-2 gap-1 rounded-md bg-secondary p-1 ${
            mode === 'reset' ? 'hidden' : ''
          }`}
        >
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(m)}
              className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'signin' ? t('login.tabSignIn') : t('login.tabSignUp')}
            </button>
          ))}
        </div>

        {mode === 'reset' ? (
          <div>
            <h2 className="mb-3 text-sm font-medium text-foreground">{t('reset.title')}</h2>
            <PasswordResetFlow
              authenticated={false}
              presetEmail={email}
              onCancel={() => switchTo('signin')}
              // Straight back to the sign-in panel with the reason carried, not
              // a toast that disappears: the password they just set is the one
              // they are about to type, and the reset also ended every session
              // this account had anywhere.
              onDone={() =>
                switchTo('signin', t('login.passwordUpdated'))
              }
            />
          </div>
        ) : (
        <>
        {googleButton}

        <form onSubmit={mode === 'signin' ? onSignIn : onSignUp} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t('login.name')}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder={t('login.namePlaceholder')}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('login.email')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder={t('login.emailPlaceholder')}
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <label htmlFor="password" className="block text-xs font-medium text-muted-foreground">
                {t('login.password')}
              </label>
              {/* Only on the sign-in panel. On "create account" there is no
                  password to have forgotten, and offering to reset one would be
                  offering a recovery for an account that does not exist yet. */}
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => switchTo('reset')}
                  className="text-xs text-primary-strong transition-opacity hover:underline"
                >
                  {t('login.forgot')}
                </button>
              )}
            </div>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={mode === 'signup' ? t('login.passwordHint') : undefined}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {mode === 'signin' ? t('login.tabSignIn') : t('login.tabSignUp')}
          </button>
        </form>
        </>
        )}

        {/*
          Two facts, both true today and both a surprise otherwise: the account
          is shared, and a new address has to be approved before it can sign up.
          Nothing about grants — `platform.app_access` was dropped in the
          multi-app refactor's Phase 5 and membership is the whole gate — and
          nothing about invitations, which is the sentence sales got wrong once.

          The third sentence used to send people to b/issues or b/sales to reset
          a password. It is reset HERE now, from the link above, and the note
          that remains is the one that is still surprising: doing it signs the
          account out of every app, because there is only one password.
        */}
        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          {t('login.shared')}
        </p>
      </div>
    </SiteFrame>
  )
}
