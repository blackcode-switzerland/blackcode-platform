'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Crown, Medal, Trophy } from 'lucide-react'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { Sparkline, formatNumber } from '@blackcode/platform-ui/charts'
import type { LeaderMetric, OverviewPayload } from '@/lib/db/queries/overview'
import type { OverviewPeriodKey } from '@/lib/overview-periods'
import {
  defaultDir,
  formatHours,
  isLeader,
  memberLabel,
  podiumMembers,
  sortMembers,
  type SortDir,
  type SortKey,
} from './helpers'
import { Panel, focusRing } from './ui'

type Board = OverviewPayload['overview']['leaderboard']
type Member = Board['members'][number]

const LEADER_CHIPS: Array<{ metric: LeaderMetric; label: string; fmt: (v: number) => string }> = [
  { metric: 'completed', label: 'Most issues closed', fmt: (v) => `${formatNumber(v)} closed` },
  { metric: 'created', label: 'Most created', fmt: (v) => `${formatNumber(v)} created` },
  { metric: 'fastest_cycle', label: 'Fastest cycle time', fmt: (v) => formatHours(v) },
  { metric: 'comments', label: 'Most comments', fmt: (v) => `${formatNumber(v)} comments` },
  { metric: 'activity', label: 'Most active', fmt: (v) => `${formatNumber(v)} events` },
]

// Medal tones — legible on both themes.
const MEDAL = [
  { icon: Crown, text: 'text-amber-500', ring: 'ring-amber-500/70', bar: 'bg-amber-500/15 border-amber-500/40', height: 'h-14' },
  { icon: Medal, text: 'text-slate-400 dark:text-slate-300', ring: 'ring-slate-400/70', bar: 'bg-slate-400/15 border-slate-400/40', height: 'h-10' },
  { icon: Medal, text: 'text-orange-700 dark:text-orange-500', ring: 'ring-orange-600/60', bar: 'bg-orange-600/15 border-orange-600/40', height: 'h-7' },
] as const

