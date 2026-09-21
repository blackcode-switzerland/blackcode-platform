import { PageHeader, PageBody } from '@/components/shell'
import { SettingsNav } from '@/components/settings/settings-nav'
import { ProfileSettings } from '@/components/settings/profile-settings'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" titleTestId="page-title" />
      <PageBody>
        <div className="mx-auto max-w-3xl">
          <SettingsNav />
          <div className="mt-6">
            <ProfileSettings />
          </div>
        </div>
      </PageBody>
    </>
  )
}
