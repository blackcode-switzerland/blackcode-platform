'use client'

// Accounts & sources — the chart of accounts, and the sources register.
//
// ===========================================================================
// THIS PAGE IS BOOK-SCOPED NOW, AND `lib/nav.ts` STILL SAYS IT IS NOT
// ===========================================================================
// The nav marks it `scoped: false`, on the reasoning that a bank, a card or a
// processor is a channel money arrives through and one channel can feed more
// than one book. That is right about SOURCES — and the chart of accounts is not
// a source. `GET …/accounts` serves one book's 26 accounts, they are copied per
// book at creation, and editing one book's chart cannot touch another's.
//
// So the page is scoped in fact while the nav flag says otherwise, and the flag
// is what hides the book switcher in the top bar. **Leaving the flag alone
// would have shipped a page whose numbers change per book with no control to
// change it** — the reader would have to go to another screen to switch, and
// come back. The flag was flipped to `true` with the chart.
//
// ── PHASE 3 MADE IT A HARDER QUESTION, AND HERE IS THE ANSWER ────────────
// The sources register is now on this screen and it is NOT book-scoped: a card
// attributes spend across books, and `books.source.entity_id` is nullable
// because an unattributed source is legitimate. Seeded #9 (PostFinance) has no
// book at all, is `never_connected`, and is exactly the row a book filter would
// hide — from the register whose entire job is to say what is missing.
//
// **So the page keeps `scoped: true` and the register ignores it.** The chart
// above needs the switcher and changes with it; the register is served
// unfiltered and carries the book as a COLUMN. Two halves answering to different
// controls is a real problem and the alternatives are worse:
//
//   filter the register by book  hides the unattributed source, which is the
//                                one the register exists to surface
//   unscope the whole page       the chart is per book; without the switcher a
//                                reader cannot see another book's accounts
//   split into two screens       a tenth nav item for a table of nine rows, and
//                                the mockup deliberately puts them together
//
// What the page owes the reader instead is to SAY it, which the copy below the
// register does. Raised in the report as a design question, not settled here.
//
// ── `statement_position` IS THE ONLY MAPPING ANYBODY MAY TOUCH ────────────
// It is a NOT NULL foreign key into the legal line list, so an unmapped account
// is impossible rather than merely discouraged. It is shown on every row,
// because it is the answer to "why is this figure on that line" — and the
// answer to "this figure is wrong" is that this mapping, or the entry's
// account, is wrong. **Never the legal category.**
//
// ── ACCOUNT LABELS ARE `{fr, en}` SINCE 2026-08-19 ────────────────────────
// The wire used to carry the mockup's `{fr, enSuffix}` and needed dedicated
// helpers; the backend now normalizes at the door, so `en()` reads an account
// label like any other. See `lib/label.ts` for the closed case.

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useAccounts, useSources } from '@/lib/hooks'
import { en } from '@/lib/label'
import { ScreenFrame } from '@/components/screen-frame'
import { DataTable, type Column } from '@/components/data-table'
import { AccountRef } from '@/components/account-ref'
import { SourceRegister } from '@/components/source-register'
import type { Account } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const accounts = useAccounts(params.ws, scope)
  // Deliberately unscoped. See the header: filtering the register by book hides
  // the unattributed source, which is the one it exists to surface.
  const sources = useSources(params.ws)

  const columns = useMemo<Column<Account>[]>(
    () => [
      {
        key: 'no',
        header: 'N°',
        cell: (a) => <AccountRef no={a.no} base={base} scope={scope} />,
        sortValue: (a) => a.no,
      },
      {
        key: 'label',
        header: 'Account',
        cell: (a) => (
          <span>
            <span className="text-foreground">{a.label.fr}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">
              {en(a.label)}
            </span>
          </span>
        ),
        sortValue: (a) => a.label.fr,
      },
      {
        key: 'class',
        header: 'Class',
        numeric: true,
        cell: (a) => a.class,
        sortValue: (a) => a.class,
      },
      {
        key: 'statement',
        header: 'Statement',
        cell: (a) => (
          <span className="text-[12px] uppercase tracking-wider text-muted-foreground">
            {a.statement === 'bilan' ? 'Bilan' : 'Compte de résultat'}
          </span>
        ),
        sortValue: (a) => a.statement,
      },
      {
        key: 'statement_position',
        header: 'Legal line',
        cell: (a) => <span className="font-mono text-[12px]">{a.statement_position}</span>,
        sortValue: (a) => a.statement_position,
      },
    ],
    [base, scope]
  )

  return (
    <ScreenFrame title="Accounts & sources">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          Plan comptable{' '}
          <span className="ml-2 text-sm font-normal text-muted-foreground">Chart of accounts</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.record?.name ?? '—'} · Swiss PME chart
        </p>
      </div>

      <p className="mb-3 text-[12.5px] text-muted-foreground">
        This book&apos;s own accounts — copied when it was created, so editing one book&apos;s chart
        cannot touch another&apos;s. <span className="font-medium text-foreground">Legal line</span>{' '}
        is the art. 959a / 959b position each account&apos;s balance lands on, and it is the only
        mapping anybody may change. If a figure on a statement looks wrong, the entry&apos;s account
        or this mapping is wrong — never the legal category.
      </p>

      <DataTable
        rows={accounts.data}
        columns={columns}
        rowKey={(a) => a.no}
        isLoading={accounts.isLoading}
        error={accounts.error}
        initialSort={{ key: 'no', direction: 'asc' }}
        empty="This book has no accounts, which should not be possible — a chart is installed in the same transaction that creates a book."
      />

      <section className="mt-8">
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Sources
            {sources.data && (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                {sources.data.length}
              </span>
            )}
          </h2>
          <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
            Every channel money moves through: banks hold it, cards draw on banks, processors and
            SaaS spend sit on top. The risk this register exists for is a source that silently
            stops being imported — so{' '}
            <span className="font-medium text-foreground">
              status is computed from cadence against the last import
            </span>
            , never ticked by a person. There is nothing on this table to set, and that is what
            makes the green ones mean anything.
          </p>
          <p className="mt-1.5 max-w-2xl text-[12.5px] text-muted-foreground">
            <span className="font-medium text-foreground">This register is not filtered by book</span>{' '}
            — the chart above is. A source can feed more than one, and one of them belongs to no
            book at all, which is the row a filter would hide.
          </p>
        </div>

        <SourceRegister
          sources={sources.data}
          isLoading={sources.isLoading}
          error={sources.error}
          base={base}
          scope={scope}
        />

        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Sources are provisioned, not authored — no route creates one, and retirement is the only
          lifecycle fact a person sets. Open a source for its freeform notes, the raw files pulled
          from it, its runbook and the worker&apos;s file manifest.
        </p>
      </section>

    </ScreenFrame>
  )
}
