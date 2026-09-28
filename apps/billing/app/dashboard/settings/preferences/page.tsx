// Preferences — how this app looks in this browser (2026-09-28). Every app's
// account settings carry this tab; the theme is also one click away in the
// sidebar footer.
import { PageHeader } from '@/components/shell'
import { SettingsFrame } from '@/components/settings/settings-nav'
import { AppearanceSection } from '@blackcode/platform-ui/account/account-settings'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <>
      <PageHeader title="Account settings" titleTestId="page-title" />
      <SettingsFrame>
        <AppearanceSection />
      </SettingsFrame>
    </>
  )
}
