'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Calendar } from 'lucide-react'
import { ProjectIcon } from '../project-icon'
import {
  HealthIcon,
  PriorityIcon,
  ProgressRing,
  StatusIcon,
  projectPriorityKey,
} from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { PROJECT_STATUSES } from '@/lib/work-items'

interface ProjectRow {
  /** Uploaded logo; replaces the icon+color tile when set. */
  icon_url?: string | null
  id: number
  seq: number | null
  name: string
  summary: string | null
  status: string
  color: string | null
  icon: string | null
  priority: string | null
  issue_count: number
  open_issues: number
  due_date: string | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  health: string | null
}

const COLUMNS = PROJECT_STATUSES.map((s) => ({ status: s.value, label: s.label, color: s.color }))

export function ProjectsKanban({
  projects,
  wsSlug,
  reorderEnabled = true,
}: {
  projects: ProjectRow[]
  wsSlug: string
  // When false (a non-manual sort is active) within-column reorder is disabled,
  // but dragging a card to another column still changes its status.
  reorderEnabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [board, setBoard] = useState<Record<string, ProjectRow[]>>(() => group(projects))

  useEffect(() => {
    setBoard(group(projects))
  }, [projects])

  const updateStatus = useMutation({
    mutationFn: async (input: { id: number; status: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/projects/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: input.status }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onError: () => {
      toast.error('Status change failed — reverting')
      setBoard(group(projects))
    },
  })

  const reorder = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/projects/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] }),
    onError: () => setBoard(group(projects)),
  })

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromCol = result.source.droppableId
    const toCol = result.destination.droppableId
    if (fromCol === toCol && result.source.index === result.destination.index) return
    // Non-manual sort: within-column rearrange is disabled (sort owns the order).
    if (!reorderEnabled && fromCol === toCol) return
    const projectId = parseInt(result.draggableId)
    const card = board[fromCol].find((c) => c.id === projectId)
    if (!card) return

    const next: Record<string, ProjectRow[]> = {}
    for (const k of Object.keys(board)) next[k] = [...board[k]]
    next[fromCol] = next[fromCol].filter((c) => c.id !== projectId)
    next[toCol] = [
      ...next[toCol].slice(0, result.destination.index),
      { ...card, status: toCol },
      ...next[toCol].slice(result.destination.index),
    ]
    setBoard(next)

    // Collect all visible project IDs in display order across all columns
    const allIds = COLUMNS.flatMap((col) => next[col.status].map((p) => p.id))

    if (fromCol !== toCol) {
      if (reorderEnabled) {
        updateStatus.mutate({ id: projectId, status: toCol }, {
          onSuccess: () => reorder.mutate(allIds),
        })
      } else {
        // Status change only — the active sort decides the in-column order.
        updateStatus.mutate({ id: projectId, status: toCol }, {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] }),
        })
      }
    } else {
      reorder.mutate(allIds)
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = board[col.status] ?? []
          return (
            <div key={col.status} className="flex w-[280px] shrink-0 flex-col">
              <header className="mb-2 flex items-center gap-2 px-1">
                <StatusIcon status={col.status} size={14} className="shrink-0" />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {col.label}
                </span>
                <span className="rounded-full bg-secondary px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </header>
              <Droppable droppableId={col.status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex min-h-[200px] flex-col gap-2 rounded-lg p-1.5 transition-colors ${
                      snapshot.isDraggingOver ? 'bg-primary/5' : ''
                    }`}
                  >
                    {items.map((p, idx) => {
                      const total = p.issue_count ?? 0
                      const done = total - (p.open_issues ?? 0)
                      const pct = total > 0 ? Math.round((done / total) * 100) : 0
                      return (
                        <Draggable key={p.id} draggableId={String(p.id)} index={idx}>
                          {(prov, snap) => (
                            <Link
                              href={`/dashboard/${wsSlug}/projects/${p.seq ?? p.id}`}
                              ref={prov.innerRef as unknown as React.Ref<HTMLAnchorElement>}
                              {...prov.draggableProps}
                              {...prov.dragHandleProps}
                              prefetch={false}
                              className={`block rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow ${
                                snap.isDragging ? 'shadow-lg ring-1 ring-primary/50' : 'hover:border-border/80 hover:shadow-md'
                              }`}
                            >
                              {/* Header: icon + name */}
                              <div className="mb-2 flex items-start gap-2">
                                <ProjectIcon icon={p.icon} iconUrl={p.icon_url} color={p.color} name={p.name} size={20} />
                                <span className="flex-1 text-[13px] font-semibold leading-snug">{p.name}</span>
                              </div>

                              {/* Summary */}
                              {p.summary ? (
                                <p className="mb-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                  {p.summary}
                                </p>
                              ) : null}

                              {/* Meta row: priority + health + due date */}
                              <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <PriorityIcon priority={projectPriorityKey(p.priority)} size={12} />
                                {p.health ? <HealthIcon status={p.health} size={12} /> : null}
                                {p.due_date ? (
                                  <span className="flex items-center gap-1">
                                    <Calendar size={10} />
                                    {format(new Date(p.due_date), 'MMM d')}
                                  </span>
                                ) : null}
                                {/* lead avatar pushes right */}
                                <span className="ml-auto">
                                  {p.lead_email ? (
                                    <MemberAvatar
                                      name={p.lead_name}
                                      email={p.lead_email}
                                      avatarUrl={p.lead_avatar}
                                      size={16}
                                    />
                                  ) : null}
                                </span>
                              </div>

                              {/* Progress */}
                              <div className="flex items-center gap-2">
                                <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                                  <div
                                    className="h-full rounded-full bg-primary transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="w-16 text-right text-[10px] tabular-nums text-muted-foreground">
                                  {done}/{total} · {pct}%
                                </span>
                              </div>
                            </Link>
                          )}
                        </Draggable>
                      )
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          )
        })}
      </div>
    </DragDropContext>
  )
}

function group(projects: ProjectRow[]): Record<string, ProjectRow[]> {
  const board: Record<string, ProjectRow[]> = {}
  for (const c of COLUMNS) board[c.status] = []
  for (const p of projects) {
    if (board[p.status]) board[p.status].push(p)
    else board[COLUMNS[0].status].push(p)
  }
  return board
}
