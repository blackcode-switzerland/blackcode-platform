// A status pill. Tone and label come from `lib/ui-vocab.ts` — the one place a
// status gets a colour.

import {
  TONE_DOT,
  TONE_PILL,
  historyStatus,
  invoiceStatus,
  recurrenceStatus,
  type Tone,
} from '@/lib/ui-vocab'
import { cn } from '@/lib/utils'

export type StatusBadgeProps =
  | { kind: 'invoice' | 'recurrence' | 'history'; status: string; className?: string; testId?: string }
  | { kind?: undefined; label: React.ReactNode; tone: Tone; className?: string; testId?: string }

export function StatusBadge(props: StatusBadgeProps) {
  let style: { label: React.ReactNode; tone: Tone }
  if (props.kind === undefined) style = { label: props.label, tone: props.tone }
  else if (props.kind === 'invoice') style = invoiceStatus(props.status)
  else if (props.kind === 'recurrence') style = recurrenceStatus(props.status)
  else style = historyStatus(props.status)
  const { label, tone } = style
  return (
    <span
      data-testid={props.testId}
      data-status={props.kind ? props.status : undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONE_PILL[tone],
        props.className
      )}
    >
      <span className={cn('size-1.5 rounded-full', TONE_DOT[tone])} />
      {label}
    </span>
  )
}
