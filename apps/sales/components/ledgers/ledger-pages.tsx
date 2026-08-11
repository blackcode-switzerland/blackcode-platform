'use client'

// The two cross-prospect ledgers: Meetings and Communications.
//
// ── A LEDGER, NOT A CALENDAR (§1.2 rule 4) ─────────────────────────────────
// No month grid, no week view, no drag-to-reschedule. Meetings are a record of
// what was discussed and what is scheduled, ordered by time, and the OUTCOME is
// the column a calendar does not have. The mockup's framing is "synced from
// Google Calendar" — this app records that a meeting happened; it does not own
// the calendar.
//
// ── MULTI-CHANNEL IS FIRST CLASS (§1.2 rule 3) ─────────────────────────────
// Communications is not an email log with extras. The channel filter is built
// from `lib/pipeline.ts`'s vocabulary, so WhatsApp, calls, notes and discovery
// sweeps are peers of email rather than special cases of it — and the per-
// channel counts across the top are the "3 emails, 2 WhatsApp, 1 call" the
// doctrine asks for at a glance.
//
// ── `?focus=` ───────────────────────────────────────────────────────────────
// Both pages accept a `focus` number, which is what ⌘K and the triangulation
// block navigate with: the row is highlighted and scrolled to rather than opened
// on a page of its own. Neither entity has a detail page and neither needs one —
// the row IS the record.

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { CHANNELS, MEETING_STATUSES } from '@/lib/pipeline'
import { ChannelChip, MeetingTypeChip, VocabDot } from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { WriteGate } from '@/components/forms'
import { MeetingForm, RemoveCommunicationButton } from './ledger-forms'
import { useCanWrite } from '@/lib/ui-mode'
import { useCommunications, useMeetings } from '@/lib/hooks'
import { dateTimeShort } from '@/lib/format'
import { meetingStatusColor } from '@/lib/pipeline'

/** A row the URL asked to focus: highlighted, and scrolled into view once. */
function useFocus(focus: number | null) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus != null) ref.current?.scrollIntoView({ block: 'center' })
  }, [focus])
  return ref
}

function FilterBar({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  allLabel: string
}) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {(value || params?.get('focus')) && (
        <button
          onClick={() => router.replace(pathname ?? '', { scroll: false })}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
          Clear
        </button>
      )}
    </div>
  )
}

function useParam(key: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const set = (v: string) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    if (v) next.set(key, v)
    else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  return [params?.get(key) ?? '', set] as const
}

