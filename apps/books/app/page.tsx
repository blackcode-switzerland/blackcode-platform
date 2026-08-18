// `/` — the marketing page, and a redirect for anybody already signed in.
//
// This file was literal scaffold text reading "Template app" until 2026-08-17.
// Decision D-E: books has self-signup, so a stranger sent the bare URL can get
// in on their own, and what they met was a page describing a scaffold. The copy
// itself is `components/landing-page.tsx`, whose header carries the rules about
// what may and may not be written on it.
//
// ── SIGNED IN? YOU DO NOT WANT THE BROCHURE ────────────────────────────────
// A person with a session is a user, not a visitor, and showing them a "create
// an account" hero is the shape that makes an internal tool feel like a website
// somebody left the marketing on. The check is `getValidatedSessionUser`, not a
// raw `getServerSession`: a soft-deleted account or one whose password was reset
// elsewhere has a cookie and no longer has a session, and bouncing that person
// into `/dashboard` would send them to a page that redirects them straight back.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { LandingPage } from '@/components/landing-page'

// Per-request by construction: it reads the session. Saying so beats
// discovering at build time that Next tried to prerender it.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await getValidatedSessionUser()
  if (user) redirect('/dashboard')
  return <LandingPage />
}
