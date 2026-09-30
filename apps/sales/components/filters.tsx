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

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronDown, X } from 'lucide-react'
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

/**
 * A REPEATED URL parameter: `?city=Lausanne&city=Genève`.
 *
 * The counterpart of `useFilterList` for FREE-TEXT dimensions. `useFilterList`
 * joins with commas, which is right for tags and stages and wrong for a city —
 * "Biel/Bienne, BE" is one value, and a comma-joined encoding turns it into two
 * that match nothing. This is the shape the prospects route reads
 * (`repeated()` in `lib/http-input.ts`) and `bk sales prospect list --city a
 * --city b` sends, so the web, the CLI and the route cannot disagree about what
 * two cities mean (#98).
 */
export function useFilterMulti(key: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const values = params?.getAll(key).filter(Boolean) ?? []
  // Stable identity for effect/query keys: a fresh array every render would
  // refetch the list on every render.
  const stable = useMemo(() => values, [values.join('\u0000')]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: string[]) => {
    const q = new URLSearchParams(params?.toString() ?? '')
    q.delete(key)
    for (const v of next) q.append(key, v)
    router.replace(`${pathname}?${q.toString()}`, { scroll: false })
  }
  return [stable, set] as const
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

/**
 * A filter that takes SEVERAL values — checkboxes in a popover (#98).
 *
 * `FilterSelect` is one-of-many and the prospects filters are any-of-many
 * ("Lausanne OR Genève"), so it cannot serve. Native checkboxes rather than a
 * bespoke listbox because they bring their own accessibility: each is announced
 * with its label and state, and Space toggles it, with nothing written here.
 *
 * WHAT IT DOES NOT DO is build its own options. `options` come from the caller,
 * from the data (`useProspectFacets`), so a value written by an agent tomorrow
 * is a checkbox tomorrow with no code change — the point of #98.
 *
 * A value that is SELECTED but no longer in `options` (a bookmarked URL naming a
 * city that has since been renamed) is still shown, ticked, so the reader can see
 * what is filtering their list and untick it. Dropping it silently would leave a
 * page filtered by something invisible.
 */
export function FilterMultiSelect({
  label,
  values,
  onChange,
  options,
  allLabel,
}: {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  options: Array<{ value: string; label: string; count?: number }>
  allLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.value.toLowerCase()))
    const orphans = values
      .filter((v) => !known.has(v.toLowerCase()))
      .map((v) => ({ value: v, label: v, count: undefined as number | undefined }))
    return [...orphans, ...options]
  }, [options, values])
  const shown = search.trim()
    ? all.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : all
  const selected = (v: string) => values.some((x) => x.toLowerCase() === v.toLowerCase())
  const toggle = (v: string) =>
    onChange(selected(v) ? values.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...values, v])

  const summary =
    values.length === 0 ? allLabel : values.length === 1 ? values[0]! : `${label} · ${values.length}`

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`${label}: ${values.length === 0 ? allLabel : values.join(', ')}`}
        onClick={() => setOpen((o) => !o)}
        className={FILTER_BUTTON + (values.length ? ' border-primary/50' : '')}
      >
        <span className="max-w-[10rem] truncate">{summary}</span>
        <ChevronDown size={14} className="text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          {all.length > 8 && (
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              aria-label={`Filter ${label.toLowerCase()} options`}
              className="mb-1 h-8 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus:border-ring"
            />
          )}
          <ul className="max-h-64 overflow-y-auto">
            {shown.length === 0 && (
              <li className="px-2 py-2 text-xs text-muted-foreground">Nothing to choose from.</li>
            )}
            {shown.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selected(o.value)}
                    onChange={() => toggle(o.value)}
                    className="sr-only peer"
                  />
                  <span
                    aria-hidden
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  >
                    {selected(o.value) && <Check size={12} className="text-primary-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count != null && (
                    <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
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
