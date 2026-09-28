// A REDIRECT since 2026-09-28: a workspace's settings live inside it, at
// `/dashboard/{ws}/settings`, as in every blackcode app. This path was the
// settings page, reached from the old workspaces list. Its `storage` sub-page
// stays where it is.
import { redirect } from 'next/navigation'

export default async function WorkspaceManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  redirect(`/dashboard/${slug}/settings`)
}
