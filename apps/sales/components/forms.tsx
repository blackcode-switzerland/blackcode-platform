'use client'

// The form kit — and the two components that make D-7 visible in the tree.
//
// ===========================================================================
// `WriteGate` AND `AgentOnly` ARE THE TWO ANSWERS, AND THEY ARE NOT THE SAME
// ===========================================================================
//   <WriteGate ws=…>   a thing this app CAN edit, hidden in read-only mode.
//                      Renders its children when `useCanWrite()`, and one short
//                      line naming `bk sales` when not.
//
//   <AgentOnly …>      a thing this app does NOT edit in EITHER mode — the
//                      catalogue, documents, matches, the journey, the feed.
//                      Always renders the line, never a control.
//
// Two components rather than one flag, because they answer different questions
// and a reader has to be able to tell them apart. "You have this switched off"
// and "nothing switches this on" are different facts, and collapsing them is how
// somebody spends an afternoon looking for the setting that would let them edit
// the product catalogue.
//
// **Both always SAY something.** A control that is simply absent teaches
// nothing: the reader concludes the feature does not exist, or that they are not
// allowed, and neither is true. Naming the command turns a wall into a mode.

import { useState } from 'react'
import { Pencil, Plus, Terminal, X } from 'lucide-react'
import { useCanWrite } from '@/lib/ui-mode'
import { ticks } from '@/components/states'
import type { Option } from '@/lib/pipeline'

// ---------------------------------------------------------------------------
// The two gates
// ---------------------------------------------------------------------------

/**
 * Editing that exists, when the reader has it switched on.
 *
 * `note` overrides the default line for a block that wants to name a specific
 * command — `bk sales prospect stage` rather than the generic one.
 */
export function WriteGate({
  ws,
  note,
  children,
}: {
  ws: string
  note?: string
  children: React.ReactNode
}) {
  const canWrite = useCanWrite(ws)
  if (canWrite) return <>{children}</>
  return (
    <CommandNote>
      {/* `ticks` because every `note` this app passes names a command inside
          backticks, and until 2026-08-11 they rendered as literal backticks —
          directly beside `AgentOnly` below, which builds the same sentence in
          JSX and gets a proper chip. Same screen, same sentence, two
          treatments. */}
      {ticks(note ?? 'Editing is hidden — this browser is in read-only mode (Settings → Preferences).')}
    </CommandNote>
  )
}

/**
 * Records this app never edits from the browser, in either mode.
 *
 * The line between this and `WriteGate` is **what a human can know that the
 * agent cannot.** A person on a call learns the deal value moved, that a
 * contact's email is wrong, that the meeting had a different outcome. Nobody
 * independently learns the product catalogue changed — they tell the agent, and
 * the agent writes it. Editing those here would double this app's surface for
 * cases nobody has.
 */
export function AgentOnly({ command, what }: { command: string; what: string }) {
  return (
    <CommandNote>
      {what} are maintained through <code className="rounded bg-muted px-1 py-0.5">{command}</code>.
    </CommandNote>
  )
}

function CommandNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Terminal size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------------
// Disclosure — "+ Add" / "Edit" that expands in place
// ---------------------------------------------------------------------------

/**
 * A button that becomes a form.
 *
 * In place rather than in a modal, deliberately: every form in this app edits
 * something the page is already showing, and a dialog covering the record you
 * are editing means checking a value costs closing the form.
 */
export function Disclosure({
  label,
  icon = 'plus',
  children,
}: {
  label: string
  icon?: 'plus' | 'pencil'
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const Icon = icon === 'plus' ? Plus : Pencil
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Icon size={13} />
        {label}
      </button>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
      {children(() => setOpen(false))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

const INPUT =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={INPUT} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={INPUT + ' resize-y'} />
}

/**
 * A vocabulary select.
 *
 * Takes `Option[]` from `lib/pipeline.ts` and nothing else — there is no way to
 * pass a hand-written list of values through this component, which is what
 * keeps "the vocabulary lives in one place" true of the forms as well as of the
 * chips. A value the vocabulary gains appears in every form with no edit here.
 */
export function VocabSelect({
  options,
  placeholder,
  ...props
}: { options: Option[]; placeholder?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={INPUT}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function FormActions({
  submitLabel,
  pending,
  disabled,
  onSubmit,
  onCancel,
  destructive,
}: {
  submitLabel: string
  pending?: boolean
  disabled?: boolean
  onSubmit: () => void
  onCancel: () => void
  destructive?: boolean
}) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button
        onClick={onCancel}
        className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={pending || disabled}
        className={
          'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ' +
          (destructive
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-primary text-primary-foreground hover:bg-primary/90')
        }
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}

/**
 * The repeat-the-target-back confirmation, in the browser.
 *
 * The DELETE routes require `?confirm=<the row's name>` and check it on the
 * server (`docs/backend.md` §7.4) — a check that lived only in the CLI would be
 * one a web action could skip, and this is the web action. So the form asks for
 * the same string the route will compare, rather than showing an "Are you sure?"
 * the server would accept without.
 */
export function ConfirmDelete({
  target,
  targetLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  target: string
  targetLabel: string
  pending?: boolean
  onConfirm: (confirm: string) => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-xs text-foreground">
        This is checked by the server, not by this form. Type the {targetLabel} to confirm:{' '}
        <strong className="font-medium">{target}</strong>
      </p>
      <div className="mt-2">
        <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
      </div>
      <FormActions
        submitLabel="Delete"
        destructive
        pending={pending}
        disabled={typed !== target}
        onSubmit={() => onConfirm(typed)}
        onCancel={onCancel}
      />
    </div>
  )
}
