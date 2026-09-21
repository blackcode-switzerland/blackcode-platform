'use client'

// Form rows. Inputs themselves are `@blackcode/platform-ui/ui/input`; this adds
// the label, the hint, the per-field error, and the two native controls the
// package does not have (select, textarea) styled to match it.
//
// Keep `data-testid="input-<field>"` on inputs — the Playwright walk types into
// them by that id.

import { forwardRef } from 'react'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Label({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string
  children: React.ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <label htmlFor={htmlFor} className={cn('text-xs font-medium text-foreground', className)}>
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </label>
  )
}

export function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>
}

export interface FormFieldProps {
  label: React.ReactNode
  /** The control's id, so clicking the label focuses it. */
  htmlFor?: string
  /** Under the control. */
  hint?: React.ReactNode
  /** Red, under the control; replaces the hint. */
  error?: React.ReactNode
  required?: boolean
  /**
   * Render the control read-only with the reason — for fields frozen after
   * send (`document_frozen`): say why BEFORE the request, not after the 409.
   */
  lockedReason?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function FormField({ label, htmlFor, hint, error, required, lockedReason, children, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
        {lockedReason && <Lock size={11} className="text-muted-foreground" aria-hidden />}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : lockedReason ? (
        <Hint>{lockedReason}</Hint>
      ) : hint ? (
        <Hint>{hint}</Hint>
      ) : null}
    </div>
  )
}

/** A grid of FormFields: one column on a phone, `cols` from `sm`. */
export function FormGrid({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-4',
        cols === 2 && 'sm:grid-cols-2',
        cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {children}
    </div>
  )
}

// The platform Input's look, for the native controls it does not provide.
const control =
  'w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30'

export const Select = forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(function Select(
  { className, children, ...props },
  ref
) {
  return (
    <select ref={ref} className={cn(control, 'h-9 pr-8', className)} {...props}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(function Textarea(
  { className, ...props },
  ref
) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 py-2', className)} {...props} />
})

/** A read-only value laid out like an input — for frozen fields. */
export function ReadOnlyValue({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cn('flex min-h-9 items-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-sm text-muted-foreground', className)}
    >
      {children}
    </div>
  )
}
