import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { LoginForm } from '@/components/login-form'

// Where `middleware.ts` sends an unauthenticated visitor, and where NextAuth
// sends an error. Same shape as apps/sales, apps/books and apps/billing.
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')

  // Read on the SERVER and passed down: `lib/auth.ts` builds its provider list
  // from the same two variables, so the button and the provider appear and
  // disappear together.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

  // `useSearchParams` inside the form needs a Suspense boundary.
  return (
    <Suspense>
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  )
}
