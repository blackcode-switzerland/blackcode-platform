'use client'

// Prospects — the list, and the board.
//
// ── A NORMAL FULL-WIDTH TABLE. NO INNER SCROLLBOX ──────────────────────────
// §8.2, and it is a mockup finding rather than a style note (`UPDATE-7.md` item
// 4): the table scrolls with the PAGE. No `max-h`, no `overflow-y-auto` around
// the rows, no fixed-height container. A listing inside its own scroll region
// hides its own length — you cannot tell twelve rows from two hundred without
// grabbing the bar, and the browser's find-in-page stops working the way
// everybody expects it to.
//
// The one horizontal exception is the board, which scrolls sideways because six
// stage columns do not fit a laptop, and that IS the shape the reader wants.
//
// ── THE TOGGLE IS IN THE URL ────────────────────────────────────────────────
// `?view=board`, not component state. A view somebody chose is a thing they will
// send to a colleague, and it survives a reload — which is also how the filter
// bar persists without a store.

import { useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { STAGES, nextActionTypeLabel } from '@/lib/pipeline'
import { RecordNumber, StageChip } from '@/components/chips'
import { BlockSkeleton, ErrorState } from '@/components/states'
import {
  ClearFilters,
  FilterBar,
  FilterInput,
  FilterSelect,
  FilteredEmpty,
  useFilterParam,
} from '@/components/filters'
import { useProspects, useStrategies } from '@/lib/hooks'
import { money, relativeDay } from '@/lib/format'
import type { PublicProspect } from '@/lib/views'

export function ProspectsPage({ ws }: { ws: string }) {
  const params = useSearchParams()
  const [stage, setStage] = useFilterParam('stage')
  const [strategy, setStrategy] = useFilterParam('strategy')
  const [q, setQ] = useFilterParam('q')
  const [, setView] = useFilterParam('view')

  const view = params?.get('view') === 'board' ? 'board' : 'table'

  const strategies = useStrategies(ws)
  const strategyOptions = (strategies.data ?? []).map((s) => ({
    value: String(s.number),
    label: s.name,
  }))

  const list = useProspects(ws, {
    stage: stage || undefined,
    strategy: strategy || undefined,
    q: q || undefined,
  })
  const rows = list.data?.data ?? []
  const filtered = Boolean(q || stage || strategy)

  return (
    <div className="space-y-4">
      {/* The filter bar. Stage, strategy and free text today; owner and date
          range arrive with the ledgers, which are where a date range means
          something. */}
      <FilterBar>
        <FilterInput
          label="Company name"
          value={q}
          onChange={setQ}
          placeholder="Filter by name…"
        />
        {/* Built from `lib/pipeline.ts`, never a hand-written list — a stage
            added there appears here with no second edit. */}
        <FilterSelect
          label="Stage"
          value={stage}
          onChange={setStage}
          options={STAGES}
          allLabel="All stages"
        />
        {/* Segment strategy (#37/#41) — never displayed when there are none to
            filter by: an empty dropdown is worse than no dropdown. */}
        {strategyOptions.length > 0 && (
          <FilterSelect
            label="Strategy"
            value={strategy}
            onChange={setStrategy}
            options={strategyOptions}
            allLabel="All strategies"
          />
        )}

        {/* `view` survives Clear: which layout you are looking at is not a
            filter, and clearing the filters used to silently throw a reader
            off the board and back onto the table. */}
        <ClearFilters active={filtered} keep={['view']} />

        <div className="ml-auto flex items-center rounded-lg border border-border p-0.5">
          <ViewButton
            active={view === 'table'}
            onClick={() => setView('')}
            icon={<Rows3 size={14} />}
            label="Table"
          />
          <ViewButton
            active={view === 'board'}
            onClick={() => setView('board')}
            icon={<LayoutGrid size={14} />}
            label="Board"
          />
        </div>
      </FilterBar>

      {list.isPending ? (
        <BlockSkeleton rows={6} />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : rows.length === 0 ? (
        <FilteredEmpty
          filtered={filtered}
          noun="prospects"
          emptyTitle="No prospects yet"
          emptyHint="A prospect appears here when the agent creates one."
        />
      ) : view === 'board' ? (
        <Board ws={ws} rows={rows} />
      ) : (
        <Table ws={ws} rows={rows} />
      )}
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ' +
        (active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')
      }
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * The table. Borderless, edge-to-edge rows, `py-3` — sales' density (D-4).
 *
 * No card wrapper and no inner scroll: the page scrolls.
 */
function Table({ ws, rows }: { ws: string; rows: PublicProspect[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Company</th>
            <th className="py-2 pr-3 font-medium">Stage</th>
            <th className="py-2 pr-3 font-medium">Value</th>
            <th className="py-2 pr-3 font-medium">Owner</th>
            <th className="py-2 pr-3 font-medium">Next action</th>
            <th className="py-2 pr-3 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.number} className="group border-b border-border/60 hover:bg-accent/50">
              <td className="py-3 pr-3">
                <Link href={`/dashboard/${ws}/prospects/${p.number}`} className="block">
                  <span className="flex items-baseline gap-1.5 font-medium text-foreground">
                    <RecordNumber n={p.number} />
                    {p.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[p.city, p.sector].filter(Boolean).join(' · ') || '—'}
                  </span>
                </Link>
              </td>
              <td className="py-3 pr-3">
                <StageChip value={p.stage} />
              </td>
              <td className="py-3 pr-3 tabular-nums text-foreground">
                {money(p.value, p.currency)}
              </td>
              <td className="py-3 pr-3 text-muted-foreground">
                {/* The deal owner column UPDATE-9 made structurally important.
                    `owner` is a platform user; `next_action.owner` is a verbatim
                    label and may be "Companion", who is not one. */}
                {p.owner?.name ?? p.owner?.email ?? '—'}
              </td>
              <td className="py-3 pr-3 text-muted-foreground">
                {/* The LABEL, not the stored value. `check_in` and `wait` are
                    wire values; "Check-in" and "Waiting" are what a human reads,
                    and `lib/pipeline.ts` is the only place that knows the
                    mapping. Rendering the raw value leaks the schema onto the
                    page and goes stale the moment a label is reworded. */}
                {p.next_action.type ? nextActionTypeLabel(p.next_action.type) : '—'}
                {p.next_action.owner && (
                  <span className="text-xs"> · {p.next_action.owner}</span>
                )}
              </td>
              <td className="py-3 pr-3 text-muted-foreground">
                {p.next_action.due ? relativeDay(p.next_action.due) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The board.
 *
 * **Every stage gets a column, including the empty ones**, in pipeline order —
 * the same rule `pipeline()` applies to the funnel, for the same reason: a board
 * that silently omits the stage nobody is in hides the thing worth noticing.
 *
 * There is no drag-and-drop. Moving a deal between stages is a mutation, and
 * D-7 renders none in `read_only`; a board you can drag from is also a board
 * that needs a `PATCH …/reorder`, which is the one route class `apps/issues`
 * excluded from CLI parity as meaningless outside a UI. The stage is set by
 * `bk sales prospect stage`, which records who moved it and why.
 */
function Board({ ws, rows }: { ws: string; rows: PublicProspect[] }) {
  const columns = useMemo(
    () => STAGES.map((s) => ({ ...s, items: rows.filter((p) => p.stage === s.value) })),
    [rows]
  )

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {columns.map((col) => (
        <div key={col.value} className="w-64 shrink-0">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: col.color }}
              aria-hidden
            />
            <span className="text-xs font-medium text-foreground">{col.label}</span>
            <span className="text-xs text-muted-foreground">{col.items.length}</span>
          </div>
          <div className="space-y-2">
            {col.items.map((p) => (
              <Link
                key={p.number}
                href={`/dashboard/${ws}/prospects/${p.number}`}
                className="block rounded-xl border border-border bg-card px-3 py-3 transition-colors hover:bg-accent"
              >
                <span className="flex items-baseline gap-1.5 text-sm font-medium text-foreground">
                  <RecordNumber n={p.number} />
                  {p.name}
                </span>
                <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                  {money(p.value, p.currency)}
                </span>
                {p.next_action.due && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {relativeDay(p.next_action.due)}
                  </span>
                )}
              </Link>
            ))}
            {col.items.length === 0 && (
              <p className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                Empty
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
