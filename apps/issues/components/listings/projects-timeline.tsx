'use client'

import Link from 'next/link'
import { addDays, differenceInDays, format, max as maxDate, min as minDate, startOfDay } from 'date-fns'
import { projectStatusColor } from '@/lib/work-items'
import { ProjectIcon } from '../project-icon'
import { HealthIcon, StatusIcon } from '@/components/ui/work-item-icons'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'

interface ProjectRow {
  /** Uploaded logo; replaces the icon+color tile when set. */
  icon_url?: string | null
  id: number
  seq: number | null
  name: string
  status: string
  color: string | null
  icon: string | null
  start_date: string | null
  due_date: string | null
  created_at: string
  health: string | null
  lead_name: string | null
  lead_email: string | null
  lead_avatar: string | null
  issue_count: number
  open_issues: number
}

const ROW_HEIGHT = 48
const HEADER_HEIGHT = 44
const DAY_WIDTH = 26
const LABEL_WIDTH = 260

export function ProjectsTimeline({ projects, wsSlug }: { projects: ProjectRow[]; wsSlug: string }) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/30 p-16 text-center">
        <p className="text-sm text-muted-foreground">No projects to chart.</p>
      </div>
    )
  }

  const today = startOfDay(new Date())
  const ranges = projects.map((p) => range(p, today))

  // Pad 4 weeks before earliest and 8 weeks after latest for context
  const earliest = addDays(startOfDay(minDate(ranges.map((r) => r.start))), -28)
  const latest = addDays(startOfDay(maxDate(ranges.map((r) => r.end))), 56)
  const totalDays = Math.max(differenceInDays(latest, earliest) + 1, 90)
  const timelineWidth = totalDays * DAY_WIDTH

  // Week ticks (every 7 days from day 0) for grid lines and date labels
  const weekTicks: number[] = []
  for (let d = 0; d < totalDays; d += 7) weekTicks.push(d)

  // Month markers: first day of each calendar month visible in range
  const monthMarkers: Array<{ day: number; label: string }> = []
  for (let d = 0; d < totalDays; d++) {
    const date = addDays(earliest, d)
    if (date.getDate() === 1) {
      const isNewYear = date.getMonth() === 0
      monthMarkers.push({ day: d, label: format(date, isNewYear ? 'MMM yyyy' : 'MMM') })
    }
  }
  // If no month marker in the first ~31 days, insert one at day 0
  if (monthMarkers.length === 0 || monthMarkers[0].day > 14) {
    monthMarkers.unshift({ day: 0, label: format(earliest, 'MMM yyyy') })
  }

  const todayOffset = differenceInDays(today, earliest)

  return (
    <div className="rounded-lg border border-border bg-card/30">
      {/* outer wrapper: flex so left panel and timeline panel sit side by side */}
      <div className="flex overflow-hidden">

        {/* ── LEFT PANEL (sticky, no horizontal scroll) ── */}
        <div className="shrink-0 z-20" style={{ width: LABEL_WIDTH }}>
          {/* Header cell */}
          <div
            className="sticky top-0 z-20 flex items-center border-b border-r border-border bg-card/80 px-3 backdrop-blur"
            style={{ height: HEADER_HEIGHT }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Project
            </span>
          </div>

          {/* Project rows */}
          {projects.map((p) => {
            const total = p.issue_count ?? 0
            const done = total - (p.open_issues ?? 0)
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <Link
                key={p.id}
                href={`/dashboard/${wsSlug}/projects/${p.seq ?? p.id}`}
                prefetch={false}
                className="flex items-center gap-2.5 border-b border-r border-border/60 px-3 transition-colors hover:bg-secondary/30"
                style={{ height: ROW_HEIGHT }}
              >
                <ProjectIcon icon={p.icon} iconUrl={p.icon_url} color={p.color} name={p.name} size={20} />
                <span className="flex-1 truncate text-[13px] font-medium">{p.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                  <StatusIcon status={p.status} size={11} />
                  {p.health ? <HealthIcon status={p.health} size={11} /> : null}
                  {p.lead_email ? (
                    <MemberAvatar
                      name={p.lead_name}
                      email={p.lead_email}
                      avatarUrl={p.lead_avatar}
                      size={16}
                    />
                  ) : (
                    <span className="size-4 rounded-full border border-dashed border-muted-foreground/30" />
                  )}
                </span>
                <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </Link>
            )
          })}
        </div>

        {/* ── RIGHT PANEL (scrolls horizontally) ── */}
        <div className="flex-1 overflow-x-auto">
          <div style={{ width: timelineWidth }}>

            {/* Date header — two rows: months (top) + dates (bottom) */}
            <div
              className="sticky top-0 z-10 relative overflow-hidden border-b border-border bg-card/90 backdrop-blur"
              style={{ height: HEADER_HEIGHT }}
            >
              {/* Month row — top half */}
              <div className="relative border-b border-border/40" style={{ height: HEADER_HEIGHT / 2 }}>
                {monthMarkers.map((m) => (
                  <span
                    key={m.day}
                    className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/80"
                    style={{ left: m.day * DAY_WIDTH }}
                  >
                    {m.label}
                  </span>
                ))}
                {/* Month boundary lines */}
                {monthMarkers.map((m) => (
                  <div
                    key={`ml-${m.day}`}
                    className="absolute top-0 h-full w-px bg-border/60"
                    style={{ left: m.day * DAY_WIDTH }}
                  />
                ))}
              </div>

              {/* Date row — bottom half */}
              <div className="relative" style={{ height: HEADER_HEIGHT / 2 }}>
                {weekTicks.map((d) => {
                  const date = addDays(earliest, d)
                  return (
                    <span
                      key={d}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[9px] text-muted-foreground"
                      style={{ left: d * DAY_WIDTH }}
                    >
                      {format(date, 'd')}
                    </span>
                  )
                })}
                {/* Week tick lines */}
                {weekTicks.map((d) => (
                  <div
                    key={`wl-${d}`}
                    className="absolute top-0 h-full w-px bg-border/20"
                    style={{ left: d * DAY_WIDTH }}
                  />
                ))}
                {/* Today pip in date row */}
                {todayOffset >= 0 && todayOffset < totalDays ? (
                  <div
                    className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm bg-primary px-1 py-px text-[9px] font-bold text-primary-foreground"
                    style={{ left: todayOffset * DAY_WIDTH }}
                  >
                    {format(today, 'd')}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Timeline rows */}
            {projects.map((p, idx) => {
              const r = ranges[idx]
              const left = differenceInDays(r.start, earliest) * DAY_WIDTH
              const width = Math.max((differenceInDays(r.end, r.start) + 1) * DAY_WIDTH - 4, 16)
              const barColor = p.color ?? projectStatusColor(p.status)
              return (
                <div
                  key={p.id}
                  className="relative border-b border-border/40 hover:bg-secondary/10"
                  style={{ height: ROW_HEIGHT }}
                >
                  {/* Grid lines — week + month */}
                  {weekTicks.map((d) => (
                    <div
                      key={d}
                      className="absolute top-0 h-full border-l border-border/10"
                      style={{ left: d * DAY_WIDTH }}
                    />
                  ))}
                  {monthMarkers.map((m) => (
                    <div
                      key={`mg-${m.day}`}
                      className="absolute top-0 h-full border-l border-border/30"
                      style={{ left: m.day * DAY_WIDTH }}
                    />
                  ))}
                  {/* Today line */}
                  {todayOffset >= 0 && todayOffset < totalDays ? (
                    <div
                      className="absolute top-0 h-full w-px bg-primary/30"
                      style={{ left: todayOffset * DAY_WIDTH }}
                    />
                  ) : null}
                  {/* Bar */}
                  <Link
                    href={`/dashboard/${wsSlug}/projects/${p.seq ?? p.id}`}
                    prefetch={false}
                    className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium shadow-sm transition-opacity hover:opacity-90"
                    style={{
                      left,
                      width,
                      height: 26,
                      backgroundColor: barColor + '28',
                      border: `1px solid ${barColor}70`,
                      color: barColor,
                      overflow: 'hidden',
                    }}
                    title={`${p.name} — ${format(r.start, 'MMM d')} → ${format(r.end, 'MMM d')}`}
                  >
                    <span className="truncate">{p.name}</span>
                  </Link>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

function range(p: ProjectRow, today: Date): { start: Date; end: Date } {
  const start = p.start_date
    ? startOfDay(new Date(p.start_date))
    : startOfDay(new Date(p.created_at))
  const end = p.due_date ? startOfDay(new Date(p.due_date)) : addDays(start, 14)
  return { start, end: end.getTime() < start.getTime() ? start : end }
}
