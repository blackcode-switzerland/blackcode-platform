'use client'

// Workspace search: a floating button that opens a chat-style popup, over
// `GET /api/workspaces/{ws}/issues-search` (see that route's header for why it is
// not the platform `/search`). Opened by the button, by ⌘K / Ctrl+K, by `/`, and
// by the Search row in the sidebar — one piece of state, owned by the layout.
//
// The popup is a listbox driven from the input (`aria-activedescendant`), so
// focus never leaves the field: arrows move, Enter opens, Esc closes. Its height
// is FIXED while open, so the field does not jump as results arrive.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CornerDownLeft,
  History,
  MessageSquare,
  Search,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { AnimatePresence, motion, Skeleton } from '@blackcode/platform-ui/ui/motion'
import { MemberAvatar } from '@blackcode/platform-ui/ui/member-avatar'
import { cn } from '@blackcode/platform-ui/utils'
import { StatusIcon } from '../ui/work-item-icons'
import { ProjectIcon } from '../project-icon'
import { highlightSegments } from '@/lib/search-highlight'
import {
  SEARCH_PER_TYPE_DEFAULT,
  SEARCH_TYPES,
  searchNumber,
  type SearchHit,
  type SearchType,
} from '@/lib/search-types'
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
} from '@/lib/recent-searches'
import { useWorkspaceSearch } from './use-workspace-search'

const TYPE_LABEL: Record<SearchType, { one: string; many: string }> = {
  issue: { one: 'Issue', many: 'Issues' },
  task: { one: 'Task', many: 'Tasks' },
  project: { one: 'Project', many: 'Projects' },
  label: { one: 'Label', many: 'Labels' },
  member: { one: 'Person', many: 'People' },
  comment: { one: 'Comment', many: 'Comments' },
}

/** ⌘ on a Mac, Ctrl elsewhere. Resolved after mount so server and client markup agree. */
export function useModKey(): string {
  const [mod, setMod] = useState('Ctrl')
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform)) setMod('⌘')
  }, [])
  return mod
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-[3px] bg-primary/15 px-px text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}

function HitIcon({ hit }: { hit: SearchHit }) {
  const box = 'flex size-5 shrink-0 items-center justify-center'
  switch (hit.type) {
    case 'issue':
      return (
        <span className={box}>
          <StatusIcon status={hit.status ?? 'backlog'} size={15} />
        </span>
      )
    case 'task':
      return <Target size={15} className={cn(box, 'text-muted-foreground')} />
    case 'project':
      return <ProjectIcon icon={hit.icon} color={hit.color} name={hit.title} size={20} className="!rounded-md" />
    case 'label':
      return (
        <span className={box}>
          <span className="size-2.5 rounded-full" style={{ background: hit.color ?? '#6b7280' }} />
        </span>
      )
    case 'member':
      return <MemberAvatar name={hit.title} email={hit.detail} avatarUrl={hit.avatar_url} size={20} />
    case 'comment':
      return <MessageSquare size={15} className={cn(box, 'text-muted-foreground')} />
  }
}

function Row({
  hit,
  id,
  query,
  active,
  onHover,
  onOpen,
}: {
  hit: SearchHit
  id: string
  query: string
  active: boolean
  onHover: () => void
  onOpen: (e: React.MouseEvent) => void
}) {
  const number = hit.parent?.number ?? hit.number
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onOpen}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2',
        active ? 'bg-accent' : 'hover:bg-accent/50'
      )}
    >
      <span className="mt-px">
        <HitIcon hit={hit} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {number != null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {hit.type === 'comment' ? 'on ' : ''}#{number}
            </span>
          )}
          <span className="truncate text-sm font-medium">
            {hit.type === 'comment' ? hit.title : <Marked text={hit.title} query={query} />}
          </span>
          {hit.deleted && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground">
              <Trash2 size={9} /> In trash
            </span>
          )}
        </div>
        {hit.snippet ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {hit.detail && hit.type === 'comment' && (
              <span className="font-medium text-foreground/70">{hit.detail}: </span>
            )}
            <Marked text={hit.snippet} query={query} />
          </p>
        ) : hit.detail ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <Marked text={hit.detail} query={query} />
          </p>
        ) : null}
      </div>
      {active && <CornerDownLeft size={13} className="mt-1 shrink-0 text-muted-foreground" />}
    </div>
  )
}

