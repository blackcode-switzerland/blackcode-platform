'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/upload'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useDeleteDialog } from '@/components/ui/delete-with-children-dialog'
import { RichTextEditor, RichTextDisplay, type MentionItem } from '@blackcode/platform-ui/rich-text-editor'
import { ActivityFeed } from './activity-feed'
import { DetailPageSkeleton } from '@blackcode/platform-ui/ui/motion'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'
import { StatusIcon, ProgressRing } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { PropertySelect } from '@blackcode/platform-ui/ui/property-select'
import { ProjectIcon } from '@/components/project-icon'

interface TaskDetail {
  id: number
  seq: number | null
  workspace_id: number
  project_id: number | null
  name: string
  description: string | null
  due_date: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  project_name: string | null
  project_icon: string | null
  project_color: string | null
  lead_id: number | null
  issue_count: number
  completed_issues: number
}

interface IssueRow {
  id: number
  seq: number | null
  title: string
  status: string
  due_date: string | null
  assignees: Array<{ id: number; name: string | null; email: string; avatar_url: string | null }>
  project_name: string | null
  project_icon: string | null
  project_color: string | null
}

interface Project {
  id: number
  name: string
  icon: string | null
  color: string | null
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}

export function TaskDetailView({ taskId, workspaceSlug }: { taskId: number; workspaceSlug?: string }) {
  const queryClient = useQueryClient()
  const { confirmDelete } = useDeleteDialog()
  const { data: ws } = useActiveWorkspace()
  // When opened cross-workspace (deep link / inbox preview) an explicit slug is
  // passed; otherwise fall back to the active workspace.
  const wsSlug = workspaceSlug ?? ws?.slug
  const searchParams = useSearchParams()
  const isNew = searchParams.get('new') === '1'
  const nameInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const descRef = useRef<string>('')
  const descModifiedRef = useRef(false)

  const task = useQuery({
    queryKey: ['task', taskId, wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<TaskDetail | null> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/tasks/${taskId}`)
      if (!res.ok) return null
      return res.json()
    },
  })

  useEffect(() => {
    if (isNew && task.data && nameInputRef.current) {
      nameInputRef.current.focus()
      nameInputRef.current.select()
    }
  }, [isNew, task.data?.id])

  const issues = useQuery({
    queryKey: ['task-issues', taskId, wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<IssueRow[]> => {
      const res = await fetch(
        `/api/workspaces/${wsSlug}/issues?task_id=${taskId}&limit=200`
      )
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const projects = useQuery({
    queryKey: ['ws-projects', wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/projects`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const members = useQuery({
    queryKey: ['ws-members', wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/members`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const router = useRouter()

  const createIssue = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { title: 'New Issue', task_id: taskId }
      if (task.data?.project_id != null) body.project_id = task.data.project_id
      const res = await fetch(`/api/workspaces/${wsSlug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create issue')
      return res.json() as Promise<{ id: number; seq: number | null }>
    },
    onSuccess: (issue) => {
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/${wsSlug}/issues/${issue.seq ?? issue.id}?new=1`)
    },
    onError: () => toast.error('Failed to create issue'),
  })

  const patch = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Task updated')
      descModifiedRef.current = false
      queryClient.invalidateQueries({ queryKey: ['task', taskId] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
    },
    onError: () => toast.error('Failed to update task'),
  })

  const remove = useMutation({
    mutationFn: async (mode: 'cascade' | 'detach') => {
      const res = await fetch(`/api/workspaces/${wsSlug}/tasks/${taskId}?mode=${mode}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Task moved to Trash')
      queryClient.setQueriesData<{ id: number }[]>({ queryKey: ['ws-tasks-listing'] }, (old) =>
        old?.filter((m) => m.id !== taskId)
      )
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['project-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/${wsSlug}/tasks`)
    },
    onError: () => toast.error('Could not delete task'),
  })

  // Must be above early returns — hooks must be called unconditionally.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (nameDraft !== null || descModifiedRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [nameDraft])

  if (task.isLoading) {
    return <DetailPageSkeleton />
  }
  if (!task.data) {
    return (
      <div className="p-8">
        <Link href={`/dashboard/${wsSlug}/tasks`} className="text-xs text-muted-foreground hover:underline">
          ← Back to tasks
        </Link>
        <p className="mt-4 text-sm">Task not found.</p>
      </div>
    )
  }

  const data = task.data
  const due = data.due_date ? new Date(data.due_date) : null
  // `data.status` is DERIVED from the task's issues and its vocabulary is
  // empty|active|done|cancelled (lib/work-items.ts → TASK_PROGRESS_STATUSES).
  // This compared against 'completed' until 2026-08-12 — a value nothing in
  // this repo has ever produced, so the badge showed on finished tasks too.
  const overdue = due ? isPast(due) && !isToday(due) && data.status === 'active' : false
  const total = data.issue_count
  const done = data.completed_issues
  // null, not 0, when there are no issues: 0% reads as "nothing done" when the
  // truth is "nothing here". Renderers below show — instead.
  const pct = total > 0 ? Math.round((done / total) * 100) : null

  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  function commitName() {
    const next = nameDraft?.trim()
    if (next && next !== data.name) {
      // Optimistically update the cache so clearing the draft doesn't flash the
      // old name while the PATCH + refetch are in flight.
      queryClient.setQueryData(['task', taskId, wsSlug], (old: TaskDetail | null | undefined) =>
        old ? { ...old, name: next } : old
      )
      patch.mutate({ name: next })
    }
    setNameDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Breadcrumb header */}
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[14px] backdrop-blur">
        <Link
          href={`/dashboard/${wsSlug}/tasks`}
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Tasks
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        {data.id != null ? (
          <span className="font-mono text-xs text-muted-foreground">#{data.id}</span>
        ) : null}
        <span className="max-w-[36ch] truncate font-medium">{data.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={async () => {
              const decision = await confirmDelete({
                kind: 'task',
                name: data.name,
                previewUrl: `/api/workspaces/${wsSlug}/tasks/${taskId}?preview=1`,
              })
              if (!decision) return
              remove.mutate(decision.mode)
            }}
            title="Delete task"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col xl:flex-row">
        {/* Document */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-3xl px-6 py-10 sm:px-10">
            {/* Title — seamless editable, saves on blur/Enter */}
            <textarea
              rows={1}
              value={nameDraft ?? data.name}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
              maxLength={120}
              placeholder="Task name"
              className="mb-2 w-full resize-none overflow-hidden bg-transparent text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
              ref={(el) => {
                nameInputRef.current = el
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
            />

            {/* Description — seamless TipTap, editable by default, autosaves on blur */}
            <div className="mb-6">
              <RichTextEditor
                key={`mdesc-${data.id}`}
                content={data.description ?? ''}
                onChange={(html) => {
                  descRef.current = html
                  descModifiedRef.current = true
                }}
                onBlur={() => {
                  const next = descRef.current
                  if (next !== (data.description ?? '')) {
                    patch.mutate({ description: next })
                  } else {
                    descModifiedRef.current = false
                  }
                }}
                placeholder="Add description…"
                variant="seamless"
                minHeight="100px"
                mentionItems={mentionItems}
                onFileUpload={uploadFile}
              />
            </div>

            {/* Progress summary. An empty task shows no ring and no percentage
                — see the note on `pct` above. */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {pct === null ? (
                <span>No issues yet</span>
              ) : (
                <>
                  <ProgressRing pct={pct} size={16} />
                  <span>
                    {done} of {total} issues completed
                  </span>
                </>
              )}
            </div>

            {/* Issues */}
            <section className="mt-10">
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-base font-medium">
                  Issues{' '}
                  <span className="text-muted-foreground">({issues.data?.length ?? 0})</span>
                </h2>
                <div className="h-px flex-1 bg-border" />
                <button
                  onClick={() => ws && createIssue.mutate()}
                  disabled={createIssue.isPending || !ws}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={13} />
                  New issue
                </button>
              </div>
              {issues.data?.length ? (
                <ul>
                  {issues.data.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/dashboard/${wsSlug}/issues/${i.seq ?? i.id}`}
                        prefetch={false}
                        className="flex h-11 items-center gap-3 rounded-md px-0 transition-colors hover:bg-secondary/40"
                      >
                        <StatusIcon status={i.status} size={14} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {i.seq != null ? `#${i.seq}` : `#${i.id}`}
                        </span>
                        <span className="flex-1 truncate text-[13px]">{i.title}</span>
                        {i.project_name ? (
                          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <ProjectIcon icon={i.project_icon} color={i.project_color} name={i.project_name} size={13} />
                            <span className="hidden sm:inline">{i.project_name}</span>
                          </span>
                        ) : null}
                        {i.due_date ? (
                          <span className="shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
                            {format(new Date(i.due_date), 'MMM d')}
                          </span>
                        ) : null}
                        {(i.assignees ?? []).slice(0, 2).map((a, idx) => (
                          <span key={a.id} style={{ marginLeft: idx > 0 ? '-4px' : 0 }}>
                            <MemberAvatar name={a.name} email={a.email} avatarUrl={a.avatar_url} size={18} />
                          </span>
                        ))}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-[13px] text-muted-foreground">
                  No issues in this task yet.
                </p>
              )}
            </section>

            {/* Activity */}
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-base font-medium">Activity</h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              <ActivityFeed
                entityType="task"
                entityId={taskId}
                wsSlug={wsSlug ?? ''}
                commentsUrl={`/api/workspaces/${wsSlug}/tasks/${taskId}/comments`}
                commentsQueryKey={['task-comments', taskId, wsSlug]}
                mentionItems={mentionItems}
                members={members.data}
              />
            </section>
          </div>
        </main>

        {/* Properties sidebar */}
        <aside className="w-full shrink-0 border-t border-border xl:w-72 xl:border-l xl:border-t-0">
          <div className="sticky top-12 px-4 py-5">
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Properties</p>

            <PropertySelect
              value={data.project_id ? String(data.project_id) : ''}
              placeholder="Add to project"
              searchPlaceholder="Move to project…"
              options={[
                { value: '', label: 'No project' },
                ...(projects.data ?? []).map((p) => ({
                  value: String(p.id),
                  label: p.name,
                  icon: <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={14} />,
                })),
              ]}
              onChange={(v) => patch.mutate({ project_id: v ? parseInt(v) : null })}
            />

            <PropertySelect
              value={data.lead_id ? String(data.lead_id) : ''}
              placeholder="Lead"
              searchPlaceholder="Set lead…"
              options={[
                { value: '', label: 'No lead' },
                ...(members.data ?? []).map((m) => ({
                  value: String(m.user_id),
                  label: m.name ?? m.email,
                  icon: (
                    <MemberAvatar
                      name={m.name}
                      email={m.email}
                      avatarUrl={m.avatar_url}
                      size={16}
                    />
                  ),
                })),
              ]}
              onChange={(v) => patch.mutate({ lead_user_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Target date</p>
            <DatePicker
              variant="inline"
              value={data.due_date ?? null}
              onChange={(v) => patch.mutate({ due_date: v })}
              placeholder="Set target date"
            />
            {overdue ? (
              <p className="mt-1 px-2 text-xs text-destructive">Overdue</p>
            ) : null}

            <div className="my-4 h-px bg-border" />
            <ul className="space-y-1.5 px-2 text-xs text-muted-foreground">
              {data.created_at ? (
                <li className="flex justify-between">
                  <span>Created</span>
                  <span suppressHydrationWarning>
                    {format(new Date(data.created_at), 'MMM d, yyyy')}
                  </span>
                </li>
              ) : null}
              {data.updated_at ? (
                <li className="flex justify-between">
                  <span>Updated</span>
                  <span suppressHydrationWarning>
                    {formatDistanceToNow(new Date(data.updated_at), { addSuffix: true })}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}
