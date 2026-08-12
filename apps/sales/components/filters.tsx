'use client'

// The filter bar, once, for every listing that has one.
//
// ===========================================================================
// ONE FILTER IDIOM, AND WHY IT IS A MODULE RATHER THAN A CONVENTION
// ===========================================================================
// Before this file there were three: `prospects-page.tsx` built a bar out of an
// input and a native `<select>` inline, `ledger-pages.tsx` had a private
// `FilterBar` that took exactly one select, and `catalog-pages.tsx` had none at
// all and rendered its document kinds as a legend with a comment explaining that
// a control there "would out-weigh what it filters". Adding the filters this
// change asks for to each of those would have produced a fourth and a fifth.
//
// So the pieces live here and every listing composes them. The properties that
// come with that are the ones no page can then get wrong on its own:
//
//   THE URL HOLDS THE STATE. `?status=upcoming&prospect=3`, never component
//   state. A filtered view is a thing somebody sends to a colleague, and it has
//   to survive a reload. `prospects-page.tsx` set that precedent; this keeps it.
//
//   "NO RECORDS" AND "NO MATCHES" ARE DIFFERENT SENTENCES. `FilteredEmpty`
//   below exists because they were the same one on three pages: a workspace
//   with fifty meetings, filtered to `cancelled`, said "No meetings" — which is
//   the shape of bug this repo keeps finding, because it reads as data loss and
//   a reader has no way to tell it from the real thing.
//
//   NOTHING IS A NATIVE <select>. See `FilterSelect`.
//
// ===========================================================================
// WHY `PropertySelect` AND NOT SHADCN
// ===========================================================================
// There is no shadcn `select` in this repo — the brief that asked for one was
// mistaken about that. What exists is `@blackcode/platform-ui/ui/property-select`,
// a searchable Linear-style picker shared by both apps, which is the consistency
// the request was actually after. It is built for detail-page sidebars, so the
// question was whether it survives a compact filter bar: it does, through
// `buttonClassName`, which is the same escape hatch `apps/issues`' listings
// already use to render it icon-only inside a table row. No new variant and no
// new dependency were needed.
//
// What it DID need was accessibility. A native `<select>` announces itself, its
// expanded state, its options and its selection for free, and `PropertySelect`
// did none of that and could not be operated from the keyboard at all in
// `noSearch` mode. Swapping one for the other would have been a regression
// dressed as consistency, so the roles, states and key handling were written
// into the shared component first — see its header. Both apps get that.

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { PropertySelect } from '@blackcode/platform-ui/ui/property-select'
import { EmptyState } from '@/components/states'
import type { Option } from '@/lib/pipeline'

/**
 * Read and write one URL parameter.
 *
 * `replace`, not `push`: typing in a filter should not build a back-button
 * history one character deep. `scroll: false` because re-filtering a list the
 * reader is halfway down must not throw them back to the top.
 */
export function useFilterParam(key: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const set = (v: string) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    if (v) next.set(key, v)
    else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  return [params?.get(key) ?? '', set] as const
}

/**
 * A repeatable URL parameter, held as one comma-separated value.
 *
 * `?tag=deck,pricing` rather than `?tag=deck&tag=pricing`, because that is the
 * shape the route's `parseList` reads and the shape `bk sales doc list --tag`
 * sends. One encoding across the web, the CLI and the route means the three
 * cannot disagree about what two tags mean.
 */
export function useFilterList(key: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = params?.get(key) ?? ''
  const values = useMemo(
    () => raw.split(',').map((s) => s.trim()).filter(Boolean),
    [raw]
  )
  const toggle = (v: string) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    const set = values.includes(v) ? values.filter((x) => x !== v) : [...values, v]
    if (set.length) next.set(key, set.join(','))
    else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  return [values, toggle] as const
}

/** The compact chip-button styling that makes a sidebar picker a filter control. */
const FILTER_BUTTON =
  'flex h-9 items-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-sm ' +
  'text-foreground outline-none transition-colors hover:bg-accent focus-visible:border-ring'

