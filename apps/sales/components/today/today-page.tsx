'use client'

// Today — the landing page, and the one the doctrine is easiest to break on.
//
// ── WHAT IS NOT HERE, STATED FIRST BECAUSE IT KEEPS COMING BACK ────────────
// **No AI or approval UI whatsoever** (§1.2 rule 1, §8.2). No "approve", no
// "send", no "generate", no chat box. The mockup shipped an approval strip on
// this exact page twice by accident and removed it twice, and the two
// screenshots that differ — `bs-today.png` and `bs-today-no-approvals.png` — are
// the record of it: the earlier one has a KPI reading "2 awaiting approval" and
// queue rows whose right-hand label is "EN ATTENTE D'APPROBATION". The corrected
// one replaces that KPI with upcoming meetings and the row labels with the
// action the owner actually owes. **This page is built from the corrected one.**
//
// Everything below is a record of something that already happened, written by an
// agent through `bk sales`. A row is a link to a prospect, never a control.
//
// ── FOUR BLOCKS, AND THE THIRD IS ITS OWN BLOCK ON PURPOSE ─────────────────
//   1. the greeting — who, when, and how much is owed
//   2. the KPI strip
//   3. **upcoming meetings, across every prospect** (§8.2). Not folded into a
//      deal's card: "who am I seeing this week" is a question about the week,
//      and a reader who has to open four prospects to answer it has been given a
//      worse version of a calendar.
//   4. the pipeline queue — what is due, oldest first, overdue included
//
// ── OVERDUE IS SHOWN, NEVER DROPPED ────────────────────────────────────────
// `today` returns actions due on or before today with an `overdue` flag, and the
// flag is rendered rather than filtered. A follow-up queue that quietly loses
// what was missed yesterday is the one thing a follow-up queue must not do.

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { CalendarClock, ArrowUpRight } from 'lucide-react'
import { StageChip, MeetingTypeChip, NextActionChip } from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { useProspectsByNumber, useToday, useUpcomingMeetings } from '@/lib/hooks'
import { dateTimeShort, firstName, longDate, money, relativeDay } from '@/lib/format'
import type { DueAction } from '@/lib/db/queries/aggregates'

