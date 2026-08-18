'use client'

// Income statement — art. 959b CO, par nature, with its amounts.
//
// Ten lines, in the article's order, each carrying a `sign` (+1 produit, −1
// charge) and an `accounts` array. That array is the drill-down: it turns
// "Autres charges d'exploitation, CHF 3'063.60" into the three accounts behind
// it and a link into the ledger filtered by each. `<StatementTable>` renders
// them through `<AccountRef>` — this page's job is to hand them over unchanged.
//
// ── LINES 7 TO 9 ARE NEVER MERGED ─────────────────────────────────────────
// `financier`, `hors_exploitation`, `exceptionnel` are a hard legal requirement
// and collapsing them into one "other" bucket is the commonest way a small
// company's compte de résultat stops being compliant while still adding up
// (`lib/statements.ts`). They are three lines here, all three at zero on the
// seeded books, and all three rendered.
//
// ── THE AMOUNTS ARE ALL POSITIVE, AND THAT IS THE STATEMENT'S CONVENTION ──
// `crFor` negates a produit's movement so a revenue account's credit balance
// prints positive, and leaves a charge as its debit movement. So the column is
// magnitudes and the `sign` says which way each one pulls; only `resultat` at
// the bottom is signed. This is why the total is not the sum of the column, and
// why nothing here adds the column up — the server did, in centimes.
//
// The RI refusal is the same shape as the balance sheet's, with a different
// code (`no_cr_for_simplified`). Same treatment: an explanation, not a red box.

import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { useCompteResultat, isSimplifiedRefusal } from '@/lib/hooks'
import { crGroups } from '@/lib/statement-view'
import { StatementTable } from '@/components/statement-table'
import { ScreenFrame } from '@/components/screen-frame'
import { SimplifiedBookNotice } from '@/components/simplified-notice'
import { ErrorState, Loading } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const cr = useCompteResultat(params.ws, scope)

  return (
    <ScreenFrame title="Income statement">
      <StatementHeading
        fr="Compte de résultat"
        en="Income statement"
        article="art. 959b CO, par nature"
        bookName={scope.record?.name}
        exercice={scope.exercice}
      />

      {cr.isLoading && <Loading rows={8} label="Loading the income statement" />}

      {isSimplifiedRefusal(cr.error) && (
        <SimplifiedBookNotice
          error={cr.error}
          statement="income statement"
          because="there are no expense and revenue accounts to arrange into the art. 959b lines"
          base={base}
          scope={scope}
          bookName={scope.record?.name}
        />
      )}

      {cr.error && !isSimplifiedRefusal(cr.error) && (
        <ErrorState error={cr.error} title="The income statement could not be derived" />
      )}

      {cr.data && (
        <>
          <p className="mb-3 text-[12px] text-muted-foreground">
            Each line lists the accounts feeding it. Follow one to see its postings in the general
            ledger. Amounts are magnitudes — the sign of each line is fixed by the article, and only
            the result at the foot is signed.
          </p>

          <StatementTable
            groups={crGroups(cr.data, scope.meta)}
            base={base}
            scope={scope}
            footer={{ label: "Résultat de l'exercice", amount: cr.data.resultat }}
          />
        </>
      )}
    </ScreenFrame>
  )
}
