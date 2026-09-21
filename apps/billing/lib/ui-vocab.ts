// Status → label + tone, for every status the screens render. The ONE place a
// status gets a colour.
//
// Labels come from `lib/vocabularies.ts` — the same terms `/api/meta` serves and
// the CHECK constraints enforce — so a renamed label is one edit. The `color`
// hex those terms carry is for agents and other clients; the web UI ignores it
// and maps each value onto a TONE, and each tone onto token classes from
// app/globals.css (`--success`, `--warning`, `--info`, `--destructive`). That
// keeps both themes right and keeps every hex out of components.

import {
  HISTORY_SOURCES,
  HISTORY_STATUSES,
  INVOICE_STATUSES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_STATUSES,
  type Term,
} from './vocabularies'
import type {
  HistoryStatus,
  InvoiceStatus,
  RecurrenceFrequency,
  RecurrenceStatus,
} from '@/types'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary'

/** A pill / badge: tinted background, readable text, faint border. */
export const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-info/10 text-info border-info/25',
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  danger: 'bg-destructive/10 text-destructive border-destructive/25',
  primary: 'bg-primary/10 text-primary border-primary/25',
}

/** A status dot. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  primary: 'bg-primary',
}

/** Text only — a figure or a date in a tone (e.g. an overdue due date: `TONE_TEXT.warning`). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  primary: 'text-primary',
}

/** A callout box (problems list, notices). */
export const TONE_PANEL: Record<Tone, string> = {
  neutral: 'border-border bg-muted/40',
  info: 'border-info/30 bg-info/5',
  success: 'border-success/30 bg-success/5',
  warning: 'border-warning/30 bg-warning/5',
  danger: 'border-destructive/30 bg-destructive/5',
  primary: 'border-primary/30 bg-primary/5',
}

export interface StatusStyle {
  label: string
  tone: Tone
}

const labelOf = (terms: Term[], value: string) => terms.find((t) => t.value === value)?.label ?? value

const INVOICE_TONE: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  paid: 'success',
  void: 'danger',
}

const RECURRENCE_TONE: Record<RecurrenceStatus, Tone> = {
  active: 'success',
  paused: 'warning',
  completed: 'neutral',
}

const HISTORY_TONE: Record<HistoryStatus, Tone> = {
  paid: 'success',
  unpaid: 'warning',
  void: 'danger',
}

/** Unknown values render as themselves, neutral — a new server value is visible, not blank. */
export function invoiceStatus(s: InvoiceStatus | string): StatusStyle {
  return { label: labelOf(INVOICE_STATUSES, s), tone: INVOICE_TONE[s as InvoiceStatus] ?? 'neutral' }
}

export function recurrenceStatus(s: RecurrenceStatus | string): StatusStyle {
  return { label: labelOf(RECURRENCE_STATUSES, s), tone: RECURRENCE_TONE[s as RecurrenceStatus] ?? 'neutral' }
}

export function historyStatus(s: HistoryStatus | string): StatusStyle {
  return { label: labelOf(HISTORY_STATUSES, s), tone: HISTORY_TONE[s as HistoryStatus] ?? 'neutral' }
}

export const frequencyLabel = (f: RecurrenceFrequency | string) => labelOf(RECURRENCE_FREQUENCIES, f)
export const historySourceLabel = (s: string) => labelOf(HISTORY_SOURCES, s)

/**
 * The amount of a void invoice is struck through — it is not owed and never
 * was. Pass to `<Money className=…>`.
 */
export const amountClassFor = (status: InvoiceStatus | string) =>
  status === 'void' ? 'line-through text-muted-foreground' : ''

/** Tones for states that are not a stored status (overdue, a partial set, "due" on a series). */
export const OVERDUE_TONE: Tone = 'warning'
export const PARTIAL_TONE: Tone = 'warning'
export const DUE_TONE: Tone = 'primary'

/** The option lists a status filter needs, in the vocabulary's order. */
export const INVOICE_STATUS_OPTIONS = INVOICE_STATUSES.map((t) => ({ value: t.value, label: t.label }))
export const RECURRENCE_STATUS_OPTIONS = RECURRENCE_STATUSES.map((t) => ({ value: t.value, label: t.label }))
export const HISTORY_STATUS_OPTIONS = HISTORY_STATUSES.map((t) => ({ value: t.value, label: t.label }))
export const HISTORY_SOURCE_OPTIONS = HISTORY_SOURCES.map((t) => ({ value: t.value, label: t.label }))
export const FREQUENCY_OPTIONS = RECURRENCE_FREQUENCIES.map((t) => ({ value: t.value, label: t.label }))
