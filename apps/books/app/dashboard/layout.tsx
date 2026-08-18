// The one thing that is true of every route under `/dashboard`: you are signed
// in, with a session that survives `getValidatedSessionUser` — which is a
// stricter test than "there is a cookie". A soft-deleted account, or one whose
// password was reset in another blackcode app, has a cookie and no session; the
// stamp check is what makes "reset your password" mean "reset it everywhere".
//
// ── AND NOTHING ELSE IS DECIDED HERE ───────────────────────────────────────
// Not which workspace, not whether there is one. `apps/sales` rendered its
// zero-membership screen at this level and it swallowed `/dashboard/settings/*`
// with it — so the one person who most needed their account pages (their
// workspace bootstrap had failed) was the one person who could not reach them.
// A layout cannot make that distinction: on the server it has no pathname and
// `children` is opaque. The branch belongs to `app/dashboard/page.tsx`.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  return <>{children}</>
}
