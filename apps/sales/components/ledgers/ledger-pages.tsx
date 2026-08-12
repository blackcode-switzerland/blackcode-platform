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
import { useSearchParams } from 'next/navigation'
import { Video } from 'lucide-react'
import { CHANNELS, COMM_DIRECTIONS, MEETING_STATUSES, commDirectionLabel } from '@/lib/pipeline'
import { ChannelChip, MeetingTypeChip, VocabDot } from '@/components/chips'
import { BlockSkeleton, ErrorState } from '@/components/states'
import {
  ClearFilters,
  FilterBar,
  FilterSelect,
  FilteredEmpty,
  useFilterParam,
} from '@/components/filters'
import { WriteGate } from '@/components/forms'
import { MeetingForm, RemoveCommunicationButton } from './ledger-forms'
import { useCanWrite } from '@/lib/ui-mode'
import { useCommunications, useMeetings, useProspects } from '@/lib/hooks'
import { dateTimeShort } from '@/lib/format'
import { meetingStatusColor } from '@/lib/pipeline'

/**
 * Every prospect as a picker option, by #number.
 *
 * The ledgers filter by prospect #number — that is what the route takes — so
 * the option VALUE is the number as a string and the label is the company. It
 * reads the same `['prospects', ws, …]` cache entry the Prospects page fills,
 * so opening a ledger after the listing costs no request.
 */
function useProspectOptions(ws: string) {
  const prospects = useProspects(ws)
  return useMemo(
    () =>
      (prospects.data?.data ?? []).map((p) => ({ value: String(p.number), label: p.name })),
    [prospects.data]
  )
}

/** A row the URL asked to focus: highlighted, and scrolled into view once. */
function useFocus(focus: number | null) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus != null) ref.current?.scrollIntoView({ block: 'center' })
  }, [focus])
  return ref
}

export function MeetingsPage({ ws }: { ws: string }) {
  const [status, setStatus] = useFilterParam('status')
  const [prospect, setProspect] = useFilterParam('prospect')
  const params = useSearchParams()
  const focus = params?.get('focus') ? Number(params.get('focus')) : null
  const focusRef = useFocus(focus)
  const canWrite = useCanWrite(ws)
  const prospectOptions = useProspectOptions(ws)

  const meetings = useMeetings(ws, {
    status: status || undefined,
    prospect: prospect ? Number(prospect) : undefined,
  })
  const filtered = Boolean(status || prospect)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar>
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={MEETING_STATUSES}
            allLabel="All meetings"
          />
          <FilterSelect
            label="Prospect"
            value={prospect}
            onChange={setProspect}
            options={prospectOptions}
            allLabel="All prospects"
          />
          {/* `focus` is kept: arriving from ⌘K at one meeting and then
              narrowing the list should not silently discard which row you
              came for. */}
          <ClearFilters active={filtered} keep={['focus']} />
        </FilterBar>
        {/*
          NO "record a meeting" BUTTON HERE, and the reason is the route rather
          than the mode: a meeting always belongs to one deal, and this page is
          cross-prospect. A form here would need a prospect picker — which is
          the prospect page, one click away and already open in the case where
          somebody is recording one. The prospect's Meetings tab has the form.
        */}
        <WriteGate ws={ws} note="Meetings are maintained by the agent.">
          <p className="text-xs text-muted-foreground">
            Record a meeting from the prospect it belongs to.
          </p>
        </WriteGate>
      </div>

      {meetings.isPending ? (
        <BlockSkeleton rows={5} />
      ) : meetings.error ? (
        <ErrorState error={meetings.error} />
      ) : meetings.data.length === 0 ? (
        <FilteredEmpty
          filtered={filtered}
          noun="meetings"
          emptyTitle="No meetings"
          emptyHint="A meeting appears here when the agent records one."
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
              <MeetingLink url={m.meeting_url} />
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

/**
 * The join link, when there is one — and NOTHING at all when there is not.
 *
 * Most rows in this ledger are phone calls and in-person meetings. A "Link: —"
 * line on every one of them is noise that makes the rows which DO carry a link
 * harder to find, which is the opposite of what the field is for. So the
 * absence renders as absence.
 *
 * `rel="noopener noreferrer"` is not boilerplate here: this URL was typed by
 * one member of a workspace and is clicked by another, so the tab it opens must
 * not get a handle on this one. The route additionally refuses any scheme that
 * is not http(s), which is what keeps `javascript:` out of this href.
 */
export function MeetingLink({ url }: { url: string | null }) {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-xs text-primary hover:underline"
    >
      <Video size={12} className="shrink-0" aria-hidden />
      <span className="truncate">Join the meeting</span>
    </a>
  )
}

export function CommunicationsPage({ ws }: { ws: string }) {
  const [channel, setChannel] = useFilterParam('channel')
  const [dir, setDir] = useFilterParam('dir')
  const [prospect, setProspect] = useFilterParam('prospect')
  const params = useSearchParams()
  const focus = params?.get('focus') ? Number(params.get('focus')) : null
  const focusRef = useFocus(focus)
  const canWrite = useCanWrite(ws)
  const prospectOptions = useProspectOptions(ws)

  const comms = useCommunications(ws, {
    channel: channel || undefined,
    dir: dir || undefined,
    prospect: prospect ? Number(prospect) : undefined,
  })
  const filtered = Boolean(channel || dir || prospect)

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
        <FilterBar>
          <FilterSelect
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={CHANNELS}
            allLabel="All channels"
          />
          {/* Sent / Received — the user's words. The vocabulary labels them,
              never this page: `lib/pipeline.ts` is the one place that maps
              `out` to a phrase, and the row below reads the same helper, so
              the filter and the rows cannot disagree about what `out` is
              called. */}
          <FilterSelect
            label="Direction"
            value={dir}
            onChange={setDir}
            options={COMM_DIRECTIONS}
            allLabel="Sent and received"
          />
          <FilterSelect
            label="Prospect"
            value={prospect}
            onChange={setProspect}
            options={prospectOptions}
            allLabel="All prospects"
          />
          <ClearFilters active={filtered} keep={['focus']} />
        </FilterBar>
        {/* Logging, like recording a meeting, belongs to a deal — the form is on
            the prospect's Communications tab. */}
        <WriteGate ws={ws} note="Exchanges are logged by the agent.">
          <p className="text-xs text-muted-foreground">
            Log an exchange from the prospect it is with.
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
        <FilteredEmpty
          filtered={filtered}
          noun="exchanges"
          emptyTitle="No exchanges logged"
          // "Every email, WhatsApp, call and internal note …" until 2026-08-11,
          // which spelled four of the six values of the `channels` vocabulary
          // into prose. That vocabulary is `lib/pipeline.ts`'s, served live by
          // `bk meta`, and it can gain a channel without a deploy — at which
          // point this sentence is a list that silently stops being "every".
          // The same reasoning `labelOf`'s header sets out for the third time.
          emptyHint="Every exchange the agent records appears here, whichever channel it came through."
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
                {/* `commDirectionLabel`, not a ternary on the raw value. The
                    ternary that was here read `out` and `in` directly and
                    rendered "we → them" / "them → us" — a THIRD wording of a
                    vocabulary `lib/pipeline.ts` already labels, and one that
                    silently called every unrecognised direction "them → us"
                    because it was the else branch. `bk meta` can add a
                    direction without a deploy. */}
                <span className="text-xs text-muted-foreground">
                  {commDirectionLabel(c.direction)}
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
