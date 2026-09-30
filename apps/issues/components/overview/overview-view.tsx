'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { useActiveWorkspace } from '../listings/use-active-workspace'
import {
  AreaLineChart,
  DonutChart,
  KpiCard,
  SERIES,
} from '@blackcode/platform-ui/charts'
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issuePriorityColor,
  issuePriorityLabel,
  issueStatusColor,
  issueStatusLabel,
} from '@/lib/work-items'
import { DAY_MS } from '@/lib/overview-periods'
import type { OverviewPayload } from '@/lib/db/queries/overview'
import { formatHours } from './helpers'
import { Leaderboard } from './leaderboard'
import { AttentionNeeded, ProjectHealth, RecentActivity, Workload } from './sections'
import { Empty, Panel, SkeletonBlock, focusRing } from './ui'

type RangeKey = '7d' | '30d' | '90d' | 'all'
const RANGES: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All', days: 0 },
]

function fmtXLabel(bucket: string): string {
  try {
    return format(parseISO(bucket), 'MMM d')
  } catch {
    return bucket.slice(5)
  }
}

function RangeSwitch({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <div role="group" aria-label="Date range" className="inline-flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          aria-pressed={value === r.key}
          onClick={() => onChange(r.key)}
          className={`rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors ${focusRing} ${
            value === r.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-[100px] rounded-none bg-card" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <SkeletonBlock className="h-5 w-40" />
        <div className="mx-auto mt-5 flex max-w-md items-end justify-center gap-4">
          <SkeletonBlock className="h-28 flex-1" />
          <SkeletonBlock className="h-36 flex-1" />
          <SkeletonBlock className="h-24 flex-1" />
        </div>
        <div className="mt-5 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-8" />
          ))}
        </div>
      </div>
      <SkeletonBlock className="h-72" />
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-56" />
      </div>
      <SkeletonBlock className="h-64" />
    </div>
  )
}

function Kpis({ data, days }: { data: OverviewPayload; days: number | null }) {
  const s = data.summary
  const k = data.overview.kpi_trends
  const compare = days ? `vs previous ${days} days` : undefined
  const hint = (pct: number | null | undefined, base?: string) => (pct != null ? compare : base)
  const completedSpark = data.velocity_series.map((p) => p.completed)
  const cards = [
    <KpiCard key="total" label="Total issues" value={s.total_issues} pct={k.total.pct} hint={hint(k.total.pct)} accent="var(--primary)" />,
    <KpiCard key="open" label="Open" value={s.open + s.in_progress} pct={k.open.pct} invert hint={hint(k.open.pct, `${s.in_progress} in progress`)} />,
    <KpiCard key="done" label="Completed" value={s.completed_in_period} pct={data.trends.completed.pct} spark={completedSpark} accent={SERIES.completed} hint={hint(data.trends.completed.pct, 'in period')} />,
    <KpiCard key="overdue" label="Overdue" value={s.overdue} pct={k.overdue.pct} invert hint={hint(k.overdue.pct, 'past due date')} accent={s.overdue > 0 ? '#ef4444' : undefined} />,
    <KpiCard key="unassigned" label="Unassigned" value={s.unassigned} pct={k.unassigned.pct} invert hint={hint(k.unassigned.pct, 'need an owner')} accent={s.unassigned > 0 ? '#f59e0b' : undefined} />,
    <KpiCard key="rate" label="Completion" value={`${s.completion_rate}%`} pct={k.completion_rate.pct} hint={hint(k.completion_rate.pct, 'of non-cancelled')} />,
    <KpiCard key="cycle" label="Avg cycle time" value={formatHours(s.avg_cycle_time_hours)} pct={data.trends.cycle_time.pct} invert hint={hint(data.trends.cycle_time.pct, 'in period')} />,
  ]
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 lg:grid-cols-7">
      {cards.map((c, i) => (
        <div key={i} className={`flex min-w-0 bg-card [&>*]:min-w-0 [&>*]:flex-1 ${i === cards.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
          {c}
        </div>
      ))}
      {/* fills the eighth slot of the 4-up grid so no hairline-coloured hole shows */}
      <div className="hidden bg-card sm:block lg:hidden" aria-hidden />
    </div>
  )
}

