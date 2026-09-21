'use client'

// The sidebar's workspace switcher — modelled on apps/sales'.
//
// A workspace is a TENANT; the issuing entities inside one are companies, and
// those are the company switcher's job (company-switcher.tsx), not this one's.
//
// Switching writes through `POST /api/me/active-workspace` — the route
// `bk billing workspace use` calls — so the web and the CLI agree about where
// you are and the next `/dashboard` opens there. Navigating without it would
// make the choice last one page load.
//
// "Create workspace" goes to `/dashboard?new=1`, where the create form lives.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings } from 'lucide-react'
import { useSetActiveWorkspace, toastError } from '@/lib/mutations'
import { cn } from '@/lib/utils'

export interface SwitcherWorkspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
}

function Mark({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md bg-primary/15 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
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
  /** The slug in the URL, or null on an account page with no workspace. */
  current: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const setActive = useSetActiveWorkspace()

  // Close on an outside click or Escape.
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
      await setActive.mutateAsync({ slug: ws.slug })
      setOpen(false)
      router.push(`/dashboard/${encodeURIComponent(ws.slug)}`)
    } catch (e) {
      // Visible, never silent: a switcher that leaves you where you were with
      // no word reads as a dead button.
      toastError(e)
    } finally {
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
        data-testid="nav-workspace"
        data-slug={current ?? undefined}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
      >
        {active ? (
          <Mark name={active.name} size={22} />
        ) : (
          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Building2 size={13} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{active?.name ?? 'Choose a workspace'}</span>
          {active && (
            <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{active.slug}</span>
          )}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-2.5 right-2.5 top-full z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-popover text-popover-foreground shadow-lg"
        >
          {workspaces.length > 0 && (
            <>
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Workspaces
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
                      <Mark name={ws.name} size={20} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{ws.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {ws.member_role === 'owner' ? 'Owner' : 'Member'} · <span className="font-mono">{ws.slug}</span>
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
          <div className="border-t border-sidebar-border py-1">
            <Link
              href="/dashboard?new=1"
              onClick={() => setOpen(false)}
              data-testid="workspace-create"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Plus size={15} className="shrink-0" />
              Create workspace
            </Link>
            {active && (
              <Link
                href={`/dashboard/${encodeURIComponent(active.slug)}/settings`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Settings size={15} className="shrink-0" />
                <span className="truncate">Manage {active.name}</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
