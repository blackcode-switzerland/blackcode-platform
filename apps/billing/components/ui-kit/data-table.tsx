'use client'

// A listing: a table from `md` up, stacked cards below.
//
// ── ONE LAYOUT IN THE DOM, NOT TWO ──────────────────────────────────────────
// The obvious build renders both and hides one with CSS. That duplicates every
// `data-testid` on the page (`invoice-row-<number>` twice), and a Playwright
// locator matching two elements fails in strict mode — or clicks the hidden
// one. So the layout is chosen by a media query in JS and only one is mounted.
// Before mount (server render) it is the table; rows arrive from a client
// query after mount anyway.
//
// Rows with `rowHref` navigate on click (and on Enter) and render the first
// column as a real link, so middle-click and screen readers still work.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface Column<T> {
  /** Stable key. */
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** `right` for amounts. */
  align?: 'left' | 'right'
  /** Extra classes on the th/td (widths, `hidden lg:table-cell`, …). */
  className?: string
  /** On a phone: `title` is the card's heading line, `hide` drops the column, default shows `header: value`. */
  mobile?: 'title' | 'subtitle' | 'hide' | 'default'
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  /**
   * Makes each row navigate. The first cell becomes a real link and, on a
   * phone, the whole card is one — so cells of a linked row must not contain
   * their own links or buttons (nested interactive elements).
   */
  rowHref?: (row: T) => string
  /** `data-testid` per row (keep existing ids, e.g. `invoice-row-<number>`). */
  rowTestId?: (row: T) => string
  /** Dim a row (a void invoice, a retired company). */
  rowMuted?: (row: T) => boolean
  /** Rendered instead of the table when `rows` is empty. */
  empty?: React.ReactNode
  /** `data-testid` on the table / card list. */
  testId?: string
  className?: string
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const on = () => setDesktop(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return desktop
}

export function DataTable<T>(props: DataTableProps<T>) {
  const { rows, empty } = props
  const desktop = useIsDesktop()
  if (rows.length === 0 && empty) return <>{empty}</>
  return desktop ? <TableView {...props} /> : <CardView {...props} />
}

function TableView<T>({ columns, rows, rowKey, rowHref, rowTestId, rowMuted, testId, className }: DataTableProps<T>) {
  const router = useRouter()
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table data-testid={testId} className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-4 py-2.5 text-xs font-medium text-muted-foreground first:pl-4 sm:first:pl-5 last:pr-4 sm:last:pr-5',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.className
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row)
            return (
              <tr
                key={rowKey(row)}
                data-testid={rowTestId?.(row)}
                onClick={
                  href
                    ? (e) => {
                        // Let a real link inside the row (or a button) handle its own click.
                        if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return
                        router.push(href)
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-border last:border-b-0',
                  href && 'cursor-pointer transition-colors hover:bg-accent/50',
                  rowMuted?.(row) && 'text-muted-foreground'
                )}
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 align-middle first:pl-4 sm:first:pl-5 last:pr-4 sm:last:pr-5',
                      c.align === 'right' && 'text-right',
                      c.className
                    )}
                  >
                    {i === 0 && href ? (
                      <Link href={href} className="font-medium text-foreground hover:underline">
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CardView<T>({ columns, rows, rowKey, rowHref, rowTestId, rowMuted, testId, className }: DataTableProps<T>) {
  const title = columns.filter((c) => c.mobile === 'title')
  const titleCols = title.length > 0 ? title : columns.slice(0, 1)
  const subtitle = columns.filter((c) => c.mobile === 'subtitle')
  const rest = columns.filter((c) => !titleCols.includes(c) && !subtitle.includes(c) && c.mobile !== 'hide')

  return (
    <ul data-testid={testId} className={cn('divide-y divide-border', className)}>
      {rows.map((row) => {
        const href = rowHref?.(row)
        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 font-medium">
                {titleCols.map((c) => (
                  <div key={c.key} className="truncate">
                    {c.cell(row)}
                  </div>
                ))}
              </div>
              {subtitle.length > 0 && (
                <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                  {subtitle.map((c) => (
                    <div key={c.key}>{c.cell(row)}</div>
                  ))}
                </div>
              )}
            </div>
            {rest.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {rest.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className="truncate text-sm text-foreground">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        )
        const cls = cn('block px-4 py-3', rowMuted?.(row) && 'text-muted-foreground')
        return (
          <li key={rowKey(row)} data-testid={rowTestId?.(row)}>
            {href ? (
              <Link href={href} className={cn(cls, 'transition-colors active:bg-accent/60')}>
                {content}
              </Link>
            ) : (
              <div className={cls}>{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
