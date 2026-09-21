import { Suspense } from 'react'
import { LoginForm } from '@/components/login-form'

// Where `middleware.ts` sends an unauthenticated visitor, and where NextAuth
// sends an error. Both are configured in `lib/auth.ts` under `pages`.
//
// `useSearchParams` inside the form needs a Suspense boundary or the whole
// route opts into dynamic rendering.
export default function LoginPage() {
  // Read on the SERVER and passed down. `lib/auth.ts` builds its provider list
  // from the same two variables, so the button and the provider appear and
  // disappear together.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  )
}