export function MeetingsPage({ ws }: { ws: string }) {
  const [status, setStatus] = useParam('status')
  const params = useSearchParams()
  const focus = params?.get('focus') ? Number(params.get('focus')) : null
  const focusRef = useFocus(focus)
  const canWrite = useCanWrite(ws)

  const meetings = useMeetings(ws, { status: status || undefined })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar
          value={status}
          onChange={setStatus}
          options={MEETING_STATUSES}
          allLabel="All meetings"
        />
        {/*
          NO "record a meeting" BUTTON HERE, and the reason is the route rather
          than the mode: a meeting always belongs to one deal, and this page is
          cross-prospect. A form here would need a prospect picker — which is
          the prospect page, one click away and already open in the case where
          somebody is recording one. The prospect's Meetings tab has the form.
        */}
        <WriteGate
          ws={ws}
          note="Meetings are recorded with `bk sales meeting schedule | log | outcome`."
        >
          <p className="text-xs text-muted-foreground">
            Record a meeting from the prospect it belongs to, or with{' '}
            <code className="rounded bg-muted px-1 py-0.5">bk sales meeting schedule</code>.
          </p>
        </WriteGate>
      </div>

      {meetings.isPending ? (
        <BlockSkeleton rows={5} />
      ) : meetings.error ? (
        <ErrorState error={meetings.error} />
      ) : meetings.data.length === 0 ? (
        <EmptyState
          title="No meetings"
          hint="A meeting appears here when the agent records one with `bk sales meeting schedule` or `meeting log`."
        />
      ) : (
        <div className="space-y-2">
          {meetings.data.map((m) => (
            <div
              key={m.number}
              ref={m.number === focus ? focusRef : undefined}
              className={
                'rounded-xl border bg-card px-4 py-3 ' +
                (m.number === focus ? 'border-primary' : 'border-border')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <VocabDot color={meetingStatusColor(m.status)} title={m.status} />
                <Link
                  href={`/dashboard/${ws}/prospects/${m.prospect_number}`}
                  className="text-sm font-medium text-foreground hover:underline"
                >
                  {m.prospect_name}
                </Link>
                <span className="text-sm text-muted-foreground">· {m.title}</span>
                <MeetingTypeChip value={m.type} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {dateTimeShort(m.starts_at)}
                  {m.duration_min ? ` · ${m.duration_min} min` : ''}
                </span>
                {canWrite && <MeetingForm ws={ws} meeting={m} />}
              </div>
              {m.attendees.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">{m.attendees.join(', ')}</p>
              )}
              {m.agenda && <p className="mt-1.5 text-sm text-foreground">{m.agenda}</p>}
              {m.outcome && (
                <p className="mt-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                  {m.outcome}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CommunicationsPage({ ws }: { ws: string }) {
  const [channel, setChannel] = useParam('channel')
  const params = useSearchParams()
  const focus = params?.get('focus') ? Number(params.get('focus')) : null
  const focusRef = useFocus(focus)
  const canWrite = useCanWrite(ws)

  const comms = useCommunications(ws, { channel: channel || undefined })

  // "3 emails, 2 WhatsApp, 1 call" at a glance — rule 3, counted over whatever
  // the current filter returned rather than fetched separately, so the strip
  // cannot disagree with the list under it.
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of comms.data ?? []) map.set(c.channel, (map.get(c.channel) ?? 0) + 1)
    return CHANNELS.filter((ch) => map.has(ch.value)).map((ch) => ({
      ...ch,
      count: map.get(ch.value)!,
    }))
  }, [comms.data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar
          value={channel}
          onChange={setChannel}
          options={CHANNELS}
          allLabel="All channels"
        />
        {/* Logging, like recording a meeting, belongs to a deal — the form is on
            the prospect's Communications tab. */}
        <WriteGate ws={ws} note="Exchanges are logged with `bk sales comm log`.">
          <p className="text-xs text-muted-foreground">
            Log an exchange from the prospect it is with, or with{' '}
            <code className="rounded bg-muted px-1 py-0.5">bk sales comm log</code>.
          </p>
        </WriteGate>
      </div>

      {counts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {counts.map((c) => (
            <span key={c.value} className="flex items-center gap-1.5">
              <VocabDot color={c.color} />
              {/*
                The label EXACTLY as `lib/pipeline.ts` authors it, uninflected.
                Appending an "s" produced "3 whatsapps", and the general problem
                is worse than the typo: the vocabulary is served live by
                `bk meta` and can gain a value without a deploy, so this page
                cannot know how to pluralise a label it has never seen. A legend
                does not need to — "3 WhatsApp" is how a legend reads.
              */}
              {c.count} {c.label}
            </span>
          ))}
        </div>
      )}

      {comms.isPending ? (
        <BlockSkeleton rows={5} />
      ) : comms.error ? (
        <ErrorState error={comms.error} />
      ) : comms.data.length === 0 ? (
        <EmptyState
          title="No exchanges logged"
          // "Every email, WhatsApp, call and internal note …" until 2026-08-11,
          // which spelled four of the six values of the `channels` vocabulary
          // into prose. That vocabulary is `lib/pipeline.ts`'s, served live by
          // `bk meta`, and it can gain a channel without a deploy — at which
          // point this sentence is a list that silently stops being "every".
          // The same reasoning `labelOf`'s header sets out for the third time.
          hint="Every exchange the agent records with `bk sales comm log` appears here, whichever channel it came through."
        />
      ) : (
        <div className="space-y-2">
          {comms.data.map((c) => (
            <div
              key={c.number}
              ref={c.number === focus ? focusRef : undefined}
              className={
                'rounded-xl border bg-card px-4 py-3 ' +
                (c.number === focus ? 'border-primary' : 'border-border')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <ChannelChip value={c.channel} />
                <Link
                  href={`/dashboard/${ws}/prospects/${c.prospect_number}`}
                  className="text-sm font-medium text-foreground hover:underline"
                >
                  {c.prospect_name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {c.direction === 'out' ? 'we → them' : 'them → us'}
                </span>
                {c.contact && <span className="text-xs text-muted-foreground">· {c.contact}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {dateTimeShort(c.occurred_at)}
                </span>
                {canWrite && <RemoveCommunicationButton ws={ws} comm={c} />}
              </div>
              {c.subject && (
                <p className="mt-1.5 text-sm font-medium text-foreground">{c.subject}</p>
              )}
              {c.body && (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {c.body}
                </p>
              )}
              {c.logged_by && (
                <p className="mt-1 text-xs text-muted-foreground">logged by {c.logged_by}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
