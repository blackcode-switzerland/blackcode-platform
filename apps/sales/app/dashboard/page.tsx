import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { listWorkspacesForUser } from '@/lib/db/queries/workspaces'

/**
 * `/dashboard` → `/dashboard/{ws}` (D-3).
 *
 * The URL stays workspace-scoped even though the UI never mentions workspaces,
 * because that is what keeps links, URNs and the issues app agreeing about what
 * a thing is. What the human loses is the switcher, not the address.
 *
 * **More than one → a picker, never a guess.** Landing somebody in the wrong
 * workspace is silent: the pipeline looks empty or looks like somebody else's,
 * and nothing on the page says which one they are in. In practice this app has
 * one workspace and the picker is the branch nobody sees — which is exactly why
 * it must not be "pick the first and hope".
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
  // Zero is the layout's "no access" empty, which has already rendered instead
  // of this page. Reaching here with zero would mean the two disagreed.
  if (reachable.length === 0) return null

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Choose a workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You can reach b/sales in more than one.
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
