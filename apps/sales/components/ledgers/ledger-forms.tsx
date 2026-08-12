'use client'

// Writing to the two ledgers, in `full` mode.
//
// Meetings and communications are the clearest case for §4a's line: a person who
// was on the call knows what it turned into, and the agent does not until
// somebody tells it. So both are writable — and both remain records of something
// that already happened rather than a way to make something happen.
//
// **The app still does not SEND anything** (`docs/backend.md` §1). "Log an
// exchange" records that a message went, by whatever means it actually went.
// There is no compose, no send, no "email this template", and adding one is a
// different product.

import { useState } from 'react'
import {
  CHANNELS,
  COMM_DIRECTIONS,
  MEETING_STATUSES,
  MEETING_TYPES,
} from '@/lib/pipeline'
import {
  ConfirmDelete,
  Disclosure,
  Field,
  FormActions,
  TextArea,
  TextInput,
  VocabSelect,
} from '@/components/forms'
import {
  useEditMeeting,
  useLogCommunication,
  useRemoveCommunication,
  useRemoveMeeting,
  useScheduleMeeting,
} from '@/lib/mutations'
import type { Communication, Meeting } from '@/lib/hooks'

/**
 * `datetime-local` gives `2026-08-07T14:30` and the routes want something
 * `new Date()` accepts as an instant. Appending nothing would leave it
 * ambiguous, so the browser's own offset is applied here: a meeting typed as
 * 14:30 is 14:30 where the person typing it is.
 */
function toIso(local: string): string {
  return local ? new Date(local).toISOString() : ''
}

/** The inverse, for seeding an edit form. */
function toLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function MeetingForm({
  ws,
  prospect,
  meeting,
}: {
  ws: string
  /** Required when creating: a meeting always belongs to one deal. */
  prospect?: number
  meeting?: Meeting
}) {
  return (
    <Disclosure
      label={meeting ? 'Edit' : 'Record a meeting'}
      icon={meeting ? 'pencil' : 'plus'}
    >
      {(close) => <MeetingFields ws={ws} prospect={prospect} meeting={meeting} close={close} />}
    </Disclosure>
  )
}

