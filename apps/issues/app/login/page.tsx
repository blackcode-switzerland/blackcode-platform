'use client'

import { signIn, getSession } from 'next-auth/react'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Terminal,
} from 'lucide-react'

import { MarketingLayout } from '@/components/marketing/layout'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Input } from '@blackcode/platform-ui/ui/input'
import { Label } from '@blackcode/platform-ui/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@blackcode/platform-ui/ui/tabs'
import { Separator } from '@blackcode/platform-ui/ui/separator'
import { cn } from "@blackcode/platform-ui/utils"
import { PasswordResetFlow } from '@/components/password-reset-flow'

type Mode = 'signin' | 'signup'
type FieldName = 'name' | 'email' | 'password' | 'confirmPassword'
type Errors = Partial<Record<FieldName, string>>
type Touched = Partial<Record<FieldName, boolean>>

const HEADINGS: Record<Mode, { eyebrow: string; heading: string; sub: string }> = {
  signin: {
    eyebrow: 'Welcome back',
    heading: 'Sign in to your workspace.',
    sub: 'Use your email and password, or continue with Google.',
  },
  signup: {
    eyebrow: 'Get started — free',
    heading: 'Create your workspace.',
    sub: 'Spin up a workspace in seconds. No credit card needed.',
  },
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<Mode>('signin')

  // useSearchParams() is empty during SSR — sync the tab once after mount
  // so deep links like /login?tab=signup land on the right pane.
  useEffect(() => {
    if (searchParams.get('tab') === 'signup') setMode('signup')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [showReset, setShowReset] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [errors, setErrors] = useState<Errors>({})
  const [touched, setTouched] = useState<Touched>({})

  const [checkingSession, setCheckingSession] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // Toast OAuth errors from the URL exactly once, then strip the param so a
  // refresh doesn't re-toast.
  const oauthErrorHandled = useRef(false)
  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (!oauthError || oauthErrorHandled.current) return
    oauthErrorHandled.current = true
    toast.error('Sign in with Google failed', {
      description:
        oauthError === 'OAuthAccountNotLinked'
          ? 'This email is already associated with another account.'
          : 'Please try again or use email and password.',
    })
    const url = new URL(window.location.href)
    url.searchParams.delete('error')
    window.history.replaceState(null, '', url.toString())
  }, [searchParams])

  // Bounce already-authenticated users to the dashboard.
  useEffect(() => {
    getSession()
      .then((session) => {
        if (session) router.replace('/dashboard')
        else setCheckingSession(false)
      })
      .catch(() => setCheckingSession(false))
  }, [router])

  // Keep URL in sync with the active tab.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (mode === 'signup') url.searchParams.set('tab', 'signup')
    else url.searchParams.delete('tab')
    window.history.replaceState(null, '', url.toString())
    // Don't carry old errors across tabs
    setErrors({})
    setTouched({})
  }, [mode])

  /* ---------- Validation ---------- */

  const validateEmail = (val: string): string | undefined => {
    const trimmed = val.trim()
    if (!trimmed) return 'Email is required.'
    if (!EMAIL_RE.test(trimmed)) return 'Please enter a valid email address.'
    return undefined
  }

  const validatePassword = (val: string): string | undefined => {
    if (!val) return 'Password is required.'
    if (mode === 'signup' && val.length < 8)
      return 'Password must be at least 8 characters.'
    return undefined
  }

  const validateConfirm = (
    val: string,
    pwd: string = password,
  ): string | undefined => {
    if (mode !== 'signup') return undefined
    if (!val) return 'Please confirm your password.'
    if (val !== pwd) return 'Passwords don’t match.'
    return undefined
  }

  const setFieldError = (field: FieldName, err: string | undefined) =>
    setErrors((prev) => ({ ...prev, [field]: err }))

  // On blur: mark touched + validate that field.
  const onBlurEmail = () => {
    setTouched((t) => ({ ...t, email: true }))
    setFieldError('email', validateEmail(email))
  }
  const onBlurPassword = () => {
    setTouched((t) => ({ ...t, password: true }))
    setFieldError('password', validatePassword(password))
    // re-check confirm if user already blurred it
    if (touched.confirmPassword) {
      setFieldError('confirmPassword', validateConfirm(confirmPassword, password))
    }
  }
  const onBlurConfirm = () => {
    setTouched((t) => ({ ...t, confirmPassword: true }))
    setFieldError('confirmPassword', validateConfirm(confirmPassword))
  }

  // Change handlers re-validate the field only if it's already been touched.
  // This avoids screaming "Email is required" at someone who's still typing
  // the first character.
  const onChangeEmail = (v: string) => {
    setEmail(v)
    if (touched.email) setFieldError('email', validateEmail(v))
  }
  const onChangePassword = (v: string) => {
    setPassword(v)
    if (touched.password) setFieldError('password', validatePassword(v))
    if (touched.confirmPassword) {
      setFieldError('confirmPassword', validateConfirm(confirmPassword, v))
    }
  }
  const onChangeConfirm = (v: string) => {
    setConfirmPassword(v)
    if (touched.confirmPassword) setFieldError('confirmPassword', validateConfirm(v))
  }

  // Positive feedback when confirm matches — keeps the encouraging cue from
  // the previous version. Only shown if user has typed something.
  const confirmHint = useMemo(() => {
    if (!confirmPassword) return undefined
    if (errors.confirmPassword) return undefined
    return password === confirmPassword
      ? ({ tone: 'positive', text: 'Passwords match' } as const)
      : undefined
  }, [confirmPassword, password, errors.confirmPassword])

  /* ---------- Submit ---------- */

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    try {
      await signIn('google', { callbackUrl: '/dashboard' })
    } catch {
      toast.error('Sign in with Google failed', {
        description: 'Please try again or use email and password.',
      })
      setGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate all fields synchronously.
    const next: Errors = {
      email: validateEmail(email),
      password: validatePassword(password),
    }
    if (mode === 'signup') {
      next.confirmPassword = validateConfirm(confirmPassword)
    }
    setErrors(next)
    setTouched({ name: true, email: true, password: true, confirmPassword: true })

    const order: FieldName[] =
      mode === 'signup'
        ? ['name', 'email', 'password', 'confirmPassword']
        : ['email', 'password']
    const firstInvalid = order.find((f) => next[f])
    if (firstInvalid) {
      document.getElementById(inputId(mode, firstInvalid))?.focus()
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name: name || undefined }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          const errorCode = body.error ?? ''
          const message = body.message ?? body.error ?? 'Failed to create account.'
          if (errorCode === 'not_in_whitelist') {
            toast.error("You're not on the approved list", {
              description: "Blackcode is invite-only. Ask a super admin to add your email or domain.",
              duration: 8000,
            })
          } else if (res.status === 409 || /email/i.test(message)) {
            setFieldError('email', message)
            document.getElementById(inputId('signup', 'email'))?.focus()
          } else {
            toast.error('Could not create account', { description: message })
          }
          return
        }
      }

      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
      })

      if (!result || result.error) {
        if (mode === 'signup') {
          // Account was created but sign-in failed — surface as toast and let
          // the user retry from the sign-in tab.
          toast.error('Account created, but sign-in failed', {
            description: 'Try signing in manually with the credentials you just set.',
          })
          setMode('signin')
          return
        }
        // Sign-in failure → inline on password (the most actionable field).
        setFieldError('password', 'Invalid email or password.')
        toast.error('Sign in failed', {
          description: 'Check your email and password and try again.',
        })
        document.getElementById(inputId('signin', 'password'))?.focus()
        return
      }

      if (mode === 'signup') {
        toast.success('Account created', { description: 'Welcome aboard.' })
      } else {
        toast.success('Welcome back', {
          description: 'Taking you to your dashboard…',
        })
      }
      router.push('/dashboard')
    } catch (err) {
      toast.error('Something went wrong', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (checkingSession) {
    return (
      <MarketingLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </MarketingLayout>
    )
  }

  const headings = HEADINGS[mode]
  const formDisabled = submitting || googleLoading

  return (
    <MarketingLayout>
      <div className="grid min-h-[calc(100vh-160px)] grid-cols-1 lg:grid-cols-2">
        {/* Form side */}
        <section className="flex items-center justify-center px-6 py-12 sm:px-12">
          <div className="w-full max-w-md">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
              {headings.eyebrow}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {headings.heading}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{headings.sub}</p>

            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="mt-8"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin" disabled={formDisabled}>
                  Sign in
                </TabsTrigger>
                <TabsTrigger value="signup" disabled={formDisabled}>
                  Create account
                </TabsTrigger>
              </TabsList>

              {/* Google */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="mt-6 w-full"
                onClick={handleGoogleSignIn}
                disabled={formDisabled}
              >
                {googleLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GoogleGlyph />
                )}
                <span>
                  {mode === 'signup'
                    ? 'Sign up with Google'
                    : 'Continue with Google'}
                </span>
              </Button>

              <div className="my-6 flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  or with email
                </span>
                <Separator className="flex-1" />
              </div>

              {/* ---------- Sign in ---------- */}
              <TabsContent value="signin" className="mt-0">
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <Field
                    label="Email"
                    htmlFor={inputId('signin', 'email')}
                    error={errors.email}
                  >
                    <Input
                      id={inputId('signin', 'email')}
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => onChangeEmail(e.target.value)}
                      onBlur={onBlurEmail}
                      disabled={formDisabled}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={
                        errors.email ? errorId('signin', 'email') : undefined
                      }
                      required
                    />
                  </Field>

                  <Field
                    label="Password"
                    htmlFor={inputId('signin', 'password')}
                    error={errors.password}
                  >
                    <PasswordInput
                      id={inputId('signin', 'password')}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={onChangePassword}
                      onBlur={onBlurPassword}
                      shown={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      disabled={formDisabled}
                      invalid={Boolean(errors.password)}
                      describedBy={
                        errors.password ? errorId('signin', 'password') : undefined
                      }
                      required
                    />
                  </Field>

                  <div className="-mt-1 text-right">
                    <button
                      type="button"
                      onClick={() => setShowReset(true)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <SubmitButton submitting={submitting}>Sign in</SubmitButton>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  New to b/issues?{' '}
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-primary hover:underline"
                    onClick={() => setMode('signup')}
                  >
                    Create an account
                  </button>
                </p>
              </TabsContent>

              {/* ---------- Sign up ---------- */}
              <TabsContent value="signup" className="mt-0">
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <Field
                    label="Full name"
                    htmlFor={inputId('signup', 'name')}
                    error={errors.name}
                  >
                    <Input
                      id={inputId('signup', 'name')}
                      type="text"
                      autoComplete="name"
                      placeholder="Andrea Martinez"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={formDisabled}
                    />
                  </Field>

                  <Field
                    label="Email"
                    htmlFor={inputId('signup', 'email')}
                    error={errors.email}
                  >
                    <Input
                      id={inputId('signup', 'email')}
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => onChangeEmail(e.target.value)}
                      onBlur={onBlurEmail}
                      disabled={formDisabled}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={
                        errors.email ? errorId('signup', 'email') : undefined
                      }
                      required
                    />
                  </Field>

                  <Field
                    label="Password"
                    htmlFor={inputId('signup', 'password')}
                    error={errors.password}
                    hint={!errors.password ? 'At least 8 characters.' : undefined}
                  >
                    <PasswordInput
                      id={inputId('signup', 'password')}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={onChangePassword}
                      onBlur={onBlurPassword}
                      shown={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      disabled={formDisabled}
                      invalid={Boolean(errors.password)}
                      describedBy={
                        errors.password ? errorId('signup', 'password') : undefined
                      }
                      minLength={8}
                      required
                    />
                  </Field>

                  <Field
                    label="Confirm password"
                    htmlFor={inputId('signup', 'confirmPassword')}
                    error={errors.confirmPassword}
                    hint={confirmHint}
                  >
                    <PasswordInput
                      id={inputId('signup', 'confirmPassword')}
                      autoComplete="new-password"
                      placeholder="Re-type your password"
                      value={confirmPassword}
                      onChange={onChangeConfirm}
                      onBlur={onBlurConfirm}
                      shown={showConfirm}
                      onToggle={() => setShowConfirm((v) => !v)}
                      disabled={formDisabled}
                      invalid={Boolean(errors.confirmPassword)}
                      describedBy={
                        errors.confirmPassword
                          ? errorId('signup', 'confirmPassword')
                          : undefined
                      }
                      minLength={8}
                      required
                    />
                  </Field>

                  <SubmitButton submitting={submitting}>Create account</SubmitButton>

                  <p className="text-center text-xs text-muted-foreground">
                    By creating an account you agree to our{' '}
                    <a href="/terms" className="text-primary hover:underline">
                      Terms
                    </a>{' '}
                    and{' '}
                    <a href="/privacy" className="text-primary hover:underline">
                      Privacy Policy
                    </a>
                    .
                  </p>
                </form>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-primary hover:underline"
                    onClick={() => setMode('signin')}
                  >
                    Sign in
                  </button>
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </section>

        {/* Brand side — hidden on small screens to keep the form front and centre */}
        <aside className="relative hidden overflow-hidden border-l border-border/60 bg-muted/30 lg:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 50% at 20% 0%, rgb(94 106 210 / 0.16), transparent 70%), radial-gradient(50% 50% at 90% 100%, rgb(94 106 210 / 0.10), transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="bg-grid-center pointer-events-none absolute inset-0 opacity-60"
          />
          <div className="relative m-auto max-w-md p-12">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
              b/issues
            </div>
            <h2 className="text-3xl font-semibold leading-[1.2] tracking-tight">
              Issue tracking for humans and the{' '}
              <span className="text-gradient-brand">AI working</span> alongside them.
            </h2>
            <p className="mt-3 text-muted-foreground">
              {/* "Web, CLI, and HTTP — three equal interfaces" until 2026-08-11.
                  The HTTP API is private plumbing with no public contract; its
                  own reference route answers 410. A sign-in page promising a
                  third door is the `bk undo` defect in a smaller frame. */}
              A web UI for people and a CLI for agents, over one Postgres-backed
              data model. Sign in once, work from either.
            </p>

            <ul className="mt-8 space-y-5">
              {[
                {
                  title: 'Integer IDs everywhere',
                  copy: '"Issue 42" beats a 36-character UUID — for humans and agents alike.',
                },
                {
                  title: 'API tokens in 10 seconds',
                  copy: 'Mint a bk_live_… token from settings. Drop it in any agent or script.',
                },
                {
                  title: 'Undoable mutations',
                  copy: 'Issue updates are journaled. One command rewinds them. Broader coverage on the roadmap.',
                },
              ].map((it) => (
                <li key={it.title} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">{it.title}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{it.copy}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10 rounded-xl border border-border bg-card p-4 font-mono text-[12.5px] leading-relaxed text-muted-foreground">
              <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground/80">
                <Terminal className="size-3.5" />
                <span>terminal</span>
              </div>
              <div>
                <span className="text-primary">$</span> bk login
              </div>
              <div className="pl-2 text-muted-foreground/70">→ opening browser…</div>
              <div className="pl-2 text-muted-foreground/70">
                → token saved to ~/.config/bk/config.json
              </div>
              <div className="mt-1.5">
                <span className="text-primary">$</span> bk issues issue create --title
                &quot;Ship landing&quot; --priority 2
              </div>
              <div className="pl-2 text-muted-foreground/70">✓ created issue #152</div>
            </div>
          </div>
        </aside>
      </div>

      {showReset ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowReset(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold">Reset your password</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              We&apos;ll email you a one-time code to verify it&apos;s you.
            </p>
            <PasswordResetFlow
              authenticated={false}
              presetEmail={email}
              onCancel={() => setShowReset(false)}
              onDone={() => {
                setShowReset(false)
                toast.success('Password reset — sign in with your new password')
              }}
            />
          </div>
        </div>
      ) : null}
    </MarketingLayout>
  )
}

/* ---------- Helpers ---------- */

function inputId(mode: Mode, field: FieldName): string {
  return `${mode}-${field}`
}
function errorId(mode: Mode, field: FieldName): string {
  return `${inputId(mode, field)}-error`
}

/* ---------- Small components ---------- */

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string | { tone: 'positive' | 'negative'; text: string } | undefined
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : hint ? (
        typeof hint === 'string' ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : (
          <p
            className={cn(
              'text-xs',
              hint.tone === 'positive'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-destructive',
            )}
          >
            {hint.text}
          </p>
        )
      ) : null}
    </div>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  onBlur,
  shown,
  onToggle,
  autoComplete,
  placeholder,
  minLength,
  required,
  disabled,
  invalid,
  describedBy,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  shown: boolean
  onToggle: () => void
  autoComplete?: string
  placeholder?: string
  minLength?: number
  required?: boolean
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        minLength={minLength}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        tabIndex={-1}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function SubmitButton({
  submitting,
  children,
}: {
  submitting: boolean
  children: React.ReactNode
}) {
  return (
    <Button type="submit" size="lg" disabled={submitting} className="mt-2 w-full">
      {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </Button>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.99 10.99 0 001 12c0 1.78.43 3.46 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}
