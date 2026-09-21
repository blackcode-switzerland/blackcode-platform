'use client'

// The front door: sign in, create an account, or reset a forgotten password.
//
// Modelled closely on apps/sales' `login-form.tsx`. `POST /api/auth/register`
// creates the SHARED blackcode account, gated server-side by the whitelist
// (`isEmailAllowed` — see that route's header before touching it); this form
// only renders what the server refused.
//
// The Google button renders only when the deployment actually has Google
// configured (`googleEnabled`, read server-side in `app/login/page.tsx` from
// the same two env vars `lib/auth.ts` builds its provider list from) — a button
// that cannot work is never drawn.

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { GoogleMark } from '@blackcode/platform-ui/ui/google-mark'
import { WebError, call } from '@/lib/client'
import { APP_NAME } from '@/lib/app'
import { PasswordResetFlow } from '@/components/password-reset-flow'
import { SiteFrame, BrandMark } from '@/components/landing/site-chrome'

type Mode = 'signin' | 'signup' | 'reset'

const inputClass =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const callbackUrl = params?.get('callbackUrl') ?? '/dashboard'

  // `?tab=signup` opens the create-account panel — same spelling as
  // apps/sales and apps/issues, so a link copied between them behaves the same.
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
      // Deliberately one message for "no such account" and "wrong password".
      setError('That email and password do not match an account.')
    }
  }

  async function onSignUp(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await call<{ id: number }>('/api/auth/register', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password, name: name.trim() },
      })
      // Straight in, with the password they just chose — the register route has
      // already minted a workspace, so there is somewhere to land.
      const ok = await signInWith(email, password)
      if (!ok) {
        setError('Account created. Please sign in.')
        switchTo('signin')
      }
    } catch (err) {
      // The refusal the SERVER wrote, plus its suggestion — the whitelist
      // message is the one a rejected person most needs to act on.
      setError(
        err instanceof WebError
          ? [err.message, err.suggestion].filter(Boolean).join(' ')
          : 'Could not create your account.'
      )
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
    // Reset panel does not show the Google button: "continue with Google" is
    // not an answer to "I forgot my password".
    <SiteFrame>
      <div className="mx-auto flex w-full max-w-sm flex-col justify-center px-6 py-16 sm:py-24">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex justify-center">
            <BrandMark size={44} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Swiss QR-bill invoicing</p>
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

            <form
              onSubmit={mode === 'signin' ? onSignIn : onSignUp}
              className="space-y-3"
              data-testid={mode === 'signin' ? 'signin-form' : 'signup-form'}
            >
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
                    data-testid="input-name"
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
          Your blackcode account is the same one across every blackcode app. New addresses have to
          be approved by a super admin before they can sign up.
        </p>
      </div>
    </SiteFrame>
  )
}
