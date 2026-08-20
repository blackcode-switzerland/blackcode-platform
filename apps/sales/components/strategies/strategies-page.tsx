'use client'

// The segment strategies listing (#37).
//
// ---------------------------------------------------------------------------
// A LISTING, NOT A DETAIL PAGE, AND THE ROW IS THE RECORD
// ---------------------------------------------------------------------------
// `docs/frontend.md` §7: a type with no children of its own is shown as a row
// that IS the record, and a cross-app link resolves to the listing with the row
// highlighted. A strategy has products and prospects, but both are LINKS to
// records that have their own homes — so there is nothing a detail page would
// hold that this row cannot.
//
// That is also what `lib/dashboard-paths.ts` already decided by putting
// `strategy: 'strategies'` in LISTING_SEGMENT rather than giving it a branch in
// `entityPath` — and `lib/dashboard-paths.test.ts` fails the build if this page
// does not read `?focus=`, which is the half a text scan cannot infer.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Users } from 'lucide-react'
import { useStrategies, type Strategy } from '@/lib/hooks'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { AgentOnly, WriteGate } from '@/components/forms'
import { RecordNumber } from '@/components/chips'
import { useCanWrite } from '@/lib/ui-mode'
import { usePageTitle } from '@/components/sales-shell'
import { AddStrategyForm, EditStrategyForm } from '@/components/strategies/strategy-forms'

/** `?focus=<n>` — how a URN and ⌘K arrive at a strategy, which has no page. */
function useFocus(): number | null {
  const params = useSearchParams()
  const raw = params?.get('focus')
  const n = raw == null ? NaN : Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function StrategiesPage({ ws }: { ws: string }) {
  usePageTitle('Strategies')
  const strategies = useStrategies(ws)
  const focus = useFocus()

  if (strategies.isPending) return <BlockSkeleton rows={4} />
  if (strategies.error) return <ErrorState error={strategies.error} />

  return (
    <div className="space-y-3">
      <p className="px-1 text-xs text-muted-foreground">
        Why a segment was chosen, and what we lead with. Reusable across
        prospects — the angle for one company is its own{' '}
        <span className="font-medium text-foreground">game plan</span>, on the
        prospect.
      </p>
      <div className="flex items-center justify-between px-1">
        <AgentOnly what="Strategies" />
        <WriteGate ws={ws} note="Strategies are maintained by the agent.">
          <AddStrategyForm ws={ws} />
        </WriteGate>
      </div>
      {strategies.data.length === 0 ? (
        <EmptyState
          title="No strategies yet"
          hint="A strategy records why a vertical or area was chosen and which products it leads with — the reasoning that otherwise only exists in a chat log."
        />
      ) : (
        <div className="space-y-2">
          {strategies.data.map((s) => (
            <StrategyCard key={s.number} ws={ws} strategy={s} focused={s.number === focus} />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategyCard({
  ws,
  strategy: s,
  focused,
}: {
  ws: string
  strategy: Strategy
  focused: boolean
}) {
  // The scroll ref is OWNED HERE rather than passed down, for the reason
  // `DocumentList` records: threading a ref for a focused element through a
  // prop crosses a boundary where two copies of `@types/react` disagree about
  // `Ref`, and it fails to compile. The card knows whether it is the focused
  // one; let it keep that.
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])
  const canWrite = useCanWrite(ws)
  const [expanded, setExpanded] = useState(false)
  const hasProse = Boolean(s.rationale || s.case_studies)

  return (
    <article
      ref={ref}
      className={
        'rounded-xl border bg-card px-4 py-4 ' +
        (focused ? 'border-primary' : 'border-border')
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <RecordNumber n={s.number} />
        <h3 className="text-sm font-medium text-foreground">{s.name}</h3>
        {[s.vertical, s.area].filter(Boolean).map((v) => (
          <span key={v} className="text-xs text-muted-foreground">
            {v}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Users size={12} />
          {/* Not inflected. `ledger-pages.tsx` learned this the hard way: a page
              that pluralises a count it did not choose the noun for produces
              "1 prospects". The number and the noun, flat. */}
          {s.prospect_count} prospect
        </span>
        {canWrite && <EditStrategyForm ws={ws} strategy={s} />}
      </div>

      {s.products.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.products.map((p) => (
            <Link
              key={p.number}
              href={`/dashboard/${ws}/products?focus=${p.number}`}
              className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="font-mono tabular-nums">#{p.number}</span>
              {p.name}
            </Link>
          ))}
        </div>
      )}

      {hasProse && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs text-primary hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide the reasoning' : 'Why this segment'}
          </button>
          {expanded && (
            <div className="mt-2 space-y-3 border-t border-border pt-3">
              {s.rationale && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Why
                  </p>
                  {/* `whitespace-pre-wrap`: the rationale is written with line
                      breaks and losing them turns a list of reasons into one
                      paragraph. Same call the research log makes. */}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {s.rationale}
                  </p>
                </div>
              )}
              {s.case_studies && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Case studies
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {s.case_studies}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}
