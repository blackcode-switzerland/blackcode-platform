'use client'

// Raw text shown as it is — the QR payload, a JSON import, an accept link —
// with a copy button. `value` is rendered untouched: no trimming, no
// re-serialisation (the QR payload's bytes ARE the contract).

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface CodeBlockProps {
  value: string
  /** A caption above the block. */
  label?: React.ReactNode
  /** `data-testid` on the <pre> (e.g. `qr-payload`). */
  testId?: string
  /** Wrap long lines instead of scrolling. Default true. */
  wrap?: boolean
  /** Max height before scrolling, as a Tailwind class. Default `max-h-96`. */
  maxHeightClass?: string
  className?: string
}

export function CodeBlock({ value, label, testId, wrap = true, maxHeightClass = 'max-h-96', className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy — select the text instead')
    }
  }
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        data-testid={testId}
        className={cn(
          'overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed',
          wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
          maxHeightClass
        )}
      >
        {value}
      </pre>
    </div>
  )
}
