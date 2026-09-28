// A REDIRECT since 2026-09-28: creating a workspace is the shared modal, opened
// over the workspace chooser.
import { redirect } from 'next/navigation'

export default function NewWorkspacePage() {
  redirect('/dashboard/workspaces?new=1')
}
