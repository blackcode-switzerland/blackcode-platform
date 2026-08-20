// The browser half of `bk login --server https://books.blackcode.ch`.
//
// `bk login` opens THIS page on whichever server it was pointed at, and the page
// posts to that server's `/api/cli/authorize`. Without it the route exists and
// nothing ever reaches it: the CLI would open a 404 and the terminal would sit
// waiting for a callback that never comes — a failure with no error message
// anywhere, which is the worst kind this product ships.
//
// ── IT IS OUTSIDE `/dashboard`, AND OUTSIDE THE READ-MOSTLY RULE ───────────
// This page mints a credential, which is a write, and b/books' web surface is
// read-mostly with five permitted writes. This is not a sixth: it touches no
// `books.*` table and creates no bookkeeping record. It is an ACCOUNT write, the
// same one Settings → API tokens makes, and `lib/account.ts` is where both live.
//
// ── THE CALLBACK IS VALIDATED BEFORE ANYTHING IS SHOWN ─────────────────────
// `parseCallbackURL` refuses anything that is not a localhost loopback, and this
// app imports it rather than re-deriving it. An app that got that check slightly
// wrong would post a live, platform-wide token to an external host. The route
// checks it again — this page checking it first is so a bad request is refused
// with a sentence rather than with a button that fails after the click.
//
// The `/cli-callback` SUBPATH, not the package root: this is parsed for a page
// that ships a client component, and the barrel pulls bcryptjs and Drizzle in
// behind it.

import { redirect } from 'next/navigation'
import { Terminal } from 'lucide-react'
import { parseCallbackURL } from '@blackcode/platform-auth/cli-callback'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { CliAuthorizeForm } from '@/components/cli-authorize-form'
import { serverT } from '@/lib/i18n-server'

export const dynamic = 'force-dynamic'

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ callback?: string; state?: string; name?: string }>
}) {
  const sp = await searchParams
  // A server translator — this page is `async` and resolves the session itself.
  const t = await serverT()
  const callback = sp.callback ?? ''
  const state = sp.state ?? ''
  const proposedName = sp.name ?? ''

  if (!callback || !state) {
    return (
      <Shell title={t('cli.missingParams')} back={t('cli.back')}>
        {t('cli.missingParamsBody', { login: 'bk login' })}
      </Shell>
    )
  }

  const parsed = parseCallbackURL(callback)
  if (!parsed) {
    return (
      <Shell title={t('cli.invalidCallback')} back={t('cli.back')}>
        {t('cli.invalidCallbackBody')}
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
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15">
            <Terminal size={20} className="text-primary-strong" />
          </span>
          <span>
            <h1 className="text-lg font-semibold text-foreground">{t('cli.title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('cli.signedInAs', { email: user.email })}
            </p>
          </span>
        </div>

        <p className="mb-3 text-sm text-muted-foreground">{t('cli.willSendTo')}</p>
        <code className="mb-5 block break-all rounded-md bg-secondary px-3 py-2 font-mono text-xs">
          {parsed.url.toString()}
        </code>

        {/* Said in the product, not only in the docs. One login and one token
            across every blackcode app is the thing a reader is most likely to
            assume otherwise — "I authorized in b/books, so I got a books token"
            is a reasonable guess and a wrong one. */}
        <p className="mb-6 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {t('cli.notBooksSpecific')}
        </p>

        <CliAuthorizeForm callback={callback} state={state} defaultName={defaultName} />
      </div>
    </div>
  )
}

function Shell({
  title,
  back,
  children,
}: {
  title: string
  /** Already translated: `Shell` is not `async` and cannot resolve its own. */
  back: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
        <a
          href="/dashboard"
          className="mt-6 inline-block text-sm text-primary-strong hover:underline"
        >
          {back}
        </a>
      </div>
    </div>
  )
}
