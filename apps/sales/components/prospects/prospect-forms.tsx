'use client'

// The write affordances on a prospect — Phase 9's `full` mode.
//
// ===========================================================================
// WHY THESE FIVE AND NOT FOURTEEN
// ===========================================================================
// The line is **what a human can know that the agent cannot.** A person on a
// call learns the deal value moved, that the contact's email is wrong, that the
// meeting had a different outcome, that they pushed back on price. Nobody
// independently learns the product catalogue changed — they tell the agent, and
// the agent writes it.
//
// So: prospect (including stage, owner, value, next action), contacts, meetings,
// communications and objections are writable in `full`. Products, templates,
// document metadata, matches, the journey ladder and the activity feed are
// read-only in BOTH modes and say so through `<AgentOnly>`.
//
// ===========================================================================
// EVERY WRITE HERE GOES THROUGH `lib/mutations.ts`
// ===========================================================================
// No `fetch`, no `apiSend`, no method strings in this file. That is what makes
// "read-only renders no mutation affordance" checkable rather than promised:
// `lib/read-only.test.ts` asserts that the only module sending a non-GET at an
// `/api/workspaces/…` path is `lib/mutations.ts`, and every hook there is built
// on the one `useMutation` that reads `useCanWrite()`.

import { useMemo, useState } from 'react'
import {
  DECISION_POWERS,
  NEUTRAL_OPTION_COLOR,
  NEXT_ACTION_TYPES,
  OBJECTION_STATUSES,
  OBJECTION_TYPES,
  STAGES,
  TERMINAL_STAGES,
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
  useAddContact,
  useAddProspectNote,
  useEditContact,
  useEditObjection,
  useEditProspect,
  useRaiseObjection,
  useRemoveContact,
  useRemoveObjection,
  useRemoveProspectNote,
  useSetNextAction,
  useSetStage,
  type ProspectPatch,
} from '@/lib/mutations'
import { useStrategies } from '@/lib/hooks'
import type { Contact, Objection, ProspectDetail, ProspectNote } from '@/lib/hooks'

// ---------------------------------------------------------------------------
// The deal itself
// ---------------------------------------------------------------------------

export function EditProspectForm({ ws, p }: { ws: string; p: ProspectDetail }) {
  return (
    <Disclosure label="Edit deal" icon="pencil">
      {(close) => <ProspectFields ws={ws} p={p} close={close} />}
    </Disclosure>
  )
}

