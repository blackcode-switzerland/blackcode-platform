'use client'

// The overview — the book index, each book's headline figures, and the
// cross-book rollup.
//
// ===========================================================================
// ONE ROW PER BOOK, CARRYING WHICHEVER STATEMENT ITS LEGAL FORM HAS
// ===========================================================================
// `GET …/overview` returns `bilan` OR `ri` per book, never both, and BOTH null
// for a book with no fiscal year yet. Three shapes, and the card renders the one
// it was given rather than reaching for a field that is only there sometimes —
// which is the exact mistake that had every book reporting "VAT: Not registered"
// when `publicEntity` nested `vat`.
//
// The two are not one polymorphic `result` on purpose: a sole proprietorship has
// no balance sheet under art. 957 al. 2 CO, and a shared shape would invite this
// page to render one.
//
// ── THE ROLLUP IS NEVER A CONSOLIDATION (art. 963 CO) ─────────────────────
// It says so, on the page, in the reader's own words rather than in a footnote.
// See `lib/rollup.ts` for why both sides of the same intercompany loan are
// counted twice and why that is correct for the question being asked.
//
// ── THE THREE BOOK-COUNT STATES (D-D) ─────────────────────────────────────
//   zero   `<NoBooks>`. A new employee's first screen. Not an error.
//   one    the book, and NO rollup — a rollup over one book is that book with a
//          different title, and printing it implies an aggregation happened.
//   many   the index and the rollup.
// Nothing here counts to three, and no slug is named.

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowRight } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useOverview, type OverviewBook } from '@/lib/hooks'
import { rollup } from '@/lib/rollup'
import { scopedHref } from '@/lib/nav'
import { EntityChip } from '@/components/chips'
import { ErrorState, FixtureNotice, Loading } from '@/components/states'
import { NoBooks } from '@/components/no-books'
import { Money } from '@/components/money'
import { BookFacts } from '@/components/book-facts'
import type { Entity } from '@/lib/types'

export default function OverviewPage() {
  const { data: session } = useSession()
  const params = useParams<{ ws: string }>()
  const base = `/dashboard/${params.ws}`
  const scope = useScope()
  const { entities, isLoading, error, source } = scope
  const overview = useOverview(params.ws)

  if (isLoading) return <Loading rows={4} label="Loading your books" />
  if (error) return <ErrorState error={error} title="Your books could not be loaded" />
  if (entities.length === 0) return <NoBooks email={session?.user?.email} />

  const single = entities.length === 1
  const rows = overview.data ?? []
  // Keyed by slug so a card finds ITS row rather than trusting two lists to
  // arrive in the same order. They do today; that is not a thing to depend on.
  const byslug = new Map(rows.map((r) => [r.slug, r]))
  const totals = rollup(rows)

  return (
    <div className="mx-auto max-w-3xl">
      <FixtureNotice source={source} />

      <h1 className="text-lg font-semibold text-foreground">
        {single ? 'Your book' : 'Your books'}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {single
          ? 'One set of accounts. Everything else in the app is scoped to it.'
          : 'Each one is a separate set of accounts. The control in the top bar chooses which one every other screen is about.'}
      </p>

      {overview.error && (
        <div className="mt-4">
          <ErrorState error={overview.error} title="The figures could not be loaded" />
        </div>
      )}

      <div className="mt-6 space-y-2">
        {entities.map((entity) => (
          <BookCard
            key={entity.slug}
            entity={entity}
            row={byslug.get(entity.slug) ?? null}
            loading={overview.isLoading}
            base={base}
          />
        ))}
      </div>

      {!single && overview.data && <RollupPanel totals={totals} />}

      {/* The only way into the taxes screen — it is deliberately not in the nav
          (`lib/nav.ts`): tax TRACKING over time is a different product, and this
          is a statutory snapshot reached from here. The link keeps the scope. */}
      <p className="mt-6 text-sm">
        <Link
          href={scopedHref(base, '/taxes', scope)}
          className="inline-flex items-center gap-1.5 text-primary-strong hover:underline"
        >
          Statutory tax snapshot
          <ArrowRight size={14} />
        </Link>
      </p>
    </div>
  )
}

/**
 * One book: what it IS, and how its year is going.
 *
 * The facts half is unchanged from phase 0 and lives in `<BookFacts>` now,
 * because the patrimoine screen needs the same block. The figures half is new
 * and is where the three payload shapes are handled.
 */
