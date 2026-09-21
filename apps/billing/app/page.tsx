import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { LandingPage } from '@/components/landing-page'

// This app's front door.
//
// Signed-out visitors see the product page; a signed-in visitor is sent
// straight to the work, because for them this page has nothing `/dashboard`
// does not. Same shape as apps/sales and apps/issues.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')

  return <LandingPage />
}