function ProspectFields({ ws, p, close }: { ws: string; p: ProspectDetail; close: () => void }) {
  const edit = useEditProspect(ws, p.number)
  // The segments to choose from, by #number — the same address the CLI takes
  // and the value the route reads. A free-text box would 404 on a typo.
  const strategies = useStrategies(ws)
  const strategyOptions = useMemo(
    () =>
      // No `color`: a strategy is not a vocabulary value and has no colour to
      // decide. `lib/palette.test.ts` is right to refuse a hex here — D-4 is
      // that colour is chosen in `lib/pipeline.ts` and nowhere else, and this
      // list is data from the server, not a vocabulary.
      (strategies.data ?? []).map((g) => ({
        value: String(g.number),
        label: `#${g.number} ${g.name}`,
        color: NEUTRAL_OPTION_COLOR,
      })),
    [strategies.data]
  )
  const [form, setForm] = useState<ProspectPatch>({
    name: p.name,
    city: p.city,
    sector: p.sector,
    website: p.website,
    address: p.address,
    strategy: p.strategy,
    game_plan: p.game_plan,
    value: p.value,
    source: p.source,
    summary: p.summary,
  })
  const set = <K extends keyof ProspectPatch>(k: K, v: ProspectPatch[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company">
          <TextInput value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={`Deal value (${p.currency})`} hint="A plain number. Rounded when shown.">
          <TextInput
            value={form.value ?? ''}
            onChange={(e) => set('value', e.target.value || null)}
            inputMode="decimal"
          />
        </Field>
        <Field label="City">
          <TextInput value={form.city ?? ''} onChange={(e) => set('city', e.target.value || null)} />
        </Field>
        <Field label="Sector">
          <TextInput
            value={form.sector ?? ''}
            onChange={(e) => set('sector', e.target.value || null)}
          />
        </Field>
        <Field label="Source" hint="How they arrived — a referral, a sweep, an event.">
          <TextInput
            value={form.source ?? ''}
            onChange={(e) => set('source', e.target.value || null)}
          />
        </Field>
        <Field label="Website" hint="The company's site. Include https:// — the route refuses anything else.">
          <TextInput
            type="url"
            value={form.website ?? ''}
            onChange={(e) => set('website', e.target.value || null)}
          />
        </Field>
        <Field label="Address" hint="One line, as you would write it on an envelope.">
          <TextInput
            value={form.address ?? ''}
            onChange={(e) => set('address', e.target.value || null)}
          />
        </Field>
        <Field
          label="Strategy"
          hint="The segment this deal belongs to. Its reasoning lives on the strategy, not here."
        >
          <VocabSelect
            label="Strategy"
            options={strategyOptions}
            placeholder="Not linked"
            value={form.strategy == null ? '' : String(form.strategy)}
            onChange={(v) => set('strategy', v === '' ? null : Number(v))}
          />
        </Field>
        {/*
          STAGE IS NOT IN THIS FORM, and its absence is the contract. Moving a
          deal writes a journey step and may close it; `PATCH …/prospects/{n}`
          refuses `stage` with a 400 naming the other route, so a field here
          would be a control that always errors. It has its own button.

          OWNER is not here either: the route resolves an EMAIL to a user and
          400s on one it does not know, and a free-text box that fails on a
          typed name is a worse affordance than none. `bk sales prospect assign`
          has the member list to check against; this page does not mount
          `/api/workspaces/{ws}/members`.
        */}
      </div>
      <div className="mt-3 space-y-3">
        <Field
          label="Game plan"
          hint="What to say on the way IN: the angle, the talking points, the objections to expect. Line breaks are kept."
        >
          <TextArea
            value={form.game_plan ?? ''}
            onChange={(e) => set('game_plan', e.target.value || null)}
            rows={5}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Summary">
          <TextArea
            value={form.summary ?? ''}
            onChange={(e) => set('summary', e.target.value || null)}
          />
        </Field>
      </div>
      <FormActions
        submitLabel="Save"
        pending={edit.isPending}
        onCancel={close}
        onSubmit={() => edit.mutate(form, { onSuccess: close })}
      />
    </>
  )
}

export function MoveStageForm({ ws, p }: { ws: string; p: ProspectDetail }) {
  return (
    <Disclosure label="Move stage" icon="pencil">
      {(close) => <StageFields ws={ws} p={p} close={close} />}
    </Disclosure>
  )
}

function StageFields({ ws, p, close }: { ws: string; p: ProspectDetail; close: () => void }) {
  const move = useSetStage(ws, p.number)
  const [stage, setStage] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const terminal = TERMINAL_STAGES.includes(stage)

  return (
    <>
      <div className="space-y-3">
        <Field
          label="New stage"
          hint="The stage it is in now is not offered — re-posting it would append a journey step for a move that did not happen, and the route refuses it."
        >
          <VocabSelect
            label="New stage"
            options={STAGES.filter((s) => s.value !== p.stage)}
            placeholder="Choose…"
            value={stage}
            onChange={setStage}
          />
        </Field>
        <Field label="Note" hint="What moved it. Written onto the journey step.">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {/* Only for a terminal stage, because `closed_reason` is only stored
            there. Offering it on every move would invite a value the row has
            nowhere to put. */}
        {terminal && (
          <Field label="Closing reason">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
      <FormActions
        submitLabel="Move"
        pending={move.isPending}
        disabled={!stage}
        onCancel={close}
        onSubmit={() =>
          move.mutate(
            {
              stage,
              note: note.trim() || undefined,
              reason: terminal ? reason.trim() || undefined : undefined,
            },
            { onSuccess: close }
          )
        }
      />
    </>
  )
}

export function NextActionForm({ ws, p }: { ws: string; p: ProspectDetail }) {
  return (
    <Disclosure label={p.next_action.type ? 'Change next action' : 'Set a next action'} icon="pencil">
      {(close) => <NextActionFields ws={ws} p={p} close={close} />}
    </Disclosure>
  )
}

function NextActionFields({ ws, p, close }: { ws: string; p: ProspectDetail; close: () => void }) {
  const save = useSetNextAction(ws, p.number)
  const [type, setType] = useState(p.next_action.type ?? '')
  const [due, setDue] = useState(p.next_action.due ?? '')
  const [dueLabel, setDueLabel] = useState(p.next_action.due_label ?? '')
  const [note, setNote] = useState(p.next_action.note ?? '')

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is owed">
          <VocabSelect
            label="What is owed"
            options={NEXT_ACTION_TYPES}
            placeholder="Nothing"
            value={type}
            onChange={setType}
          />
        </Field>
        <Field label="Due">
          {/* A real date input: the route requires YYYY-MM-DD and 400s on
              anything else, so a free-text box would fail on the phrasing a
              human would naturally type. */}
          <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field
          label="How it was said"
          hint="Kept alongside the date. “Due Friday” and “sometime this week, Friday is my guess” are different commitments."
        >
          <TextInput value={dueLabel} onChange={(e) => setDueLabel(e.target.value)} />
        </Field>
        <Field label="Note">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <FormActions
        submitLabel="Save"
        pending={save.isPending}
        onCancel={close}
        onSubmit={() =>
          save.mutate(
            {
              // `null` CLEARS; `undefined` would leave it. Choosing "Nothing" in
              // the select has to mean cleared, or the queue keeps an action
              // nobody owes.
              type: type || null,
              due: due || null,
              due_label: dueLabel.trim() || null,
              note: note.trim() || null,
            },
            { onSuccess: close }
          )
        }
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export function AddContactForm({ ws, n }: { ws: string; n: number }) {
  return (
    <Disclosure label="Add a contact">
      {(close) => <ContactFields ws={ws} n={n} close={close} />}
    </Disclosure>
  )
}

/**
 * Append one research note (#39).
 *
 * ---------------------------------------------------------------------------
 * THIS FORM CANNOT EDIT, AND THERE IS NO SIBLING THAT CAN
 * ---------------------------------------------------------------------------
 * `ContactFields` below serves both add and edit from one component, which is
 * right there and would be wrong here: the log is append-only, so an edit form
 * would have no route to POST to. See the route header — an editable log stops
 * answering the only question it exists for.
 */
export function AddProspectNoteForm({ ws, n }: { ws: string; n: number }) {
  return (
    <Disclosure label="Add a note">
      {(close) => <ProspectNoteFields ws={ws} n={n} close={close} />}
    </Disclosure>
  )
}

function ProspectNoteFields({ ws, n, close }: { ws: string; n: number; close: () => void }) {
  const add = useAddProspectNote(ws, n)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('')

  return (
    <>
      <div className="space-y-3">
        <Field
          label="What you found"
          hint="Line breaks are kept — a site audit reads as a list, not a paragraph."
        >
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
        </Field>
        <Field
          label="Kind"
          hint="Optional, free text — “site audit”, “competitor”, “timing”. Not a fixed list."
        >
          <TextInput value={kind} onChange={(e) => setKind(e.target.value)} />
        </Field>
      </div>
      <FormActions
        submitLabel="Append"
        pending={add.isPending}
        disabled={!body.trim()}
        onCancel={close}
        onSubmit={() =>
          add.mutate(
            { body: body.trim(), kind: kind.trim() || null },
            {
              onSuccess: () => {
                setBody('')
                setKind('')
                close()
              },
            }
          )
        }
      />
    </>
  )
}

/**
 * Destroy one note. Hard — `sales.prospect_notes` has no `deleted_at`, so there
 * is no bin behind this and `bk sales trash restore` has nothing to take.
 *
 * The confirmation types the note's **id** back, which is what the route
 * requires. It is the weaker of this repo's two confirmation shapes and the
 * reason is at `deleteProspectNote`: `kind` is nullable, so confirming on it
 * would leave the common note unconfirmable.
 */
export function RemoveProspectNoteButton({
  ws,
  n,
  note,
}: {
  ws: string
  n: number
  note: ProspectNote
}) {
  const remove = useRemoveProspectNote(ws, n)
  return (
    <Disclosure label="Remove" icon="pencil">
      {(close) => (
        <ConfirmDelete
          target={String(note.id)}
          targetLabel="note’s id"
          pending={remove.isPending}
          onCancel={close}
          onConfirm={() => remove.mutate({ id: note.id }, { onSuccess: close })}
        />
      )}
    </Disclosure>
  )
}

export function EditContactForm({
  ws,
  n,
  contact,
}: {
  ws: string
  n: number
  contact: Contact
}) {
  return (
    <Disclosure label={`Edit ${contact.name}`} icon="pencil">
      {(close) => <ContactFields ws={ws} n={n} contact={contact} close={close} />}
    </Disclosure>
  )
}

function ContactFields({
  ws,
  n,
  contact,
  close,
}: {
  ws: string
  n: number
  contact?: Contact
  close: () => void
}) {
  const add = useAddContact(ws, n)
  const edit = useEditContact(ws, n)
  const remove = useRemoveContact(ws, n)
  const [confirming, setConfirming] = useState(false)

  const [form, setForm] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    linkedin: contact?.linkedin ?? '',
    decision_power: contact?.decision_power ?? '',
    notes: contact?.notes ?? '',
    is_primary: contact?.is_primary ?? false,
  })
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  if (confirming && contact) {
    return (
      <ConfirmDelete
        target={contact.name}
        targetLabel="contact’s name"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate({ id: contact.id, name: contact.name }, { onSuccess: close })}
      />
    )
  }

  const payload = {
    name: form.name.trim(),
    role: form.role.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    linkedin: form.linkedin.trim() || null,
    decision_power: form.decision_power || null,
    notes: form.notes.trim() || null,
    is_primary: form.is_primary,
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Role">
          <TextInput value={form.role} onChange={(e) => set('role', e.target.value)} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="LinkedIn" hint="Include https:// — the route refuses anything else.">
          <TextInput
            type="url"
            value={form.linkedin}
            onChange={(e) => set('linkedin', e.target.value)}
          />
        </Field>
        <Field
          label="Decision power"
          hint="What they can DO in the deal, not their job title. The one who wants it is rarely the one who signs."
        >
          <VocabSelect
            label="Decision power"
            options={DECISION_POWERS}
            placeholder="Not recorded"
            value={form.decision_power}
            onChange={(v) => set('decision_power', v)}
          />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Notes" hint="Background, negotiation history, how they behave in a room.">
          <TextArea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={form.is_primary}
            onChange={(e) => set('is_primary', e.target.checked)}
          />
          Primary contact
        </label>
      </div>
      <div className="flex items-center justify-between">
        {contact ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            Remove
          </button>
        ) : (
          <span />
        )}
        <FormActions
          submitLabel={contact ? 'Save' : 'Add'}
          pending={add.isPending || edit.isPending}
          disabled={!payload.name}
          onCancel={close}
          onSubmit={() =>
            contact
              ? edit.mutate({ id: contact.id, patch: payload }, { onSuccess: close })
              : add.mutate(payload, { onSuccess: close })
          }
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Objections — three fields, still three
// ---------------------------------------------------------------------------

export function RaiseObjectionForm({ ws, n }: { ws: string; n: number }) {
  return (
    <Disclosure label="Record an objection">
      {(close) => <ObjectionFields ws={ws} n={n} close={close} />}
    </Disclosure>
  )
}

export function EditObjectionForm({
  ws,
  n,
  objection,
}: {
  ws: string
  n: number
  objection: Objection
}) {
  return (
    <Disclosure label="Edit" icon="pencil">
      {(close) => <ObjectionFields ws={ws} n={n} objection={objection} close={close} />}
    </Disclosure>
  )
}

function ObjectionFields({
  ws,
  n,
  objection,
  close,
}: {
  ws: string
  n: number
  objection?: Objection
  close: () => void
}) {
  const raise = useRaiseObjection(ws, n)
  const edit = useEditObjection(ws, n)
  const remove = useRemoveObjection(ws, n)
  const [confirming, setConfirming] = useState(false)

  const [form, setForm] = useState({
    type: objection?.type ?? '',
    raised_by: objection?.raised_by ?? '',
    spoken: objection?.spoken ?? '',
    real_fear: objection?.real_fear ?? '',
    counter: objection?.counter ?? '',
    status: objection?.status ?? 'open',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (confirming && objection) {
    return (
      <ConfirmDelete
        target={objection.type}
        targetLabel="objection type"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={(confirm) =>
          remove.mutate({ id: objection.id, confirm }, { onSuccess: close })
        }
      />
    )
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <VocabSelect
            label="Type"
            options={OBJECTION_TYPES}
            placeholder="Choose…"
            value={form.type}
            onChange={(v) => set('type', v)}
          />
        </Field>
        <Field label="Raised by">
          <TextInput value={form.raised_by} onChange={(e) => set('raised_by', e.target.value)} />
        </Field>
      </div>
      {/*
        THREE FIELDS, KEPT AS THREE. What they SAID, what we think they MEAN,
        and what we say back is the only structured sales insight in this
        product; `lib/views.ts` refuses to collapse them and neither does this.
      */}
      <div className="mt-3 space-y-3">
        <Field label="What they said">
          <TextArea value={form.spoken} onChange={(e) => set('spoken', e.target.value)} />
        </Field>
        <Field label="What we think they mean">
          <TextArea value={form.real_fear} onChange={(e) => set('real_fear', e.target.value)} />
        </Field>
        {objection && (
          <>
            <Field label="Our counter">
              <TextArea value={form.counter} onChange={(e) => set('counter', e.target.value)} />
            </Field>
            <Field
              label="Status"
              hint="A counter does not settle an objection. Moving this to resolved is a separate judgement, which is why they are two fields and not one."
            >
              <VocabSelect
                label="Status"
                options={OBJECTION_STATUSES}
                value={form.status}
                onChange={(v) => set('status', v)}
              />
            </Field>
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        {objection ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            Remove — permanent
          </button>
        ) : (
          <span />
        )}
        <FormActions
          submitLabel={objection ? 'Save' : 'Record'}
          pending={raise.isPending || edit.isPending}
          disabled={!form.type}
          onCancel={close}
          onSubmit={() => {
            const payload = {
              type: form.type,
              raised_by: form.raised_by.trim() || null,
              spoken: form.spoken.trim() || null,
              real_fear: form.real_fear.trim() || null,
              ...(objection
                ? { counter: form.counter.trim() || null, status: form.status }
                : {}),
            }
            objection
              ? edit.mutate({ id: objection.id, patch: payload }, { onSuccess: close })
              : raise.mutate(payload, { onSuccess: close })
          }}
        />
      </div>
    </>
  )
}
