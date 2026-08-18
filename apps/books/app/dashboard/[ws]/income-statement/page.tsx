'use client'

// Income statement — the art. 959b line list, rendered, with no amounts.
//
// Same argument as the balance sheet page next door, and the same restraint: the
// structure is real (`/api/meta` serves it), the amounts are `null` rather than
// `"0.00"`, and the banner says which. Read that file's header for why the
// distinction is not pedantry.
//
// ── ONE DIFFERENCE: THE CR IS A FLAT LIST, NOT GROUPS ──────────────────────
// Art. 959b gives an ordered sequence of lines, each with a `sign` (+1 revenue,
// −1 expense) rather than the actif/passif split the bilan has. `<StatementTable>`
// takes groups, so this passes a single unnamed group — which is the honest
// mapping and keeps one component instead of two.
//
// ── THE `accounts` ARRAY IS THE DRILL-DOWN AND IT IS ABSENT HERE ───────────
// `CrLineResult.accounts` is what turns a line into a link into the ledger, and
// it is a property of the DERIVED statement, not of the legal structure — the
// structure does not know which accounts a given book maps onto a line. So there
// are no `<AccountRef>`s on this page yet. They arrive with the amounts, from the
// same route, and `<StatementTable>` already renders them when a line carries
// them.

import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { StatementTable, type StatementGroupView } from '@/components/statement-table'
import { ScreenFrame } from '@/components/screen-frame'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`

  const groups: StatementGroupView[] = scope.meta
    ? [
        {
          group: { fr: 'Compte de résultat', en: 'Income statement' },
          lines: scope.meta.statements.cr.map((l) => ({
            pos: l.pos,
            label: l.label,
            amount: null,
          })),
        },
      ]
    : []

  return (
    <ScreenFrame title="Income statement">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">
          Compte de résultat{' '}
          <span className="ml-2 text-sm font-normal text-muted-foreground">Income statement</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope.record?.name} · exercice {scope.exercice} · art. 959b CO
        </p>
      </div>

      <p className="mb-5 rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Structure only.</span> The statutory line
        list in its legal order. Amounts, and the per-line drill-down into the ledger, arrive with
        the route that derives them.
      </p>

      <StatementTable groups={groups} base={base} scope={scope} />
    </ScreenFrame>
  )
}