export function TodayPage({ ws }: { ws: string }) {
  const { data: session } = useSession()
  const today = useToday(ws)
  const upcoming = useUpcomingMeetings(ws)
  const prospects = useProspectsByNumber(ws)

  const queue = today.data?.due_actions ?? []
  const name = firstName(session?.user?.name, session?.user?.email)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* 1 — the greeting. The date comes from the ANSWER, not from the
          browser: `today.date` is the day the server computed for, and a header
          that said "Monday" over Sunday's numbers would be a lie nobody could
          see. Falls back to the local day only while the answer is in flight. */}
      <section className="rounded-2xl border border-border bg-card px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Today</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Hello, {name}
          {today.data ? ` — ${queue.length} ${queue.length === 1 ? 'action' : 'actions'} queued` : ''}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {longDate(today.data?.date ?? new Date())}
        </p>
      </section>

      {/* 2 — the KPI strip. Four numbers, and the fourth is UPCOMING MEETINGS,
          which is what the corrected mockup put where the approval count had
          been. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          value={today.data ? String(today.data.counts.due_today) : null}
          label="Due today"
        />
        <Kpi
          value={today.data ? String(today.data.counts.overdue) : null}
          label="Overdue"
          // The one number worth a colour: it is the only one that is a problem
          // rather than a fact. Zero stays neutral so a clean queue does not
          // read as an alert.
          tone={today.data && today.data.counts.overdue > 0 ? 'warn' : 'plain'}
        />
        <Kpi
          value={today.data ? String(today.data.counts.meetings_today) : null}
          label="Meetings today"
        />
        <Kpi value={upcoming.data ? String(upcoming.data.total) : null} label="Upcoming meetings" />
      </section>

      {/* 3 — upcoming meetings, across every prospect */}
      <section>
        <SectionHeading icon={<CalendarClock size={14} />} title="Upcoming meetings" />
        {upcoming.isPending ? (
          <BlockSkeleton rows={3} />
        ) : upcoming.error ? (
          <ErrorState error={upcoming.error} />
        ) : upcoming.data.meetings.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            hint="Meetings appear here when the agent records one."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {upcoming.data.meetings.map((m, i) => (
              <Link
                key={m.number}
                href={`/dashboard/${ws}/prospects/${m.prospect_number}`}
                className={
                  'flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent ' +
                  (i > 0 ? 'border-t border-border' : '')
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {m.prospect_name} · {m.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {dateTimeShort(m.starts_at)}
                    {m.attendees.length > 0 && ` · ${m.attendees.join(', ')}`}
                  </span>
                </span>
                <MeetingTypeChip value={m.type} />
              </Link>
            ))}
            {upcoming.data.has_more && (
              // Not decoration. The route pages at 100 and orders newest-first,
              // so a workspace with more upcoming meetings than that would be
              // shown a block missing the nearest ones. Saying so beats a
              // silently short list — CLAUDE.md's rule about caps that read as
              // coverage.
              <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                More upcoming meetings exist than this block can load — see the
                Meetings ledger.
              </p>
            )}
          </div>
        )}
      </section>

      {/* 4 — the pipeline queue */}
      <section>
        <SectionHeading title="Pipeline queue" />
        {today.isPending ? (
          <BlockSkeleton rows={4} />
        ) : today.error ? (
          <ErrorState error={today.error} />
        ) : queue.length === 0 ? (
          <EmptyState
            title="Nothing due"
            hint="A prospect appears here when the agent sets a next action with a due date."
          />
        ) : (
          <div className="space-y-2">
            {queue.map((a, i) => (
              <QueueRow
                key={a.number}
                ws={ws}
                rank={i + 1}
                action={a}
                value={prospects.data?.get(a.number)?.value ?? null}
                currency={prospects.data?.get(a.number)?.currency ?? 'CHF'}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SectionHeading({ title, icon }: { title: string; icon?: React.ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {title}
    </h3>
  )
}

function Kpi({
  value,
  label,
  tone = 'plain',
}: {
  value: string | null
  label: string
  tone?: 'plain' | 'warn'
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      {value == null ? (
        <span className="block h-7 w-10 animate-pulse rounded bg-muted" />
      ) : (
        <span
          className={
            'block text-2xl font-semibold tracking-tight ' +
            (tone === 'warn' ? 'text-destructive' : 'text-foreground')
          }
        >
          {value}
        </span>
      )}
      <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

/**
 * One queued action.
 *
 * The whole row is a link to the prospect — the only thing this page can do is
 * take you to the record. There is no button, no menu and no inline edit, which
 * is D-7's read-only default and rule 1 of the doctrine arriving at the same
 * answer from two directions.
 */
function QueueRow({
  ws,
  rank,
  action,
  value,
  currency,
}: {
  ws: string
  rank: number
  action: DueAction
  value: string | null
  currency: string
}) {
  return (
    <Link
      href={`/dashboard/${ws}/prospects/${action.number}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{action.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={action.overdue ? 'font-medium text-destructive' : ''}>
            {/*
              The agent's own phrasing wins — `due_label` is what somebody wrote
              ("before the board meeting"), `due` is the date — but ONLY while it
              is still true.
              `due_label` is a snapshot of how the date read when it was written,
              so an action written last week says "Today" forever. Rendering that
              beside an overdue flag puts two contradictory facts in one row and
              lets the reader pick; the stored string is the one that has gone
              stale, so past the due date the computed phrase replaces it. Seen
              on the seeded database: five actions labelled "Today" and "This
              week", all of them nine days old.
            */}
            {action.overdue ? relativeDay(action.due) : (action.due_label ?? relativeDay(action.due))}
          </span>
          {action.note && <span className="truncate">· {action.note}</span>}
          {value && <span>· {money(value, currency)}</span>}
        </span>
      </span>
      <StageChip value={action.stage} />
      {action.action_type && <NextActionChip value={action.action_type} />}
      <ArrowUpRight
        size={15}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  )
}
