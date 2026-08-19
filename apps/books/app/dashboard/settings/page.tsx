import { redirect } from 'next/navigation'

// `/dashboard/settings` has no content of its own. Redirecting beats rendering a
// fifth page whose only job is to point at the four real ones — and it keeps
// every existing link to `/dashboard/settings` working, which matters because
// the sidebar has pointed there since this app had one page.
export default function SettingsIndex() {
  redirect('/dashboard/settings/profile')
}
