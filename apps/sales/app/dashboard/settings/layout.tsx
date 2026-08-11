// Settings sits under `/dashboard` and OUTSIDE `/dashboard/{ws}`.
//
// Three of the four pages are about the ACCOUNT, which belongs to the platform
// and is the same row in every app — a name changed here is the name issues
// shows. Nesting them under a workspace would say otherwise. **That reasoning is
// about the URL and it still holds**; what changed on 2026-08-11 is the CHROME.
//
// Preferences is the exception and it says so on its own page: `ui_mode` is
// keyed on (user, workspace), so that page resolves the workspaces this person
// can reach and renders one block per workspace rather than pretending there is
// a single global setting. In practice there is one (D-3), which is exactly why
// the plural branch must not be "pick the first and hope".
//
// ── THE SIDEBAR WAS MISSING HERE UNTIL 2026-08-11 ───────────────────────────
//
// `SalesShell` is mounted by `app/dashboard/[ws]/layout.tsx`, and settings is a
// SIBLING of `[ws]`, not a child — so every settings page rendered with no
// sidebar, no header and no ⌘K, and the only way back into the app was a small
// text link. `apps/issues` never had the problem because it mounts its shell one
// level up, at `app/dashboard/layout.tsx`, a parent of both.
//
// Moving the URL under `{ws}` would have been the wrong fix — it would say the
// account belongs to a workspace. Mounting the shell here says what is actually
// true: the same app frame, around pages that are not workspace-scoped.
//
// ── WHICH WORKSPACE THE FRAME POINTS AT ─────────────────────────────────────
//
// The shell needs a slug for its nav hrefs. Settings has none in its path, so it
// takes the first membership — and unlike `app/dashboard/page.tsx`, which
// refuses to guess a DESTINATION and shows a picker, guessing is acceptable for
// CHROME: every link points at a workspace this person is a member of (nothing
// leaks, nothing 404s), the ordering is deterministic, and in this app there is
// exactly one (D-3). The plural case costs a person one click through the
// picker at `/dashboard`, which is a different failure from landing silently in
// the wrong pipeline.
//
// ── AND WITH NO WORKSPACE AT ALL, SETTINGS STILL RENDERS ────────────────────
//
// Deliberately, and it is the reason `app/dashboard/layout.tsx` stopped
// rendering its zero-membership screen over `children`: somebody whose workspace
// bootstrap failed is exactly the person who needs their profile, their tokens
// and the account page. They get the settings pages with no frame around them —
// which is what this file rendered for everybody until today.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { PageTitle, SalesShell } from '@/components/sales-shell'
import { SettingsNav } from '@/components/settings/settings-nav'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)
  const ws = memberships[0]?.slug ?? null

  const body = (
    <div className="mx-auto max-w-3xl">
      {/* No back-link and no `<h1>Settings</h1>` when the frame is there: the
          sidebar is the way back, and the shell's sticky header carries the
          title (`PageTitle` below). Both were here because neither existed. */}
      {ws === null && (
        <h1 className="mb-5 text-xl font-semibold text-foreground">Settings</h1>
      )}
      <SettingsNav />
      <div className="mt-6">{children}</div>
    </div>
  )

  if (ws === null) return <div className="px-6 py-8">{body}</div>

  return (
    <SalesShell ws={ws}>
      <PageTitle title="Settings" />
      {body}
    </SalesShell>
  )
}
