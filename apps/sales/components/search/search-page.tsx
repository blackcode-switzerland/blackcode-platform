'use client'

// `/dashboard/{ws}/search?q=` — the full page half of D-9.
//
// ===========================================================================
// WHICH SEARCH THIS IS, AND WHY A READER CAN TELL
// ===========================================================================
// This searches INSIDE b/sales records: a phrase in a call summary, a name in
// an attendee list, the body of a template. It is `…/sales-search`, the same
// endpoint ⌘K uses, through the same hook.
//
// The OTHER search is `bk search`, which reads `platform.entities` — titles
// only, every app, URNs out. D-9 says the two layers must stay visible in the
// product and not only in the guide, so the page says which one it is, in place,
// and names the other. If a reader could not tell them apart, that is a design
// failure and not a documentation one.
//
// ===========================================================================
// THE FACETS, AND THE ONE THAT IS NOT HERE
// ===========================================================================
// TYPE is a real server facet: `…/sales-search?type=` narrows the UNION itself.
// The counts beside each type come from the unfiltered result set — a second,
// unfiltered query, which TanStack shares with the "everything" view — because
// counts computed from the filtered list would show `1` beside every type but
// the chosen one.
//
// STAGE and OWNER are derived, not searched. A hit carries no stage and no
// owner: it is a row from one of nine tables and only some of them belong to a
// deal at all. So the page joins each hit to its prospect using the `/prospects`
// listing it would load for the Prospects page anyway (`useProspectsByNumber`,
// the same trick Today's queue uses for deal values, §7.1). That is not a second
// search API — it is one more read of a route that already exists, joined in the
// browser.
//
// **DATE IS NOT BUILT, and that is a report rather than an omission.**
// `…/sales-search` returns `{type, number, prospect_number, title, snippet,
// rank, urn}` and no timestamp of any kind. Nothing on this page could honestly
// filter by when a thing happened: the deal's `updated_at` is reachable through
// the join above, but "the deal was touched last week" is not "this meeting
// happened last week", and a control labelled by date that answered a different
// question is worse than no control. Adding a date to the hit shape is a change
// to agent5's route and belongs to whoever owns that, which is why the brief
// says to say so rather than to add a parallel endpoint (D-9).

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search as SearchIcon, X } from 'lucide-react'
import { STAGES, stageLabel } from '@/lib/pipeline'
import { StageChip } from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { useProspectsByNumber, useSalesSearch, type SearchHit, type SearchType } from '@/lib/hooks'
import { recordHref } from '@/lib/record-href'
import type { PublicProspect } from '@/lib/views'

/**
 * Group ORDER — a display preference, not the list of searchable types.
 *
 * Prospects first because a deal is what somebody is usually looking for, then
 * the things that hang off one, then the catalog. `rank` still orders WITHIN a
 * group, which is where ranking means something: comparing a template's rank
 * against a contact's is comparing two different columns' tsvectors.
 *
 * **What is searchable is the SERVER's list** (`SEARCH_TYPES`, served by
 * `bk meta`), and this page never enumerates it: the facet chips are built from
 * the types actually returned, and `order()` puts anything not named here at the
 * end. A tenth searchable type therefore appears with a readable-enough label
 * and a working filter on the day the route gains it, rather than being searched,
 * returned and silently dropped from the display — which is what a hardcoded
 * list would do, quietly, in the direction of showing less than was found.
 *
 * The list is not imported from `lib/db/queries/search.ts` for one reason: that
 * module imports the database client, and a value import would pull drizzle into
 * the browser bundle.
 */
const GROUP_ORDER = [
  'prospect',
  'contact',
  'meeting',
  'communication',
  'objection',
  'match',
  'product',
  'template',
  'document',
]

const GROUP_LABEL: Record<string, string> = {
  prospect: 'Prospects',
  contact: 'Contacts',
  meeting: 'Meetings',
  communication: 'Communications',
  objection: 'Objections',
  match: 'Triangulation',
  product: 'Products',
  template: 'Templates',
  document: 'Documents',
}

/** Types that hang off a deal, and can therefore be narrowed by stage or owner. */
const DEAL_SCOPED = new Set(['prospect', 'contact', 'meeting', 'communication', 'objection', 'match'])

const groupLabel = (t: string) => GROUP_LABEL[t] ?? t.replace(/_/g, ' ')

/** One shared empty array, so "no results yet" keeps a stable identity. */
const EMPTY: SearchHit[] = []

