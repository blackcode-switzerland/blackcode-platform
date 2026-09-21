'use client'

// A structured editor for an invoice's lines — add, remove, edit — used both by
// the create-invoice dialog and the detail page's "Edit lines" panel. Replaces
// the minimal UI's `desc|qty|unit|price|vat` textarea (`components/min/lines.ts`,
// being retired) with real fields; the parsing convention is dropped along with
// it. Saved to the server with `useSetInvoiceLines` alone (the route refuses
// `items` mixed with other fields).
//
// VAT: an empty field means "no VAT" (invariant I3), never `0` — the toggle
// makes that explicit rather than relying on a reader to leave a box blank.

import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@blackcode/platform-ui/ui/input'
import { Button } from '@blackcode/platform-ui/ui/button'
import { Label } from '@/components/ui-kit'
import { cn } from '@/lib/utils'
import type { CreateInvoiceLineBody } from '@/types'

export const EMPTY_LINE: CreateInvoiceLineBody = { description: '', qty: '1', unit: null, unit_price: '', vat_rate: null }

export function LineItemsEditor({
  items,
  onChange,
  testIdPrefix = 'line',
}: {
  items: CreateInvoiceLineBody[]
  onChange: (items: CreateInvoiceLineBody[]) => void
  testIdPrefix?: string
}) {
  const set = (i: number, patch: Partial<CreateInvoiceLineBody>) =>
    onChange(items.map((line, n) => (n === i ? { ...line, ...patch } : line)))
  const remove = (i: number) => onChange(items.filter((_, n) => n !== i))
  const add = () => onChange([...items, { ...EMPTY_LINE }])

  return (
    <div className="space-y-3">
      <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_5rem_7rem_6rem_2rem]">
        <span>Description</span>
        <span>Qty</span>
        <span>Unit</span>
        <span>Unit price</span>
        <span>VAT %</span>
        <span />
      </div>
      {items.map((line, i) => (
        <div
          key={i}
          data-testid={`${testIdPrefix}-row-${i}`}
          className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_5rem_5rem_7rem_6rem_2rem] sm:items-center sm:border-0 sm:p-0"
        >
          <div className="col-span-2 sm:col-span-1">
            <Label className="sm:hidden">Description</Label>
            <Input
              data-testid={`${testIdPrefix}-description-${i}`}
              value={line.description}
              onChange={(e) => set(i, { description: e.target.value })}
              placeholder="Consulting, hours…"
            />
          </div>
          <div>
            <Label className="sm:hidden">Qty</Label>
            <Input
              data-testid={`${testIdPrefix}-qty-${i}`}
              value={line.qty ?? ''}
              onChange={(e) => set(i, { qty: e.target.value })}
              placeholder="1"
            />
          </div>
          <div>
            <Label className="sm:hidden">Unit</Label>
            <Input
              data-testid={`${testIdPrefix}-unit-${i}`}
              value={line.unit ?? ''}
              onChange={(e) => set(i, { unit: e.target.value || null })}
              placeholder="h"
            />
          </div>
          <div>
            <Label className="sm:hidden">Unit price</Label>
            <Input
              data-testid={`${testIdPrefix}-price-${i}`}
              value={line.unit_price}
              onChange={(e) => set(i, { unit_price: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label className="sm:hidden">VAT %</Label>
            <Input
              data-testid={`${testIdPrefix}-vat-${i}`}
              value={line.vat_rate ?? ''}
              onChange={(e) => set(i, { vat_rate: e.target.value || null })}
              placeholder="none"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove line"
            data-testid={`${testIdPrefix}-remove-${i}`}
            onClick={() => remove(i)}
            disabled={items.length <= 1}
            className={cn('justify-self-end text-muted-foreground hover:text-destructive', items.length <= 1 && 'opacity-30')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" data-testid={`${testIdPrefix}-add`} onClick={add}>
        <Plus size={14} />
        Add line
      </Button>
    </div>
  )
}
