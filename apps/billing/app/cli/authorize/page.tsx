// The browser half of `bk login --server https://billing.blackcode.ch`.
//
// `bk login` opens THIS page on whichever server it was pointed at, and the page
// posts to that server's `/api/cli/authorize`. Without it the route exists and
// nothing ever reaches it: the CLI would open a 404 and the terminal would sit
// waiting for a callback that never comes.
//
// ── THE CALLBACK IS VALIDATED BEFORE ANYTHING IS SHOWN ─────────────────────
// `parseCallbackURL` refuses anything that is not a localhost loopback, and this
// app imports it rather than re-deriving it. The route checks it again — this
// page checking it first is so a bad request is refused with a sentence rather
// than with a button that fails after the click.
//
// The `/cli-callback` SUBPATH, not the package root: this page ships a client
// component, and the barrel pulls bcryptjs and Drizzle in behind it.

import { redirect } from 'next/navigation'
import { Terminal } from 'lucide-react'
import { parseCallbackURL } from '@blackcode/platform-auth/cli-callback'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { CliAuthorizeForm } from '@/components/cli-authorize-form'
import { APP_NAME, PLATFORM_NAME } from '@/lib/app'

export const dynamic = 'force-dynamic'

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string; name?: string }>
}) {
  const sp = await searchParams
  const callback = sp.callback ?? ''
  const state = sp.state ?? ''
  const proposedName = sp.name ?? ''

  if (!callback || !state) {
    return (
      <Shell title="Nothing to authorize">
        This page is opened by <code className="rounded bg-muted px-1 py-0.5">bk login</code> and
        needs the parameters it supplies. Run{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk login --server</code> against this server
        and let it open the page for you.
      </Shell>
    )
  }

  const parsed = parseCallbackURL(callback)
  if (!parsed) {
    return (
      <Shell title="That callback is not safe to use">
        A CLI login may only send its token back to a loopback address on this machine. This
        request named somewhere else, so nothing was minted.
      </Shell>
    )
  }

  // `getValidatedSessionUser`, not a bare session read: a session issued before
  // the account's last password reset must not be walkable through `bk login`
  // into a permanent credential. The ROUTE checks this too; the page checks it
  // so a stale session is sent to sign in rather than shown an Authorize button
  // that will 401.
  const user = await getValidatedSessionUser()
  if (!user) {
    const params = new URLSearchParams({ callback, state })
    if (proposedName) params.set('name', proposedName)
    redirect(`/login?callbackUrl=${encodeURIComponent(`/cli/authorize?${params.toString()}`)}`)
  }

  const defaultName =
    proposedName && proposedName.length <= 100
      ? proposedName
      : `cli-${new Date().toISOString().slice(0, 10)}`

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Terminal size={20} className="text-primary" />
          </span>
          <span>
            <h1 className="text-lg font-semibold">Authorize the bk CLI</h1>
            <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>
          </span>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          A new API token will be created and sent to your terminal at:
        </p>
        <code
          data-testid="callback-url"
          className="mb-5 block break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs"
        >
          {parsed.url.toString()}
        </code>

        {/* Said in the product, not only in the docs. One login and one token
            across every blackcode app is the thing a reader is most likely to
            assume otherwise — "I authorized here, so I got an app-scoped
            token" is a reasonable guess and a wrong one. */}
        <p className="mb-6 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This mints one <strong className="text-foreground">{PLATFORM_NAME}-wide</strong> token, not a{' '}
          {APP_NAME} token. It reaches every app your account can reach, and you can revoke it from
          any of them.
        </p>

        <CliAuthorizeForm callback={callback} state={state} defaultName={defaultName} />
      </div>
    </div>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <h1 className="mb-2 text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
        <a href="/dashboard" className="mt-6 inline-block text-sm text-primary hover:underline">
          ← Back to the dashboard
        </a>
      </div>
    </div>
  )
}
