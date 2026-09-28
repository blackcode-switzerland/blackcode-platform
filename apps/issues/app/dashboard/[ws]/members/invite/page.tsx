// A REDIRECT since 2026-09-28: inviting is the Invitations section of
// `/dashboard/{ws}/settings`.
import { redirect } from 'next/navigation'

export default async function InvitePage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  redirect(`/dashboard/${ws}/settings`)
}
