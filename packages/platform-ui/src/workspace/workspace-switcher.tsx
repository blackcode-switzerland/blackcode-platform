'use client'

// The sidebar's workspace switcher — one component for every app (2026-09-28).
//
// apps/billing's switcher, lifted: the current workspace (mark, name, slug) as
// a button, and a dropdown listing every workspace with your role in it, plus
// "Create workspace" and "Manage <current>". What stays with the app is
// everything that touches its data or its router, passed in as callbacks:
//
//   onSelect(ws)   remember the choice (POST /api/me/active-workspace, the
//                  route `bk <app> workspace use` calls) and navigate. Throw to
//                  keep the menu open — the app shows the error.
//   onCreate()     open the app's create modal.
//   onManage(ws)   go to the workspace's settings.
//
// This package has no router and no toast library on purpose; an app's own are
// the ones that know its URLs and its error envelope.

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings } from 'lucide-react'
import { cn } from '../utils'
import { WorkspaceMark } from './workspace-mark'
import { withDefaults, type WorkspaceLabels } from './labels'

export interface SwitcherWorkspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
  logo_url?: string | null
  /**
   * Who owns it, for a workspace that is not yours — a name, or an email.
   * From apps/sales (2026-08-12): "Member" does not tell two workspaces apart
   * when one is somebody else's called "My Workspace"; "Owned by Priya" does.
   */
  owner_label?: string | null
}

/** The second line under a workspace's name: whose it is, then its slug. */
export function roleLine(ws: SwitcherWorkspace, L: Pick<WorkspaceLabels, 'owner' | 'member' | 'ownedBy'>): string {
  if (ws.member_role === 'owner') return L.owner
  const owner = ws.owner_label?.trim()
  return owner ? L.ownedBy(owner) : L.member
}

export function WorkspaceSwitcher({
  workspaces,
  current,
  onSelect,
  onCreate,
  onManage,
  labels,
  className,
}: {
  workspaces: SwitcherWorkspace[]
  /** The slug in the URL, or null on a page outside any workspace. */
  current: string | null
  onSelect: (ws: SwitcherWorkspace) => Promise<void>
  onCreate?: () => void
  onManage?: (ws: SwitcherWorkspace) => void
  labels?: Partial<WorkspaceLabels>
  className?: string
}) {
  const L = withDefaults(labels)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

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

  const active = workspaces.find((w) => w.slug === current) ?? null

  async function choose(ws: SwitcherWorkspace) {
    if (ws.slug === current) {
      setOpen(false)
      return
    }
    setPending(ws.slug)
    try {
      await onSelect(ws)
      setOpen(false)
    } catch {
      // The app has already said why; stay open so the choice can be retried.
    } finally {
      setPending(null)
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="nav-workspace"
        data-slug={current ?? undefined}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
      >
        {active ? (
          <WorkspaceMark name={active.name} logoUrl={active.logo_url} size={24} />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Building2 size={13} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{active?.name ?? L.chooseWorkspace}</span>
          {active && <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{active.slug}</span>}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {workspaces.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {L.workspaces}
              </p>
              <div className="max-h-72 overflow-y-auto">
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
                      data-testid={`workspace-option-${ws.slug}`}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-60',
                        isCurrent && 'bg-accent/60'
                      )}
                    >
                      <WorkspaceMark name={ws.name} logoUrl={ws.logo_url} size={20} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{ws.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {roleLine(ws, L)} · <span className="font-mono">{ws.slug}</span>
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
              </div>
            </>
          )}
          {(onCreate || (active && onManage)) && (
            <div className="border-t border-border py-1">
              {onCreate && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onCreate()
                  }}
                  data-testid="workspace-create"
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus size={15} className="shrink-0" />
                  {L.createWorkspace}
                </button>
              )}
              {active && onManage && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onManage(active)
                  }}
                  data-testid="workspace-manage"
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Settings size={15} className="shrink-0" />
                  <span className="truncate">{L.manage(active.name)}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
