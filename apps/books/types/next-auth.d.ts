import 'next-auth'
import { DefaultSession, DefaultUser } from 'next-auth'

// The session shape is the platform's, not this app's, and it is declared per
// app because a `declare module` augmentation is scoped to the TypeScript
// program that includes it. Two apps carrying the same augmentation is not
// duplication in the sense the isolation rule cares about — there is no import
// crossing an app boundary, and the shape is fixed by `platform.users` plus what
// `lib/auth.ts` puts on the token.
declare module 'next-auth' {
  interface Session {
    user: {
      id?: number
      name?: string | null
      email?: string | null
      image?: string | null
      // Snapshot of `platform.users.password_changed_at` at sign-in time. A
      // password reset bumps it, which invalidates every session issued before
      // the reset — see lib/auth/session.ts.
      pwStamp?: number
      // True if this user's email is in the SUPER_ADMINS env list.
      isSuperAdmin?: boolean
    } & DefaultSession['user']
  }

  interface User extends DefaultUser {
    role?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string | number
    accessToken?: string
    pwStamp?: number
    isSuperAdmin?: boolean
  }
}
