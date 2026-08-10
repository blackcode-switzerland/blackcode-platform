// This app's NextAuth configuration.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THIS APP'S AND NOT THE PLATFORM'S
// ---------------------------------------------------------------------------
// `packages/platform-auth/src/index.ts` carries the full argument and it is not
// re-litigated here. The short version: what these callbacks DO to the database
// is shared and lives in `platform-db`'s `sign-in.ts`; what stays is the bundle
// of things that are genuinely one deployment's — which providers it offers,
// whose client credentials they use, and which URLs an unauthenticated visitor
// is sent to.
//
// The session COOKIE is not one of those. It is one credential across every
// deployment (D-16), so it is spread in from `@blackcode/platform-auth` and
// nothing about it is configured here.
//
// ---------------------------------------------------------------------------
// A FIRST SIGN-IN HERE CREATES A WORKSPACE. THAT REVERSES D-3, ON PURPOSE.
// ---------------------------------------------------------------------------
// Until 2026-08-10 this file deliberately did NOT create one, and the reasoning
// was right for what was true then: sales rendered no switcher and no create
// flow, so a workspace minted at sign-in was one the human could neither see nor
// leave — and it arrived with `sales` not enabled on it in
// `platform.workspace_apps`, which is the "onboarding screen that quietly works
// while hiding the real problem" `app/dashboard/layout.tsx` existed to prevent.
//
// **Both halves of that premise are gone.** This app owns `sales.workspaces`, so
// there is no per-app switch left to be off; and it has a members page, so the
// workspace is something the person can see and act on. What is left of D-3 —
// no switcher, no create-workspace page, one workspace per person — is intact
// and is `ensureWorkspaceForUser`'s whole shape.
//
// The workspace and the owner's membership row are written in ONE transaction.
// That is not tidiness: a workspace with no membership locks its own owner out
// of their data, because every read in this app joins on membership — and it is
// exactly the shape a partial failure leaves behind.
//
// It runs on BOTH providers and on every sign-in, not just new accounts. The
// credentials provider cannot know whether an account is new, and the function
// is keyed on MEMBERSHIP rather than account age, which is also what makes the
// invitation flow correct: somebody who accepted an invitation already belongs
// to a workspace and must not be handed a second one of their own.
//
// Pending invitations are still materialised: those were addressed to this
// person by somebody who already decided they belong.
import { type NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import {
  getUserByEmail,
  materializePendingInvitationsForUser,
  touchLastLogin,
  upsertUserFromOAuth,
} from '@blackcode/platform-db'
import {
  isEmailAllowed,
  isSuperAdmin,
  sessionCookieConfig,
  verifyPassword,
} from '@blackcode/platform-auth'
import { getDb } from './db/client'
import { ensureWorkspaceForUser } from './db/queries/workspaces'

/**
 * The first-sign-in bootstrap, run for both providers.
 *
 * NEVER THROWS. A sign-in that fails because a workspace could not be minted is
 * a person locked out of an account that exists — and this is idempotent, so the
 * next sign-in retries it. The dashboard's "no workspace yet" screen is the
 * visible fallback, and it is now an anomaly rather than the normal state.
 */
async function bootstrapWorkspace(userId: number, name: string | null, email: string) {
  try {
    await ensureWorkspaceForUser(userId, name, email)
  } catch (err) {
    console.error('ensureWorkspaceForUser failed at sign-in:', err)
  }
}

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const authOptions: NextAuthOptions = {
  providers: [
    ...(googleClientId && googleClientSecret
      ? [GoogleProvider({ clientId: googleClientId, clientSecret: googleClientSecret })]
      : []),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase()
        const password = credentials?.password ?? ''
        if (!email || !password) return null

        const user = await getUserByEmail(getDb(), email)
        if (!user || !user.password_hash) return null

        const ok = await verifyPassword(password, user.password_hash)
        if (!ok) return null

        await touchLastLogin(getDb(), user.id)
        // Both providers bootstrap. This one cannot know whether the account is
        // new, which is why the function is keyed on membership — see the header.
        await bootstrapWorkspace(user.id, user.name, user.email)
        return {
          id: String(user.id),
          email: user.email,
          name: user.name ?? undefined,
          image: user.avatar_url ?? undefined,
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        if (!user.email) return false
        // Who may exist on the platform at all. Off when SUPER_ADMINS is unset,
        // which is what keeps local development working.
        const allowed = await isEmailAllowed(getDb(), user.email)
        if (!allowed) return '/blocked'
        try {
          const result = await upsertUserFromOAuth(getDb(), {
            google_id: account.providerAccountId,
            email: user.email,
            name: user.name,
            avatar_url: user.image,
          })
          if (result.was_new) {
            try {
              await materializePendingInvitationsForUser(
                getDb(),
                result.user.id,
                result.user.email
              )
            } catch (mErr) {
              console.error('materialize pending invitations failed:', mErr)
            }
          }
          // OUTSIDE the `was_new` branch, unlike the invitation materialisation
          // above. That one is a one-time conversion of rows addressed to a
          // brand-new account; this is "does this person have a workspace yet",
          // which stays worth asking — an existing account whose bootstrap
          // failed, or one created before this phase, self-heals on next login.
          await bootstrapWorkspace(result.user.id, result.user.name, result.user.email)
        } catch (error) {
          console.error('Failed to upsert user:', error)
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (account && user?.email) {
        const dbUser = await getUserByEmail(getDb(), user.email)
        if (dbUser) {
          token.id = dbUser.id
          token.pwStamp = dbUser.password_changed_at ? dbUser.password_changed_at.getTime() : 0
        }
        token.isSuperAdmin = isSuperAdmin(user.email)
        if (account.provider === 'google' && account.access_token) {
          token.accessToken = account.access_token
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.id === 'number') session.user.id = token.id
        if (typeof token.pwStamp === 'number') session.user.pwStamp = token.pwStamp
        if (typeof token.isSuperAdmin === 'boolean') session.user.isSuperAdmin = token.isSuperAdmin
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  // ONE SIGN-IN ACROSS EVERY APP (D-16). Shared, never configured here: two apps
  // disagreeing about this cookie's name or domain produce a session that works
  // in one place and silently does not in the other. The whole decision — why it
  // is a rename rather than a widening, and what a wrong domain looks like — is
  // in `packages/platform-auth/src/session-cookie.ts`.
  //
  // Set `AUTH_COOKIE_DOMAIN=.blackcode.ch` in production and leave it UNSET
  // everywhere else.
  cookies: sessionCookieConfig(),
}
