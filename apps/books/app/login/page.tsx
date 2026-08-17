import { Suspense } from 'react'
import { LoginForm } from '@/components/login-form'

// Where `middleware.ts` sends an unauthenticated visitor, and where NextAuth
// sends an error. Both are configured in `lib/auth.ts` under `pages`.
//
// Until 2026-08-11 this route did not exist and the matcher in `middleware.ts`
// guarded nothing — the file was there to be COPIED with its shape intact,
// because the second app's middleware was written from scratch against an app
// that had the session cookie wrong, and it nearly shipped an infinite
// sign-in redirect. Now the shape and its destination both exist.
export default function LoginPage() {
  // Read on the SERVER and passed down. `lib/auth.ts` builds its provider list
  // from the same two variables, so the button and the provider appear and
  // disappear together — a "Continue with Google" that 500s because the
  // deployment has no client id is worse than no button.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  )
}
