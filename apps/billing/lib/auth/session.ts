import { getServerSession } from 'next-auth'
import { getUserByEmail, type User } from '@blackcode/platform-db'
import { authOptions } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

/**
 * The current browser-session user, or null — and null covers three different
 * things on purpose, because a page that distinguished them would be leaking:
 *
 *   - there is no session
 *   - the user was soft-deleted since the session was issued
 *   - the session's password stamp no longer matches
 *     `platform.users.password_changed_at`, i.e. the password was reset. A reset
 *     signs you out of every dashboard, in every app, everywhere — which is the
 *     point of one shared identity, and only works if every app checks.
 *
 * Bearer tokens are deliberately unaffected: `bk_live_…` tokens are separate,
 * explicitly-managed credentials, and `lib/api.ts` checks them on their own path.
 *
 * COPY THIS FILE. The stamp check is three lines and it is the difference
 * between "reset your password" and "reset your password everywhere".
 */
export async function getValidatedSessionUser(): Promise<User | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const user = await getUserByEmail(getDb(), session.user.email)
  if (!user || user.deleted_at) return null
  const sessionStamp = session.user.pwStamp ?? 0
  const currentStamp = user.password_changed_at ? user.password_changed_at.getTime() : 0
  if (sessionStamp !== currentStamp) return null
  return user
}
