'use client'

// The sign-in form. Deliberately unstyled beyond the minimum: a scaffold that
// shipped a design would be a design every copy has to undo.
//
// `next-auth/react` only — no query client, no toast library, no theme
// provider. This app has none of those as dependencies, and adding three to a
// scaffold so its login page can have a spinner is how a starting point becomes
// a framework. `docs/frontend.md` is where the shared UI lives when you want it.
import { useState } from 'react'
import { signIn } from 'next-auth/react'

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // `redirect: false` so a bad password renders an error here instead of
    // bouncing to NextAuth's own error page, which cannot say anything useful.
    const res = await signIn('credentials', {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    })
    setBusy(false)
    if (res?.error) {
      // Deliberately one message for "no such account" and "wrong password":
      // distinguishing them tells an attacker which addresses have accounts.
      setError('That email and password did not match.')
      return
    }
    window.location.href = '/dashboard'
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 380 }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {googleEnabled && (
        <button type="button" onClick={() => signIn('google', { callbackUrl: '/dashboard' })}>
          Continue with Google
        </button>
      )}
      <p style={{ marginTop: 24, fontSize: 13 }}>
        No account? <code>POST /api/auth/register</code> creates one — and note that it is the
        SHARED blackcode account, gated by the whitelist. Read that route&apos;s header before
        copying it.
      </p>
    </main>
  )
}
