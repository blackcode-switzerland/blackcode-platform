'use client'

// Which issuing company a screen is about: `?company=<slug>` on the current
// URL, or no parameter for "All companies".
//
// The URL is the state, deliberately — not a context, not localStorage. The
// overview, invoice, recurrence and history routes all take `company` as a
// filter, so a page passes `useCompanyParam()` straight into its query hook,
// a link to a filtered view is shareable, and the back button undoes a switch.
// The sidebar carries the parameter between company-scoped screens.

import { useEffect, useRef, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, Check, ChevronDown } from 'lucide-react'
import { useCompanies } from '@/lib/queries'
import { cn } from '@/lib/utils'

/** The selected company slug, or null for all companies. */
export function useCompanyParam(): string | null {
  const search = useSearchParams()
  const v = search?.get('company')
  return v ? v : null
}

/** Set or clear `?company=` on the current URL, keeping every other parameter. */
export function useSetCompanyParam() {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const search = useSearchParams()
  return (slug: string | null) => {
    const next = new URLSearchParams(search?.toString() ?? '')
    if (slug) next.set('company', slug)
    else next.delete('company')
    // A cursor belongs to the previous filter's result set.
    next.delete('cursor')
    const q = next.toString()
    router.push(q ? `${pathname}?${q}` : pathname)
  }
}

export function CompanySwitcher({ ws: wsProp, className }: { ws?: string; className?: string }) {
  const params = useParams<{ ws: string }>()
  const ws = wsProp ?? params?.ws ?? ''
  const selected = useCompanyParam()
  const setCompany = useSetCompanyParam()
  const companies = useCompanies(ws, {}, { enabled: !!ws })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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

  const list = companies.data ?? []
  const current = list.find((c) => c.slug === selected)
  // A slug in the URL that is not (or no longer) a company still filters the
  // API — which answers with its own error. Show the slug rather than "All".
  const label = selected ? (current?.name ?? selected) : 'All companies'

  const pick = (slug: string | null) => {
    setOpen(false)
    if (slug !== selected) setCompany(slug)
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="company-switcher"
        className="flex h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[13px] transition-colors hover:bg-accent"
      >
        <Building2 size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="max-h-80 overflow-y-auto py-1">
            <Option active={!selected} onClick={() => pick(null)} testId="company-option-all">
              All companies
            </Option>
            {companies.isPending && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
            {companies.error && (
              <p className="px-3 py-2 text-xs text-destructive">Could not load companies.</p>
            )}
            {list.map((c) => (
              <Option key={c.slug} active={c.slug === selected} onClick={() => pick(c.slug)} testId={`company-option-${c.slug}`}>
                <span className="block truncate">{c.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{c.slug}</span>
              </Option>
            ))}
            {!companies.isPending && !companies.error && list.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">No companies yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Option({
  active,
  onClick,
  testId,
  children,
}: {
  active: boolean
  onClick: () => void
  testId: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-accent"
    >
      <span className="min-w-0 flex-1">{children}</span>
      {active && <Check size={14} className="shrink-0 text-primary" />}
    </button>
  )
}
