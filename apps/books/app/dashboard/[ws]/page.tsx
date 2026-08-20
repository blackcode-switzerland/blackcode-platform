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
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'

export default function OverviewPage() {
  const { data: session } = useSession()
  const params = useParams<{ ws: string }>()
  const base = `/dashboard/${params.ws}`
  const scope = useScope()
  const { entities, isLoading, error, source } = scope
  const overview = useOverview(params.ws)
  const t = useT()

  if (isLoading) return <Loading rows={4} label={t('overview.loading')} />
  if (error) return <ErrorState error={error} title={t('overview.loadError')} />
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
        {single ? t('overview.titleOne') : t('overview.titleMany')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {single ? t('overview.leadOne') : t('overview.leadMany')}
      </p>

      {overview.error && (
        <div className="mt-4">
          <ErrorState error={overview.error} title={t('overview.figuresFailed')} />
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

      {/* The two off-nav screens, and the only way into either — both are
          deliberately not in the sidebar (`lib/nav.ts`). Tax TRACKING over time
          is a different product and this is a statutory snapshot; the compliance
          register is not part of a working loop. The links keep the scope, which
          matters for the first and is harmless for the second — the rules are
          the same for every book, and `/compliance` says so. */}
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link
          href={scopedHref(base, '/taxes', scope)}
          className="inline-flex items-center gap-1.5 text-primary-strong hover:underline"
        >
          {t('overview.taxLink')}
          <ArrowRight size={14} />
        </Link>
        <Link
          href={scopedHref(base, '/compliance', scope)}
          className="inline-flex items-center gap-1.5 text-primary-strong hover:underline"
        >
          {t('nav.compliance')}
          <ArrowRight size={14} />
        </Link>
      </div>
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
  const t = useT()
  const scope = { entity: entity.slug, exercice: row?.exercice ?? null }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5" data-book={entity.slug}>
      <div className="flex flex-wrap items-center gap-2.5">
        <EntityChip entity={entity} />
        <span className="text-[13px] text-muted-foreground">
          {entity.seat ?? t('overview.noSeat')}
        </span>
        <span className="ml-auto text-[12px] uppercase tracking-wider text-muted-foreground">
          #{entity.number}
        </span>
      </div>

      <BookFacts entity={entity} />

      <div className="mt-3 border-t border-border/60 pt-3">
        {loading && (
          <p className="text-[12.5px] text-muted-foreground">{t('overview.loadingFigures')}</p>
        )}

        {!loading && row === null && (
          // The overview answered, and this book was not in the answer. That is
          // not "zero" — it is a book the figures route did not describe, and
          // saying so beats printing a dash that reads as "nothing happened".
          <p className="text-[12.5px] text-muted-foreground">
            {t('overview.noFiguresServed')}
          </p>
        )}

        {!loading && row && row.exercice === null && (
          <p className="text-[12.5px] text-muted-foreground">{t('overview.noExercice')}</p>
        )}

        {!loading && row?.bilan && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
            <Figure label={t('statements.totalActif')} amount={row.bilan.actif} />
            <Figure label={t('statements.totalPassif')} amount={row.bilan.passif} />
            <Figure
              label={t('overview.resultatYear', { year: row.exercice ?? '—' })}
              amount={row.bilan.resultat}
            />
            <div>
              <Dt>{t('overview.balance')}</Dt>
              <dd className={row.bilan.balanced ? 'text-foreground' : 'font-medium text-destructive'}>
                {row.bilan.balanced ? t('overview.balances') : t('overview.doesNotBalance')}
              </dd>
            </div>
          </dl>
        )}

        {!loading && row?.ri && (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
              <Figure label={t('overview.recettes')} amount={row.ri.recettes} />
              <Figure label={t('overview.depenses')} amount={row.ri.depenses} />
              <Figure
                label={t('overview.resultatYear', { year: row.exercice ?? '—' })}
                amount={row.ri.resultat}
              />
            </dl>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {t('overview.riNote')}{' '}
              <Link
                href={scopedHref(base, '/patrimoine', scope)}
                className="text-primary-strong hover:underline"
              >
                {t('overview.riNoteLink')}
              </Link>
              .
            </p>
          </>
        )}

        {!loading && row && row.exercice !== null && (
          // `worklist`, not `unrecognized`. The two are different predicates and
          // the difference is an INFERRED row — one the machine guessed at and
          // nobody has confirmed, which still needs a human and which
          // `unrecognized` excludes. The recognition screen lists both, and
          // `bk books overview` prints this figure under TO RESOLVE, so showing
          // the smaller one here made the page disagree with the CLI and with
          // the screen it links to. Seeded blackcode: 2 against 3.
          <p className="mt-2 flex flex-wrap gap-x-4 text-[11.5px] text-muted-foreground">
            <span>{t('overview.entriesCount', { n: row.entries })}</span>
            <span>{t('overview.toResolveCount', { n: row.worklist })}</span>
            <span>{t('overview.stagedCount', { n: row.staged })}</span>
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
  const t = useT()
  return (
    <section className="mt-8 rounded-lg border border-border bg-card px-4 py-4">
      <h2 className="text-sm font-semibold text-foreground">{t('overview.rollupTitle')}</h2>
      {/* The `<span className="font-medium">` around "never a consolidation" is
          gone: emphasis inside a sentence means splitting it into fragments,
          which fixes English clause order into the French. The disclaimer is one
          entry, and it stays ABOVE the numbers — a reader who stops at the
          figures must already have read what they are. */}
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {t('overview.rollupLead', { books: totals.books })}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
        <Figure label={t('statements.totalActif')} amount={totals.totalActif} />
        <Figure label={t('overview.combinedResult')} amount={totals.resultat} />
        <div>
          <Dt>{t('overview.entries')}</Dt>
          <dd className="num text-foreground">{totals.entries}</dd>
        </div>
        <div>
          {/* `worklist`, not `unrecognized` — see `lib/rollup.ts`. This label is
              a claim about work outstanding, and the field that answers it
              includes the inferred rows a rule guessed at. */}
          <Dt>{t('overview.needAHuman')}</Dt>
          <dd className="num text-foreground">{totals.worklist}</dd>
        </div>
      </dl>

      <ul className="mt-3 space-y-1 border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
        {/* Which books each total actually covers. A total that silently omits a
            book is the most reassuring wrong answer this panel can give. */}
        {/* Four whole sentences rather than one assembled from fragments. Two
            counts each agree independently, and French moves the agreement into
            places English does not have — the ternaries that worked here are
            exactly what a translation cannot carry. */}
        <li>{t(coverKey(totals), { n: totals.bilanBooks, ri: totals.riBooks })}</li>
        {totals.riBooks > 0 && <li>{t('overview.mixedResult')}</li>}
        {totals.withoutExercice > 0 && (
          <li>
            {t(
              totals.withoutExercice === 1
                ? 'overview.withoutExerciceOne'
                : 'overview.withoutExerciceMany',
              { n: totals.withoutExercice }
            )}
          </li>
        )}
        {totals.staged > 0 && (
          <li>
            {t(
              totals.staged === 1 ? 'overview.stagedExcludedOne' : 'overview.stagedExcludedMany',
              { n: totals.staged }
            )}
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

/**
 * Which of the four "Total actif covers…" sentences this rollup needs.
 *
 * Four, because two counts agree independently and French moves the agreement
 * into the article, the noun, the verb AND the participle. Picking the key here
 * rather than assembling fragments in JSX is what makes the sentence something
 * a translator can write; it is also what makes the compile-time key check
 * cover all four, since each is a literal.
 */
function coverKey(totals: ReturnType<typeof rollup>): BooksKey {
  if (totals.riBooks === 0) {
    return totals.bilanBooks === 1 ? 'overview.coverOne' : 'overview.coverMany'
  }
  return totals.riBooks === 1 ? 'overview.coverRiOne' : 'overview.coverRiMany'
}
