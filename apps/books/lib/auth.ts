// This app's NextAuth configuration.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE IS THIS APP'S AND NOT THE PLATFORM'S
// ---------------------------------------------------------------------------
// `packages/platform-auth/src/index.ts` carries the full argument and it is not
// re-litigated here. The short version: what these callbacks DO to the database
// is shared and lives in `platform-db`'s `sign-in.ts`; what stays per app is the
// bundle that is genuinely one deployment's — which providers it offers, whose
// client credentials they use, and which URLs an unauthenticated visitor is sent
// to.
//
// The session COOKIE is NOT one of those. It is one credential across every
// deployment (D-16), so it is spread in from `@blackcode/platform-auth` and
// nothing about it is configured here. Two apps disagreeing about that cookie's
// name or domain produce a session that works in one place and silently does not
// in the other.
//
// ---------------------------------------------------------------------------
// A FIRST SIGN-IN HERE CREATES A WORKSPACE
// ---------------------------------------------------------------------------
// That is the whole difference between an app somebody can use and an app that
// tells them to go and get invited somewhere else. Before Phase 7 this app
// had no auth at all and no tenancy of its own; a copy of it could not serve a
// request until an issues workspace existed for the caller.
//
// The workspace and the owner's membership row are written in ONE transaction —
// see `ensureWorkspaceForUser`. It runs on BOTH providers and on EVERY sign-in,
// not just new accounts, because the credentials provider cannot know whether an
// account is new. The function is keyed on MEMBERSHIP rather than account age,
// which is also what makes the invitation flow correct: somebody who accepted an
// invitation already belongs to a workspace and must not be handed a second one.
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
 * a person locked out of an account that exists — and the call is idempotent, so
 * the next sign-in retries it.
 *
 * The cost of that choice is stated where it bites: a bug inside
 * `ensureWorkspaceForUser` is invisible from the response. Check the ROWS after
 * running a sign-up, not the status code.
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
    // Conditional, so an app with no Google credentials still builds and still
    // signs people in with a password. A provider registered without credentials
    // renders a button that fails.
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
        // WHO MAY HOLD AN ACCOUNT AT ALL. The same gate the register route
        // applies, for the same reason: the account is the SHARED platform one.
        // Off when SUPER_ADMINS is unset, which keeps local development working.
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
          // OUTSIDE the `was_new` branch, unlike the materialisation above. That
          // one is a one-time conversion of rows addressed to a brand-new
          // account; this is "does this person have a workspace yet", which
          // stays worth asking — an account whose bootstrap failed self-heals on
          // the next login.
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
          // The stamp `getValidatedSessionUser` compares. A password reset moves
          // it and signs this session out of every app.
          token.pwStamp = dbUser.password_changed_at ? dbUser.password_changed_at.getTime() : 0
        }
        token.isSuperAdmin = isSuperAdmin(user.email)
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
  // ONE SIGN-IN ACROSS EVERY APP (D-16). Shared, never configured here.
  // Set `AUTH_COOKIE_DOMAIN=.blackcode.ch` in production; leave it UNSET
  // everywhere else.
  cookies: sessionCookieConfig(),
}
