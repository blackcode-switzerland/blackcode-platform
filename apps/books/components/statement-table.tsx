'use client'

// `<StatementTable>` — the bilan and the compte de résultat are one component.
//
// ===========================================================================
// THE LINE LIST IS THE LAW, NOT A VIEW OF THE DATA
// ===========================================================================
// Art. 959a CO fixes the balance sheet's groups and their order (actif in
// decreasing liquidity, passif in decreasing exigibility). Art. 959b does the
// same for the income statement. `lib/statements.ts` holds both, in the
// article's order, and `/api/meta` serves them.
//
// Three consequences, and every one of them is a thing somebody will try to
// "improve":
//
//   1. **A zero line renders.** It is not dropped, not filtered, not hidden
//      behind "show empty". The legal list is the legal list, and a bilan
//      missing a line because it happened to be zero this year is not the
//      document that gets filed. Collapsing them VISUALLY is allowed and is
//      offered below as an explicit, off-by-default toggle; removing them from
//      the model is not.
//   2. **The order is never re-sorted.** Not alphabetically, not by amount.
//   3. **A category is never restructured to fix a number.** If a total looks
//      wrong, the transaction's ACCOUNT is wrong — `statement_position` on the
//      account is the only touchable mapping in the whole chain. See
//      `b-mockups/bbooks/CATEGORIES-ARCHITECTURE.md`.
//
// ── THERE IS NO EMPTY STATE, DELIBERATELY ──────────────────────────────────
// A book with no entries has a balance sheet: every legal line, at zero. That is
// a correct and useful document — it is what a company that was incorporated
// last week files. So this component never renders `<EmptyState>`, and a caller
// that wraps it in one has misunderstood the screen.
//
// ── THE LABELS ARE FRENCH, AND THAT IS D-A ─────────────────────────────────
// b/books is English everywhere except here. These strings are the statute's own
// wording and the filed PDF has to reproduce them, so `legal()` returns the
// French and the English gloss sits under it in muted type for an operator who
// does not read French. Never translate the line; never drop the gloss.

import { useState } from 'react'
import { Money } from './money'
import { AccountRef } from './account-ref'
import { en, legal } from '@/lib/label'
import type { StatementLabel } from '@/lib/statements'
import type { Money as MoneyString } from '@/lib/types'

export interface StatementLineView {
  pos: string
  label: StatementLabel
  /** Null means "no amount known", which is NOT the same as zero. */
  amount: MoneyString | null
  /** art. 959a al. 4 — presented separately. Marked, never merged away. */
  related?: boolean
  /** Computed, never posted (`resultat_exercice`). Marked so it is not queried. */
  derived?: boolean
  /** The accounts feeding this line. The drill-down into the ledger. */
  accounts?: string[]
}

export interface StatementGroupView {
  group: StatementLabel
  side?: 'actif' | 'passif'
  lines: StatementLineView[]
  /** The group subtotal, when the caller has one. */
  total?: MoneyString | null
}

export function StatementTable({
  groups,
  base,
  scope,
  /** The bottom line: `Total actif`, `Résultat de l'exercice`. */
  footer,
}: {
  groups: readonly StatementGroupView[]
  /** `/dashboard/{ws}` — needed for the account drill-down links. */
  base: string
  scope: { entity: string | null; exercice: number | null }
  footer?: { label: string; amount: MoneyString | null }
}) {
  // Off by default. The reader's first question about a statement is "what does
  // it say", and a document with rows silently removed does not answer it. The
  // toggle exists because a 40-line bilan with 30 zeroes is genuinely hard to
  // scan, and the honest way to offer that is a control the reader chose.
  const [hideZero, setHideZero] = useState(false)

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
            className="accent-primary"
          />
          Collapse zero lines
        </label>
      </div>

      <table className="w-full border-collapse text-[13px]">
        {groups.map((group) => {
          // `isZero` is a DISPLAY test over the wire string. `Number("0.00")` is
          // 0 and so is `Number("-0.00")`; an absent amount (null) is never
          // treated as zero, because "we do not know" and "it is nothing" are
          // different and only one of them may be hidden.
          const visible = hideZero
            ? group.lines.filter((l) => l.amount === null || Number(l.amount) !== 0)
            : group.lines

          return (
            <tbody key={group.side ? `${group.side}:${legal(group.group)}` : legal(group.group)}>
              <tr>
                <th
                  colSpan={2}
                  scope="colgroup"
                  className="border-b border-border pt-5 pb-1.5 text-left"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-primary-strong">
                    {legal(group.group)}
                  </span>
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {en(group.group)}
                  </span>
                </th>
              </tr>

              {visible.map((line) => (
                <tr key={line.pos} className="border-b border-border/50" data-pos={line.pos}>
                  <td className="py-1.5 pr-3 align-top">
                    <span className="text-foreground">{legal(line.label)}</span>
                    <span className="ml-2 text-[11.5px] text-muted-foreground">
                      {en(line.label)}
                    </span>
                    {line.related && (
                      <span
                        className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        title="art. 959a al. 4 CO — presented separately"
                      >
                        related party
                      </span>
                    )}
                    {line.derived && (
                      <span
                        className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        title="Computed from the income statement, never posted"
                      >
                        derived
                      </span>
                    )}
                    {/* The drill-down. The array is kept even with one member
                        (`lib/types.ts`, CrLineResult) so this never has to
                        special-case a single account into a different shape. */}
                    {line.accounts && line.accounts.length > 0 && (
                      <span className="mt-0.5 flex flex-wrap gap-x-3">
                        {line.accounts.map((no) => (
                          <AccountRef key={no} no={no} base={base} scope={scope} />
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="num w-40 py-1.5 align-top">
                    <Money value={line.amount} bare />
                  </td>
                </tr>
              ))}

              {group.total !== undefined && (
                <tr>
                  <td className="py-1.5 pr-3 text-right text-[12px] font-medium text-muted-foreground">
                    Total {en(group.group).toLowerCase()}
                  </td>
                  <td className="num-total w-40 py-1.5">
                    <Money value={group.total} bare />
                  </td>
                </tr>
              )}
            </tbody>
          )
        })}

        {footer && (
          <tfoot>
            <tr>
              <td className="pt-3 pr-3 text-right text-[13px] font-semibold">{footer.label}</td>
              <td className="num-total w-40 pt-3 text-[13px]">
                <Money value={footer.amount} bare />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
