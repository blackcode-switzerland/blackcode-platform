'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import { toast } from 'sonner'
import { uploadFile } from '@/lib/upload'
import { Bell, BellOff, ChevronRight, Plus, Tag, Target, Trash2, X } from 'lucide-react'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { RichTextEditor, RichTextDisplay, type MentionItem } from '@blackcode/platform-ui/rich-text-editor'
import { ActivityFeed } from './activity-feed'
import { ProjectIcon } from './project-icon'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { PropertySelect } from '@blackcode/platform-ui/ui/property-select'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'
import {
  StatusIcon,
  PriorityIcon,
  issuePriorityKey,
} from '@/components/ui/work-item-icons'
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/work-items'
import { DetailPageSkeleton } from '@blackcode/platform-ui/ui/motion'

interface AssigneeInfo {
  id: number
  name: string | null
  email: string
  avatar_url: string | null
}

interface IssueDetail {
  id: number
  workspace_id: number
  seq: number | null
  title: string
  description: string | null
  status: string
  priority: number
  assignees: AssigneeInfo[]
  reporter_id: number | null
  project_id: number | null
  task_id: number | null
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  task_name: string | null
  project_name: string | null
}

interface Label {
  id: number
  name: string
  color: string
}

interface Member {
  user_id: number
  email: string
  name: string | null
  avatar_url?: string | null
}

interface Project {
  /** Uploaded logo; replaces the icon+color tile when set. */
  icon_url?: string | null
  id: number
  name: string
  color: string | null
  icon: string | null
}

interface Task {
  id: number
  name: string
  project_id: number | null
}

