'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface PropertyOption {
  value: string
  label: string
  icon?: React.ReactNode
}

/**
 * Linear-style property picker: a quiet chip-button that opens a searchable
 * command list. Used in detail-page sidebars, create modals and filter bars
 * instead of native <select>.
 *
 * ===========================================================================
 * IT REPLACES A NATIVE <select>, SO IT OWES WHAT A NATIVE <select> GAVE AWAY
 * ===========================================================================
 * A native `<select>` is accessible for free: it announces itself as a combobox,
 * says whether it is expanded, exposes its options as options, reports which one
 * is selected, and is fully operable from the keyboard — all without anybody
 * writing a line for it. A custom picker gets none of that, and the swap is a
 * REGRESSION unless it is written back by hand.
 *
 * That is not hypothetical here: this component is what `apps/sales` moved its
 * six native `<select>`s onto on 2026-08-12, and the instruction was explicit
 * that keyboard access and `aria-*` had to end up at least as good as the
 * element being removed. Before that change this file had:
 *
 *   - no `aria-haspopup` and no `aria-expanded` on the trigger, so a screen
 *     reader announced a plain button and never said the menu had opened;
 *   - no `role="listbox"` / `role="option"` / `aria-selected`, so the options
 *     were announced as a list of buttons and the current value was carried
 *     only by a checkmark ICON — invisible to a screen reader;
 *   - keyboard navigation that lived entirely on the search input's `onKeyDown`,
 *     which meant `noSearch` pickers (every icon-only one in `apps/issues`
 *     listings) could be opened with the keyboard and then not operated with it.
 *     Enter did nothing, arrows did nothing, and Escape did nothing.
 *
 * So: the roles and states are declared below, and the key handling was moved
 * off the input onto the popup, which is where it works in both modes.
 * `aria-activedescendant` is what tells a screen reader which option is
 * highlighted while focus stays on the input (the standard combobox pattern) —
 * a `<ul>` full of `<li>`s with no active descendant announces nothing as the
 * highlight moves.
 *
 * `label` is optional but strongly wanted on a filter bar: `iconOnly` pickers
 * and pickers whose only text is the current VALUE ("All stages") have no
 * accessible name saying what they change, and "combobox, All stages" does not
 * tell anybody it filters by stage.
 */
export function PropertySelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Change…',
  buttonClassName,
  align = 'left',
  chevron = false,
  iconOnly = false,
  noSearch = false,
  label,
}: {
  value: string
  options: PropertyOption[]
  onChange: (v: string) => void
  placeholder?: string
  searchPlaceholder?: string
  buttonClassName?: string
  align?: 'left' | 'right'
  chevron?: boolean
  iconOnly?: boolean
  noSearch?: boolean
  /**
   * What this picker CHANGES, for assistive technology — "Stage", "Channel".
   * Rendered nowhere; it becomes the trigger's accessible name. Without it a
   * screen reader announces only the current value, which says what the answer
   * is and never what the question was.
   */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // Focus goes to the search input when there is one, and to the LIST when
      // there is not. The second half is what makes a `noSearch` picker
      // keyboard-operable at all: without it, focus stays on the trigger, the
      // popup receives no keys, and the component is mouse-only.
      requestAnimationFrame(() => {
        if (noSearch) listRef.current?.focus()
        else inputRef.current?.focus()
      })
    }
  }, [open, noSearch])

  const current = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  function choose(v: string) {
    onChange(v)
    setOpen(false)
    // Focus returns to the trigger, as it does when a native <select> closes.
    // Leaving it on a node that just unmounted drops the user at the top of the
    // document, which on a filter bar means losing your place in the page.
    requestAnimationFrame(() => buttonRef.current?.focus())
  }

  /** Arrow / Enter / Escape / Home / End — shared by both modes. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setHighlight(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setHighlight(Math.max(filtered.length - 1, 0))
    } else if (e.key === 'Enter' || (noSearch && e.key === ' ')) {
      // Space selects only when there is no search box; with one it is a
      // character somebody is typing into a filter.
      e.preventDefault()
      const opt = filtered[highlight]
      if (opt) choose(opt.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      requestAnimationFrame(() => buttonRef.current?.focus())
    } else if (e.key === 'Tab') {
      // Tabbing away closes, matching every other menu on the platform. Not
      // prevented — the focus move itself is what the user asked for.
      setOpen(false)
    }
  }

  const listboxId = `${baseId}-listbox`
  const activeId = filtered[highlight] ? `${baseId}-opt-${highlight}` : undefined

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          // ArrowDown opens the menu from the closed trigger, which is what a
          // native <select> does and what a keyboard user reaches for first.
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={label}
        className={
          buttonClassName ??
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary'
        }
      >
        {current?.icon ? <span className="shrink-0">{current.icon}</span> : null}
        {!iconOnly ? (
          <span className={`truncate ${current ? '' : 'text-muted-foreground'}`}>
            {current?.label ?? placeholder}
          </span>
        ) : null}
        {chevron ? <ChevronDown size={12} className="ml-auto shrink-0 text-muted-foreground" /> : null}
      </button>

      {open ? (
        <div
          className={`absolute top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-xl duration-100 animate-in fade-in zoom-in-95 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {!noSearch ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              // The combobox trio: the input owns focus, the listbox is the
              // popup it controls, and `aria-activedescendant` names the option
              // the arrow keys have landed on. Without the third, the highlight
              // moves visually and is announced to nobody.
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label={label ? `${label} — filter options` : searchPlaceholder}
              placeholder={searchPlaceholder}
              className="w-full border-b border-border bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground"
            />
          ) : null}
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            // Focusable ONLY in noSearch mode, where it is the thing that holds
            // focus. With a search box the input holds focus and a second tab
            // stop here would be a keyboard trap between two halves of one
            // control.
            tabIndex={noSearch ? -1 : undefined}
            aria-activedescendant={noSearch ? activeId : undefined}
            onKeyDown={noSearch ? onKeyDown : undefined}
            className="max-h-64 overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.value || '∅'}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                >
                  <button
                    type="button"
                    // The row is the option; the button inside it is a mouse
                    // target. `tabIndex={-1}` keeps it out of the tab order so
                    // Tab leaves the control instead of walking every choice.
                    tabIndex={-1}
                    onClick={() => choose(o.value)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${
                      i === highlight ? 'bg-secondary' : ''
                    }`}
                  >
                    {o.icon ? <span className="shrink-0">{o.icon}</span> : null}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.value === value ? (
                      <Check size={13} className="shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