export function SearchPage({ ws }: { ws: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const q = params?.get('q') ?? ''
  const type = params?.get('type') ?? ''
  const stage = params?.get('stage') ?? ''
  const owner = params?.get('owner') ?? ''

  // Takes a PATCH of several keys, not one. Calling a single-key setter three
  // times in a row would build all three URLs from the same `params` snapshot
  // and only the last would survive — which is how "Clear filters" quietly
  // clears one filter.
  const setParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  const setParam = (key: string, value: string) => setParams({ [key]: value })
  const clearFilters = () => setParams({ type: '', stage: '', owner: '' })

  // Two queries against ONE endpoint. `all` is what the type counts are computed
  // from; with no type chosen the keys are identical and it is one request.
  const all = useSalesSearch(ws, q, { limit: 100 })
  const search = useSalesSearch(ws, q, {
    types: type ? [type as SearchType] : undefined,
    limit: 100,
  })
  const prospects = useProspectsByNumber(ws)

  // `?? EMPTY` rather than `?? []`: a fresh array literal is a new identity on
  // every render, so the memos below would recompute continuously.
  const hits = search.data ?? EMPTY

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const h of all.data ?? []) counts.set(h.type, (counts.get(h.type) ?? 0) + 1)
    return counts
  }, [all.data])

  // The chips come from what the SERVER returned, ordered by preference — never
  // from `GROUP_ORDER` filtered by count, which would make a type this page has
  // not heard of unfilterable and invisible. The currently-chosen type is kept
  // even at count zero, or choosing it would remove the chip that unchooses it.
  const facetTypes = useMemo(() => {
    const set = new Set(typeCounts.keys())
    if (type) set.add(type)
    return [...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  }, [typeCounts, type])

  // The deal facets, applied here because the endpoint cannot apply them. A hit
  // with no prospect is EXEMPT rather than excluded when no deal facet is set,
  // and hidden with a stated count when one is — a product silently vanishing
  // because somebody filtered by stage would read as the index being wrong.
  const dealFiltered = stage !== '' || owner !== ''
  const { shown, hiddenCatalog } = useMemo(() => {
    if (!dealFiltered) return { shown: hits, hiddenCatalog: 0 }
    const byNumber = prospects.data
    const kept: SearchHit[] = []
    let hidden = 0
    for (const h of hits) {
      if (!DEAL_SCOPED.has(h.type)) {
        hidden++
        continue
      }
      const p = h.prospect_number == null ? undefined : byNumber?.get(h.prospect_number)
      if (!p) continue
      if (stage && p.stage !== stage) continue
      if (owner && ownerKey(p) !== owner) continue
      kept.push(h)
    }
    return { shown: kept, hiddenCatalog: hidden }
  }, [hits, prospects.data, stage, owner, dealFiltered])

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of shown) {
      const list = map.get(h.type) ?? []
      list.push(h)
      map.set(h.type, list)
    }
    return [...map.entries()].sort((a, b) => order(a[0]) - order(b[0]))
  }, [shown])

  const owners = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of prospects.data?.values() ?? []) {
      const key = ownerKey(p)
      if (key) map.set(key, p.owner?.name ?? p.owner?.email ?? key)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [prospects.data])

  const anyFilter = type !== '' || stage !== '' || owner !== ''

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="relative flex-1 sm:max-w-md">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            autoFocus
            placeholder="Search inside prospects, calls, meetings, the catalog…"
            className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
        </span>
        {anyFilter && (
          <button
            onClick={clearFilters}
            className="flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={14} />
            Clear filters
          </button>
        )}
      </div>

      {/*
        D-9 in the product. Two searches exist, they answer different questions,
        and a reader who cannot tell which one they are looking at is the failure
        the decision is written to prevent.
      */}
      {/* THIS PARAGRAPH PROMISED A CROSS-APP SEARCH UNTIL 2026-08-11, and there
          has not been one since Phase 3 stopped this app projecting into the
          shared index. It named `bk search`, which Phase 4 then removed as a
          bare verb — so the sentence pointed at a command that answers
          `unknown command` about a capability that no longer exists.
          PLAN.md §3 records the loss as deliberate; the honest replacement says
          each app is searched on its own. */}
      <p className="text-xs text-muted-foreground">
        Searching <strong className="font-medium text-foreground">inside b/sales records</strong> —
        call summaries, meeting outcomes, contact details, template copy. Each app is searched on
        its own:{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk sales search</code> here,{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk issues search</code> there.
      </p>

      {!q.trim() ? (
        <EmptyState
          title="Type to search"
          hint="This reaches into the text of records, not just their titles — a phrase from a call, a person's name in an attendee list."
        />
      ) : search.error ? (
        <ErrorState error={search.error} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <FacetChip
              label="Everything"
              count={all.data?.length}
              active={type === ''}
              onClick={() => setParam('type', '')}
            />
            {facetTypes.map((t) => (
              <FacetChip
                key={t}
                label={groupLabel(t)}
                count={typeCounts.get(t) ?? 0}
                active={type === t}
                onClick={() => setParam('type', type === t ? '' : t)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={stage}
              onChange={(e) => setParam('stage', e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-ring"
            >
              <option value="">Any stage</option>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={owner}
              onChange={(e) => setParam('owner', e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-ring"
            >
              <option value="">Any owner</option>
              {owners.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {dealFiltered && (
              <span className="text-xs text-muted-foreground">
                {/*
                  Said, not silent. Stage and owner are properties of a DEAL, so
                  narrowing by one necessarily excludes the catalog — and a
                  product that disappeared without explanation would read as the
                  search being broken.
                */}
                Stage and owner belong to a deal
                {hiddenCatalog > 0 && ` — ${hiddenCatalog} catalog result${hiddenCatalog === 1 ? '' : 's'} hidden`}
              </span>
            )}
          </div>

          {search.isPending || (dealFiltered && prospects.isPending) ? (
            <BlockSkeleton rows={5} />
          ) : shown.length === 0 ? (
            <NoResults
              q={q}
              anyFilter={anyFilter}
              unfilteredCount={all.data?.length ?? 0}
              onClearFilters={clearFilters}
            />
          ) : (
            <div className="space-y-6">
              {grouped.map(([groupType, groupHits]) => (
                <section key={groupType}>
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupLabel(groupType)}
                    <span className="ml-1.5 font-normal normal-case tracking-normal">
                      {groupHits.length}
                    </span>
                  </h2>
                  <div className="space-y-1">
                    {groupHits.map((hit, i) => (
                      <Hit
                        key={`${hit.type}-${hit.number ?? 'x'}-${i}`}
                        ws={ws}
                        hit={hit}
                        prospect={
                          hit.prospect_number == null
                            ? undefined
                            : prospects.data?.get(hit.prospect_number)
                        }
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** `owner` is filtered by email — a stable key. A display name is not unique. */
function ownerKey(p: PublicProspect): string {
  return p.owner?.email ?? ''
}

function order(t: string): number {
  const i = GROUP_ORDER.indexOf(t)
  return i === -1 ? GROUP_ORDER.length : i
}

function Hit({
  ws,
  hit,
  prospect,
}: {
  ws: string
  hit: SearchHit
  prospect?: PublicProspect
}) {
  const href = recordHref(ws, hit)
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm text-foreground">{hit.title}</span>
        {hit.number != null && (
          <span className="text-xs text-muted-foreground">#{hit.number}</span>
        )}
        {prospect && hit.type !== 'prospect' && (
          <span className="text-xs text-muted-foreground">on {prospect.name}</span>
        )}
        {prospect && <StageChip value={prospect.stage} />}
      </span>
      {hit.snippet && (
        // The snippet is drawn from the columns `platform.entities` never
        // holds. It is what makes this search visibly different from the
        // cross-app one, so it is shown rather than truncated away.
        <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
          {hit.snippet}
        </span>
      )}
    </>
  )

  if (!href) {
    return <div className="rounded-lg px-3 py-2">{body}</div>
  }
  return (
    <Link href={href} className="block rounded-lg px-3 py-2 transition-colors hover:bg-accent">
      {body}
    </Link>
  )
}

function FacetChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full border px-3 py-1 text-xs transition-colors ' +
        (active
          ? 'border-primary bg-primary/10 font-medium text-foreground'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')
      }
    >
      {label}
      {count != null && <span className="ml-1.5 opacity-70">{count}</span>}
    </button>
  )
}

/**
 * The dead end that names its own exit — `hintFor()` in the CLI, one layer up.
 *
 * The three cases are genuinely different and collapsing them is what makes a
 * "no results" screen useless: a filter hiding everything is a click away from
 * fixed, a term that matches nothing in b/sales may well match in another app,
 * and a term nothing anywhere matches is worth saying plainly.
 */
function NoResults({
  q,
  anyFilter,
  unfilteredCount,
  onClearFilters,
}: {
  q: string
  anyFilter: boolean
  unfilteredCount: number
  onClearFilters: () => void
}) {
  if (anyFilter && unfilteredCount > 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
        <p className="text-sm text-foreground">
          Nothing matches “{q}” with these filters.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          There {unfilteredCount === 1 ? 'is' : 'are'} {unfilteredCount} result
          {unfilteredCount === 1 ? '' : 's'} without them.
        </p>
        <button
          onClick={onClearFilters}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
        >
          Clear the filters
        </button>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-foreground">Nothing in b/sales matches “{q}”.</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        This searched the text of prospects, contacts, meetings, communications, objections and the
        catalog. Two things worth trying: a shorter term — matching is by whole word with a prefix
        on the last one, so <code className="rounded bg-muted px-1 py-0.5">roch</code> finds Roches
        but <code className="rounded bg-muted px-1 py-0.5">oches</code> does not — or, if the
        record you want lives in another app,{' '}
        <code className="rounded bg-muted px-1 py-0.5">bk issues search {q}</code>. There is no
        one command that searches both.
      </p>
    </div>
  )
}
