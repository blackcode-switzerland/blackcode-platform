import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { LandingPage } from '@/components/landing-page'

export const dynamic = 'force-dynamic'

// ── THIS WAS A BARE REDIRECT, AND THE COMMENT ABOVE IT WAS A DECISION ───────
//
// It read: "There is no marketing page and there should not be one: b/sales is
// internal, nobody arrives here without being invited, and
// `docs/platform-architecture.md` puts a landing page in the app that has an
// audience for it."
//
// **The premise expired on 2026-08-11.** This app got self-signup that day —
// `POST /api/auth/register` mints a workspace through `ensureWorkspaceForUser`,
// and `components/login-form.tsx` links to it — so "nobody arrives here without
// being invited" is no longer true. Somebody sent the bare URL used to be
// bounced instantly to a login screen that said nothing about what they were
// signing into. That is the audience the old comment said did not exist.
//
// The decision is therefore REPLACED rather than ignored, and it is replaced
// here rather than being argued with in a note underneath: a comment that
// disagrees with the code beside it is how the next person reverts this.
//
// (The `docs/platform-architecture.md` half of the old comment was already
// wrong when it was written — that document has never contained a paragraph
// about landing pages, in any revision. Grep before citing.)
//
// ── WHO SEES IT ─────────────────────────────────────────────────────────────
//
// Signed-out visitors, always. A signed-in visitor goes straight to the work,
// because for them this page has nothing the sidebar does not. There is no
// `?from=app` escape hatch as in `apps/issues`: that exists because its sidebar
// brand links to `/`, and this app's links to the workspace home instead — so
// nobody here can reach this page by accident and be bounced off it.
export default async function Home() {
  const session = await getServerSession(authOptions)
  if (session) redirect('/dashboard')

  return <LandingPage />
}
