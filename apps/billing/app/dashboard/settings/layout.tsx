// Settings sits under `/dashboard` and OUTSIDE `/dashboard/{ws}` — modelled on
// apps/sales' `app/dashboard/settings/layout.tsx`.
//
// Three of the tabs are about the ACCOUNT, which belongs to the platform and is
// the same row in every app — a name changed here is the name every other app
// shows. Nesting them under a workspace would say otherwise.
//
// ── THIS LAYOUT RENDERS `BillingShell` ITSELF ────────────────────────────────
// It is a SIBLING of `[ws]`, not a child, so `app/dashboard/[ws]/layout.tsx`'s
// shell never wraps it. Skipping the shell here would strand a phone user with
// no navigation and leave every desktop visit with no sidebar back into the
// app — the same bug apps/sales carried until 2026-08-11.
//
// The slug the shell's nav points at is guessed the same way
// `app/dashboard/page.tsx` guesses one for its own workspace list (last
// membership, deterministic ordering): nothing leaks and nothing 404s, because
// every link built from it points at a workspace this person is a member of.
//
// ── AND WITH NO WORKSPACE AT ALL, SETTINGS STILL RENDERS ────────────────────
// Deliberately: somebody whose workspace bootstrap failed is exactly the person
// who needs their profile, their tokens and the account page. `ws={null}`
// renders `BillingShell` with no workspace nav — the account pages still work,
// per apps/sales' 2026-08-11 fix.

// No wrapper markup here beyond the shell: `PageHeader` must be the FIRST
// thing inside it so its sticky bar sits full-width and registers with the
// shell (billing-shell.tsx — a page with no `PageHeader` gets the shell's
// fallback mobile bar instead). Each of the three pages renders its own
// `PageHeader` + `PageBody` + `SettingsNav`, the same shape every other
// workspace page uses.

import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { APP_NAME } from '@/lib/app'
import { BillingShell } from '@/components/shell/billing-shell'

export const dynamic = 'force-dynamic'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const memberships = await listWorkspacesForUser(user.id)
  // The workspace the person last chose (the same rule /dashboard uses), so the
  // sidebar does not jump to another workspace just because settings opened.
  const active = memberships.find((w) => w.id === user.active_workspace_id)
  const ws = (active ?? memberships[memberships.length - 1])?.slug ?? null
  const workspaces = memberships.map((w) => ({ id: w.id, name: w.name, slug: w.slug, member_role: w.member_role }))

  return (
    <BillingShell ws={ws} workspaces={workspaces} appName={APP_NAME}>
      {children}
    </BillingShell>
  )
}
