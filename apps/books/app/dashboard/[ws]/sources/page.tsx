'use client'

// Accounts & sources — the CHART half. The sources half is phase 3.
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
// come back. The flag is flipped to `true` with the chart, and it flips back to
// a harder question in phase 3 when the sources arrive on the same screen: a
// half-scoped page is a real design problem and it is raised in the report
// rather than solved here.
//
// ── `statement_position` IS THE ONLY MAPPING ANYBODY MAY TOUCH ────────────
// It is a NOT NULL foreign key into the legal line list, so an unmapped account
// is impossible rather than merely discouraged. It is shown on every row,
// because it is the answer to "why is this figure on that line" — and the
// answer to "this figure is wrong" is that this mapping, or the entry's
// account, is wrong. **Never the legal category.**
//
// ── THE LABELS ARE `{fr, enSuffix}` AND NOT `{fr, en}` ────────────────────
// `accountLabelEn` / `accountLabelFr`, never `en()` / `legal()`. Handed an
// account label, `en()` finds no `.en`, falls back to the French, and renders
// it on an English screen with nothing to say so. See `lib/label.ts`.

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useAccounts } from '@/lib/hooks'
import { accountLabelEn, accountLabelFr } from '@/lib/label'
import { ScreenFrame } from '@/components/screen-frame'
import { DataTable, type Column } from '@/components/data-table'
import { AccountRef } from '@/components/account-ref'
import type { Account } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const accounts = useAccounts(params.ws, scope)

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
            <span className="text-foreground">{accountLabelFr(a.label)}</span>
            <span className="ml-2 text-[12px] text-muted-foreground">
              {accountLabelEn(a.label)}
            </span>
          </span>
        ),
        sortValue: (a) => accountLabelFr(a.label),
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

      <section className="mt-8 rounded-lg border border-dashed border-border px-4 py-4">
        <h2 className="text-sm font-medium text-foreground">Sources</h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          The register of every bank, card, processor and document feed money arrives through is
          phase 3, and there is no route serving one yet. It is deliberately empty rather than
          faked: a source&apos;s status (current, stale, gap, never connected) is computed from its
          cadence, and a placeholder showing one would be a status nobody measured.
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          A source is also not scoped the way this chart is — one bank account can feed more than
          one book — so the two halves of this screen do not answer to the same control.
        </p>
      </section>
    </ScreenFrame>
  )
}
