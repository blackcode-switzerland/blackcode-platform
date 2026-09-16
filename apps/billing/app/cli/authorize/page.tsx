// The browser half of `bk login --server https://billing.blackcode.ch`.
//
// `bk login` opens THIS page on whichever server it was pointed at, and the page
// posts to that server's `/api/cli/authorize`. Without it the route exists and
// nothing ever reaches it: the CLI would open a 404 and the terminal would sit
// waiting for a callback that never comes — a failure with no error message
// anywhere, which is the worst kind this product ships. b/books found the gap by
// mounting the route alone.
//
// ── THE CALLBACK IS VALIDATED BEFORE ANYTHING IS SHOWN ─────────────────────
// `parseCallbackURL` refuses anything that is not a localhost loopback, and this
// app imports it rather than re-deriving it. An app that got that check slightly
// wrong would post a live, platform-wide token to an external host. The route
// checks it again — this page checking it first is so a bad request is refused
// with a sentence rather than with a button that fails after the click.
//
// The `/cli-callback` SUBPATH, not the package root: this page ships a client
// component, and the barrel pulls bcryptjs and Drizzle in behind it.
//
// ── PLAIN, LIKE THE REST OF PHASE 0 ───────────────────────────────────────
// Inline styles and no i18n. This app has no shell, no theme and no dictionary
// yet; phase 1's frontend brings all three and this page joins them then. A
// design shipped here is a design phase 1 has to undo.

import { redirect } from 'next/navigation'
import { parseCallbackURL } from '@blackcode/platform-auth/cli-callback'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { CliAuthorizeForm } from '@/components/cli-authorize-form'
import { APP_NAME } from '@/lib/app'

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
        This page is opened by <code>bk login</code> and needs the parameters it supplies. Run{' '}
        <code>bk login --server</code> against this server and let it open the page for you.
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
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 560 }}>
      <h1>Authorize a terminal</h1>
      <p style={{ fontSize: 14 }}>Signed in as {user.email}.</p>
      <p style={{ fontSize: 14 }}>The token will be sent to:</p>
      <code style={{ display: 'block', wordBreak: 'break-all', padding: 8, background: '#f1f3f5' }}>
        {parsed.url.toString()}
      </code>
      {/* Said in the product, not only in the docs. One login and one token
          across every blackcode app is the thing a reader is most likely to
          assume otherwise — "I authorized in b/billing, so I got a billing
          token" is a reasonable guess and a wrong one. */}
      <p style={{ fontSize: 13, marginTop: 16, padding: 8, background: '#f8f9fa' }}>
        This mints one <strong>blackcode-wide</strong> token, not a {APP_NAME} token. It reaches
        every app your account can reach, and you can revoke it from any of them.
      </p>
      <CliAuthorizeForm callback={callback} state={state} defaultName={defaultName} />
    </main>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 48, maxWidth: 560 }}>
      <h1>{title}</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>{children}</p>
      <p style={{ marginTop: 24 }}>
        <a href="/dashboard">Back to the dashboard</a>
      </p>
    </main>
  )
}
