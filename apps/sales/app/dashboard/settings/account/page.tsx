// The account page resolves the OTHER apps in the suite, and their registered
// `base_url`s.
//
// Three things on that page live somewhere else — changing a password, closing
// an account, and platform administration — and a page that says so without
// saying WHERE is only marginally better than saying nothing. So it links, and
// the link is built the way D-18 builds every cross-app link: from
// `platform.apps.base_url`, on the server, per app.
//
// **The other app's slug is never named in this app's code.** Hardcoding
// `issues` here would be a second declaration of a fact that lives in
// `platform.apps` — the thing D-18 exists to avoid — and it would be wrong on
// the day a third app arrives. The list is "every app I can reach that is not
// this one", which is a question the platform can answer and this app cannot.
//
// Until 2026-08-10 the list was grant-derived, so somebody who could reach only
// b/sales got the same sentence with no link. It is the address book now (Phase
// 5 — reachability is not derivable centrally any more), so the link appears for
// everyone. Following it and finding no workspace there is a normal, legible
// outcome; being unable to find the app that holds your password was not.

import { redirect } from 'next/navigation'
import { listAppRegistry } from '@blackcode/platform-db'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { AccountSettings } from '@/components/settings/account-settings'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  // The ADDRESS BOOK, not a grant list — `appsReachableByUser` went with
  // `platform.app_access` on 2026-08-10. This is now "every app in the suite
  // except this one", not "every app you can reach": whether the account can get
  // in is answered by the app at that address, and this deployment cannot know
  // it (each app's membership lives in its own schema).
  //
  // For this link that is the same behaviour it already had in practice and a
  // more honest description of it. Following one and having no workspace there
  // is a normal outcome, and that app says so in its own words.
  const registry = await listAppRegistry(getDb())
  const otherApps = registry
    .filter((a) => a.slug !== APP_SLUG && a.base_url)
    .map((a) => ({ name: a.name, url: a.base_url as string }))

  return <AccountSettings otherApps={otherApps} />
}
