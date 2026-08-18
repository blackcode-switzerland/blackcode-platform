// Joining a derived statement to its legal line list.
//
// ===========================================================================
// THE PAYLOAD HAS NO LINE LABELS, AND THAT IS CORRECT
// ===========================================================================
// `GET …/bilan` and `GET …/compte-resultat` serve, per line, `pos` and `amount`
// (plus `related` on the bilan and `sign` + `accounts` on the CR). They do NOT
// serve the line's name. `lib/types.ts` used to declare one and nothing sent it,
// which would have rendered a statement of amounts with no line names.
//
// The names are `BILAN_STRUCTURE` and `CR_STRUCTURE` — art. 959a and art. 959b,
// fixed by law. Serving a second copy of them on every statement request would
// be a copy that can disagree with the one the derivation used.
//
// So the join happens here, on `pos`, against **the structure `/api/meta` serves**
// — never against `lib/statements.ts` imported into the bundle. A frontend that
// imported the constant would keep rendering last week's legal structure after
// the server's had changed, with nothing on the page to say so. That distinction
// is already made in the phase-0 balance-sheet page and it survives the rewrite.
//
// ── A `pos` THE STRUCTURE DOES NOT KNOW STILL RENDERS ─────────────────────
// If the server adds a line before this bundle ships, the join misses and the
// line renders with its raw `pos` as its name. Legible, obviously un-glossed,
// and fixed by a reload. The alternatives are both worse: dropping the line
// removes money from a statutory statement, and rendering a blank name puts an
// amount on the page with nothing to say what it is.

import type { MetaPayload } from './hooks'
import type { StatementLineView } from '@/components/statement-table'
import type { BilanResult, CrResult } from './types'
import type { StatementLabel } from './statements'

/** The raw `pos` as a label, for a line the served structure does not carry. */
function fallbackLabel(pos: string): StatementLabel {
  return { fr: pos, en: pos }
}

/** `pos` → its legal line, from the SERVED bilan structure. */
function bilanLineIndex(meta: MetaPayload | undefined) {
  const index = new Map<string, { label: StatementLabel; derived?: boolean }>()
  for (const group of meta?.statements.bilan ?? []) {
    for (const line of group.lines) index.set(line.pos, { label: line.label, derived: line.derived })
  }
  return index
}

/**
 * The bilan, ready for `<StatementTable>`.
 *
 * `related` comes from the PAYLOAD and not from the structure, deliberately:
 * art. 959a al. 4 is a property of the line as the derivation emitted it, and
 * the two agree today. Reading it from the payload means that if they ever stop
 * agreeing, the screen shows what the numbers were actually computed as.
 *
 * Every line is kept, including `"0.00"`. A zero-balance statutory line still
 * legally exists; `<StatementTable>` offers a visual collapse and nothing drops
 * one from the model.
 */
export function bilanGroups(bilan: BilanResult, meta: MetaPayload | undefined) {
  const index = bilanLineIndex(meta)
  return bilan.groups.map((group) => ({
    group: group.group,
    side: group.side,
    lines: group.lines.map((line): StatementLineView => {
      const legal = index.get(line.pos)
      return {
        pos: line.pos,
        label: legal?.label ?? fallbackLabel(line.pos),
        amount: line.amount,
        related: line.related,
        derived: legal?.derived,
      }
    }),
  }))
}

/**
 * The compte de résultat, ready for `<StatementTable>`.
 *
 * Art. 959b is a flat ordered sequence rather than the bilan's actif/passif
 * split, so it becomes ONE group. The group heading is written here rather than
 * served, because the structure has none — the ten lines are the document.
 *
 * `accounts` is carried through untouched, INCLUDING the empty array. That array
 * is what `<StatementTable>` turns into the drill-down into the ledger, and a
 * line with no accounts mapped to it in this book genuinely has nowhere to drill
 * — `variation_stocks` and `exceptionnel` are both empty on every seeded book.
 * Rendering no links there is the honest answer; inventing one would send the
 * reader to an empty ledger and let them conclude the postings are missing.
 */
export function crGroups(cr: CrResult, meta: MetaPayload | undefined) {
  const index = new Map<string, StatementLabel>()
  for (const line of meta?.statements.cr ?? []) index.set(line.pos, line.label)

  return [
    {
      group: { fr: 'Compte de résultat', en: 'Income statement' },
      lines: cr.lines.map((line): StatementLineView => ({
        pos: line.pos,
        label: index.get(line.pos) ?? fallbackLabel(line.pos),
        amount: line.amount,
        accounts: line.accounts,
      })),
    },
  ]
}