export function GlobalSearch({
  open,
  onOpenChange,
  workspaceSlug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string | undefined
}) {
  const router = useRouter()
  const mod = useModKey()
  const inputRef = useRef<HTMLInputElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [type, setType] = useState<SearchType | null>(null)
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  activeRef.current = active
  const [recent, setRecent] = useState<string[]>([])

  const { hits, answeredQuery, pending, firstLoad, error, refetch } = useWorkspaceSearch(workspaceSlug, query, type)

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  // ── global shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceSlug) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      } else if (e.key === '/' && !open && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange, workspaceSlug])

  // ── open / close housekeeping ─────────────────────────────────────────────
  // Closing does NOT reset anything: query, type chip, cursor and scroll all
  // survive, so after opening a hit you can reopen the popup exactly where you
  // left it and work down the list. State resets only when the workspace
  // changes or the query is cleared (see below).
  useEffect(() => {
    if (!open) return
    setRecent(readRecentSearches(workspaceSlug ?? ''))
    // After the enter animation has mounted the field. select() so typing a new
    // query replaces the old one, while arrows/Enter still work on the old list.
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
      document.getElementById(`gs-opt-${activeRef.current}`)?.scrollIntoView({ block: 'nearest' })
    }, 60)
    return () => clearTimeout(t)
  }, [open, workspaceSlug])

  // A different workspace is a different search.
  const lastSlug = useRef(workspaceSlug)
  useEffect(() => {
    if (lastSlug.current === workspaceSlug) return
    lastSlug.current = workspaceSlug
    setQuery('')
    setType(null)
    setActive(0)
  }, [workspaceSlug])

  // Click outside closes it — a search popup, not a chat window that stays.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || fabRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  // ── the answer, grouped in the server's type order ────────────────────────
  const groups = useMemo(
    () =>
      SEARCH_TYPES.map((t) => ({ type: t, hits: hits.filter((h) => h.type === t) })).filter((g) => g.hits.length > 0),
    [hits]
  )
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])
  const rowId = (i: number) => `gs-opt-${i}`

  // A new answer restarts the cursor at the top; a `#42` query lands on the
  // exact-number hit because the server ranks it first.
  useEffect(() => {
    setActive(0)
  }, [answeredQuery, type])

  useEffect(() => {
    document.getElementById(rowId(active))?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const openHit = (hit: SearchHit, newTab: boolean) => {
    if (workspaceSlug) pushRecentSearch(workspaceSlug, query)
    if (newTab) {
      window.open(hit.path, '_blank', 'noopener')
      return
    }
    close()
    router.push(hit.path)
  }

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (flat.length === 0) return
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + d + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      const hit = flat[active]
      if (hit) {
        e.preventDefault()
        openHit(hit, e.metaKey || e.ctrlKey)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      fabRef.current?.focus()
    }
  }

  const trimmed = query.trim()
  const settled = trimmed.length > 0 && !pending
  // Only an explicit `#N` is a jump; a bare number is an ordinary text search.
  const exactNumber = /^#\d+$/.test(trimmed) ? searchNumber(trimmed) : null

  return (
    <>
      {/* The floating button. Bottom-right, above page content, below dialogs. */}
      {workspaceSlug && (
        <button
          ref={fabRef}
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-label={open ? 'Close search' : 'Search workspace'}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={`Search (${mod}${mod === '⌘' ? '' : '+'}K)`}
          className="fixed bottom-5 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/25 ring-1 ring-black/5 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 sm:right-5"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? 'x' : 's'}
              initial={{ rotate: -60, opacity: 0, scale: 0.7 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 60, opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.15 }}
              className="flex"
            >
              {open ? <X size={20} /> : <Search size={20} />}
            </motion.span>
          </AnimatePresence>
        </button>
      )}

      <AnimatePresence>
        {open && workspaceSlug && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="Search workspace"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 420 }}
            style={{ transformOrigin: 'bottom right' }}
            className="fixed inset-x-3 bottom-[4.5rem] z-50 flex h-[min(620px,calc(100dvh-6.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl shadow-black/30 sm:inset-x-auto sm:right-5 sm:w-[460px]"
          >
            {/* Field */}
            <div className="flex items-center gap-2.5 border-b border-border px-3.5">
              <Search size={16} className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value.trim() === '') setType(null)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Search issues, tasks, projects, people…"
                role="combobox"
                aria-expanded
                aria-controls="gs-listbox"
                aria-activedescendant={flat[active] ? rowId(active) : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              />
              {pending && (
                <span
                  aria-label="Searching"
                  className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary"
                />
              )}
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setType(null)
                    setActive(0)
                    inputRef.current?.focus()
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Type chips */}
            <div className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [scrollbar-width:none]" role="group" aria-label="Filter by type">
              {[null, ...SEARCH_TYPES].map((t) => {
                const on = type === t
                return (
                  <button
                    key={t ?? 'all'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setType(t)
                      inputRef.current?.focus()
                    }}
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      on
                        ? 'bg-primary/12 text-primary ring-1 ring-primary/30'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                  >
                    {t ? TYPE_LABEL[t].many : 'All'}
                  </button>
                )
              })}
            </div>

            {/* Body */}
            <div
              ref={listRef}
              id="gs-listbox"
              role="listbox"
              aria-label="Search results"
              className={cn('min-h-0 flex-1 overflow-y-auto p-1.5 transition-opacity', pending && !firstLoad && 'opacity-70')}
            >
              {trimmed.length === 0 ? (
                <div className="px-2 py-2">
                  {recent.length > 0 && (
                    <>
                      <div className="mb-1 flex items-center justify-between px-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent</span>
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            clearRecentSearches(workspaceSlug)
                            setRecent([])
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      {recent.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => {
                            setQuery(r)
                            inputRef.current?.focus()
                          }}
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent/60"
                        >
                          <History size={14} className="text-muted-foreground" />
                          <span className="truncate">{r}</span>
                        </button>
                      ))}
                    </>
                  )}
                  <div className={cn('space-y-2 px-1 text-xs leading-relaxed text-muted-foreground', recent.length > 0 && 'mt-4 border-t border-border pt-3')}>
                    <p className="font-medium text-foreground/80">Search the whole workspace</p>
                    <p>Titles, descriptions, labels, people and comments — every word you type must match.</p>
                    <p>
                      Type <kbd className="rounded border border-border bg-secondary px-1 font-mono text-[10px]">#42</kbd> to jump to a
                      number, or pick a type above to see everything of that kind.
                    </p>
                  </div>
                </div>
              ) : firstLoad ? (
                <div className="space-y-1 p-1" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
                      <Skeleton className="size-5 rounded-md" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/5" />
                        <Skeleton className="h-3 w-4/5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="text-sm font-medium">Search failed</p>
                  <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
                  <button type="button" onClick={() => refetch()} className="mt-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-accent">
                    Retry
                  </button>
                </div>
              ) : flat.length === 0 && settled ? (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
                  <p className="text-sm font-medium">
                    No results for “<span className="break-all">{trimmed}</span>”
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {type ? (
                      <>
                        Nothing in {TYPE_LABEL[type].many.toLowerCase()}.{' '}
                        <button type="button" className="text-primary hover:underline" onClick={() => setType(null)}>
                          Search everything
                        </button>
                      </>
                    ) : exactNumber !== null ? (
                      `Nothing in this workspace is numbered #${exactNumber}.`
                    ) : (
                      'Try fewer or shorter words — every word has to match.'
                    )}
                  </p>
                </div>
              ) : (
                (() => {
                  let offset = 0
                  return groups.map((g) => {
                    const start = offset
                    offset += g.hits.length
                    const capped = type === null && g.hits.length >= SEARCH_PER_TYPE_DEFAULT
                    return (
                      <div key={g.type} role="group" aria-label={TYPE_LABEL[g.type].many} className="mb-1">
                        <div className="flex items-center justify-between px-2.5 pb-0.5 pt-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {TYPE_LABEL[g.type].many}
                          </span>
                          {capped && (
                            <button
                              type="button"
                              onClick={() => {
                                setType(g.type)
                                inputRef.current?.focus()
                              }}
                              className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              See all <ArrowRight size={11} />
                            </button>
                          )}
                        </div>
                        {g.hits.map((h, i) => (
                          <Row
                            key={`${h.type}-${h.id}`}
                            hit={h}
                            id={rowId(start + i)}
                            query={answeredQuery}
                            active={start + i === active}
                            onHover={() => setActive(start + i)}
                            onOpen={(e) => openHit(h, e.metaKey || e.ctrlKey)}
                          />
                        ))}
                      </div>
                    )
                  })
                })()
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
