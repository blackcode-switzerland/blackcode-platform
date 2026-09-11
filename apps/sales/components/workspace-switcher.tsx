'use client'

// The sidebar workspace switcher — and, since 2026-09-11, the only reachable
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

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings } from 'lucide-react'
import { avatarColor } from '@blackcode/platform-ui/ui/member-avatar'
import { toast } from 'sonner'
import { apiSend } from '@/lib/client'
import { WorkspaceCreateModal } from './workspace-create-modal'

export interface SwitcherWorkspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
  /**
   * Who owns it — a name, or an email when they have no name, or null when the
   * owner row cannot be resolved. Only read for workspaces that are not yours.
   */
  owner_label?: string | null
}

/**
 * The second line under a workspace name.
 *
 * ── IT SAYS WHOSE, NOT WHAT YOUR ROLE IS ────────────────────────────────────
 * This was `Your workspace` / `Member` until 2026-08-12, and `Member` answers
 * the wrong question. A person with two workspaces is looking at a list like:
 *
 *     My Workspace                 ✓
 *     Member
 *     Balathanusan 1's worksp…
 *     Your workspace
 *
 * and "My Workspace" is somebody ELSE'S — named in the first person by whoever
 * made it, so it reads as yours. Knowing you are a "Member" of it does not tell
 * you which of the two is which; knowing Priya owns it does.
 *
 * ── THE FALLBACK CHAIN, AND WHY IT ENDS AT `Member` ─────────────────────────
 * name → email → `Member`. The last step matters: an owner who cannot be
 * resolved (a hard-deleted account) must not render as a blank line or the word
 * "null". Blank is strictly worse than the label this replaces, so the old
 * label is what it falls back TO rather than what it replaces unconditionally.
 *
 * The middle step is not theoretical either, and it is the one a `??` would get
 * wrong: `platform.users.name` is nullable AND can hold whitespace. Both cases
 * were driven through the real switcher on 2026-08-12 (name set to NULL, then
 * to "   ") and both render the email.
 *
 * Your OWN workspace keeps `Your workspace` rather than becoming your own name.
 * "Owned by Balathanusan Chandrasekaram" on your own row is both longer and
 * less clear than the two words it would replace.
 */
function ownershipLine(ws: SwitcherWorkspace): string {
  if (ws.member_role === 'owner') return 'Your workspace'
  const owner = ws.owner_label?.trim()
  return owner ? `Owned by ${owner}` : 'Member'
}

function Mark({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[14%] font-semibold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: avatarColor(name),
        fontSize: Math.round(size * 0.44),
      }}
    >
      {(name.trim()[0] ?? 'W').toUpperCase()}
    </span>
  )
}

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: SwitcherWorkspace[]
  current: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape. Both, because a menu that traps the
  // pointer is worse than no menu — and this one sits above the whole nav.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // ALWAYS RENDERS NOW — see the header for why this changed on 2026-09-11.
  // `workspaces` is empty only in the moment before the sign-in bootstrap has
  // run (`components/no-workspace.tsx` covers that screen); guarded here
  // rather than assumed, so this component degrades to "create your first
  // workspace" instead of crashing on `workspaces[0]`.
  const active = workspaces.find((w) => w.slug === current) ?? workspaces[0] ?? null

  async function choose(ws: SwitcherWorkspace) {
    if (ws.slug === current) {
      setOpen(false)
      return
    }
    setPending(ws.slug)
    try {
      // `apiSend`, not `fetch`. `lib/read-only.test.ts` asserts there is exactly
      // ONE `fetch(` in this app — the transport module — and that assertion is
      // what makes "no mutation reaches the network except through the module
      // that documents them" checkable rather than merely intended. It caught
      // the first version of this file.
      await apiSend('POST', '/api/me/active-workspace', { slug: ws.slug })
      setOpen(false)
      // push, not replace: switching workspace is a navigation a person may
      // want to undo with the back button.
      router.push(`/dashboard/${ws.slug}`)
      router.refresh()
    } catch {
      // The failure has to be visible. A switcher that silently leaves you where
      // you were reads as a dead button, and the page would still be showing the
      // old workspace with no indication why.
      toast.error(`Could not switch to ${ws.name}`)
      setPending(null)
    }
  }

  return (
    <div ref={ref} className="relative px-2.5 pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
      >
        {active ? <Mark name={active.name} size={22} /> : <NoWorkspaceMark />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {active?.name ?? 'No workspace'}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-2.5 right-2.5 top-full z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar shadow-lg"
        >
          {workspaces.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspaces
              </p>
              {workspaces.map((ws) => {
                const isCurrent = ws.slug === current
                return (
                  <button
                    key={ws.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    disabled={pending !== null}
                    onClick={() => choose(ws)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60 disabled:opacity-60"
                  >
                    <Mark name={ws.name} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{ws.name}</span>
                      {/* WHOSE it is — see `ownershipLine`. `truncate` is
                          load-bearing here and was already needed for the name
                          above it: this sidebar is narrow enough that
                          "Balathanusan 1's worksp…" clips, so an owner line
                          carrying a full name clips too, and it must degrade to
                          an ellipsis rather than wrap the row to two lines. */}
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {ownershipLine(ws)}
                      </span>
                    </span>
                    {pending === ws.slug ? (
                      <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />
                    ) : isCurrent ? (
                      <Check size={14} className="shrink-0 text-primary" />
                    ) : null}
                  </button>
                )
              })}
            </>
          )}

          {/* Two admin rows, below the list — the only reachable door into
              either capability, since this app has no separate
              workspaces-list page (unlike `apps/issues`). */}
          <div className="border-t border-sidebar-border py-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setCreateOpen(true)
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              <Plus size={15} className="shrink-0" />
              Create workspace
            </button>
            {active && (
              <Link
                href={`/dashboard/${active.slug}/settings`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              >
                <Settings size={15} className="shrink-0" />
                Manage {active.name}
              </Link>
            )}
          </div>
        </div>
      )}

      <WorkspaceCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

/** The empty-state mark, exported so the shell can render a placeholder. */
export function NoWorkspaceMark() {
  return (
    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[14%] bg-secondary text-muted-foreground">
      <Building2 size={13} />
    </span>
  )
}
