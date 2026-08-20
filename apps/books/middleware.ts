import { withAuth } from 'next-auth/middleware'
// The SUBPATH, not the barrel. Middleware runs on the Edge runtime, and
// `@blackcode/platform-auth`'s index pulls in `tokens.ts` (node `crypto`) and,
// through `password-reset.ts`, the whole of `platform-db` (`node:crypto`) —
// none of which the Edge runtime can load. `./session-cookie` is deliberately
// dependency-free for this reason; the export map already carries the door.
import { sessionCookieConfig } from '@blackcode/platform-auth/session-cookie'

// The browser gate on the dashboard.
//
// ═══════════════════════════════════════════════════════════════════════════
// `cookies` IS NOT OPTIONAL, AND ITS ABSENCE FAILS SILENTLY. COPY THIS SHAPE.
// ═══════════════════════════════════════════════════════════════════════════
// `withAuth` verifies the session by calling `getToken`, and `getToken` looks
// for a cookie called `next-auth.session-token` (or `__Secure-…`) **unless it is
// told otherwise**. D-16 renamed this platform's session cookie to
// `blackcode.session-token`, so a middleware that passes nothing here is looking
// for a cookie that no deployment sets any more.
//
// The failure is not an error. A signed-in user is redirected to `/login`, signs
// in successfully, is redirected back, and bounces to `/login` again — forever,
// with a 200 on every request and nothing in the logs. It was found on
// 2026-08-07 by signing in against a seeded database: NextAuth returned a
// session, `/api/auth/session` served it, and `/dashboard` still bounced.
//
// It nearly shipped to production, and the reason is this file: the scaffold had
// NO middleware, so the second app's was written from scratch — modelled on the
// app that had it wrong. That is why a correct one lives here now, and why
// `packages/platform-testing/test/middleware-session-cookie.test.ts` asserts the
// shape for every app rather than trusting anyone to copy it.
//
// `sessionCookieConfig()` is the same call `lib/auth.ts` makes, so the name the
// gate looks for and the name the app sets cannot drift apart.
export default withAuth({
  cookies: sessionCookieConfig(),
  pages: {
    signIn: '/login',
  },
})

// ── `/dashboard` is real since 2026-08-11, so this matcher now guards something.
// Until then it protected nothing and said so, because the file existed to be
// COPIED WITH ITS SHAPE INTACT — which is the whole reason the cookie note above
// is here. When you add more authenticated pages, add their prefixes here.
//
// The matcher must NOT cover `/api/*`: API routes authenticate per request
// through `apiHandler`, which accepts a bearer token as well as a session, and
// a browser-session gate in front of them would lock out every `bk` command.
export const config = {
  matcher: ['/dashboard/:path*'],
}
