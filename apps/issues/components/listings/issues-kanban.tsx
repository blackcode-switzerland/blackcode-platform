'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Calendar } from 'lucide-react'
import { ISSUE_STATUSES } from '@/lib/work-items'
import { StatusIcon, PriorityIcon, issuePriorityKey } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { ProjectIcon } from '../project-icon'

interface IssueAssignee {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  priority: number
  assignees: IssueAssignee[]
  project_name: string | null
  project_icon: string | null
  /** Uploaded project logo; replaces the icon tile when set. */
  project_icon_url: string | null
  project_color: string | null
  due_date: string | null
  task_name: string | null
}

const COLUMNS = ISSUE_STATUSES.map((s) => ({ status: s.value, label: s.label }))

export function IssuesKanban({
  issues,
  wsSlug,
  reorderEnabled = true,
}: {
  issues: IssueRow[]
  wsSlug: string
  // When false (a non-manual sort is active) within-column reorder is disabled,
  // but dragging a card to another column still changes its status.
  reorderEnabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [board, setBoard] = useState<Record<string, IssueRow[]>>(() => groupByStatus(issues))

  useEffect(() => {
    setBoard(groupByStatus(issues))
  }, [issues])

  const updateStatus = useMutation({
    mutationFn: async (input: { id: number; status: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${input.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: input.status }),
      })
      if (!res.ok) throw new Error('failed')
    },
    // No invalidation here — we invalidate only after reorder completes so the
    // re-fetch sees the correct position order and doesn't snap back.
    onError: () => {
      toast.error('Status change failed — reverting')
      setBoard(groupByStatus(issues))
    },
  })

  const reorder = useMutation({
    mutationFn: async (input: { ids: number[]; status: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ws-issues'] }),
    onError: () => {
      setBoard(groupByStatus(issues))
    },
  })

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const fromCol = result.source.droppableId
    const toCol = result.destination.droppableId
    if (fromCol === toCol && result.source.index === result.destination.index) return
    // Non-manual sort: within-column rearrange is disabled (sort owns the order).
    if (!reorderEnabled && fromCol === toCol) return
    const issueId = parseInt(result.draggableId)
    const card = board[fromCol].find((c) => c.id === issueId)
    if (!card) return
    const next: Record<string, IssueRow[]> = {}
    for (const k of Object.keys(board)) next[k] = [...board[k]]
    next[fromCol] = next[fromCol].filter((c) => c.id !== issueId)
    next[toCol] = [
      ...next[toCol].slice(0, result.destination.index),
      { ...card, status: toCol },
      ...next[toCol].slice(result.destination.index),
    ]
    setBoard(next)

    const destIds = next[toCol].map((c) => c.id)
    if (fromCol !== toCol) {
      if (reorderEnabled) {
        // Status update first, then persist the new column order in one go.
        // Invalidation happens only after reorder so the re-fetch sees the right positions.
        updateStatus.mutate({ id: issueId, status: toCol }, {
          onSuccess: () => reorder.mutate({ ids: destIds, status: toCol }),
        })
      } else {
        // Status change only — the active sort decides the in-column order.
        updateStatus.mutate(
          { id: issueId, status: toCol },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ws-issues'] }) }
        )
      }
    } else {
      reorder.mutate({ ids: destIds, status: toCol })
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
                    {items.map((issue, idx) => (
                      <Draggable key={issue.id} draggableId={String(issue.id)} index={idx}>
                        {(p, s) => (
                          <Link
                            href={`/dashboard/${wsSlug}/issues/${issue.seq ?? issue.id}`}
                            ref={p.innerRef as unknown as React.Ref<HTMLAnchorElement>}
                            {...p.draggableProps}
                            {...p.dragHandleProps}
                            prefetch={false}
                            className={`block rounded-lg border border-border bg-card p-3 shadow-sm transition-shadow ${
                              s.isDragging ? 'shadow-lg ring-1 ring-primary/50' : 'hover:border-border/80 hover:shadow-md'
                            }`}
                          >
                            {/* Header row: seq + assignee */}
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                                {issue.seq != null ? `#${issue.seq}` : `#${issue.id}`}
                              </span>
                              <span className="flex items-center">
                                {(issue.assignees ?? []).slice(0, 2).map((a, idx) => (
                                  <span key={a.id} style={{ marginLeft: idx > 0 ? '-4px' : 0 }}>
                                    <MemberAvatar name={a.name} email={a.email} avatarUrl={a.avatar_url} size={16} />
                                  </span>
                                ))}
                              </span>
                            </div>

                            {/* Title */}
                            <p className="mb-2.5 line-clamp-2 text-[13px] font-semibold leading-snug">
                              {issue.title}
                            </p>

                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <PriorityIcon priority={issuePriorityKey(issue.priority)} size={12} />
                              <StatusIcon status={issue.status} size={12} />
                              {issue.due_date ? (
                                <span className="flex items-center gap-1">
                                  <Calendar size={10} />
                                  {format(new Date(issue.due_date), 'MMM d')}
                                </span>
                              ) : null}
                              {issue.task_name ? (
                                <span className="ml-auto truncate max-w-[80px] text-[10px]">
                                  {issue.task_name}
                                </span>
                              ) : issue.project_name ? (
                                <span className="ml-auto flex items-center gap-1 truncate max-w-[90px]">
                                  <ProjectIcon
                                    icon={issue.project_icon}
                                    iconUrl={issue.project_icon_url}
                                    color={issue.project_color}
                                    name={issue.project_name}
                                    size={12}
                                  />
                                  <span className="truncate text-[10px]">{issue.project_name}</span>
                                </span>
                              ) : null}
                            </div>
                          </Link>
                        )}
                      </Draggable>
                    ))}
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

function groupByStatus(issues: IssueRow[]): Record<string, IssueRow[]> {
  const board: Record<string, IssueRow[]> = {}
  for (const c of COLUMNS) board[c.status] = []
  for (const i of issues) {
    if (board[i.status]) board[i.status].push(i)
    else board[COLUMNS[0].status].push(i)
  }
  return board
}
