'use client'

// `<PostedOnlyNote>` — the sentence that makes a statement reconcilable.
//
// ===========================================================================
// WHY A STATEMENT HAS TO SAY WHAT IT LEFT OUT
// ===========================================================================
// `/bilan` and `/compte-resultat` derive from POSTED entries only. That is
// almost certainly correct accounting — staged money has no agreed meaning yet —
// and it was not written anywhere on either screen.
//
// The gap that exposes it is the drill-down. On the seeded books, the income
// statement's *Autres charges d'exploitation* reads 3'063.60; following its own
// link into account 6570 lists postings totalling 147.10, because the ledger
// shows staged rows and the statement did not count them. The arithmetic is
// right on both sides and they do not agree, and a reader checking a figure the
// way the page invites them to has been given nothing to resolve it with.
//
// This product's claim is that its records are audit DEFENSIBLE. A statement
// that cannot be reconciled to its own drill-down is the thing that phrase
// exists to rule out, so the exclusion is disclosed rather than implied.
//
// Found by the phase-1 review, 2026-08-18 (F1). The overview already said this
// in its own words; the two screens a fiduciary actually reads did not.

'use client'

import { useEntries } from '@/lib/hooks'
import { useT } from '@/lib/i18n'
import type { ReadScope } from '@/lib/hooks'
import type { Journal } from '@/lib/journal'

/**
 * ── IT TAKES THE JOURNAL, AND `?status=` IS THE REASON ───────────────────
 * The count below asks `GET …/entries?status=staged`, and since phase 4A a
 * SIMPLIFIED book refuses that filter outright (400 `ri_no_such_filter`) rather
 * than ignoring it. Both call sites gate this component on the statement having
 * come back, and a simplified book has neither statement — so `grand_livre` is
 * what actually reaches here today. It is passed rather than assumed anyway:
 * this note's whole existence is because a sentence that is true for one book
 * was being printed over another, and "the caller happens to gate it" is not a
 * thing the compiler holds.
 */
export function PostedOnlyNote({
  ws,
  scope,
  journal,
}: {
  ws: string | undefined
  scope: ReadScope
  journal: Journal | null
}) {
  // Counted rather than asserted. "Posted entries only" is always true and is
  // said unconditionally; the COUNT is what turns a policy note into something
  // the reader can act on, and a number nobody has fetched would be a guess.
  const t = useT()
  const { data: staged } = useEntries(ws, scope, journal, { status: 'staged' })
  const n = staged?.length ?? 0

  return (
    <p className="mt-1.5 text-[12.5px] text-muted-foreground">
      <span className="font-medium text-foreground">{t('statements.postedOnlyLead')}</span>{' '}
      {/* Singular and plural are TWO DICTIONARY ENTRIES, not one string with
          `entry`/`entries` chosen in JSX. That trick works in English and does
          not survive translation: French agreement reaches the verb and the
          participle as well as the noun, and it differs per sentence. Two whole
          sentences is the only shape a translator can work with. */}
      {n === 0
        ? t('statements.postedOnlyNone')
        : n === 1
          ? t('statements.postedOnlyStagedOne', { n })
          : t('statements.postedOnlyStaged', { n })}
    </p>
  )
}
