'use client'

// `<DataTable>` — every screen in b/books is a table, so there is one table.
//
// ===========================================================================
// WHAT IT OWNS: THE FOUR STATES, THE SORT, AND THE NUMERIC COLUMN
// ===========================================================================
// Loading, error, empty and full are four states every listing has, and a table
// per screen is thirteen chances to render an empty grid while a request is in
// flight — which reads as "this book has no entries" and is the failure
// `components/states.tsx` exists to prevent. Getting them here means a new
// screen gets all four by passing two props.
//
// The `numeric` flag on a column is the other reason this is shared. Money in a
// table has to be right-aligned with tabular figures or a column of amounts is
// ragged and cannot be compared by eye — that is the whole point of a column of
// amounts. The `num` utility in `app/globals.css` is where the convention is
// spelled; this is what applies it, so no screen has to remember.
//
// ── SORTING IS CLIENT-SIDE AND THAT IS A DELIBERATE LIMIT ──────────────────
// It sorts the rows it was given. It does not paginate and it does not ask the
// server for a different order. For a page of a ledger that is right; for a
// ledger of ten thousand postings it is not, and the answer then is an `order`
// parameter on the route — a backend change, asked for rather than papered over
// here. **A client-side sort over a truncated list silently sorts the wrong
// set**, so a caller that paginates must not offer one.
//
// ── ROWS ARE BORDERLESS AND EDGE-TO-EDGE ───────────────────────────────────
// Platform convention (`docs/frontend.md`): no card wrapper around a listing, a
// hairline between rows, no vertical rules. A ledger is a list, not a grid of
// boxes.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { EmptyState, ErrorState, Loading } from './states'
import { useT } from '@/lib/i18n'

export interface Column<T> {
  /** Stable identity for the column. Used as the sort key and the React key. */
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Right-aligned, tabular figures. Every money and count column. */
  numeric?: boolean
  /**
   * What to sort this column by. Omit and the column is not sortable — which is
   * the honest default for a cell whose content is a component rather than a
   * value.
   */
  sortValue?: (row: T) => string | number | null
  /** Extra classes on both the header cell and the body cells. */
  className?: string
}

export interface DataTableProps<T> {
  rows: T[] | undefined
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  isLoading?: boolean
  error?: unknown
  /**
   * What an empty list says. A string — ALREADY TRANSLATED by the caller — or a
   * full `<EmptyState>` for more. The default is this component's own and comes
   * from the dictionary.
   */
  empty?: React.ReactNode
  /** Column key to sort by on first render. */
  initialSort?: { key: string; direction: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  isLoading,
  error,
  empty,
  initialSort,
  onRowClick,
}: DataTableProps<T>) {
  const t = useT()
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!rows) return rows
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const get = col.sortValue
    // A COPY. Sorting `rows` in place mutates the array the query cache handed
    // us, which makes the cached value depend on which column somebody clicked.
    return [...rows].sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      // Nulls last in both directions. A row with no date is not "the earliest";
      // it is a row with no date, and burying it at the top of an ascending sort
      // pushes the rows the reader came for off the screen.
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sort.direction === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, columns])

  if (isLoading) return <Loading rows={6} />
  if (error) return <ErrorState error={error} />
  if (!sorted || sorted.length === 0) {
    // A prop DEFAULT would be evaluated before any hook can run, so the fallback
    // is chosen here instead. `undefined` means "the caller said nothing"; a
    // caller that genuinely wants no empty state passes an element.
    if (empty === undefined) return <EmptyState title={t('table.nothingHere')} />
    return typeof empty === 'string' ? <EmptyState title={empty} /> : <>{empty}</>
  }

  function toggle(key: string) {
    setSort((prev) =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => {
              const sortable = Boolean(col.sortValue)
              const active = sort?.key === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={
                    'px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground ' +
                    (col.numeric ? 'text-right ' : 'text-left ') +
                    (col.className ?? '')
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      className={
                        'inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground ' +
                        (active ? 'text-foreground' : '')
                      }
                    >
                      {col.header}
                      {active &&
                        (sort!.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={
                'border-b border-border/60 ' +
                (onRowClick ? 'cursor-pointer hover:bg-accent/50 ' : '')
              }
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={
                    'px-3 py-1.5 align-top ' +
                    (col.numeric ? 'num ' : '') +
                    (col.className ?? '')
                  }
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
