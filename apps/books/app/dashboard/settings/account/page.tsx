// The account tab resolves the OTHER blackcode apps and their registered URLs.
//
// **Another app's slug is never named in this app's code.** Hardcoding `issues`
// here would be a second declaration of a fact that already lives in
// `platform.apps`, and it would be wrong on the day a fourth app arrives. The
// list is "every app in the address book that is not this one", which is a
// question the platform can answer and this app cannot.
//
// It is the ADDRESS BOOK, not a grant list. `platform.app_access` was dropped in
// the multi-app refactor, so this deployment cannot know whether the account can
// get in at the far end — the app at that address answers that, in its own
// words. Following a link and finding no workspace there is a normal, legible
// outcome; being unable to find where your account lives was not.

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

  const registry = await listAppRegistry(getDb())
  const otherApps = registry
    .filter((a) => a.slug !== APP_SLUG && a.base_url)
    .map((a) => ({ name: a.name, url: a.base_url as string }))

  return <AccountSettings otherApps={otherApps} />
}
