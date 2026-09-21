import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'

// The one thing true of every route under /dashboard: you are signed in, with
// a session that survives `getValidatedSessionUser` (soft delete, a password
// reset elsewhere).
//
// It deliberately renders NO shell and no zero-workspace screen. A layout has
// no pathname on the server, so a branch here would swallow
// `/dashboard/settings/*` too — and the person whose workspace bootstrap failed
// is exactly the one who most needs their account pages (apps/sales learned
// this on 2026-08-11). The empty state is `app/dashboard/page.tsx`'s; the shell
// is `[ws]/layout.tsx`'s.
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')
  return <>{children}</>
}
