'use client'

// Add and edit a segment strategy (#37).
//
// One `StrategyFields` for both, the shape `ContactFields` uses — right here
// because a strategy IS editable, unlike the research log next door, whose form
// deliberately has no edit sibling.

import { useState } from 'react'
import { useProducts, type Strategy } from '@/lib/hooks'
import {
  ConfirmDelete,
  Disclosure,
  Field,
  FormActions,
  TextArea,
  TextInput,
} from '@/components/forms'
import {
  useCreateStrategy,
  useEditStrategy,
  useRemoveStrategy,
  type StrategyInput,
} from '@/lib/mutations'

export function AddStrategyForm({ ws }: { ws: string }) {
  return (
    <Disclosure label="New strategy">
      {(close) => <StrategyFields ws={ws} close={close} />}
    </Disclosure>
  )
}

export function EditStrategyForm({ ws, strategy }: { ws: string; strategy: Strategy }) {
  return (
    <Disclosure label={`Edit ${strategy.name}`} icon="pencil">
      {(close) => <StrategyFields ws={ws} strategy={strategy} close={close} />}
    </Disclosure>
  )
}

function StrategyFields({
  ws,
  strategy,
  close,
}: {
  ws: string
  strategy?: Strategy
  close: () => void
}) {
  const create = useCreateStrategy(ws)
  const edit = useEditStrategy(ws)
  const remove = useRemoveStrategy(ws)
  const products = useProducts(ws)
  const [confirming, setConfirming] = useState(false)

  const [form, setForm] = useState({
    name: strategy?.name ?? '',
    vertical: strategy?.vertical ?? '',
    area: strategy?.area ?? '',
    rationale: strategy?.rationale ?? '',
    case_studies: strategy?.case_studies ?? '',
  })
  // The SET of product #numbers this strategy leads with. Held as a Set because
  // the route replaces the whole set rather than merging — the checkbox list
  // below is the exact shape of what gets sent.
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set((strategy?.products ?? []).map((p) => p.number))
  )
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (confirming && strategy) {
    return (
      <ConfirmDelete
        target={strategy.name}
        targetLabel="strategy’s name"
        pending={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate({ number: strategy.number, name: strategy.name }, { onSuccess: close })
        }
      />
    )
  }

  const payload: StrategyInput = {
    name: form.name.trim(),
    vertical: form.vertical.trim() || null,
    area: form.area.trim() || null,
    rationale: form.rationale.trim() || null,
    case_studies: form.case_studies.trim() || null,
    products: [...picked].sort((a, b) => a - b),
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="What this segment is — “Lausanne watch & jewellery”.">
          <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Vertical" hint="The trade. Free text, not a fixed list.">
          <TextInput value={form.vertical} onChange={(e) => set('vertical', e.target.value)} />
        </Field>
        <Field label="Area" hint="Where — “Lausanne”, “Romandie”.">
          <TextInput value={form.area} onChange={(e) => set('area', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field
          label="Why this segment"
          hint="The part worth writing — what the next person reads instead of reconstructing it from a list of prospects."
        >
          <TextArea
            value={form.rationale}
            onChange={(e) => set('rationale', e.target.value)}
            rows={4}
          />
        </Field>
        <Field label="Case studies" hint="What we point at as proof.">
          <TextArea
            value={form.case_studies}
            onChange={(e) => set('case_studies', e.target.value)}
            rows={3}
          />
        </Field>
        <Field
          label="Products it leads with"
          hint="Checking and unchecking REPLACES the set — there is no add/remove."
        >
          {products.isPending ? (
            <p className="text-xs text-muted-foreground">Loading products…</p>
          ) : products.data && products.data.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {products.data.map((p) => {
                const on = picked.has(p.number)
                return (
                  <button
                    key={p.number}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((prev) => {
                        const next = new Set(prev)
                        if (on) next.delete(p.number)
                        else next.add(p.number)
                        return next
                      })
                    }
                    className={
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ' +
                      (on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')
                    }
                  >
                    <span className="font-mono tabular-nums">#{p.number}</span>
                    {p.name}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No products in the catalog yet.
            </p>
          )}
        </Field>
      </div>
      <div className="flex items-center justify-between">
        {strategy ? (
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
          submitLabel={strategy ? 'Save' : 'Create'}
          pending={create.isPending || edit.isPending}
          disabled={!payload.name}
          onCancel={close}
          onSubmit={() => {
            if (strategy) {
              edit.mutate({ number: strategy.number, patch: payload }, { onSuccess: close })
            } else {
              create.mutate(payload, { onSuccess: close })
            }
          }}
        />
      </div>
    </>
  )
}
