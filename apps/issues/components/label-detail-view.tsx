'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronRight, Tag, Trash2 } from 'lucide-react'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { useConfirm } from '@blackcode/platform-ui/ui/confirm-dialog'
import { DetailPageSkeleton } from '@blackcode/platform-ui/ui/motion'
import { StatusIcon } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { ProjectIcon } from '@/components/project-icon'
import { PRESET_COLORS } from './label-colors'

interface LabelDetail {
  id: number
  name: string
  color: string
  description: string | null
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
  /** Uploaded project logo; replaces the icon tile when set. */
  project_icon_url: string | null
  project_color: string | null
  labels: Array<{ id: number; name: string; color: string }>
}

export function LabelDetailView({ labelId }: { labelId: number }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm } = useConfirm()
  const { data: ws } = useActiveWorkspace()
  const wsSlug = ws?.slug
  const [nameDraft, setNameDraft] = useState<string | null>(null)

  const label = useQuery({
    queryKey: ['label', labelId, wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<LabelDetail | null> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/labels/${labelId}`)
      if (!res.ok) return null
      return res.json()
    },
  })

  // Issues carrying this label (filtered client-side from the issue list).
  const issues = useQuery({
    queryKey: ['label-issues', labelId, wsSlug],
    enabled: !!wsSlug,
    queryFn: async (): Promise<IssueRow[]> => {
      const res = await fetch(`/api/workspaces/${wsSlug}/issues?limit=200`)
      if (!res.ok) return []
      const j = await res.json()
      return (j.data as IssueRow[]).filter((i) => (i.labels ?? []).some((l) => l.id === labelId))
    },
  })

  const patch = useMutation({
    mutationFn: async (input: { name?: string; color?: string }) => {
      const res = await fetch(`/api/workspaces/${wsSlug}/labels/${labelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'failed')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['label', labelId] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${wsSlug}/labels/${labelId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    },
    onSuccess: () => {
      toast.success('Label deleted')
      queryClient.invalidateQueries({ queryKey: ['ws-labels-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-labels'] })
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['sidebar-counts'] })
      router.push(`/dashboard/${wsSlug}/labels`)
    },
    onError: () => toast.error('Could not delete label'),
  })

  // Keep hooks above early returns.
  useEffect(() => {
    setNameDraft(null)
  }, [labelId])

  if (label.isLoading) return <DetailPageSkeleton />
  if (!label.data) {
    return (
      <div className="p-8">
        <Link href={`/dashboard/${wsSlug}/labels`} className="text-xs text-muted-foreground hover:underline">
          ← Back to labels
        </Link>
        <p className="mt-4 text-sm">Label not found.</p>
      </div>
    )
  }

  const data = label.data

  function commitName() {
    const next = nameDraft?.trim()
    if (next && next !== data.name) patch.mutate({ name: next })
    setNameDraft(null)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background/80 px-4 text-[14px] backdrop-blur">
        <Link
          href={`/dashboard/${wsSlug}/labels`}
          prefetch={false}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Labels
        </Link>
        <ChevronRight size={13} className="text-muted-foreground/50" />
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: data.color }} />
        <span className="max-w-[36ch] truncate font-medium">{data.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={async () => {
              const ok = await confirm({
                title: `Delete label "${data.name}"?`,
                description: 'It will be removed from all issues.',
                destructive: true,
                confirmLabel: 'Delete',
              })
              if (ok) remove.mutate()
            }}
            title="Delete label"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10">
        {/* Name — inline editable */}
        <div className="mb-4 flex items-center gap-3">
          <span className="size-5 shrink-0 rounded-full" style={{ backgroundColor: data.color }} />
          <input
            value={nameDraft ?? data.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setNameDraft(null)
            }}
            maxLength={50}
            placeholder="Label name"
            className="flex-1 bg-transparent text-[26px] font-semibold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Color — inline editable swatches */}
        <div className="mb-8 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Color</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => c !== data.color && patch.mutate({ color: c })}
                aria-label={`Set color ${c}`}
                className={`size-6 rounded-full transition-transform hover:scale-110 ${data.color === c ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Associated issues */}
        <section>
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-base font-medium">
              Issues <span className="text-muted-foreground">({issues.data?.length ?? 0})</span>
            </h2>
            <div className="h-px flex-1 bg-border" />
          </div>
          {issues.data?.length ? (
            <ul>
              {issues.data.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/dashboard/${wsSlug}/issues/${i.seq ?? i.id}`}
                    prefetch={false}
                    className="flex h-11 items-center gap-3 rounded-md transition-colors hover:bg-secondary/40"
                  >
                    <StatusIcon status={i.status} size={14} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {i.seq != null ? `#${i.seq}` : `#${i.id}`}
                    </span>
                    <span className="flex-1 truncate text-[13px]">{i.title}</span>
                    {i.project_name ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <ProjectIcon icon={i.project_icon} iconUrl={i.project_icon_url} color={i.project_color} name={i.project_name} size={13} />
                        <span className="hidden sm:inline">{i.project_name}</span>
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
            <p className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
              <Tag size={14} /> No issues have this label yet.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
