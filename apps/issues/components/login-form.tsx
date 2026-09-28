'use client'

// The front door: sign in, create an account, or reset a forgotten password.
//
// Rebuilt 2026-09-28 on apps/billing's and apps/sales' `login-form.tsx`, so the
// four apps' front doors are one design. What changed from the page it
// replaced (`app/login/page.tsx`, 828 lines, in git history):
//
//   - The Google button renders only when this deployment has Google
//     configured (`googleEnabled`, read on the server from the same two env
//     vars `lib/auth.ts` builds its provider list from). The old page drew it
//     unconditionally, so a deployment without Google showed a button that
//     could only fail — the one local inconsistency between the four apps.
//   - No Terms / Privacy line: those pages were removed with the old
//     marketing chrome.
//   - An already-signed-in visitor is redirected by the SERVER page, not by a
//     client `getSession()` round trip behind a spinner.
//
// `POST /api/auth/register` creates the SHARED blackcode account, gated
// server-side by the whitelist; this form only renders what the server refused.

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { Loader2 } from 'lucide-react'
import { GoogleMark } from '@blackcode/platform-ui/ui/google-mark'
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { SiteFrame } from '@/components/site-chrome'

type Mode = 'signin' | 'signup' | 'reset'

const inputClass =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

/** NextAuth's `?error=` codes a person can actually cause, in their words. */
function oauthErrorMessage(code: string): string {
  if (code === 'OAuthAccountNotLinked') return 'This email is already associated with another sign-in method.'
  if (code === 'AccessDenied') return 'That Google account is not on the approved list. Ask a super admin to add it.'
  return 'Sign in with Google failed. Try again, or use your email and password.'
}

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  // `?tab=signup` opens the create-account panel — the spelling every app's
  // landing page links to.
  const [mode, setMode] = useState<Mode>(params?.get('tab') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Show an OAuth failure once, then strip the param so a refresh is clean.
  useEffect(() => {
    const code = params?.get('error')
    if (!code) return
    setError(oauthErrorMessage(code))
    const url = new URL(window.location.href)
    url.searchParams.delete('error')
    window.history.replaceState(null, '', url.toString())
  }, [params])

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
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
    // Deliberately one message for "no such account" and "wrong password".
    if (!ok) setError('That email and password do not match an account.')
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          name: name.trim() || undefined,
        }),
      })
      if (!res.ok) {
        // The refusal the SERVER wrote, plus its suggestion — the whitelist
        // message is the one a rejected person most needs to act on.
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
          suggestion?: string
        }
        const message = body.message ?? body.error ?? 'Could not create your account.'
        setError([message, body.suggestion].filter(Boolean).join(' — '))
        return
      }
      // Straight in, with the password they just chose — the register route has
      // already made a workspace, so there is somewhere to land.
      const ok = await signInWith(email, password)
      if (!ok) {
        setMode('signin')
        setNotice('Account created. Please sign in.')
      }
    } catch {
      setError('Could not create your account.')
    } finally {
      setBusy(false)
    }
  }

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
    // The reset panel does not show the Google button: "continue with Google"
    // is not an answer to "I forgot my password".
    <SiteFrame>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center px-6 py-16 sm:py-24">
        <div className="mb-8 text-center">
          <Image
            src="/logo.png"
            alt=""
            width={44}
            height={44}
            className="mx-auto mb-4 rounded-[14%]"
            priority
          />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">b/issues</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI-native issue tracking</p>
        </div>

        {mode === 'reset' ? (
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <h2 className="mb-3 text-sm font-medium text-foreground">Reset your password</h2>
            <PasswordResetFlow
              authenticated={false}
              presetEmail={email}
              onCancel={() => switchTo('signin')}
              onDone={() => {
                switchTo('signin')
                setNotice('Password reset. Sign in with your new password.')
              }}
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

            <form
              onSubmit={mode === 'signin' ? onSignIn : onSignUp}
              className="space-y-3"
              data-testid={mode === 'signin' ? 'signin-form' : 'signup-form'}
            >
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
                    data-testid="input-name"
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
                  data-testid="input-email"
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
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : undefined}
                  data-testid="input-password"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  data-testid="error"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              {notice && !error && (
                <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                data-testid="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            </form>
          </>
        )}

        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Your blackcode account is the same one across every blackcode app. New addresses
          have to be approved by a super admin before they can sign up.
        </p>
      </div>
    </SiteFrame>
  )
}
