'use client'

// `<VocabChip>` and `<EntityChip>` — the two components that get their colour
// from the SERVER.
//
// ===========================================================================
// NOT ONE VOCABULARY COLOUR IS SPELLED IN THIS FILE, OR IN app/globals.css
// ===========================================================================
// Recognition states, evidence tiers, entry statuses, source statuses and
// manifest states all arrive from `GET /api/meta` with their `color` and `icon`
// attached, and each book carries its own `accent`. That is how the mockup does
// it and it is worth keeping for one concrete reason: **a value added on the
// server must render correctly with no frontend release.**
//
// A `switch (recognition)` here, or a `.is-inferred { color: … }` in the
// stylesheet, is a second copy of a vocabulary that nobody keeps in sync. It
// goes stale the day somebody adds a state, and the failure is silent — the new
// state renders in the default grey and looks deliberate.
//
// So the only knowledge this file has about a vocabulary is that terms have a
// `value`, a `label` and maybe a `color`. Everything else comes down the wire.
//
// ── AN UNKNOWN VALUE STILL RENDERS ─────────────────────────────────────────
// If a term is not in the served vocabulary — a state added since this bundle
// loaded — the chip draws the raw value in the neutral treatment instead of
// throwing or rendering nothing. Legible, obviously un-styled, and fixed by a
// reload rather than by a deploy. Rendering nothing would hide a real value from
// the reader, which is the worse of the two failures in a bookkeeping screen.
//
// ── WHY THE COLOUR IS MIXED RATHER THAN USED RAW ───────────────────────────
// The served colours were chosen against the mockup's dark ink. Used as raw text
// on this app's cream light theme, the green (#3fb27f) and the amber (#f0b66b)
// are close to unreadable. `color-mix(… var(--foreground))` pulls each one
// toward the current theme's text colour — darker in light mode, lighter in dark
// mode — so one served hex works in both without the server knowing which theme
// the reader is in, and without a second palette here to go stale.

import type { Term } from '@/lib/types'
import type { Entity } from '@/lib/types'
import { useMeta, findTerm, type VocabularyName } from '@/lib/hooks'

/** The pill shape both chips share. The mockup's: small, uppercase, tracked. */
const PILL =
  'inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap'

/**
 * The colour treatment, derived from one served hex.
 *
 * `color-mix` is doing the theme-awareness. Returning undefined for a term with
 * no colour lets the CSS classes below supply the neutral fallback, so "this
 * vocabulary has no colours" (source types, source layers) is not a special case
 * anybody has to write.
 */
function tint(color: string | null | undefined): React.CSSProperties | undefined {
  if (!color) return undefined
  return {
    // The ratio is `--chip-mix` and NOT a literal, because it has to differ per
    // theme: 62% here failed WCAG AA on three of the seven served colours in the
    // light theme (measured 2026-08-17, F5 of the review). The token carries the
    // measurements and the reason; changing it here instead would put the light
    // theme back under 4.5:1 with nothing to say so.
    color: `color-mix(in oklab, ${color} var(--chip-mix), var(--foreground))`,
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
  }
}

export function VocabChip({
  vocabulary,
  value,
  /** Show the term's legal `note` as a tooltip. Evidence tiers carry one. */
  withNote = false,
  className = '',
}: {
  vocabulary: VocabularyName
  value: string | null | undefined
  withNote?: boolean
  className?: string
}) {
  const { data: meta } = useMeta()
  if (!value) return null
  const term = findTerm(meta, vocabulary, value)
  return <TermChip term={term} value={value} withNote={withNote} className={className} />
}

/**
 * The same chip for a term the caller already has in hand.
 *
 * Exported because a table that renders a hundred rows should look the
 * vocabulary up once rather than a hundred times — `findTerm` is cheap, but a
 * hundred `useMeta()` subscriptions are not free and the indirection is worth
 * making avoidable.
 */
export function TermChip({
  term,
  value,
  withNote = false,
  className = '',
}: {
  term: Term | null
  value: string
  withNote?: boolean
  className?: string
}) {
  const style = tint(term?.color)
  return (
    <span
      className={
        PILL +
        (style ? ' ' : ' border-border bg-secondary text-muted-foreground ') +
        className
      }
      style={style}
      title={withNote ? (term?.note ?? undefined) : undefined}
      // The raw value, for an agent reading the DOM and for the phase-1 parity
      // check. The label is presentation; this is the fact.
      data-value={value}
    >
      {term?.label ?? value}
    </span>
  )
}

/**
 * `<EntityChip>` — a book's name in its own accent.
 *
 * The accent is `entity.accent`, served per book, so a new book needs no
 * frontend change and there is no map from slug to colour anywhere in this app
 * (D-D: nothing may hardcode `blackcode`, `aios` or `ri`).
 *
 * **The accent is not this app's colour.** `--primary` (amber) means "you are in
 * b/books"; an entity accent means "these numbers belong to this book". The
 * accent belongs on this chip and in the book switcher, and nowhere else — see
 * decision D-B, which exists because the two are easy to confuse and the mockup's
 * own gold happens to be one book's accent.
 */
export function EntityChip({
  entity,
  /** Add the legal form (`SA`, `RI`) after the name. */
  withForm = false,
  className = '',
}: {
  entity: Entity | null | undefined
  withForm?: boolean
  className?: string
}) {
  if (!entity) return null
  return (
    <span
      className={PILL + ' ' + className}
      style={tint(entity.accent)}
      data-entity={entity.slug}
    >
      {entity.name}
      {withForm && (
        <span className="opacity-70">· {entity.legal_form}</span>
      )}
    </span>
  )
}
