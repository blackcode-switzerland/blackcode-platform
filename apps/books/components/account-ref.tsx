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
import { journalAccepts, type Journal } from '@/lib/journal'
import type { AccountLabel } from '@/lib/types'

/**
 * What this component needs of the scope, and the third field is the point.
 *
 * `journal` is REQUIRED, so every call site is a compile error until it supplies
 * one. That is deliberate: the link this component builds was 400ing on a
 * simplified book, and a prop with a default would have let a fifth call site
 * be added later without anybody thinking about it.
 */
export interface AccountRefScope {
  entity: string | null
  exercice: number | null
  /** The journal of the book the LINK TARGETS — `scope.record`'s, not the record being shown. */
  journal: Journal | null
}

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
  scope: AccountRefScope
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

  const body = (
    <>
      <span className="font-mono text-[12.5px] tabular-nums">{no}</span>
      {label && (
        <span className="text-[13px] text-muted-foreground group-hover:text-primary-strong">
          {accountLabelEn(label)}
        </span>
      )}
    </>
  )

  // ── THE DRILL-DOWN IS A LINK ONLY WHERE THE TARGET CAN ANSWER IT ────────
  // The link lands on `/ledger` filtered by this account, IN THE SCOPED BOOK.
  // Since phase 4A a simplified book's `GET …/entries` REFUSES `?account=` and
  // `?status=` — 400 `ri_no_such_filter` — and it refuses them rather than
  // ignoring them, so this link was a page with an error box on it where the
  // ledger should be. Reproduced on 2026-08-19 by opening the chart of accounts
  // for the seeded RI book (which has all 26 accounts) and following 1020:
  //
  //   /ledger?entity=ri&exercice=2026&account=1020&status=posted
  //     → "an RI journal has no posting status and no accounts to filter by"
  //
  // And dropping only the two filters would be worse, not better: the
  // recettes-dépenses journal has **no chart mapping at all**, so an unfiltered
  // ledger is not a narrower answer to the same question — it is a different
  // document that cannot be filtered by this number. So there is nothing to
  // link to, and the account renders as the fact it is.
  //
  // A null journal takes the same branch. It means the book is not in hand, and
  // a link built then is a link whose legality is a guess.
  if (!journalAccepts(scope.journal, 'account')) {
    return (
      <span
        className={'group inline-flex items-baseline gap-1.5 ' + className}
        data-account={no}
        data-account-link="none"
        title={
          scope.journal === 'recettes_depenses'
            ? 'This book keeps recettes and dépenses under art. 957 al. 2 CO. Its journal has no chart mapping, so there is nothing to drill into by account number.'
            : 'Which journal this book keeps is not known yet, so this cannot be drilled into.'
        }
      >
        {body}
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
      //
      // It is only reached for a `grand_livre` target — the guard above is what
      // makes that true, and it is `journalAccepts`, not a second copy of the
      // rule. `status` is asserted separately from `account` because the two are
      // separate entries in that table and a journal could one day take one and
      // not the other; asking once for both would be an assumption.
      href={scopedHref(base, '/ledger', scope, {
        account: no,
        status: journalAccepts(scope.journal, 'status') ? 'posted' : undefined,
      })}
      className={
        'group inline-flex items-baseline gap-1.5 hover:text-primary-strong ' + className
      }
      data-account={no}
    >
      {body}
    </Link>
  )
}
