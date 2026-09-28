// `/dashboard/{ws}/settings` — the workspace's name, logo, members,
// invitations, storage and danger zone, on the sections every blackcode app
// shares (since 2026-09-28). The `[ws]` layout has already refused a slug this
// person is not a member of.
import { WorkspaceSettings } from '@/components/workspace-settings'

export const dynamic = 'force-dynamic'

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params
  return (
    <div>
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-[15px] font-semibold">Settings</h1>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <WorkspaceSettings slug={ws} />
      </div>
    </div>
  )
}