/**
 * One filter dropdown.
 *
 * `allLabel` is prepended as the empty value rather than being a separate
 * "clear" affordance, because "All stages" is how a person reads an unset
 * filter and because it keeps the control's width from jumping between states.
 *
 * `label` is passed through to `PropertySelect` as the accessible name. It is
 * required here, not optional as it is there: on a filter bar the visible text
 * is the VALUE ("All stages"), so without it the control announces its answer
 * and never its question.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Option[] | { value: string; label: string }[]
  allLabel: string
}) {
  const opts = useMemo(
    () => [{ value: '', label: allLabel }, ...options.map((o) => ({ value: o.value, label: o.label }))],
    [options, allLabel]
  )
  return (
    <PropertySelect
      label={label}
      value={value}
      options={opts}
      onChange={onChange}
      placeholder={allLabel}
      searchPlaceholder={`Filter ${label.toLowerCase()}…`}
      buttonClassName={FILTER_BUTTON}
      chevron
      // No search box on a short vocabulary: a combobox that filters five
      // options costs a keystroke and an extra tab stop to save nothing. The
      // longer lists — prospects, products — keep theirs.
      noSearch={opts.length <= 8}
    />
  )
}

/** The free-text box, so the three listings that have one look the same. */
export function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-56 rounded-lg border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
    />
  )
}

/**
 * A toggleable tag.
 *
 * Tags are free text with no vocabulary and therefore no colour of their own —
 * `lib/pipeline.ts` owns every colour in this app and has nothing to say about
 * a string somebody typed — so this uses the neutral chrome tokens and shows
 * selection through the border and weight instead of a hue.
 *
 * `aria-pressed` rather than a checkbox role: it is a toggle button, and a
 * screen reader saying "pricing, pressed" is exactly what the visual state
 * means.
 */
export function TagFilterChip({
  tag,
  active,
  onToggle,
}: {
  tag: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-4 transition-colors ' +
        (active
          ? 'border-primary bg-primary/10 font-medium text-foreground'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground')
      }
    >
      {tag}
    </button>
  )
}

/** "Clear", shown only when there is something to clear. */
export function ClearFilters({ active, keep = [] }: { active: boolean; keep?: string[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  if (!active) return null
  return (
    <button
      onClick={() => {
        // Parameters that are not filters survive — `?tab=` on the prospect
        // page, `?view=board` on prospects. Clearing the filters must not also
        // throw the reader out of the view they are in, which is what
        // `router.replace(pathname)` did on both pages that used to do this.
        const next = new URLSearchParams()
        for (const k of keep) {
          const v = params?.get(k)
          if (v) next.set(k, v)
        }
        const qs = next.toString()
        router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ''), { scroll: false })
      }}
      className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <X size={14} />
      Clear
    </button>
  )
}

/** The bar itself — one place that decides how filters are spaced and wrap. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

/**
 * The empty state, told apart.
 *
 * ── THIS IS THE POINT OF THE FILE ───────────────────────────────────────────
 * A listing that says "No meetings" to somebody who has fifty of them, because
 * they filtered to `cancelled`, is indistinguishable from a listing that says
 * "No meetings" because the data is gone. One is a filter working and the other
 * is an outage, and a reader cannot tell which they are looking at. The repo
 * has a name for this shape — it is `unreconciled_count`'s lesson and
 * `states.tsx`'s "the most reassuring wrong answer this app could give" — and it
 * is worth a component rather than a convention because it is a sentence every
 * listing has to get right independently.
 *
 * `filtered` decides the sentence; the caller passes the two hints it has.
 */
export function FilteredEmpty({
  filtered,
  emptyTitle,
  emptyHint,
  noun,
}: {
  filtered: boolean
  emptyTitle: string
  emptyHint?: string
  /** Plural, lowercase — "meetings", "documents". Used in the no-match line. */
  noun: string
}) {
  return filtered ? (
    <EmptyState
      title={`No ${noun} match this filter`}
      hint="Clear the filter to see everything that is here."
    />
  ) : (
    <EmptyState title={emptyTitle} hint={emptyHint} />
  )
}
