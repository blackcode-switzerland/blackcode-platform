// A REDIRECT since 2026-09-28. The team and its invitations are sections of
// `/dashboard/{ws}/settings` now — the settings page every blackcode app shares
// (`@blackcode/platform-ui/workspace/*`). Kept so bookmarks and the invitation
// email's "manage your team" wording still land somewhere.
import { redirect } from 'next/navigation'

export default async function Page({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  redirect(`/dashboard/${ws}/settings`)
}
