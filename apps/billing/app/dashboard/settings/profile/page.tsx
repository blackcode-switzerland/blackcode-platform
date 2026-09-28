import { PageHeader } from '@/components/shell'
import { SettingsFrame } from '@/components/settings/settings-nav'
import { ProfileSettings } from '@/components/settings/profile-settings'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <>
      <PageHeader title="Account settings" titleTestId="page-title" />
      <SettingsFrame>
        <ProfileSettings />
      </SettingsFrame>
    </>
  )
}
