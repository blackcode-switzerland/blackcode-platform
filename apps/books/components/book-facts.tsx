// `<BookFacts>` — what a book IS, as opposed to how its year is going.
//
// Legal form, bookkeeping regime, VAT, seat, audit status. Extracted from the
// overview card on 2026-08-18 because the patrimoine screen needs the same block
// and a second copy is a second place for the VAT read to go wrong.
//
// ── THE VAT READ IS THE ONE TO BE CAREFUL WITH ────────────────────────────
// `entity.vat` is a NESTED block, not four flat columns. Read flat it is
// `undefined`, and `undefined ? … : 'Not registered'` prints a confident, wrong
// fact about a company's tax status with nothing thrown. That happened, on every
// book including the registered one, and it is why `lib/types.ts` now carries a
// header about typing against the route.
//
// ── AND A FALSE VALUE IS NOT AN ABSENT ONE ────────────────────────────────
// `registered: false` renders "Not registered", because for a company that is a
// fact somebody checks rather than a gap. What must never happen is a field this
// screen did not FIND rendering as `false`, `0` or "Not registered" — so every
// value below distinguishes null from a real negative.

import type { Entity } from '@/lib/types'

export function BookFacts({ entity }: { entity: Entity }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
      <Fact label="Legal form" value={entity.legal_form} />
      <Fact
        label="Regime"
        value={
          entity.bookkeeping_regime === 'double_entry'
            ? 'Double entry'
            : entity.bookkeeping_regime === 'simplified'
              ? 'Simplified (art. 957 al. 2)'
              : // A third value would be a regime this bundle does not know. Show
                // it raw rather than folding it into one of the two we do.
                entity.bookkeeping_regime
        }
      />
      <Fact
        label="VAT"
        value={
          entity.vat.registered
            ? [entity.vat.method, entity.vat.filing].filter(Boolean).join(', ') || 'Registered'
            : 'Not registered'
        }
      />
      {entity.audit_status && <Fact label="Audit" value={entity.audit_status.replace('_', ' ')} />}
      {/* `fte_count` is a `numeric` STRING on the wire (`"4.60"`), not a number.
          It is printed as served — no parse, no rounding — because the only
          reason it is on the screen is that it is what preserves audit opt-out
          eligibility, and a rounded headcount is not that fact. */}
      {entity.fte_count !== null && <Fact label="FTE" value={entity.fte_count} numeric />}
    </dl>
  )
}

function Fact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={'text-foreground' + (numeric ? ' num' : '')}>{value}</dd>
    </div>
  )
}
