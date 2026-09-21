// The account page resolves the OTHER apps in the suite, and their registered
// `base_url`s — modelled on apps/sales' `app/dashboard/settings/account/page.tsx`.
//
// **The other app's slug is never named in this app's code.** Hardcoding
// `issues` or `sales` here would be a second declaration of a fact that lives
// in `platform.apps` (D-18), and it would be wrong the day a fourth app arrives.
// `platform.apps` is the ADDRESS BOOK, not a grant list (multiAppFinalRefactor
// Phase 5): the list is "every app I can reach that is not this one".

import { redirect } from 'next/navigation'
import { listAppRegistry } from '@blackcode/platform-db'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { getDb } from '@/lib/db/client'
import { APP_SLUG } from '@/lib/app'
import { PageHeader, PageBody } from '@/components/shell'
import { SettingsNav } from '@/components/settings/settings-nav'
import { AccountSettings } from '@/components/settings/account-settings'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const user = await getValidatedSessionUser()
  if (!user) redirect('/login')

  const registry = await listAppRegistry(getDb())
  const otherApps = registry
    .filter((a) => a.slug !== APP_SLUG && a.base_url)
    .map((a) => ({ name: a.name, url: a.base_url as string }))

  return (
    <>
      <PageHeader title="Settings" titleTestId="page-title" />
      <PageBody>
        <div className="mx-auto max-w-3xl">
          <SettingsNav />
          <div className="mt-6">
            <AccountSettings otherApps={otherApps} />
          </div>
        </div>
      </PageBody>
    </>
  )
}
