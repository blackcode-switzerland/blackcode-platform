import { redirect } from 'next/navigation'

// Workspace settings moved out of the account Settings tabs; since 2026-09-28
// they live inside each workspace at /dashboard/{ws}/settings, and
// /dashboard/workspaces is the workspace chooser. Kept as a redirect so old
// links and bookmarks still resolve.
export default function WorkspaceSettingsRedirect() {
  redirect('/dashboard/workspaces')
}
