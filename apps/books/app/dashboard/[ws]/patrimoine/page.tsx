'use client'

// Patrimoine — the net-worth statement. A screen the mockup never had.
//
// ===========================================================================
// WHY THIS EXISTS AT ALL
// ===========================================================================
// Art. 957 al. 2 CO asks a simplified book for TWO things: recettes/dépenses,
// and a statement of net worth (`état du patrimoine`). The mockup folded the
// second into its balance-sheet page; phase 1 made it its own route, and the
// bilan route now REFUSES a simplified book and points here. Without this
// screen the sole proprietorship is a dead end — the thirteen-screen plan does
// not list it, and it is not optional.
//
// ===========================================================================
// IT IS A SNAPSHOT, NOT A DERIVATION, AND THE PAGE HAS TO SAY SO
// ===========================================================================
// A bilan is computed from postings every time it is asked for. This is not:
// `books.patrimoine` holds compiled statements with an `as_of` date and a
// `compiled` date, and the two are separate fields precisely because a reader
// needs both to judge one. A statement describing 31.12 that was compiled in
// March is a normal and useful document; the same statement with the two dates
// hidden is a figure of unknown age.
//
// So the dates lead, and `total` is labelled as derived-on-read — which it is:
// `publicPatrimoine` sums the items and stores nothing.
//
// ── THE ITEM AMOUNTS ARRIVE AS JSON NUMBERS ───────────────────────────────
// `items` is a `jsonb` column served verbatim, so an amount is `8200` and not
// `"8200.00"` — the only place in this app where that is true. `usePatrimoine`
// converts at the boundary and says why. `total` is a proper `numeric` string.
// The report asks the backend to serve the items the same way.
//
// ── A DOUBLE-ENTRY BOOK HAS NONE, AND THAT IS NOT AN ERROR EITHER ─────────
// The route answers `[]` for an SA rather than refusing, because a company
// COULD have one compiled and simply has not. The empty state says which of the
// two situations the reader is in.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useScope } from '@/lib/scope'
import { usePatrimoine, type PatrimoineView } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { en } from '@/lib/label'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading, EmptyState } from '@/components/states'
import { StatementHeading } from '@/components/statement-heading'
import { DateText } from '@/components/date-text'
import { Money } from '@/components/money'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const patrimoine = usePatrimoine(params.ws, scope)

  const simplified = scope.record?.bookkeeping_regime === 'simplified'
  const snapshots = patrimoine.data ?? []

  return (
    <ScreenFrame title="Patrimoine">
      {/* The article is cited only for the books it governs. Art. 957 al. 2 is
          the SIMPLIFIED regime; printing it over a double-entry book's page
          states that that book is kept under it, which is false and is exactly
          the kind of confident wrong legal fact this screen must not produce.
          A company may still compile one of these — it is just not what the
          article asks of it. */}
      <StatementHeading
        fr="État du patrimoine"
        en="Statement of net worth"
        article={simplified ? 'art. 957 al. 2 CO' : undefined}
        bookName={scope.record?.name}
        exercice={scope.exercice}
        exerciceStatus={scope.exerciceStatus}
      />

      <p className="mb-4 text-[12.5px] text-muted-foreground">
        {simplified
          ? 'Simplified bookkeeping is income and expenditure plus this. It is a compiled snapshot of what the activity holds and owes on one date — not a balance sheet, and not derived from postings.'
          : 'A compiled snapshot of what a book holds and owes on one date. It is required of simplified books (art. 957 al. 2 CO) and optional for this one, which states its net worth on the equity side of its balance sheet instead.'}
      </p>

      {patrimoine.isLoading && <Loading rows={5} label="Loading the patrimoine statement" />}
      {patrimoine.error && (
        <ErrorState error={patrimoine.error} title="The patrimoine statement could not be loaded" />
      )}

      {patrimoine.data && snapshots.length === 0 && (
        <EmptyState title="No statement has been compiled for this book.">
          {simplified ? (
            <p>
              {scope.record?.name} keeps simplified books, so art. 957 al. 2 CO asks it for one of
              these alongside its recettes and dépenses. None is recorded yet.
            </p>
          ) : (
            <p>
              {scope.record?.name} keeps double-entry books, so it is not required to compile one —
              its net worth is the equity side of{' '}
              <Link
                href={scopedHref(base, '/balance-sheet', scope)}
                className="text-primary-strong hover:underline"
              >
                its balance sheet
              </Link>
              . Nothing is missing here.
            </p>
          )}
        </EmptyState>
      )}

      {snapshots.map((snapshot) => (
        <Snapshot key={snapshot.number} snapshot={snapshot} />
      ))}

      {snapshots.length > 1 && (
        <p className="mt-4 text-[11.5px] text-muted-foreground">
          Newest first. Each statement stands on its own — they are compiled documents, not
          revisions of one another.
        </p>
      )}
    </ScreenFrame>
  )
}

function Snapshot({ snapshot }: { snapshot: PatrimoineView }) {
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-card px-4 py-4"
      data-patrimoine={snapshot.number}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border pb-2">
        <h2 className="text-sm font-medium text-foreground">
          As of <DateText value={snapshot.as_of} />
        </h2>
        <span className="text-[12px] text-muted-foreground">
          {/* Two dates, deliberately. See this file's header. */}
          compiled <DateText value={snapshot.compiled} />
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          #{snapshot.number}
        </span>
      </div>

      <table className="mt-2 w-full border-collapse text-[13px]">
        <tbody>
          {snapshot.items.length === 0 && (
            <tr>
              <td className="py-2 text-[12.5px] text-muted-foreground">
                This statement records no items.
              </td>
            </tr>
          )}
          {snapshot.items.map((item, i) => (
            <tr key={`${en(item.label)}:${i}`} className="border-b border-border/50">
              <td className="py-1.5 pr-3 text-foreground">{en(item.label)}</td>
              <td className="num w-40 py-1.5">
                <Money value={item.amount} bare />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-2.5 pr-3 text-right text-[13px] font-semibold">Net worth</td>
            <td className="num-total w-40 pt-2.5 text-[13px]">
              <Money value={snapshot.total} bare />
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        The total is summed on read from the items above and is never stored, so it cannot disagree
        with them.
      </p>

      {snapshot.note && (
        <p className="mt-2 border-t border-border/60 pt-2 text-[12px] text-muted-foreground">
          {en(snapshot.note)}
        </p>
      )}
    </section>
  )
}