export function OverviewView() {
  const { data: ws } = useActiveWorkspace()
  const [range, setRange] = useState<RangeKey>('30d')
  const days = RANGES.find((r) => r.key === range)?.days ?? 0

  const q = useQuery({
    queryKey: ['ws-overview', ws?.slug, range],
    enabled: !!ws,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<OverviewPayload> => {
      const params = new URLSearchParams({ view: 'overview' })
      if (days > 0) {
        // Minute-rounded (up, so the last seconds are never left out) so a refetch
        // inside the same minute asks the same question.
        const to = Math.ceil(Date.now() / 60_000) * 60_000
        params.set('from', new Date(to - days * DAY_MS).toISOString())
        params.set('to', new Date(to).toISOString())
      }
      const res = await fetch(`/api/workspaces/${ws!.slug}/analytics?${params}`)
      if (!res.ok) throw new Error(`Overview failed to load (${res.status})`)
      return res.json()
    },
  })

  const data = q.data
  const slug = ws?.slug ?? ''
  const showSkeleton = !ws || (q.isPending && !data)

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <header className="flex h-12 items-center gap-2.5 px-4">
          <h1 className="text-[15px] font-semibold">Overview</h1>
          <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">{ws?.name ?? ''}</span>
          <div className="ml-auto flex items-center gap-2">
            <RangeSwitch value={range} onChange={setRange} />
            <button
              type="button"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh overview"
              title="Refresh"
              className={`flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 ${focusRing}`}
            >
              <RefreshCw size={14} className={q.isFetching ? 'animate-spin motion-reduce:animate-none' : ''} />
            </button>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-7xl p-4">
        {showSkeleton ? (
          <OverviewSkeleton />
        ) : q.isError && !data ? (
          <div className="rounded-lg border border-border bg-card px-6 py-12 text-center" role="alert">
            <p className="text-[14px] font-medium">Couldn’t load the overview</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{q.error instanceof Error ? q.error.message : 'Something went wrong.'}</p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className={`mt-4 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 ${focusRing}`}
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <div className={`space-y-4 transition-opacity ${q.isFetching ? 'opacity-60' : ''}`} aria-busy={q.isFetching}>
            <Kpis data={data} days={days || null} />
            <Leaderboard key={range} board={data.overview.leaderboard} rangeIsAll={range === 'all'} />

            <Panel title="Created vs completed" subtitle={`Per ${data.overview.range.interval}`}>
              {data.velocity_series.every((p) => p.created === 0 && p.completed === 0) ? (
                <Empty>No issues were created or completed in this period.</Empty>
              ) : (
                <div className="px-4 pb-4">
                  <AreaLineChart
                    data={data.velocity_series}
                    series={[
                      { key: 'created', label: 'Created', color: SERIES.created, fill: true },
                      { key: 'completed', label: 'Completed', color: SERIES.completed, fill: true },
                    ]}
                    formatX={fmtXLabel}
                  />
                </div>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Issues by status">
                <div className="px-4 pb-4">
                  <DonutChart
                    centerLabel="Issues"
                    data={ISSUE_STATUSES.flatMap((st) => {
                      const n = data.by_status.find((x) => x.status === st.value)?.count ?? 0
                      return n > 0 ? [{ label: issueStatusLabel(st.value), value: n, color: issueStatusColor(st.value) }] : []
                    })}
                  />
                </div>
              </Panel>
              <Panel title="Issues by priority">
                <div className="px-4 pb-4">
                  <DonutChart
                    centerLabel="Issues"
                    data={ISSUE_PRIORITIES.flatMap((p) => {
                      const n = data.by_priority.find((x) => x.priority === p.value)?.count ?? 0
                      return n > 0 ? [{ label: issuePriorityLabel(p.value), value: n, color: issuePriorityColor(p.value) }] : []
                    })}
                  />
                </div>
              </Panel>
            </div>

            <ProjectHealth projects={data.overview.projects} slug={slug} />
            <AttentionNeeded attention={data.overview.attention} slug={slug} />
            <Workload workload={data.overview.workload} />
            <RecentActivity rows={data.overview.recent_activity} slug={slug} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
