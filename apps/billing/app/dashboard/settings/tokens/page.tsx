import { PageHeader } from '@/components/shell'
import { SettingsFrame } from '@/components/settings/settings-nav'
import { TokenSettings } from '@/components/settings/token-settings'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <>
      <PageHeader title="Account settings" titleTestId="page-title" />
      <SettingsFrame>
        <TokenSettings />
      </SettingsFrame>
    </>
  )
}
