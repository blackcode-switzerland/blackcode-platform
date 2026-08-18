'use client'

// `<AccountRef>` — a chart account, and the way into the ledger.
//
// Renders `1020 · Banque` and links to the general ledger filtered by that
// account. **That link is the income statement's drill-down**: each CR line
// carries an `accounts` array (`lib/types.ts`, `CrLineResult`) and this is what
// turns it into a reachable page, so the reader can go from "other operating
// expenses, CHF 41'220.00" to the postings that make it up.
//
// ── THE ACCOUNT NUMBER IS THE PRIMARY KEY AND IS ALWAYS SHOWN ──────────────
// Swiss PME chart numbers are how bookkeepers and fiduciaries name accounts —
// "sixty-five seventy", not "other operating expenses". Showing only the label
// makes the screen unreadable to the person who is going to audit it, and makes
// it impossible to check a mapping against the chart. Number first, mono, always.
//
// ── THE SCOPE TRAVELS ──────────────────────────────────────────────────────
// `scopedHref` keeps the current book and year. A bare `<Link href="/ledger">`
// would drop them and send the reader to the default book's ledger with the
// right account number on it — real numbers, wrong company. See `lib/nav.ts`.

import Link from 'next/link'
import { scopedHref } from '@/lib/nav'
import { accountLabelEn } from '@/lib/label'
import type { AccountLabel } from '@/lib/types'

export function AccountRef({
  no,
  label,
  base,
  scope,
  className = '',
}: {
  /** `"1020"`. Null renders the unmapped marker rather than a broken link. */
  no: string | null
  /**
   * `{fr, enSuffix}` — an `AccountLabel`, NOT a `StatementLabel`. The two are
   * separate types precisely so this prop cannot be handed the wrong one and
   * silently render French; see `lib/label.ts`.
   */
  label?: AccountLabel | null
  /** `/dashboard/{ws}` — the shell knows it; a page passes it down. */
  base: string
  scope: { entity: string | null; exercice: number | null }
  className?: string
}) {
  // A staged entry may legitimately have no account yet (`EntryLine.account` is
  // `string | null` and null is allowed only while staged). Saying so is the
  // point: an unmapped line is the thing Recognition exists to resolve, and
  // rendering an em dash would hide the work.
  if (!no) {
    return (
      <span className={'text-xs italic text-muted-foreground ' + className}>
        unmapped
      </span>
    )
  }

  return (
    <Link
      // ── `status: 'posted'` IS WHAT MAKES THE DRILL-DOWN RECONCILE ──────────
      // Statements derive from posted entries only. Without this filter, this
      // link takes a reader from a figure built one way to a list built another:
      // on the seeded books, *Autres charges d'exploitation* reads 3'063.60 and
      // following 6570 listed postings totalling 147.10, because the ledger
      // included a 13.50 STAGED row the statement had correctly ignored. Both
      // sides right, neither reconcilable. F1 of the phase-1 review.
      //
      // The ledger's own filter is still there, so a reader who wants the staged
      // rows can clear it — the default just matches where they came from.
      href={scopedHref(base, '/ledger', scope, { account: no, status: 'posted' })}
      className={
        'group inline-flex items-baseline gap-1.5 hover:text-primary-strong ' + className
      }
      data-account={no}
    >
      <span className="font-mono text-[12.5px] tabular-nums">{no}</span>
      {label && (
        <span className="text-[13px] text-muted-foreground group-hover:text-primary-strong">
          {accountLabelEn(label)}
        </span>
      )}
    </Link>
  )
}
