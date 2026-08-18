'use client'

// The overview — **the sprint-1 half of it**, which is the book index and the
// three states a book count can be in.
//
// ===========================================================================
// WHAT IS DELIBERATELY NOT HERE
// ===========================================================================
// The overview is screen 1 of thirteen and sprint 1 does not build screens. What
// it does build is `01-foundation.md` §5: the zero-books, one-book and many-books
// states, which have nowhere to live except this page. So this renders exactly
// the part of the overview that `/api/meta` can answer today — who the books
// are — and nothing that needs an amount.
//
// Absent, on purpose, and each one is sprint 2's:
//
//   - **The cross-book rollup**, and its mandatory disclaimer that this is
//     informational aggregation and **never** consolidation (art. 963 CO). The
//     word "consolidated" must not appear anywhere in this app, ever.
//   - **The cross-link to Taxes**, which is the only way that screen is reached.
//   - Every figure. There is no route that serves one yet.
//
// ── THE THREE STATES (D-D) ─────────────────────────────────────────────────
//   zero   `<NoBooks>`. A new employee's first screen. Not an error.
//   one    the book, and no rollup — a cross-book rollup over one book is a
//          copy of that book with a different title. Degrade, do not hide
//          behind a flag.
//   many   the index. The mockup's design; nothing special.
//
// Nothing here counts to three, and no slug is named.

import { useSession } from 'next-auth/react'
import { useScope } from '@/lib/scope'
import { EntityChip } from '@/components/chips'
import { ErrorState, FixtureNotice, Loading } from '@/components/states'
import { NoBooks } from '@/components/no-books'
import type { Entity } from '@/lib/types'

export default function OverviewPage() {
  const { data: session } = useSession()
  const scope = useScope()
  const { entities, isLoading, error, source } = scope

  if (isLoading) return <Loading rows={4} label="Loading your books" />
  if (error) return <ErrorState error={error} title="Your books could not be loaded" />

  if (entities.length === 0) return <NoBooks email={session?.user?.email} />

  const single = entities.length === 1

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

      <div className="mt-6 space-y-2">
        {entities.map((entity) => (
          <BookCard key={entity.slug} entity={entity} />
        ))}
      </div>

      {/* The rollup's absence is stated rather than left as whitespace: a
          reader who knows the product is coming back to look for it, and a
          silent gap reads as a bug. Named without its numbers, and without the
          word this app may never use for it. */}
      {!single && (
        <p className="mt-8 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          The cross-book rollup — one view of what you personally hold across all of these — is
          sprint 2. It is an informational aggregation and never a consolidation (art. 963 CO), and
          it will say so on the page.
        </p>
      )}
    </div>
  )
}

/**
 * One book, in the facts `/api/meta` actually carries.
 *
 * Every field here is served per book, including the accent — so a fourth book
 * appears with the right colour and the right regime with no frontend change.
 * `vat_registered: false` renders "not VAT registered" rather than being
 * omitted, because for a company that is a fact somebody checks, not an absence.
 */
function BookCard({ entity }: { entity: Entity }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <EntityChip entity={entity} />
        <span className="text-[13px] text-muted-foreground">{entity.seat}</span>
        {/* No exercice here any more. A book no longer carries one year — phase 1
            made them rows in `books.exercice` and there can be several, so this
            printed the word with an empty space after it. The year lives in the
            top bar, where it is a choice rather than a property of the book. */}
        <span className="ml-auto text-[12px] uppercase tracking-wider text-muted-foreground">
          #{entity.number}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
        <Fact label="Legal form" value={entity.legal_form} />
        <Fact
          label="Regime"
          value={entity.bookkeeping_regime === 'double_entry' ? 'Double entry' : 'Simplified'}
        />
        <Fact
          label="VAT"
          // `entity.vat` is a nested block, not four flat columns. Read flat, it
          // was `undefined` and every book — including a registered one — said
          // "Not registered". A wrong fact about tax status is not a cosmetic bug.
          value={
            entity.vat.registered
              ? [entity.vat.method, entity.vat.filing].filter(Boolean).join(', ') || 'Registered'
              : 'Not registered'
          }
        />
      </dl>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  )
}
