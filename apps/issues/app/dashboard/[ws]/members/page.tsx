// A REDIRECT since 2026-09-28: members and invitations are sections of
// `/dashboard/{ws}/settings`, the settings page every blackcode app shares.
// Kept because the path is in bookmarks and in the sidebar's history.
import { redirect } from 'next/navigation'

export default async function MembersPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  redirect(`/dashboard/${ws}/settings`)
}
