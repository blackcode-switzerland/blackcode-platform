'use client'

// The sidebar workspace switcher.
//
// ── WHY THIS EXISTS, HAVING BEEN DELIBERATELY ABSENT ────────────────────────
// PLAN.md §1 and D-3 gave sales no switcher on a premise that has since become
// false: one workspace per person. A person invited into somebody else's
// workspace ends up in TWO — signing in mints their own (the bootstrap is keyed
// on membership, and they have none until they accept), then accepting adds the
// second. Measured 2026-08-11 by running the real sequence against a database.
//
// Before this, `/dashboard` answered that with a full-page "Choose a workspace"
// screen and the app offered no way back to it: every link in the shell is
// `/dashboard/{ws}/…`, the logo included. You chose once, then you were stuck.
//
// ── IT RENDERS NOTHING FOR ONE WORKSPACE, AND THAT IS THE DESIGN ────────────
// D-3's actual goal was that a human working here sees a single-tenant product,
// not that the capability be absent. With one membership — everyone today —
// this returns null and the sidebar is unchanged. It appears exactly when it
// has something to offer.
//
// ── SWITCHING WRITES THROUGH THE SERVER, NOT JUST THE URL ──────────────────
// `POST /api/me/active-workspace` is the same route `bk sales workspace use`
// calls, so the web and the CLI agree about where you are, and the next
// `/dashboard` opens there. Navigating without it would make the choice last
// exactly one page load.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { avatarColor } from '@blackcode/platform-ui/ui/member-avatar'
import { toast } from 'sonner'
import { apiSend } from '@/lib/client'

export interface SwitcherWorkspace {
  id: number
  name: string
  slug: string
  member_role: 'owner' | 'member'
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

  // NOTHING TO SWITCH BETWEEN → NO CONTROL. See the header.
  if (workspaces.length < 2) return null

  const active = workspaces.find((w) => w.slug === current) ?? workspaces[0]

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
        <Mark name={active.name} size={22} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{active.name}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-2.5 right-2.5 top-full z-50 mt-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar shadow-lg"
        >
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
                  {/* Owner vs member is the difference between "yours" and
                      "somebody invited you", which is the question a person
                      actually has when two names look alike. */}
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {ws.member_role === 'owner' ? 'Your workspace' : 'Member'}
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
      )}
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