function BookCard({
  entity,
  row,
  loading,
  base,
}: {
  entity: Entity
  row: OverviewBook | null
  loading: boolean
  base: string
}) {
  const scope = { entity: entity.slug, exercice: row?.exercice ?? null }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5" data-book={entity.slug}>
      <div className="flex flex-wrap items-center gap-2.5">
        <EntityChip entity={entity} />
        <span className="text-[13px] text-muted-foreground">{entity.seat ?? 'No registered seat'}</span>
        <span className="ml-auto text-[12px] uppercase tracking-wider text-muted-foreground">
          #{entity.number}
        </span>
      </div>

      <BookFacts entity={entity} />

      <div className="mt-3 border-t border-border/60 pt-3">
        {loading && <p className="text-[12.5px] text-muted-foreground">Loading its figures…</p>}

        {!loading && row === null && (
          // The overview answered, and this book was not in the answer. That is
          // not "zero" — it is a book the figures route did not describe, and
          // saying so beats printing a dash that reads as "nothing happened".
          <p className="text-[12.5px] text-muted-foreground">
            No figures were served for this book.
          </p>
        )}

        {!loading && row && row.exercice === null && (
          <p className="text-[12.5px] text-muted-foreground">
            No fiscal year is open yet, so there is nothing to derive. A book gets its accounts when
            it is created; the exercice is a second step.
          </p>
        )}

        {!loading && row?.bilan && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
            <Figure label="Total actif" amount={row.bilan.actif} />
            <Figure label="Total passif" amount={row.bilan.passif} />
            <Figure label={`Résultat ${row.exercice}`} amount={row.bilan.resultat} />
            <div>
              <Dt>Balance</Dt>
              <dd className={row.bilan.balanced ? 'text-foreground' : 'font-medium text-destructive'}>
                {row.bilan.balanced ? 'Actif = passif' : 'Does not balance'}
              </dd>
            </div>
          </dl>
        )}

        {!loading && row?.ri && (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
              <Figure label="Recettes" amount={row.ri.recettes} />
              <Figure label="Dépenses" amount={row.ri.depenses} />
              <Figure label={`Résultat ${row.exercice}`} amount={row.ri.resultat} />
            </dl>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Simplified bookkeeping, art. 957 al. 2 CO. That result is CASH in minus cash out — not
              a profit: there are no accruals and no depreciation behind it. This book has no
              balance sheet;{' '}
              <Link
                href={scopedHref(base, '/patrimoine', scope)}
                className="text-primary-strong hover:underline"
              >
                its net worth is the patrimoine statement
              </Link>
              .
            </p>
          </>
        )}

        {!loading && row && row.exercice !== null && (
          <p className="mt-2 flex flex-wrap gap-x-4 text-[11.5px] text-muted-foreground">
            <span>{row.entries} entries</span>
            <span>{row.unrecognized} unrecognized</span>
            <span>{row.staged} staged</span>
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The rollup, and its disclaimer.
 *
 * The disclaimer is above the numbers rather than under them. A reader who
 * stops at the figures must have already read what they are.
 */
function RollupPanel({ totals }: { totals: ReturnType<typeof rollup> }) {
  return (
    <section className="mt-8 rounded-lg border border-border bg-card px-4 py-4">
      <h2 className="text-sm font-semibold text-foreground">Across all your books</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        An informational aggregation over {totals.books} books, and{' '}
        <span className="font-medium text-foreground">never a consolidation</span> under art. 963
        CO. Nothing is eliminated: a loan between two of your books is counted on both sides,
        because the question this answers is what you hold, not what a group balance sheet would
        say. It has no standing in any filing.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
        <Figure label="Total actif" amount={totals.totalActif} />
        <Figure label="Combined result" amount={totals.resultat} />
        <div>
          <Dt>Entries</Dt>
          <dd className="num text-foreground">{totals.entries}</dd>
        </div>
        <div>
          <Dt>Need a human</Dt>
          <dd className="num text-foreground">{totals.unrecognized}</dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
        {/* Which books each total actually covers. A total that silently omits a
            book is the most reassuring wrong answer this panel can give. */}
        <li>
          Total actif covers the {totals.bilanBooks} double-entry{' '}
          {totals.bilanBooks === 1 ? 'book' : 'books'}
          {totals.riBooks > 0 && (
            <>
              {' '}— the {totals.riBooks} simplified{' '}
              {totals.riBooks === 1 ? 'book has no balance sheet and contributes' : 'books have no balance sheet and contribute'}{' '}
              nothing to it
            </>
          )}
          .
        </li>
        {totals.riBooks > 0 && (
          <li>
            The combined result adds accrual profits to a cash result, which are different kinds of
            number. It is an order of magnitude, not a figure to file.
          </li>
        )}
        {totals.withoutExercice > 0 && (
          <li>
            {/* Both verbs agree with the count, not just the first one. "1 book
                has … and contribute nothing" read as a typo on a page whose
                whole job is looking precise about numbers. */}
            {totals.withoutExercice} {totals.withoutExercice === 1 ? 'book has' : 'books have'} no
            fiscal year open and {totals.withoutExercice === 1 ? 'contributes' : 'contribute'}{' '}
            nothing to any total above.
          </li>
        )}
        {totals.staged > 0 && (
          <li>
            {totals.staged} staged {totals.staged === 1 ? 'entry is' : 'entries are'} excluded from
            every figure above — staged money has no agreed meaning and never touches a statement.
          </li>
        )}
      </ul>
    </section>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </dt>
  )
}

function Figure({ label, amount }: { label: string; amount: string }) {
  return (
    <div>
      <Dt>{label}</Dt>
      <dd className="num text-foreground">
        <Money value={amount} bare />
      </dd>
    </div>
  )
}