function Podium({ members, period, emptyLabel }: { members: Member[]; period: OverviewPeriodKey; emptyLabel: string }) {
  const top = podiumMembers(members, period)
  if (top.length === 0) {
    return (
      <div className="mx-4 mb-4 rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No issues closed in this period ({emptyLabel}).
      </div>
    )
  }
  // Visual order 2-1-3; missing places are simply absent.
  const order = [1, 0, 2].filter((i) => top[i])
  return (
    <ol className="mx-auto flex max-w-md items-end justify-center gap-2 px-4 pb-4 sm:gap-4" aria-label="Top three">
      {order.map((i) => {
        const m = top[i]
        const tone = MEDAL[i]
        const Icon = tone.icon
        const p = m.periods[period]
        return (
          <li key={m.user_id} className="flex min-w-0 flex-1 flex-col items-center">
            <Icon size={i === 0 ? 20 : 16} className={tone.text} aria-hidden />
            <MemberAvatar
              name={m.name}
              email={m.email}
              avatarUrl={m.avatar_url}
              size={i === 0 ? 56 : 44}
              className={`mt-1 ring-2 ring-offset-2 ring-offset-card ${tone.ring}`}
            />
            <p className="mt-2 w-full truncate text-center text-[13px] font-medium">{memberLabel(m)}</p>
            <p className="text-[11px] tabular-nums text-muted-foreground">{formatNumber(p.completed)} closed</p>
            <div
              className={`mt-2 flex w-full items-center justify-center rounded-t-md border border-b-0 text-[15px] font-semibold tabular-nums ${tone.bar} ${tone.height}`}
              aria-label={`Rank ${p.rank}`}
            >
              {p.rank}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function LeaderChips({ board, period }: { board: Board; period: OverviewPeriodKey }) {
  const byId = useMemo(() => new Map(board.members.map((m) => [m.user_id, m])), [board.members])
  const leaders = board.leaders[period] ?? {}
  const chips = LEADER_CHIPS.flatMap((c) => {
    const l = leaders[c.metric]
    return l && l.user_ids.length ? [{ ...c, l }] : []
  })
  if (chips.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
      {chips.map(({ metric, label, fmt, l }) => {
        const who = l.user_ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []))
        return (
          <div key={metric} className="min-w-0 rounded-md bg-secondary/50 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              <Trophy size={11} className="shrink-0 text-amber-500" aria-hidden />
              <span className="truncate">{label}</span>
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="flex shrink-0 -space-x-1.5">
                {who.slice(0, 3).map((m) => (
                  <MemberAvatar key={m.user_id} name={m.name} email={m.email} avatarUrl={m.avatar_url} size={20} className="ring-2 ring-card" />
                ))}
              </span>
              <span className="min-w-0 truncate text-[12.5px] font-medium">
                {who.map(memberLabel).join(', ')}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{fmt(l.value)}</p>
          </div>
        )
      })}
    </div>
  )
}

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'created', label: 'Created', align: 'right' },
  { key: 'completed', label: 'Completed', align: 'right' },
  { key: 'open_assigned', label: 'Open', align: 'right' },
  { key: 'cycle', label: 'Avg cycle', align: 'right' },
  { key: 'comments', label: 'Comments', align: 'right' },
  { key: 'activity', label: 'Activity', align: 'right' },
  { key: 'trend', label: '12-week trend', align: 'right' },
]

function SortHeader({
  k,
  label,
  align,
  sort,
  onSort,
  className,
}: {
  k: SortKey
  label: string
  align: 'left' | 'right'
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sort.key === k
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'} ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 rounded uppercase tracking-wide ${focusRing} ${
          active ? 'text-foreground' : 'hover:text-foreground'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon size={11} className={active ? '' : 'opacity-40'} aria-hidden />
      </button>
    </th>
  )
}

function Lead({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {show ? <Trophy size={11} className="text-amber-500" aria-label="Leader" /> : null}
      {children}
    </span>
  )
}

export function Leaderboard({ board, rangeIsAll }: { board: Board; rangeIsAll: boolean }) {
  const periods = board.periods.filter((p) => !(rangeIsAll && p.key === 'range'))
  const [period, setPeriod] = useState<OverviewPeriodKey>(rangeIsAll ? 'all_time' : 'range')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'rank', dir: 'asc' })
  const meta = periods.find((p) => p.key === period) ?? periods[0]
  const active = meta?.key ?? period

  const rows = useMemo(() => sortMembers(board.members, active, sort.key, sort.dir), [board.members, active, sort])
  const leaders = board.leaders[active]

  function onSort(k: SortKey) {
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: defaultDir(k) }))
  }

  const chips = (
    <div
      role="group"
      aria-label="Leaderboard period"
      className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {periods.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={p.key === active}
          onClick={() => setPeriod(p.key)}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${focusRing} ${
            p.key === active
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )

  return (
    <Panel title="Leaderboard" subtitle="Ranked by issues completed" className="overflow-hidden">
      <div className="px-4 pb-3">{chips}</div>
      <Podium members={board.members} period={active} emptyLabel={meta?.label ?? ''} />
      <LeaderChips board={board} period={active} />

      {board.members.length === 0 ? (
        <p className="border-t border-border px-4 py-6 text-center text-[13px] text-muted-foreground">No members yet.</p>
      ) : (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
            <caption className="sr-only">Member leaderboard for {meta?.label}</caption>
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b border-border">
                <SortHeader k="rank" label="#" align="left" sort={sort} onSort={onSort} className="sticky left-0 z-10 w-12 min-w-12 bg-card" />
                <SortHeader k="name" label="Member" align="left" sort={sort} onSort={onSort} className="sticky left-12 z-10 min-w-[150px] bg-card" />
                {COLUMNS.map((c) => (
                  <SortHeader key={c.key} k={c.key} label={c.label} align={c.align} sort={sort} onSort={onSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const p = m.periods[active]
                const lead = (metric: LeaderMetric) => isLeader(leaders, metric, m.user_id)
                const cell = 'border-t border-border px-3 py-2 text-right tabular-nums'
                return (
                  <tr key={m.user_id} className="group">
                    <td className="sticky left-0 z-10 border-t border-border bg-card px-3 py-2 tabular-nums text-muted-foreground group-hover:bg-secondary">
                      {p.completed > 0 ? (
                        <span className={p.rank <= 3 ? 'font-semibold text-foreground' : ''}>{p.rank}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="sticky left-12 z-10 border-t border-border bg-card px-3 py-2 group-hover:bg-secondary">
                      <span className="flex items-center gap-2">
                        <MemberAvatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={22} />
                        <span className="max-w-[110px] truncate font-medium sm:max-w-[200px]">{memberLabel(m)}</span>
                      </span>
                    </td>
                    <td className={`${cell} group-hover:bg-secondary/60`}><Lead show={lead('created')}>{formatNumber(p.created)}</Lead></td>
                    <td className={`${cell} font-medium group-hover:bg-secondary/60`}><Lead show={lead('completed')}>{formatNumber(p.completed)}</Lead></td>
                    <td className={`${cell} group-hover:bg-secondary/60`}>{formatNumber(m.open_assigned)}</td>
                    <td className={`${cell} group-hover:bg-secondary/60`}><Lead show={lead('fastest_cycle')}>{formatHours(p.avg_cycle_time_hours)}</Lead></td>
                    <td className={`${cell} group-hover:bg-secondary/60`}><Lead show={lead('comments')}>{formatNumber(p.comments)}</Lead></td>
                    <td className={`${cell} group-hover:bg-secondary/60`}><Lead show={lead('activity')}>{formatNumber(p.activity)}</Lead></td>
                    <td className={`${cell} group-hover:bg-secondary/60`}>
                      <Sparkline values={m.spark} className="ml-auto block w-20" color="var(--chart-series-completed)" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
