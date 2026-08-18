'use client'

// `<EntryLines>` — the two (or more) sides of one écriture.
//
// ===========================================================================
// AN ENTRY IS SHOWN WHOLE, ALWAYS
// ===========================================================================
// Even when the ledger is filtered to one account. `GET …/entries?account=1020`
// deliberately returns entries that TOUCH the account rather than the matching
// lines, because a half-shown écriture is unreadable — the other side is what
// says where the money went. Rendering only the matching line here would undo
// that decision from the client.
//
// ── DEBIT AND CREDIT ARE NOT NETTED ───────────────────────────────────────
// Each line carries both, and both are `"0.00"` on the side it is not. They are
// shown as the ledger records them rather than folded into one signed number:
// a signed column is a presentation a bookkeeper has to un-fold to check
// against anything, and the double-entry shape is the point of the document.
//
// ── AN UNMAPPED ACCOUNT IS THE WORK, NOT AN ERROR ─────────────────────────
// `account` is null while an entry is staged, and `<AccountRef>` renders that as
// "unmapped" rather than as an em dash. It is the thing Recognition exists to
// resolve, and an em dash would hide it.

import { AccountRef } from './account-ref'
import { Money } from './money'
import type { EntryLine } from '@/lib/types'

export function EntryLines({
  lines,
  base,
  scope,
  /** The full table treatment, for the detail screen. */
  detailed = false,
}: {
  lines: EntryLine[]
  base: string
  scope: { entity: string | null; exercice: number | null }
  detailed?: boolean
}) {
  if (!lines || lines.length === 0) {
    // An entry with no lines is not a thing the schema should permit, so this is
    // reported rather than rendered as blank space.
    return <p className="text-[11.5px] italic text-muted-foreground">This entry has no lines.</p>
  }

  if (!detailed) {
    return (
      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
        {lines.map((line, i) => (
          <span key={`${line.account ?? 'unmapped'}:${i}`} className="inline-flex items-baseline gap-1">
            <AccountRef no={line.account} base={base} scope={scope} />
            <span className="num">
              {/* `D` and `C` rather than a sign. The side is the fact. */}
              {isNonZero(line.debit) ? 'D' : 'C'}{' '}
              <Money value={isNonZero(line.debit) ? line.debit : line.credit} bare />
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-0 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Account
          </th>
          <th scope="col" className="px-3 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Débit
          </th>
          <th scope="col" className="px-0 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Crédit
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => (
          <tr key={`${line.account ?? 'unmapped'}:${i}`} className="border-b border-border/50">
            <td className="py-1.5 pr-3">
              <AccountRef no={line.account} base={base} scope={scope} />
            </td>
            <td className="num px-3 py-1.5">
              {isNonZero(line.debit) ? <Money value={line.debit} bare /> : <span className="text-muted-foreground">·</span>}
            </td>
            <td className="num py-1.5">
              {isNonZero(line.credit) ? <Money value={line.credit} bare /> : <span className="text-muted-foreground">·</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Is this side of the line the one carrying the amount?
 *
 * A DISPLAY test over the wire string, and it is deliberately not `Number(x) !==
 * 0`: this decides which of two columns a figure appears in, and the figure
 * itself is rendered from the untouched string either way. `"0.00"`, `"0"` and
 * `"-0.00"` all mean the same thing here and none of them is an amount.
 */
function isNonZero(value: string | null | undefined): boolean {
  if (!value) return false
  return /[1-9]/.test(value)
}
