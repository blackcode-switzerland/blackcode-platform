// Settings sits under `/dashboard` and OUTSIDE `/dashboard/{ws}`.
//
// ── FOUR TABS SINCE 2026-08-19, THE SAME FOUR THE OTHER APPS CARRY ─────────
// It was one long scrolling page: profile, then appearance, then a block of
// account facts. Four tabs is not a redesign for its own sake — the account is
// ONE `platform.users` row shared by every blackcode app, so a person who knows
// where their tokens live in b/issues should find them in the same place here.
// `SettingsNav` carries the labels and the reasoning for the one that differs.
//
// It is about the ACCOUNT, which belongs to the platform and is the same row in
// every app — a name changed here is the name b/issues shows. Nesting it under a
// tenancy segment would say otherwise.
//
// ── THE SHELL IS MOUNTED HERE, BECAUSE SETTINGS IS A SIBLING OF `[ws]` ─────
// `BooksShell` is mounted by `app/dashboard/[ws]/layout.tsx`, and this route is
// not a child of that. `apps/sales` shipped every settings page with no sidebar,
// no header and no way back into the app for exactly this reason, and fixed it
// on 2026-08-11 by mounting the shell here rather than by moving the URL. Moving
// the URL would have been the wrong fix — it would say the account belongs to a
// tenancy.
//
// ── WHICH SLUG THE FRAME POINTS AT ─────────────────────────────────────────
// The shell needs one for its nav hrefs and this path has none, so it takes the
// first membership. Guessing is acceptable for CHROME and not for a destination:
// every link points somewhere this person is a member of, nothing leaks, nothing
// 404s, and the ordering is deterministic. In this app there is normally exactly
// one anyway — `app/dashboard/page.tsx` explains why.
//
// ── AND WITH NO MEMBERSHIP AT ALL, SETTINGS STILL RENDERS ─────────────────
// Deliberately. Somebody whose account bootstrap failed is exactly the person
// who needs their profile page, and `app/dashboard/layout.tsx` therefore does
// not render an empty state over `children`. They get the settings page with no
// frame around it, which is worse than having one and much better than a
// redirect loop.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getStoredActiveWorkspaceId, listWorkspacesForUser, resolveActiveWorkspace } from '@/lib/db/queries/workspaces'
import { BooksShell } from '@/components/books-shell'
import { SettingsFrame } from '@/components/settings/settings-nav'
import { serverT } from '@/lib/i18n-server'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const [memberships, storedId] = await Promise.all([
    listWorkspacesForUser(user.id),
    getStoredActiveWorkspaceId(user.id),
  ])
  // The workspace you were last in, not merely the oldest: the sidebar's
  // switcher names it, and it should be the one you would go back to.
  const ws = resolveActiveWorkspace(memberships, storedId)?.slug ?? null
  // A SERVER translator, not `useT()`. This is the one heading in the app a
  // layout has to name for itself — `/dashboard/settings/*` is a sibling of
  // `[ws]`, so no nav entry matches its pathname — and a layout cannot call a
  // hook. See `lib/i18n-server.ts`.
  const t = await serverT()

  const body = (
    // The shared `AccountSettingsFrame` (via `SettingsFrame`) owns the column,
    // its padding and the tab strip since 2026-09-28 — the same frame, width
    // and tabs in every app.
    <SettingsFrame>
      {/* The heading only when there is no frame. With the shell mounted, its
          sticky header already names the page and a second one is noise. */}
      {ws === null && <h1 className="text-xl font-semibold text-foreground">{t('settings.title')}</h1>}
      {children}
    </SettingsFrame>
  )

  // The frameless case renders with no shell at all, for somebody whose
  // workspace bootstrap failed and who is exactly the person who needs their
  // profile and tokens.
  if (ws === null) return body

  return (
    <BooksShell ws={ws} title={t('settings.title')} workspaces={memberships}>
      {body}
    </BooksShell>
  )
}
