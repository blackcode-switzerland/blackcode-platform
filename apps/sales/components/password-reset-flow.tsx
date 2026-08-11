'use client'

// The OTP password-reset flow, in b/sales' own styling. Two modes:
//   - authenticated=false : logged-out "forgot password", by email (login page)
//   - authenticated=true  : Settings → Account, using the session's email
//
// Two steps either way: request a code, then verify it and set a new password.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SECOND COMPONENT AND NOT A SHARED ONE
// ---------------------------------------------------------------------------
// `apps/issues` has its own. They are not shared and should not be: this is a
// PAGE, not a policy. The rule that must not diverge — OTP length, expiry,
// attempt cap, which failure maps to which code — lives in
// `@blackcode/platform-auth` and the shared route factories, where `tsc`
// enforces it. What is left here is the part the brief calls each app's own
// visual language: this app's inputs, this app's spacing, this app's emerald.
//
// A shared form would have to take a class map for every element to look right
// in both, which is the "if you have to add a parameter to make it generic,
// leave it in the app" rule verbatim.
//
// ---------------------------------------------------------------------------
// WHAT IT DOES WITH A DEPLOYMENT THAT CANNOT SEND
// ---------------------------------------------------------------------------
// The request routes answer 503 `email_not_configured` rather than a cheerful
// 200, so the error path below renders a true sentence instead of sending
// somebody to watch an inbox forever. That is the whole reason the status code
// exists; see `packages/platform-email/src/client.ts`.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { ApiClientError, apiSend } from '@/lib/client'

interface Props {
  authenticated: boolean
  presetEmail?: string
  onDone?: () => void
  onCancel?: () => void
}

type Step = 'request' | 'verify'

const REQUEST_URL = (authed: boolean) =>
  authed ? '/api/me/password/request-otp' : '/api/auth/password-reset/request'
const CONFIRM_URL = (authed: boolean) =>
  authed ? '/api/me/password/confirm' : '/api/auth/password-reset/confirm'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The server's sentence, plus its recovery line when it sent one.
 *
 * `suggestion` is the field the CLI prints as `hint:`; showing it here is what
 * turns "this deployment cannot send email" from a dead end into "ask an
 * administrator to configure RESEND_API_KEY".
 */
function describe(err: unknown, fallback: string): string {
  if (err instanceof ApiClientError) {
    return err.suggestion ? `${err.message} ${err.suggestion}` : err.message
  }
  return (err as Error)?.message || fallback
}

const inputClass =
  'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25'

export function PasswordResetFlow({ authenticated, presetEmail, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState(presetEmail ?? '')
  const [sentTo, setSentTo] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  function startResendCooldown() {
    setResendCooldown(120)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((v) => {
        if (v <= 1) {
          clearInterval(cooldownRef.current!)
          cooldownRef.current = null
          return 0
        }
        return v - 1
      })
    }, 1000)
  }

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!authenticated && !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      const j = await apiSend<{ ok: true; email?: string }>(
        'POST',
        REQUEST_URL(authenticated),
        authenticated ? undefined : { email: email.trim() }
      )
      setSentTo(j.email ?? email.trim())
      setStep('verify')
      startResendCooldown()
      toast.success('Verification code sent')
    } catch (err) {
      setError(describe(err, 'Could not send a code'))
    } finally {
      setLoading(false)
    }
  }

  async function confirmReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await apiSend<{ ok: true }>('POST', CONFIRM_URL(authenticated), {
        ...(authenticated ? {} : { email: email.trim() }),
        otp: otp.trim(),
        new_password: password,
      })
      toast.success('Password updated')
      onDone?.()
    } catch (err) {
      setError(describe(err, 'Could not reset password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {step === 'request' ? (
        <form onSubmit={requestCode} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {authenticated
              ? "We'll email a 6-digit code to confirm it's you, then you can set a new password."
              : "Enter your account email and we'll send you a 6-digit code to reset your password."}
          </p>
          {!authenticated ? (
            <div>
              <label
                htmlFor="reset-email"
                className="mb-1.5 block text-xs font-medium text-muted-foreground"
              >
                Email
              </label>
              <input
                id="reset-email"
                type="email"
                autoFocus
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@blackcode.ch"
                className={inputClass}
              />
            </div>
          ) : presetEmail ? (
            <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              Code will be sent to <strong className="text-foreground">{presetEmail}</strong>
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              Send code
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirmReset} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to{' '}
            <strong className="text-foreground">{sentTo || email}</strong>. Enter it below with your
            new password.
          </p>

          <div>
            <label
              htmlFor="reset-otp"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Verification code
            </label>
            <input
              id="reset-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-40 rounded-lg border border-input bg-card px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
          </div>

          <div>
            <label
              htmlFor="reset-password"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              New password
            </label>
            <div className="relative">
              <input
                id="reset-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className={`${inputClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="reset-confirm"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              Confirm new password
            </label>
            <input
              id="reset-confirm"
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter password"
              className={inputClass}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Reset password
            </button>
            <button
              type="button"
              onClick={() => {
                startResendCooldown()
                requestCode()
              }}
              disabled={loading || resendCooldown > 0}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>

          {!authenticated ? (
            <button
              type="button"
              onClick={() => {
                setStep('request')
                setOtp('')
                setError(null)
              }}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              &larr; Use a different email
            </button>
          ) : null}
        </form>
      )}
    </div>
  )
}
