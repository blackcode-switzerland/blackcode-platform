'use client'

// The front door: sign in, create an account, or reset a forgotten password.
//
// ===========================================================================
// THIS FILE USED TO SAY "THERE IS NO SIGN-UP HERE, AND THAT IS D-3 READ
// THROUGH TO ITS CONCLUSION". THAT WAS TRUE WHEN IT WAS WRITTEN AND IS NOT NOW.
// ===========================================================================
// The old argument: sales renders no create-workspace flow, so an account
// created here would land on the "you belong to nowhere" screen — a
// registration form whose successful outcome is a dead end.
//
// Phase 2 ended that. `POST /api/auth/register` mints a workspace through
// `ensureWorkspaceForUser` before it answers, so a person who signs up here
// lands in a working app. The route has existed since then with **no front
// door** — the capability was built and never linked to. Phase 10 links it.
//
// The footer sentence went the same way. It read "Access is by invitation. Ask
// a workspace owner to invite you and grant you b/sales." Both halves were
// wrong by 2026-08-11: access is not only by invitation (this form), and the
// GRANT was `platform.app_access`, dropped in Phase 5 — each app owns its
// workspaces now, so membership is the whole gate and there is nothing to grant.
// A page describing a capability the product does not have is the same defect
// as the landing page that sold `bk undo` for months.
//
// ---------------------------------------------------------------------------
// SIGN-UP IS GATED, AND THE GATE IS NOT HERE
// ---------------------------------------------------------------------------
// `isEmailAllowed` (SUPER_ADMINS + `platform.email_whitelist`) is checked
// server-side in the register route, before any write. It has to be there and
// not here: the account this creates is the SHARED platform account, so an
// ungated sign-up on sales is an ungated sign-up on every app. This form only
// renders what the server refused. Read that route's header before touching it.
//
// The Google button only renders when the deployment actually has Google
// configured. `lib/auth.ts` builds its provider list the same way, from the same
// two environment variables, so a button that cannot work is never drawn — but
// the flag has to be passed IN, because `process.env.GOOGLE_CLIENT_ID` is not
// readable from a client component.

import { useState } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { GoogleMark } from '@blackcode/platform-ui/ui/google-mark'
import { ApiClientError, apiSend } from '@/lib/client'
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { SiteFrame } from '@/components/site-chrome'

type Mode = 'signin' | 'signup' | 'reset'

const inputClass =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  // `?tab=signup` opens the form on the create-account panel. The landing page's
  // "Create an account" button is the only caller, and without this it landed
  // people on the SIGN-IN panel — a CTA that appears not to have worked, on the
  // one screen where a first-time visitor has no idea what they did wrong.
  // Same spelling as `apps/issues`, which has had the parameter since its own
  // landing page shipped; a second spelling for the same idea is a link that
  // silently misbehaves when somebody copies it between the two.
  const [mode, setMode] = useState<Mode>(params?.get('tab') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
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
      await apiSend<{ id: number }>('POST', '/api/auth/register', {
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      })
      // Straight in, with the password they just chose — the register route has
      // already minted the workspace, so there is somewhere to land.
      const ok = await signInWith(email, password)
      if (!ok) {
        setError('Account created. Please sign in.')
        switchTo('signin')
      }
    } catch (err) {
      // The refusal the SERVER wrote, verbatim, plus its `suggestion`. An
      // invented shorter version would be a second copy of the policy, in the
      // client, where nothing checks it — and the whitelist message is the one
      // a rejected person most needs to be able to act on.
      setError(
        err instanceof ApiClientError
          ? [err.message, err.suggestion].filter(Boolean).join(' ')
          : 'Could not create your account.'
      )
    } finally {
      setBusy(false)
    }
  }

  // ── THE GOOGLE BUTTON, DRAWN ONCE AND PLACED FIRST ────────────────────────
  // It used to sit BELOW the email/password form, after an "OR", with no mark
  // on it. Both halves were wrong. Position is a claim about which door is the
  // main one, and one click beats filling two fields — putting it second said
  // the opposite. And an unmarked "Continue with Google" is the shape a phishing
  // page has; the mark is what makes it recognisable at a glance.
  //
  // Rendered here, once, so the sign-in and create-account panels cannot drift
  // apart — they are the same `mode` on one form, and a second copy for the
  // second panel is how the two would end up different. The reset panel does
  // not show it: "continue with Google" is not an answer to "I forgot my
  // password", and offering it there sends somebody who wants their password
  // back into a flow that never asks for one.
  const googleButton = googleEnabled ? (
    <>
      <button
        type="button"
        onClick={() => signIn('google', { callbackUrl })}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
    // ── THE PAGE HAS THE LANDING PAGE'S FRAME SINCE 2026-08-11 ──────────────
    // This was a bare centred card in an empty viewport: no header, no footer,
    // and therefore no way back to `/` — so "Sign in" on a page with chrome
    // landed you somewhere that looked like a different site. The frame is
    // `components/site-chrome.tsx`, shared with the landing page rather than
    // copied into it. No nav: "Sign in" and "Create an account" are both this
    // page. The card itself is unchanged — narrow and centred.
    <SiteFrame>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center px-6 py-16 sm:py-24">
        <div className="mb-8 text-center">
          {/* The real mark. This was a `b/` drawn in text on an emerald square,
              which made THREE treatments of one logo in one app once
              `public/logo.png` arrived (2026-08-11): the sidebar's, the landing
              page's, and this. The front door is the worst place to be the odd
              one out — it is the first thing anybody sees of the product, and
              the mail they arrived from carries this same file.

              `rounded-[14%]` — a PERCENTAGE, deliberately. A fixed
              radius is a different shape at every size: 6px on this 44px mark
              is 14% and reads as a squircle; the same 6px on the 22px sidebar
              mark is 27% and reads as a circle. That was the 2026-08-11 defect,
              fixed once and then re-reported for the small renders. The mark is
              always square, so a percentage is exactly proportional and no
              future size can get it wrong. The radius on
              this mark is a CONSTANT 6px everywhere else it is drawn — 18, 22,
              24 and 28px in the two apps, all 6 — not a proportion of the size,
              so scaling it with the box at 44px made the front door the one
              place the logo looked different. */}
          <Image
            src="/logo.png"
            alt="b/"
            width={44}
            height={44}
            priority
            className="mx-auto mb-4 rounded-[14%]"
          />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">b/sales</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            blackcode&rsquo;s business-development pipeline
          </p>
        </div>

        {mode === 'reset' ? (
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <h2 className="mb-3 text-sm font-medium text-foreground">Reset your password</h2>
            <PasswordResetFlow
              authenticated={false}
              presetEmail={email}
              onCancel={() => switchTo('signin')}
              onDone={() => switchTo('signin')}
            />
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchTo(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-xs font-medium text-muted-foreground"
                  >
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
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
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
                <div className="mb-1.5 flex items-baseline justify-between">
                  <label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => switchTo('reset')}
                      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Forgot password?
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
                  placeholder={mode === 'signup' ? 'At least 8 characters' : undefined}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}

        {/*
          The replacement for "Ask a workspace owner to invite you and grant you
          b/sales." Says the one thing that is still true and still a surprise —
          the account is shared, and the address has to be approved first — and
          nothing about a grant, which has not existed since Phase 5.
        */}
        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Your blackcode account is the same one across every blackcode app. New addresses have to
          be approved by a super admin before they can sign up.
        </p>
      </div>
    </SiteFrame>
  )
}
