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
// ── NO PASSWORD RESET LINK, AND THAT IS NOT AN OVERSIGHT ───────────────────
// `apps/sales` offers "Forgot password?" over `@blackcode/platform-email` and a
// set of `/api/auth/password-reset/*` routes. **b/books has neither the
// dependency nor the routes** (checked 2026-08-17: `app/api/auth/` contains
// `register` and `[...nextauth]`, nothing else). A link to a flow that 404s is
// worse than no link, and adding the routes is the backend's side of the wall —
// it is item 3 of the requests in this sprint's report.
//
// The password is the shared account's, so it CAN be reset from another
// blackcode app today. That is a true recovery and it is what the footer says.

import { useState } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { GoogleMark } from '@blackcode/platform-ui/ui/google-mark'
import { useRegisterAccount } from '@/lib/account'
import { SiteFrame } from '@/components/site-chrome'

type Mode = 'signin' | 'signup'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  // `?tab=signup` opens on the create-account panel. The marketing page's
  // "Create an account" buttons are the callers, and without this they landed
  // people on the SIGN-IN panel — a CTA that appears not to have worked, on the
  // one screen where a first-time visitor has no idea what they did wrong.
  // Same spelling as issues and sales; a second spelling for the same idea is a
  // link that silently misbehaves when somebody copies it between apps.
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
      setError('That email and password do not match an account.')
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
        setError('Account created. Please sign in.')
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
        Continue with Google
      </button>
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
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
          <p className="mt-1 text-sm text-muted-foreground">Swiss statutory bookkeeping</p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
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
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {googleButton}

        <form onSubmit={mode === 'signin' ? onSignIn : onSignUp} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Name
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@blackcode.ch"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={mode === 'signup' ? 'At least 8 characters' : undefined}
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
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {/*
          Two facts, both true today and both a surprise otherwise: the account
          is shared, and a new address has to be approved before it can sign up.
          Nothing about grants — `platform.app_access` was dropped in the
          multi-app refactor's Phase 5 and membership is the whole gate — and
          nothing about invitations, which is the sentence sales got wrong once.
        */}
        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Your blackcode account is the same one across every blackcode app. New addresses have to
          be approved by a super admin before they can sign up. Forgotten your password? Reset it
          from b/issues or b/sales — it is the same password.
        </p>
      </div>
    </SiteFrame>
  )
}
