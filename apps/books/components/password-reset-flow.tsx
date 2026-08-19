'use client'

// The OTP password flow. Two modes, one form:
//
//   authenticated=false   logged-out "forgot password", by email — the login page
//   authenticated=true    Settings → Account, by session
//
// Two steps either way: ask for a 6-digit code, then verify it and set a new
// password.
//
// ===========================================================================
// WHY IT IS THIS APP'S OWN COMPONENT AND NOT A SHARED ONE
// ===========================================================================
// b/issues and b/sales each have one too. They are not shared and should not be:
// this is a PAGE, not a policy. Everything that must not diverge — the code
// length, the expiry, the attempt cap, which failure maps to which status — is
// in `@blackcode/platform-auth` and the shared route factories, where `tsc`
// enforces it. What is left is the part that is supposed to differ: this app's
// inputs, this app's spacing, this app's amber.
//
// ===========================================================================
// IT SENDS THROUGH lib/account.ts, NOT THROUGH apiSend
// ===========================================================================
// `lib/read-only.test.ts` allows exactly two modules to send a write, and a
// component is neither of them. b/sales' version calls `apiSend` directly, which
// b/books cannot copy — the guard would go red, correctly. The hooks it uses are
// account writes: `platform.users` and `platform.password_reset_otps`, no
// `books.*` table anywhere near them.
//
// ===========================================================================
// A PRODUCTION DEPLOYMENT THAT CANNOT SEND SAYS SO
// ===========================================================================
// The request routes answer **503 `email_not_configured`** rather than a
// cheerful 200, so the error line below renders a true sentence instead of
// sending somebody to watch an inbox forever. The refusal carries a
// `suggestion` — "ask an administrator to configure RESEND_API_KEY" — and
// `lib/account.ts` folds it into the message, which is the difference between a
// dead end and a next step.
//
// **In dev it does not refuse, and that is deliberate.** `canDeliverEmail()` is
// true outside production, the route answers 200, and the code goes to the
// SERVER LOG instead of an inbox. So "We sent a 6-digit code" on a local machine
// with no Resend key is correct behaviour, not the bug it looks like — the code
// is in `npm run dev`'s output. See `lib/email/send.ts`.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { useConfirmPassword, useRequestPasswordCode } from '@/lib/account'
import { inputClass } from '@/components/settings/section'

interface Props {
  /** True in Settings (a session exists), false on the login page. */
  authenticated: boolean
  presetEmail?: string
  onDone?: () => void
  onCancel?: () => void
}

type Step = 'request' | 'verify'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Two minutes, matching what the other two apps offer. */
const RESEND_SECONDS = 120

export function PasswordResetFlow({ authenticated, presetEmail, onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>('request')
  const [email, setEmail] = useState(presetEmail ?? '')
  const [sentTo, setSentTo] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const request = useRequestPasswordCode(authenticated)
  const confirmReset = useConfirmPassword(authenticated)
  const busy = request.pending || confirmReset.pending

  // Clearing the interval on unmount. Without it, closing the panel mid-cooldown
  // leaves a timer calling `setCooldown` on a component that is gone.
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  function startCooldown() {
    if (timer.current) clearInterval(timer.current)
    setCooldown(RESEND_SECONDS)
    timer.current = setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) {
          if (timer.current) clearInterval(timer.current)
          timer.current = null
          return 0
        }
        return v - 1
      })
    }, 1000)
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!authenticated && !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    // The logged-in route takes no body — it uses the session's own address, and
    // sending one would invite the idea that another address could be passed.
    const sent = await request.run(authenticated ? undefined : { email: email.trim() })
    if (!sent.ok) {
      // The SERVER's sentence, off the result rather than out of state — see
      // `lib/account.ts`. Reading `request.error` here is always null in this
      // tick, and that mistake has already cost this app one dead end.
      setError(sent.message)
      return
    }
    setSentTo(sent.data.email ?? email.trim())
    setStep('verify')
    startCooldown()
    toast.success('Verification code sent')
  }

  async function submitNewPassword(e: React.FormEvent) {
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
    const done = await confirmReset.run({
      ...(authenticated ? {} : { email: email.trim() }),
      otp: otp.trim(),
      new_password: password,
    })
    if (!done.ok) {
      setError(done.message)
      return
    }
    toast.success('Password updated')
    onDone?.()
  }

  if (step === 'request') {
    return (
      <form onSubmit={sendCode} className="space-y-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {authenticated
            ? 'We will email a 6-digit code to confirm it is you, then you can set a new password.'
            : 'Enter your account email and we will send you a 6-digit code to reset your password.'}
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
          <p className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            The code goes to <strong className="text-foreground">{presetEmail}</strong>
          </p>
        ) : null}

        <ErrorLine message={error} />

        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send code
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submitNewPassword} className="space-y-3">
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        We sent a 6-digit code to <strong className="text-foreground">{sentTo || email}</strong>.
        Enter it below with your new password.
      </p>

      <div>
        <label htmlFor="reset-otp" className="mb-1.5 block text-xs font-medium text-muted-foreground">
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
          className="w-40 rounded-md border border-input bg-card px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25"
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
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
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

      <ErrorLine message={error} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          Set new password
        </button>
        <button
          type="button"
          onClick={() => sendCode()}
          disabled={busy || cooldown > 0}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
      </div>

      {!authenticated && (
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
      )}
    </form>
  )
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}
