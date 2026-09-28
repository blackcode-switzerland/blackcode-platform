'use client'

// The sidebar workspace switcher — the shared one from
// `@blackcode/platform-ui/workspace/workspace-switcher` since 2026-09-28, which
// all four apps render; this file is its wiring. Since 2026-09-11 it is also the only reachable
// entry point into creating or administering a workspace (there is no other
// global workspaces-list page in this app, unlike `apps/issues`).
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, HAVING BEEN DELIBERATELY ABSENT — AND WHY IT NOW ALWAYS RENDERS
// ---------------------------------------------------------------------------
// This section used to read:
//
//   > PLAN.md §1 and D-3 gave sales no switcher on a premise that has since
//   > become false: one workspace per person. [...]
//   >
//   > IT RENDERS NOTHING FOR ONE WORKSPACE, AND THAT IS THE DESIGN
//   >
//   > D-3's actual goal was that a human working here sees a single-tenant
//   > product, not that the capability be absent. With one membership —
//   > everyone today — this returns null and the sidebar is unchanged. It
//   > appears exactly when it has something to offer.
//
// That was true from 2026-08-11 (the switcher's own introduction, for the
// invitation case) until 2026-09-11, when D-3 was reversed a second time:
// sales gained the CAPABILITY to create an additional workspace, not just the
// capability to be invited into one. "With one membership this offers
// nothing" stopped being true the moment creating a second one became
// something every user, not just an invitee, could do — a person with exactly
// one workspace still needs a door to open a second, and a component that
// renders null for the common case IS the absent door. So this now always
// renders: current workspace name + chevron, a dropdown listing every
// membership, a "Create workspace" row, and a "Manage workspace" row for the
// one you are currently in (workspace ADMINISTRATION — rename, transfer,
// delete — lives at `/dashboard/{ws}/settings`, see
// `components/settings/workspace-settings.tsx`).
//
// ---------------------------------------------------------------------------
// SWITCHING WRITES THROUGH THE SERVER, NOT JUST THE URL
// ---------------------------------------------------------------------------
// `POST /api/me/active-workspace` is the same route `bk sales workspace use`
// calls, so the web and the CLI agree about where you are, and the next
// `/dashboard` opens there. Navigating without it would make the choice last
// exactly one page load.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE CALLS `apiSend` DIRECTLY, UNGATED BY `useCanWrite()`
// ---------------------------------------------------------------------------
// Switching, creating, and reaching workspace administration are ACCOUNT /
// TENANCY operations, not sales record writes — `lib/read-only.test.ts` has
// carried this file in `ACCOUNT_WRITERS` since the switcher's introduction for
// exactly that reason, and the create/manage affordances added here are the
// same class of thing: a display preference that could stop somebody moving
// between workspaces they belong to, creating one, or reaching its settings
// would make read-only mode a permission over their ACCOUNT rather than over
// the sales pipeline (D-7).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  WorkspaceSwitcher as SharedSwitcher,
  type SwitcherWorkspace,
} from '@blackcode/platform-ui/workspace/workspace-switcher'
import { apiSend } from '@/lib/client'
import { WorkspaceCreateModal } from './workspace-create-modal'

export type { SwitcherWorkspace }

/** Remember a workspace as active, then open it. Shared by the switcher and the chooser. */
export function useOpenWorkspace() {
  const router = useRouter()
  return async (ws: SwitcherWorkspace) => {
    try {
      await apiSend('POST', '/api/me/active-workspace', { slug: ws.slug })
    } catch (e) {
      toast.error(`Could not switch to ${ws.name}`, { description: e instanceof Error ? e.message : undefined })
      throw e
    }
    router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
    router.refresh()
  }
}

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: SwitcherWorkspace[]
  /** The workspace slug in the URL, or null on a page outside any workspace. */
  current: string | null
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const open = useOpenWorkspace()
  return (
    <>
      <SharedSwitcher
        workspaces={workspaces}
        current={current}
        onSelect={open}
        onCreate={() => setCreating(true)}
        onManage={(ws) => router.push(`/dashboard/${encodeURIComponent(ws.slug)}/settings`)}
      />
      <WorkspaceCreateModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}
