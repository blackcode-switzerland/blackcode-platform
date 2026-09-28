import { AppearanceSection } from '@blackcode/platform-ui/account/account-settings'

export const dynamic = 'force-dynamic'

// The theme — stored in this browser by next-themes, never on the account.
// Added 2026-09-28 with the shared account frame; the other apps had this tab.
export default function PreferencesSettingsPage() {
  return <AppearanceSection />
}
