import { redirect } from 'next/navigation'

// `/dashboard/settings` has no content of its own — redirect beats rendering a
// fourth page whose only job is to point at the three real ones.
export default function SettingsIndex() {
  redirect('/dashboard/settings/profile')
}
