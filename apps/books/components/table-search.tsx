'use client'

// `<TableSearch>` — a free-text box over a table whose rows are already here.
//
// ===========================================================================
// IT WRITES TO THE URL, AND IT DOES NOT NAVIGATE. BOTH HALVES ARE DECISIONS.
// ===========================================================================
// **Why the URL at all.** The ledger's filters live in the query string and the
// reason is written down there: a filtered view is then a page somebody can
// send to somebody else, and a reload shows the same thing it showed before.
// A search box holding its query in React state alone is a view that cannot be
// linked to and that a refresh silently widens. So the query goes in the URL,
// the same as `?account=`, `?status=` and `?recognition=`.
//
// **Why it does not navigate.** The ledger's filters are ROUTE parameters: they
// change what the server is asked for, so setting one is a navigation and
// `router.replace` is right. These two searches filter rows the browser already
// holds — `GET …/rules` and `GET …/sources` serve their whole list and neither
// takes a query — so there is nothing to fetch and `router.replace` per
// keystroke would put an RSC round-trip behind every letter for no answer it
// could give. `history.replaceState` is what Next.js documents for exactly this
// case, and `useSearchParams()` is read once, at mount, to seed the box.
//
// **Why `replaceState` and not `pushState`.** A history entry per keystroke
// makes Back a delete key: twelve presses to leave a screen the reader arrived
// at once. Nobody wants that, and the ledger does not do it either — its
// `clearFilter` is a `replace` too. The consequence is stated rather than
// hidden: **Back leaves this screen, it does not undo the search.** The URL is
// shareable and reload-stable; it is not undoable. Clearing is the ✕.
//
// ── THE COUNT BESIDE IT SAYS "N OF M", AND HERE THAT IS TRUE ───────────────
// Unlike the ledger's result count, both numbers are real on these two screens:
// the list is complete in memory, so the denominator is the whole table and not
// a page of it. If either route ever paginates, this component is wrong — the
// filter would be searching a truncated set and the total would be a page size.
// `lib/search.ts` carries the same warning next to the matching itself.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function TableSearch({
  param,
  label,
  placeholder,
  value,
  onChange,
  matches,
}: {
  /** The query-string key. Distinct per table — a page may hold two. */
  param: string
  /** The accessible name. Already translated by the caller. */
  label: string
  placeholder: string
  value: string
  onChange: (next: string) => void
  /** `{shown, total}`, or null while the rows are still in flight. */
  matches: { shown: number; total: number } | null
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          size={13}
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          placeholder={placeholder}
          autoComplete="off"
          data-search={param}
          className={
            'w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-[12.5px] ' +
            'text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none ' +
            'focus:ring-1 focus:ring-primary'
          }
        />
        {value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('table.clearSearch')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {/* Only once something has been typed. A count beside an empty box is a
          statistic nobody asked for, and it would sit next to the heading's own
          count saying the same number twice. */}
      {value.trim() !== '' && matches && (
        <span className="text-[11.5px] text-muted-foreground" data-search-matches={matches.shown}>
          {t('table.searchMatches', { n: matches.shown, total: matches.total })}
        </span>
      )}
    </div>
  )
}

/**
 * The query, seeded from the URL and mirrored back into it.
 *
 * The state is the source of truth for the input — a controlled input driven by
 * `useSearchParams()` would re-render the whole route on every letter — and the
 * URL is kept in step behind it. See the header for why that is `replaceState`.
 */
export function useTableSearch(param: string): [string, (next: string) => void] {
  const search = useSearchParams()
  // Read ONCE. `useState`'s initialiser runs on the first render only, so a
  // later change to the query string (the book switcher writes `?entity=`) does
  // not reach in and retype the reader's search.
  const [query, setQuery] = useState(() => search?.get(param) ?? '')

  useEffect(() => {
    // `window.location.search` rather than the `search` above: other controls on
    // the page write their own parameters, and rebuilding from a snapshot taken
    // at mount would drop whichever of them moved since.
    const next = new URLSearchParams(window.location.search)
    if (query.trim() === '') next.delete(param)
    else next.set(param, query)
    const qs = next.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }, [param, query])

  return [query, setQuery]
}