export function IssueDetailView({ issueId, workspaceSlug }: { issueId: number; workspaceSlug?: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()
  // When opened cross-workspace (deep link / inbox preview) an explicit slug is
  // passed; otherwise fall back to the active workspace.
  const wsSlug = workspaceSlug ?? ws?.slug

  const searchParams = useSearchParams()
  const isNew = searchParams.get('new') === '1'
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null)

  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Guard: an unparseable id (e.g. /dashboard/issues/new before that page
  // existed) used to spam the API with /api/issues/NaN. Bail out cleanly.
  const validId = Number.isFinite(issueId) && issueId > 0

  const issue = useQuery({
    queryKey: ['issue', issueId, wsSlug],
    enabled: validId && !!wsSlug,
    retry: false,
    queryFn: async (): Promise<IssueDetail> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}`)
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
  })

  useEffect(() => {
    if (isNew && issue.data && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isNew, issue.data?.id])

  const labels = useQuery({
    queryKey: ['issue-labels', issueId, wsSlug],
    enabled: !!wsSlug && validId,
    retry: false,
    queryFn: async (): Promise<Label[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}/labels`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const wsLabels = useQuery({
    queryKey: ['ws-labels', wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<Label[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/labels`)
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

  const tasks = useQuery({
    queryKey: ['ws-tasks', wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<Task[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/tasks`)
      if (!res.ok) return []
      const j = await res.json()
      return j.data
    },
  })

  const watchStatus = useQuery({
    queryKey: ['issue-watch', issueId, wsSlug],
    enabled: !!wsSlug && validId,
    queryFn: async (): Promise<boolean> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}/watch`)
      if (!res.ok) return false
      const j = await res.json()
      return j.watching ?? false
    },
    staleTime: 30_000,
  })
  const watching = watchStatus.data ?? false

  // Quiet patch used by autosave + property pickers (the UI itself is the
  // feedback); errors always toast.
  const patchIssue = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['activity', 'issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(false),
  })

  /* --------- description autosave (debounced + on blur) ---------- */
  const descRef = useRef<string | null>(null) // latest html in the editor
  const savedDescRef = useRef<string | null>(null) // last persisted html
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDescription = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (descRef.current !== null && descRef.current !== savedDescRef.current) {
      savedDescRef.current = descRef.current
      setSaving(true)
      patchIssue.mutate({ description: descRef.current })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDescriptionChange = useCallback(
    (html: string) => {
      descRef.current = html
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(flushDescription, 1200)
    },
    [flushDescription]
  )

  // Flush pending edits when leaving the page.
  useEffect(() => () => flushDescription(), [flushDescription])

  // Warn before close/reload when there are unsaved changes.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const hasDirtyTitle = titleDraft !== null
      const hasDirtyDesc =
        debounceRef.current !== null ||
        (descRef.current !== null && descRef.current !== savedDescRef.current)
      if (hasDirtyTitle || hasDirtyDesc) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [titleDraft])

  const attachLabel = useMutation({
    mutationFn: async (labelId: number) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label_id: labelId }),
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-labels', issueId] })
      queryClient.invalidateQueries({ queryKey: ['activity', 'issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
    },
    onError: () => toast.error('Could not update labels'),
  })

  const detachLabel = useMutation({
    mutationFn: async (labelId: number) => {
      const res = await fetch(
        `/api/workspaces/${wsSlug}/issues/${issueId}/labels/${labelId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue-labels', issueId] })
      queryClient.invalidateQueries({ queryKey: ['activity', 'issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
    },
    onError: () => toast.error('Could not update labels'),
  })

  const createLabel = useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
      })
      if (!res.ok) throw new Error('failed')
      return res.json() as Promise<Label>
    },
    onSuccess: async (newLabel) => {
      await queryClient.invalidateQueries({ queryKey: ['ws-labels', wsSlug] })
      attachLabel.mutate(newLabel.id)
    },
    onError: () => toast.error('Could not create label'),
  })

  const watch = useMutation({
    mutationFn: async (start: boolean) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}/watch`, {
        method: start ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: (_d, start) => {
      toast.success(start ? 'Subscribed to issue' : 'Unsubscribed')
      queryClient.invalidateQueries({ queryKey: ['issue-watch', issueId] })
    },
    onError: () => toast.error('Could not update subscription'),
  })

  const deleteIssue = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues/${issueId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Issue moved to Trash')
      queryClient.setQueriesData<{ id: number }[]>({ queryKey: ['ws-issues'] }, (old) =>
        old?.filter((i) => i.id !== issueId)
      )
      queryClient.setQueriesData<{ id: number }[]>({ queryKey: ['project-issues'] }, (old) =>
        old?.filter((i) => i.id !== issueId)
      )
      queryClient.setQueriesData<{ id: number }[]>({ queryKey: ['task-issues'] }, (old) =>
        old?.filter((i) => i.id !== issueId)
      )
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['task-issues'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/${wsSlug}/issues`)
    },
    onError: () => toast.error('Could not delete issue'),
  })

  /* ------------------------------ render ------------------------------- */

  if (issue.isLoading) {
    return <DetailPageSkeleton />
  }
  if (!issue.data) {
    return (
      <div className="p-8">
        <Link href={`/dashboard/${wsSlug}/issues`} className="text-xs text-muted-foreground hover:underline">
          ← Back to issues
        </Link>
        <p className="mt-4 text-sm">Issue not found.</p>
      </div>
    )
  }

  const data = issue.data
  const issueIdLabel = data.seq != null ? `#${data.seq}` : `#${data.id}`
  const issueLabelIds = new Set((labels.data ?? []).map((l) => l.id))
  const availableLabels = (wsLabels.data ?? []).filter((l) => !issueLabelIds.has(l.id))
  const assignedIds = new Set((data.assignees ?? []).map((a) => a.id))
  const addableAssignees = (members.data ?? []).filter((m) => !assignedIds.has(m.user_id))
  const mentionItems: MentionItem[] = (members.data ?? []).map((m) => ({
    id: m.user_id,
    label: m.name ?? m.email,
    avatarUrl: m.avatar_url,
  }))

  function commitTitle() {
    const next = titleDraft?.trim()
    if (next && next !== data.title) {
      setSaving(true)
      // Optimistically update the cache so clearing the draft doesn't flash the
      // old title while the PATCH + refetch are in flight.
      queryClient.setQueryData(['issue', issueId, wsSlug], (old: IssueDetail | undefined) =>
        old ? { ...old, title: next } : old
      )
      patchIssue.mutate({ title: next })
    }
    setTitleDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Breadcrumb header */}
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[14px] backdrop-blur">
        <Link
          href={`/dashboard/${wsSlug}/issues`}
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Issues
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        <span className="font-mono text-xs text-muted-foreground">{issueIdLabel}</span>
        <span className="max-w-[28ch] truncate font-medium">{data.title}</span>
        <span className="ml-2 text-[11px] text-muted-foreground/70 transition-opacity">
          {saving ? 'Saving…' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => watch.mutate(!watching)}
            title={watching ? 'Unsubscribe' : 'Subscribe'}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {watching ? <BellOff size={15} /> : <Bell size={15} />}
          </button>
          <button
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Delete ${issueIdLabel}?`,
                  description: 'It will be moved to Trash. You can restore it later.',
                  destructive: true,
                  confirmLabel: 'Move to Trash',
                }))
              )
                return
              deleteIssue.mutate()
            }}
            title="Delete issue"
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
            {/* Title — always editable, saves on blur/Enter */}
            <textarea
              rows={1}
              value={titleDraft ?? data.title}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
              maxLength={200}
              placeholder="Issue title"
              className="mb-3 w-full resize-none overflow-hidden bg-transparent text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
              ref={(el) => {
                titleInputRef.current = el
                if (el) {
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }
              }}
            />

            {/* Description — seamless TipTap, editable by default */}
            <RichTextEditor
              key={`desc-${data.id}`}
              content={data.description ?? ''}
              onChange={onDescriptionChange}
              onBlur={flushDescription}
              placeholder="Add description…"
              variant="seamless"
              mentionItems={mentionItems}
              minHeight="120px"
              onFileUpload={uploadFile}
            />

            {/* Activity */}
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-base font-medium">Activity</h2>
                <div className="h-px flex-1 bg-border" />
              </div>
              <ActivityFeed
                entityType="issue"
                entityId={issueId}
                wsSlug={wsSlug ?? ''}
                commentsUrl={`/api/workspaces/${wsSlug}/issues/${issueId}/comments`}
                commentsQueryKey={['issue-comments', issueId]}
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
              value={data.status}
              searchPlaceholder="Change status…"
              options={ISSUE_STATUSES.map((s) => ({
                value: s.value,
                label: s.label,
                icon: <StatusIcon status={s.value} />,
              }))}
              onChange={(v) => patchIssue.mutate({ status: v })}
            />
            <PropertySelect
              value={String(data.priority)}
              searchPlaceholder="Change priority…"
              options={ISSUE_PRIORITIES.map((p) => ({
                value: String(p.value),
                label: p.label,
                icon: <PriorityIcon priority={issuePriorityKey(p.value)} />,
              }))}
              onChange={(v) => patchIssue.mutate({ priority: parseInt(v) })}
            />
            <div>
              <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Assignees</p>
              <ul className="space-y-0.5">
                {(data.assignees ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary"
                  >
                    <MemberAvatar name={a.name} email={a.email} avatarUrl={a.avatar_url} size={16} />
                    <span className="flex-1 truncate">{a.name ?? a.email}</span>
                    <button
                      onClick={() =>
                        patchIssue.mutate({
                          assignee_ids: (data.assignees ?? [])
                            .filter((x) => x.id !== a.id)
                            .map((x) => x.id),
                        })
                      }
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      title="Remove assignee"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {addableAssignees.length > 0 && (
                <PropertySelect
                  value=""
                  placeholder="Add assignee"
                  searchPlaceholder="Add assignee…"
                  buttonClassName="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  options={addableAssignees.map((m) => ({
                    value: String(m.user_id),
                    label: m.name ?? m.email,
                    icon: (
                      <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={16} />
                    ),
                  }))}
                  onChange={(v) => {
                    if (v) {
                      patchIssue.mutate({
                        assignee_ids: [...(data.assignees ?? []).map((a) => a.id), parseInt(v)],
                      })
                    }
                  }}
                />
              )}
            </div>

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Labels</p>
            <div className="flex flex-wrap items-center gap-1.5 px-2">
              {(labels.data ?? []).map((l) => (
                <span
                  key={l.id}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name}
                  <button
                    onClick={() => detachLabel.mutate(l.id)}
                    className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                    title="Remove label"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <LabelPicker
                available={availableLabels}
                onSelect={(id) => attachLabel.mutate(id)}
                onCreate={(name, color) => createLabel.mutate({ name, color })}
              />
            </div>

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Project</p>
            <PropertySelect
              value={data.project_id ? String(data.project_id) : ''}
              placeholder="Add to project"
              searchPlaceholder="Move to project…"
              options={[
                { value: '', label: 'No project' },
                ...(projects.data ?? []).map((p) => ({
                  value: String(p.id),
                  label: p.name,
                  icon: <ProjectIcon icon={p.icon} iconUrl={p.icon_url} color={p.color} name={p.name} size={14} />,
                })),
              ]}
              onChange={(v) => patchIssue.mutate({ project_id: v ? parseInt(v) : null })}
            />
            <PropertySelect
              value={data.task_id ? String(data.task_id) : ''}
              placeholder="Add to task"
              searchPlaceholder="Set task…"
              options={[
                { value: '', label: 'No task' },
                ...(tasks.data ?? []).map((m) => ({
                  value: String(m.id),
                  label: m.name,
                  icon: <Target size={14} className="text-muted-foreground" />,
                })),
              ]}
              onChange={(v) => patchIssue.mutate({ task_id: v ? parseInt(v) : null })}
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Start date</p>
            <DatePicker
              variant="inline"
              value={data.start_date ?? null}
              onChange={(v) => patchIssue.mutate({ start_date: v })}
              placeholder="Set start date"
            />

            <div className="my-4 h-px bg-border" />
            <p className="mb-2 px-2 text-[13px] font-medium text-muted-foreground">Due date</p>
            <DatePicker
              variant="inline"
              value={data.due_date ?? null}
              onChange={(v) => patchIssue.mutate({ due_date: v })}
              placeholder="Set due date"
            />

            <div className="my-4 h-px bg-border" />
            <ul className="space-y-1.5 px-2 text-xs text-muted-foreground">
              <li className="flex justify-between">
                <span>Created</span>
                <span suppressHydrationWarning>
                  {format(new Date(data.created_at), 'MMM d, yyyy')}
                </span>
              </li>
              <li className="flex justify-between">
                <span>Updated</span>
                <span suppressHydrationWarning>
                  {formatDistanceToNow(new Date(data.updated_at), { addSuffix: true })}
                </span>
              </li>
              {data.completed_at ? (
                <li className="flex justify-between">
                  <span>Completed</span>
                  <span suppressHydrationWarning>
                    {format(new Date(data.completed_at), 'MMM d, yyyy')}
                  </span>
                </li>
              ) : null}
            </ul>
          </div>
        </aside>
      </div>

      {/* reserved icons */}
      <span className="hidden">
        <Plus />
      </span>
    </div>
  )
}

const LABEL_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#5e6ad2', '#a855f7', '#ec4899', '#8a8f98',
]

function LabelPicker({
  available,
  onSelect,
  onCreate,
}: {
  available: { id: number; name: string; color: string }[]
  onSelect: (id: number) => void
  onCreate: (name: string, color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingColor, setPendingColor] = useState(LABEL_COLORS[0])
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setPendingColor(LABEL_COLORS[0])
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = query
    ? available.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
    : available

  const canCreate = query.trim().length > 0 && !available.some(
    (l) => l.name.toLowerCase() === query.trim().toLowerCase()
  )

  function handleSelect(id: number) {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  function handleCreate() {
    const name = query.trim()
    if (!name) return
    onCreate(name, pendingColor)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Plus size={10} />
        Add label
      </button>

      {open ? (
        <div className="absolute bottom-full right-0 z-40 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-xl duration-100 animate-in fade-in zoom-in-95">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (filtered.length === 1) handleSelect(filtered[0].id)
                else if (canCreate) handleCreate()
              } else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Search or create…"
            className="w-full border-b border-border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(l.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-secondary"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="flex-1 truncate">{l.name}</span>
                </button>
              </li>
            ))}
            {canCreate ? (
              <li>
                <div className="border-t border-border px-3 pb-1 pt-2">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPendingColor(c)}
                        className={`size-3.5 rounded-full transition-transform hover:scale-110 ${pendingColor === c ? 'ring-2 ring-offset-1 ring-offset-popover' : ''}`}
                        style={{ backgroundColor: c, outlineColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={handleCreate}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-secondary"
                  >
                    <Tag size={12} className="shrink-0 text-muted-foreground" />
                    <span>Create <span className="font-medium">&quot;{query.trim()}&quot;</span></span>
                    <span className="ml-auto size-2.5 shrink-0 rounded-full" style={{ backgroundColor: pendingColor }} />
                  </button>
                </div>
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No labels found</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
