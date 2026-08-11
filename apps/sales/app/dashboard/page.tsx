import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getStoredActiveWorkspaceId, listWorkspacesForUser } from '@/lib/db/queries/workspaces'
import { NoWorkspace } from '@/components/no-workspace'

/**
 * `/dashboard` → `/dashboard/{ws}` (D-3).
 *
 * The URL stays workspace-scoped even though the UI never mentions workspaces,
 * because that is what keeps links, URNs and the issues app agreeing about what
 * a thing is. What the human loses is the switcher, not the address.
 *
 * **More than one → the REMEMBERED one, and a picker only when there is nothing
 * to remember.** "Never a guess" was the rule here, for a good reason: landing
 * somebody in the wrong workspace is silent — the pipeline looks empty or looks
 * like somebody else's. That reason held while the app had no memory and no
 * switcher, so any choice made here was positional and unfixable.
 *
 * Both halves changed on 2026-08-11. `sales.user_settings` records the choice
 * (written by this app's `setDefaultForUser`, which the web switcher and
 * `bk sales workspace use` both reach through `POST /api/me/active-workspace`),
 * and the sidebar now names the current workspace and can change it. So sending
 * a returning person where they last were is not a guess, and being sent
 * somewhere is no longer a dead end.
 *
 * The picker survives for the case that IS still a guess: more than one
 * membership and nothing stored — a person's first visit after accepting an
 * invitation. `getActiveWorkspaceForUser` falls back to the first membership
 * rather than returning null, so this page asks the settings table directly to
 * tell "remembered" from "fell back".
 *
 * The layout has already established the user is signed in and has at least one
 * reachable workspace; the checks repeat here because a page is reachable on its
 * own and a layout's conclusions are not passed down as data.
 */
export default async function DashboardIndex() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const reachable = await listWorkspacesForUser(user.id)
  if (reachable.length === 1) redirect(`/dashboard/${reachable[0].slug}`)

  // More than one: go where they last were, if that is a real answer and still
  // a workspace they belong to. `getStoredActiveWorkspaceId` returns null rather
  // than a fallback, precisely so this page can distinguish a remembered choice
  // from a positional default and only skip the picker for the former.
  if (reachable.length > 1) {
    const storedId = await getStoredActiveWorkspaceId(user.id)
    const remembered = storedId != null ? reachable.find((w) => w.id === storedId) : undefined
    if (remembered) redirect(`/dashboard/${remembered.slug}`)
  }
  // Zero is THIS page's case as of 2026-08-11. It used to be the layout's, and
  // the line here read `return null` — a blank page that could only be reached
  // if the two disagreed. The layout stopped rendering it so that
  // `/dashboard/settings/*` survives a person with no workspace; see
  // `components/no-workspace.tsx` for why, and note that the screen has to live
  // somewhere a reader can find it rather than being inlined twice.
  if (reachable.length === 0) return <NoWorkspace email={user.email} />

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Choose a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You can reach b/sales in more than one. This choice is remembered —
            switch any time from the sidebar.
          </p>
        </div>
        <div className="space-y-1.5">
          {reachable.map((w) => (
            <Link
              key={w.id}
              href={`/dashboard/${w.slug}`}
              className="block rounded-xl border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
            >
              <span className="block font-medium text-foreground">{w.name}</span>
              <span className="block text-xs text-muted-foreground">{w.slug}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
