'use client'

import Link from 'next/link'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { CheckCircle2 } from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { ChartLegend } from '@blackcode/platform-ui/charts'
import type { OverviewPayload } from '@/lib/db/queries/overview'
import {
  issuePriorityColor,
  issuePriorityLabel,
  issueStatusColor,
  issueStatusLabel,
  projectUpdateStatusColor,
  projectUpdateStatusLabel,
} from '@/lib/work-items'
import { ProjectIcon } from '../project-icon'
import { activityHref, describeActivity, memberLabel } from './helpers'
import { Empty, Panel, focusRing } from './ui'

type Block = OverviewPayload['overview']

function ago(iso: string | null): string {
  if (!iso) return ''
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

// ---------- projects ----------

export function ProjectHealth({ projects, slug }: { projects: Block['projects']; slug: string }) {
  return (
    <Panel title="Project health" subtitle="Progress and the latest posted update">
      {projects.length === 0 ? (
        <Empty>No active projects.</Empty>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {projects.map((p) => {
            const body = (
              <>
                <span className="flex min-w-0 items-center gap-2.5">
                  <ProjectIcon icon={p.icon} color={p.color} name={p.name} size={26} />
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                </span>
                <span className="min-w-0">
                  <span className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>
                      {p.done}/{p.total - p.cancelled} done
                    </span>
                    <span>{p.progress_pct}%</span>
                  </span>
                  <span
                    role="progressbar"
                    aria-valuenow={p.progress_pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${p.name} progress`}
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary"
                  >
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${p.progress_pct}%` }} />
                  </span>
                </span>
                <span className="flex items-center gap-2 sm:justify-end">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
                    <span className="size-2 rounded-full" style={{ backgroundColor: projectUpdateStatusColor(p.health) }} />
                    {projectUpdateStatusLabel(p.health)}
                  </span>
                  {p.health_at ? <span className="text-[11px] text-muted-foreground">{ago(p.health_at)}</span> : null}
                </span>
              </>
            )
            const cls = `grid items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,auto)]`
            return (
              <li key={p.project_id}>
                {p.seq != null ? (
                  <Link href={`/dashboard/${slug}/projects/${p.seq}`} className={`${cls} hover:bg-secondary/50 ${focusRing}`}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ---------- attention ----------

type AttentionKey = 'overdue' | 'urgent' | 'old_open' | 'unassigned'

function AttentionGroup({
  title,
  kind,
  list,
  slug,
}: {
  title: string
  kind: AttentionKey
  list: Block['attention']['overdue']
  slug: string
}) {
  const more = list.total - list.items.length
  return (
    <Panel title={title} count={list.total}>
      {list.items.length === 0 ? (
        <p className="flex items-center gap-2 px-4 pb-5 pt-1 text-[13px] text-muted-foreground">
          <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-500" aria-hidden />
          All clear.
        </p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {list.items.map((i) => {
            let when = `${i.age_days}d old`
            if (kind === 'overdue' && i.due_date) {
              try {
                when = `Due ${format(parseISO(i.due_date), 'MMM d')}`
              } catch {
                when = `Due ${i.due_date}`
              }
            }
            const extra = i.assignees.length - 3
            return (
              <li key={i.id}>
                <Link
                  href={`/dashboard/${slug}/issues/${i.seq ?? i.id}`}
                  className={`flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/50 ${focusRing}`}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: issuePriorityColor(i.priority) }}
                    title={issuePriorityLabel(i.priority)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      <span className="mr-1.5 tabular-nums text-muted-foreground">#{i.seq ?? i.id}</span>
                      {i.title}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {issueStatusLabel(i.status)} ·{' '}
                      <span className={kind === 'overdue' ? 'text-rose-600 dark:text-rose-500' : ''}>{when}</span>
                    </span>
                  </span>
                  {i.assignees.length > 0 ? (
                    <span className="flex shrink-0 -space-x-1.5">
                      {i.assignees.slice(0, 3).map((a) => (
                        <MemberAvatar key={a.user_id} name={a.name} email={a.email} avatarUrl={a.avatar_url} size={20} className="ring-2 ring-card" />
                      ))}
                      {extra > 0 ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[9px] font-medium ring-2 ring-card">
                          +{extra}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {more > 0 ? (
        <Link
          href={`/dashboard/${slug}/issues`}
          className={`block border-t border-border px-4 py-2 text-[12px] text-muted-foreground hover:text-foreground ${focusRing}`}
        >
          +{more} more
        </Link>
      ) : null}
    </Panel>
  )
}

export function AttentionNeeded({ attention, slug }: { attention: Block['attention']; slug: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AttentionGroup title="Overdue" kind="overdue" list={attention.overdue} slug={slug} />
      <AttentionGroup title="Urgent & still open" kind="urgent" list={attention.urgent} slug={slug} />
      <AttentionGroup title={`Open longer than ${attention.old_open_days} days`} kind="old_open" list={attention.old_open} slug={slug} />
      <AttentionGroup title="Unassigned" kind="unassigned" list={attention.unassigned} slug={slug} />
    </div>
  )
}

// ---------- workload ----------

export function Workload({ workload }: { workload: Block['workload'] }) {
  const max = Math.max(1, ...workload.members.map((m) => m.total))
  return (
    <Panel title="Workload" subtitle="Open issues per member, by status">
      {workload.members.length === 0 && workload.unassigned === 0 ? (
        <Empty>No open issues.</Empty>
      ) : (
        <div className="border-t border-border px-4 py-3">
          <ul className="space-y-2.5">
            {workload.members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3">
                <span className="flex w-28 shrink-0 items-center gap-2 sm:w-40">
                  <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={20} />
                  <span className="truncate text-[13px]">{memberLabel(m)}</span>
                </span>
                <span
                  className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                  role="img"
                  aria-label={workload.statuses
                    .filter((s) => (m.by_status[s] ?? 0) > 0)
                    .map((s) => `${m.by_status[s]} ${issueStatusLabel(s)}`)
                    .join(', ')}
                >
                  {workload.statuses.map((s) => {
                    const n = m.by_status[s] ?? 0
                    return n > 0 ? (
                      <span
                        key={s}
                        title={`${issueStatusLabel(s)}: ${n}`}
                        className="h-full motion-safe:transition-[width]"
                        style={{ width: `${(n / max) * 100}%`, backgroundColor: issueStatusColor(s) }}
                      />
                    ) : null
                  })}
                </span>
                <span className="w-8 shrink-0 text-right text-[13px] font-medium tabular-nums">{m.total}</span>
              </li>
            ))}
          </ul>
          <ChartLegend items={workload.statuses.map((s) => ({ label: issueStatusLabel(s), color: issueStatusColor(s) }))} />
          <p className="mt-3 border-t border-border pt-3 text-[13px] text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">{workload.unassigned}</span> open{' '}
            {workload.unassigned === 1 ? 'issue is' : 'issues are'} unassigned
          </p>
        </div>
      )}
    </Panel>
  )
}

// ---------- activity ----------

export function RecentActivity({ rows, slug }: { rows: Block['recent_activity']; slug: string }) {
  return (
    <Panel
      title="Recent activity"
      action={
        <Link href={`/dashboard/${slug}/activity`} className={`rounded text-[12px] text-muted-foreground hover:text-foreground ${focusRing}`}>
          View all activity
        </Link>
      }
    >
      {rows.length === 0 ? (
        <Empty>No activity yet.</Empty>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => {
            const { before, after } = describeActivity(r)
            const href = activityHref(slug, r)
            const subject = `${r.entity_type.replace(/_/g, ' ')}${r.entity_seq != null ? ` #${r.entity_seq}` : ''}${r.entity_title ? ` ${r.entity_title}` : ''}`
            return (
              <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                {r.actor ? (
                  <MemberAvatar name={r.actor.name} email={r.actor.email} avatarUrl={r.actor.avatar_url} size={22} className="mt-0.5" />
                ) : (
                  <span className="mt-0.5 size-[22px] shrink-0 rounded-full bg-secondary" aria-hidden />
                )}
                <p className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">{r.actor ? memberLabel(r.actor) : 'System'}</span> {before}{' '}
                  {href ? (
                    <Link href={href} className={`rounded text-foreground hover:underline ${focusRing}`}>
                      {subject}
                    </Link>
                  ) : (
                    <span className="text-foreground">{subject}</span>
                  )}
                  {after ? ` ${after}` : ''}
                </p>
                <time dateTime={r.occurred_at} className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                  {ago(r.occurred_at)}
                </time>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