function MeetingFields({
  ws,
  prospect,
  meeting,
  close,
}: {
  ws: string
  prospect?: number
  meeting?: Meeting
  close: () => void
}) {
  const create = useScheduleMeeting(ws)
  const edit = useEditMeeting(ws, meeting?.number ?? 0)
  const remove = useRemoveMeeting(ws)
  const [confirming, setConfirming] = useState(false)

  const [form, setForm] = useState({
    title: meeting?.title ?? '',
    type: meeting?.type ?? 'video',
    at: toLocal(meeting?.starts_at),
    duration: meeting?.duration_min != null ? String(meeting.duration_min) : '',
    attendees: (meeting?.attendees ?? []).join(', '),
    agenda: meeting?.agenda ?? '',
    outcome: meeting?.outcome ?? '',
    status: meeting?.status ?? '',
    meeting_url: meeting?.meeting_url ?? '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (confirming && meeting) {
    return (
      <ConfirmDelete
        target={meeting.title}
        targetLabel="meeting title"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={(confirm) =>
          remove.mutate({ number: meeting.number, confirm }, { onSuccess: close })
        }
      />
    )
  }

  const attendees = form.attendees
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <TextInput value={form.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Type">
          <VocabSelect
            label="Type"
            options={MEETING_TYPES}
            value={form.type}
            onChange={(v) => set('type', v)}
          />
        </Field>
        <Field label="When">
          <TextInput
            type="datetime-local"
            value={form.at}
            onChange={(e) => set('at', e.target.value)}
          />
        </Field>
        <Field label="Duration (minutes)">
          <TextInput
            value={form.duration}
            inputMode="numeric"
            onChange={(e) => set('duration', e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Attendees" hint="Comma separated.">
          <TextInput value={form.attendees} onChange={(e) => set('attendees', e.target.value)} />
        </Field>
        {/*
          Offered on EVERY meeting type, not just `video`. A room with a dial-in
          bridge is both in-person and online, and hiding the field behind the
          type would mean somebody who picked "call" first has to work out why
          the box disappeared. The field is optional; most rows leave it empty.

          Clearing the box CLEARS the link: `|| null` below sends JSON null,
          which the PATCH route reads as "remove it" (`nullableStr`). A form
          that could only ever set one would leave a stale Teams link on a
          meeting that moved to a phone call.
        */}
        <Field
          label="Meeting link"
          hint="Teams, Meet, Zoom, an internal room — whatever an attendee opens. Leave empty for a call or an in-person meeting."
        >
          <TextInput
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={form.meeting_url}
            onChange={(e) => set('meeting_url', e.target.value)}
          />
        </Field>
        <Field label="Agenda">
          <TextArea value={form.agenda} onChange={(e) => set('agenda', e.target.value)} />
        </Field>
        <Field
          label="Outcome"
          hint="Writing an outcome means the meeting happened — the route moves the status for you, which is why there is no status field beside it."
        >
          <TextArea value={form.outcome} onChange={(e) => set('outcome', e.target.value)} />
        </Field>
        {/*
          STATUS is offered only on an EDIT, and only for cancelling. On a
          create the route derives it (outcome ⇒ done, otherwise upcoming), and
          a field that could disagree with the outcome beside it is how a
          meeting ends up `upcoming` with a write-up on it.
        */}
        {meeting && (
          <Field label="Status">
            <VocabSelect
              label="Status"
              options={MEETING_STATUSES}
              value={form.status}
              onChange={(v) => set('status', v)}
            />
          </Field>
        )}
      </div>
      <div className="flex items-center justify-between">
        {meeting ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            Bin it
          </button>
        ) : (
          <span />
        )}
        <FormActions
          submitLabel={meeting ? 'Save' : 'Record'}
          pending={create.isPending || edit.isPending}
          disabled={!form.title.trim() || !form.at || (!meeting && prospect == null)}
          onCancel={close}
          onSubmit={() => {
            const shared = {
              title: form.title.trim(),
              type: form.type,
              at: toIso(form.at),
              duration_min: form.duration ? Number(form.duration) : null,
              attendees,
              agenda: form.agenda.trim() || null,
              outcome: form.outcome.trim() || null,
              meeting_url: form.meeting_url.trim() || null,
            }
            meeting
              ? edit.mutate({ ...shared, status: form.status }, { onSuccess: close })
              : create.mutate({ ...shared, prospect }, { onSuccess: close })
          }}
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export function LogCommunicationForm({ ws, prospect }: { ws: string; prospect?: number }) {
  return (
    <Disclosure label="Log an exchange">
      {(close) => <CommunicationFields ws={ws} prospect={prospect} close={close} />}
    </Disclosure>
  )
}

function CommunicationFields({
  ws,
  prospect,
  close,
}: {
  ws: string
  prospect?: number
  close: () => void
}) {
  const log = useLogCommunication(ws)
  const [form, setForm] = useState({
    channel: 'email',
    direction: 'out',
    at: toLocal(new Date().toISOString()),
    subject: '',
    body: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Channel">
          {/*
            Multi-channel is first class (§1.2 rule 3): WhatsApp, calls, notes
            and discovery sweeps are peers of email here, not special cases of
            it, because the vocabulary comes from `lib/pipeline.ts` rather than
            from a hand-written list that would have started with email.
          */}
          <VocabSelect
            label="Channel"
            options={CHANNELS}
            value={form.channel}
            onChange={(v) => set('channel', v)}
          />
        </Field>
        <Field label="Direction">
          <VocabSelect
            label="Direction"
            options={COMM_DIRECTIONS}
            value={form.direction}
            onChange={(v) => set('direction', v)}
          />
        </Field>
        <Field label="When">
          <TextInput
            type="datetime-local"
            value={form.at}
            onChange={(e) => set('at', e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Subject" hint="A call or a note usually has none.">
          <TextInput value={form.subject} onChange={(e) => set('subject', e.target.value)} />
        </Field>
        <Field label="What was said">
          <TextArea value={form.body} onChange={(e) => set('body', e.target.value)} />
        </Field>
      </div>
      <FormActions
        submitLabel="Log it"
        pending={log.isPending}
        disabled={!form.at || prospect == null}
        onCancel={close}
        onSubmit={() =>
          log.mutate(
            {
              prospect,
              channel: form.channel,
              direction: form.direction,
              at: toIso(form.at),
              subject: form.subject.trim() || null,
              body: form.body.trim() || null,
            },
            { onSuccess: close }
          )
        }
      />
    </>
  )
}

/**
 * Binning one exchange.
 *
 * There is no EDIT counterpart, and that is the route surface rather than an
 * omission: `PATCH …/communications/{n}` does not exist. An exchange is a record
 * of something that happened at a moment; a wrong one is binned and logged
 * again, which leaves both facts in the feed.
 */
export function RemoveCommunicationButton({
  ws,
  comm,
}: {
  ws: string
  comm: Communication
}) {
  const remove = useRemoveCommunication(ws)
  return (
    <Disclosure label="Bin" icon="pencil">
      {(close) => (
        <ConfirmDelete
          // The route compares against the PROSPECT NAME, not the subject: a
          // call or a note often has no subject, and "which company is this
          // against" is the fact somebody must have checked.
          target={comm.prospect_name}
          targetLabel="prospect name"
          pending={remove.isPending}
          onCancel={close}
          onConfirm={(confirm) =>
            remove.mutate({ number: comm.number, confirm }, { onSuccess: close })
          }
        />
      )}
    </Disclosure>
  )
}
