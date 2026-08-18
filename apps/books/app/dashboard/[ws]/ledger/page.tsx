'use client'

// General ledger — every posting of one book, one fiscal year.
//
// ===========================================================================
// THE LIST-AND-DETAIL PATTERN THE REST OF THE APP REUSES. GET IT RIGHT ONCE.
// ===========================================================================
// A row is one écriture, shown WHOLE: every line of it, both sides, because the
// other side is what says where the money went. `?account=` filters which
// entries appear and never which lines of them are shown — that is the route's
// behaviour and this screen must not undo it by rendering only the matching
// line.
//
// ── `?account=` ARRIVES FROM THE INCOME STATEMENT ─────────────────────────
// Each CR line carries its `accounts`, `<AccountRef>` links to here with the
// number, and this page reads it out of the URL. It is a URL a reader can
// bookmark and an agent can construct, so it is shown as a removable filter
// rather than as hidden state.
//
// ── THE #NUMBER IS THE ADDRESS, NOT THE JOURNAL NUMBER ────────────────────
// `number` is the workspace seq and is what `/ledger/{number}`, `bk books entry
// show` and a URN all take. `entry_no` is the statutory journal number, gapless
// within (entity, exercice), and is what a reader comparing against a filing
// needs. Both are shown; they are not interchangeable and the columns say so.
//
// ── THE SIMPLIFIED BOOK HAS NO ROWS HERE, AND THAT IS NOT "NO ENTRIES" ────
// A book kept under art. 957 al. 2 records recettes/dépenses in `books.ri_entry`,
// which `GET …/entries` does not read and no route serves. So this screen shows
// an empty grand livre for a book that has six movements. Saying "no entries
// yet" there would be a confident wrong answer of exactly the kind this phase
// exists to stop, so the empty state asks which book it is looking at first.
// **The RI ledger is a missing route, and the report asks for it.**

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useEntries } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { ScreenFrame } from '@/components/screen-frame'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState } from '@/components/states'
import { DateText } from '@/components/date-text'
import { Money } from '@/components/money'
import { VocabChip } from '@/components/chips'
import { EntryLines } from '@/components/entry-lines'
import type { Entry } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`

  // Every filter comes from the URL, so a filtered ledger is a shareable page
  // and the browser's Back button undoes a filter. Same reason as the scope.
  const account = search?.get('account') ?? null
  const status = search?.get('status') ?? null
  const recognition = search?.get('recognition') ?? null

  const entries = useEntries(params.ws, scope, {
    account: account ?? undefined,
    status: status ?? undefined,
    recognition: recognition ?? undefined,
  })

  const simplified = scope.record?.bookkeeping_regime === 'simplified'

  const columns = useMemo<Column<Entry>[]>(
    () => [
      {
        key: 'entry_no',
        header: 'N°',
        cell: (e) => (
          <span className="font-mono text-[12px] text-muted-foreground">{e.entry_no}</span>
        ),
        sortValue: (e) => e.entry_no,
      },
      {
        key: 'date',
        header: 'Date',
        cell: (e) => <DateText value={e.date} />,
        // The ISO string sorts correctly as text and needs no Date. See
        // `components/date-text.tsx` for why that matters here specifically.
        sortValue: (e) => e.date,
      },
      {
        key: 'label',
        header: 'Entry',
        cell: (e) => (
          <div className="min-w-0">
            <Link
              href={scopedHref(base, `/ledger/${e.number}`, scope)}
              className="font-medium text-foreground hover:text-primary-strong"
            >
              {/* The bank's own words. Never overwritten, and the first thing on
                  the row — the whole product is about explaining these. */}
              {e.raw_label}
            </Link>
            {e.counterparty && (
              <span className="ml-2 text-[12px] text-muted-foreground">{e.counterparty}</span>
            )}
            <EntryLines lines={e.lines} base={base} scope={scope} />
          </div>
        ),
        sortValue: (e) => e.raw_label,
      },
      {
        key: 'recognition',
        header: 'Recognition',
        cell: (e) => <VocabChip vocabulary="recognition" value={e.recognition} />,
        sortValue: (e) => e.recognition,
      },
      {
        key: 'evidence',
        header: 'Evidence',
        cell: (e) => <VocabChip vocabulary="evidence_tiers" value={e.evidence_tier} withNote />,
        sortValue: (e) => e.evidence_tier,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (e) => <VocabChip vocabulary="entry_status" value={e.status} />,
        sortValue: (e) => e.status,
      },
      {
        key: 'number',
        header: '#',
        numeric: true,
        cell: (e) => <span className="font-mono text-[12px] text-muted-foreground">{e.number}</span>,
        sortValue: (e) => e.number,
      },
    ],
    [base, scope]
  )

  function clearFilter(key: string) {
    const next = new URLSearchParams(search?.toString() ?? '')
    next.delete(key)
    router.replace(`${base}/ledger?${next.toString()}`, { scroll: false })
  }

  return (
    <ScreenFrame title="General ledger">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          Grand livre{' '}
          <span className="ml-2 text-sm font-normal text-muted-foreground">General ledger</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.record?.name ?? '—'} · exercice {scope.exercice ?? '—'}
        </p>
      </div>

      {(account || status || recognition) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filtered
          </span>
          {account && <FilterPill label={`account ${account}`} onClear={() => clearFilter('account')} />}
          {status && <FilterPill label={`status ${status}`} onClear={() => clearFilter('status')} />}
          {recognition && (
            <FilterPill label={`recognition ${recognition}`} onClear={() => clearFilter('recognition')} />
          )}
          {account && (
            <span className="text-[11.5px] text-muted-foreground">
              Whole entries that touch this account — both sides are shown, not just the matching
              line.
            </span>
          )}
        </div>
      )}

      <DataTable
        rows={entries.data}
        columns={columns}
        rowKey={(e) => e.number}
        isLoading={entries.isLoading}
        error={entries.error}
        initialSort={{ key: 'date', direction: 'asc' }}
        empty={
          simplified ? (
            <EmptyState title="This book keeps no grand livre.">
              <p>
                {scope.record?.name} is kept under art. 957 al. 2 CO — recettes and dépenses, with
                no double entry behind them. Its movements are recorded, but they are not écritures
                and this route does not serve them.
              </p>
              <p className="mt-2">
                Its totals are on{' '}
                <Link href={scopedHref(base, '', scope)} className="text-primary-strong hover:underline">
                  the overview
                </Link>
                , and its net worth on{' '}
                <Link
                  href={scopedHref(base, '/patrimoine', scope)}
                  className="text-primary-strong hover:underline"
                >
                  the patrimoine statement
                </Link>
                . A screen for the simplified movements themselves needs a route that does not exist
                yet.
              </p>
            </EmptyState>
          ) : account || status || recognition ? (
            <EmptyState title="No entry matches these filters.">
              <p>The book has entries; none of them satisfy every filter above at once.</p>
            </EmptyState>
          ) : (
            <EmptyState title="No entries in this exercice.">
              <p>
                Nothing has been posted or staged for {scope.record?.name ?? 'this book'} in{' '}
                {scope.exercice ?? 'this year'}.
              </p>
            </EmptyState>
          )
        }
      />
    </ScreenFrame>
  )
}

function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-[1px] text-[11px] text-foreground">
      <span className="font-mono">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove the ${label} filter`}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={11} />
      </button>
    </span>
  )
}
