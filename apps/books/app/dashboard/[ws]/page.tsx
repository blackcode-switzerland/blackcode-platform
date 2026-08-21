'use client'

// The overview — the book index and the cross-book rollup, on one page.
//
// ===========================================================================
// REBUILT 2026-08-21. WHAT IT WAS, AND WHY THAT FAILED
// ===========================================================================
// Three books rendered as three stacked cards, each holding eight
// label-above-value fields and a figure block, on a cream page where the card
// and the ground were the same colour. Every fact had the same weight: the
// book's postal address was drawn exactly as loudly as its résultat. To compare
// two books' total actif you had to scroll between two cards and hold the first
// number in your head.
//
// **The fix is the mockup's, and it is one idea: a book is a ROW.** The mockup
// renders the same three books as three lines of a table and the whole page is
// readable in one pass. Nothing here is new information; it is the same payload
// laid out so it can be compared downward.
//
// ── WHY THE FIGURES ARE TWO TABLES AND NOT ONE ─────────────────────────────
// A double-entry book has total actif, total passif, résultat and a balance
// check. A simplified book (art. 957 al. 2) has recettes, dépenses and a
// résultat that means something different — cash in minus cash out, with no
// accruals behind it. They do not share a column set.
//
// One table would need a header that is true for some rows and false for
// others, or a generic header that names neither. Both are worse than two
// tables, and the split has a second payoff: the art. 957 al. 2 note used to be
// repeated inside every simplified book's card and is now ONE footnote on the
// table it describes, which is where a reader is looking when they need it.
//
// A group with no books does not render. Nothing here assumes how many books
// there are, or of which kind (D-D).
//
// ── THE ROLLUP'S DISCLAIMER STAYS ABOVE ITS FIGURES ────────────────────────
// It was above them before and it stays above them. A reader who stops reading
// at the numbers must already have passed the sentence saying what they are —
// so the four totals are NOT lifted into a stat row at the top of the page,
// however much they look like page-level headline figures. They are figures
// about an aggregation that has no standing in any filing, and they are only
// safe to show attached to the sentence that says so.

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
import { PageHeader } from '@/components/page-header'
import { PageShell, Grid, Section } from '@/components/section'
import { Stat, StatRow } from '@/components/stat'
import { Badge, StateChip } from '@/components/badge'
import { DataTable, type Column } from '@/components/data-table'
import type { Entity } from '@/lib/types'
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'

/** A book and the figures served for it, if any. One row of every table here. */
interface BookRow {
  entity: Entity
  row: OverviewBook | null
}

export default function OverviewPage() {
  const { data: session } = useSession()
  const params = useParams<{ ws: string }>()
  const base = `/dashboard/${params.ws}`
  const scope = useScope()
  const { entities, isLoading, error, source } = scope
  const overview = useOverview(params.ws)
  const t = useT()

  // Padded, for `<ScreenFrame>`'s reason — the shell no longer pads, so an
  // unwrapped early return renders against the chrome. This page does not use
  // `<ScreenFrame>` (it is the one screen that must render with NO book in
  // scope), so it carries the same four branches itself.
  if (isLoading)
    return (
      <PageShell>
        <Loading rows={4} label={t('overview.loading')} />
      </PageShell>
    )
  if (error)
    return (
      <PageShell>
        <ErrorState error={error} title={t('overview.loadError')} />
      </PageShell>
    )
  if (entities.length === 0)
    return (
      <PageShell>
        <NoBooks email={session?.user?.email} />
      </PageShell>
    )

  const single = entities.length === 1
  const served = overview.data ?? []
  const byslug = new Map(served.map((r) => [r.slug, r]))
  const totals = rollup(served)

  const books: BookRow[] = entities.map((entity) => ({
    entity,
    row: byslug.get(entity.slug) ?? null,
  }))

  // Split on the REGIME, positively and by enumeration — `=== 'simplified'`,
  // never `!== 'double_entry'`. `lib/resolvable.ts` records at length what the
  // negative test cost this app when a third value arrived: a book kept under a
  // regime this bundle has never heard of belongs in neither table and is shown
  // in the identity table only, rather than being swept into whichever branch
  // the negation happened to fall through to.
  const doubleEntry = books.filter((b) => b.entity.bookkeeping_regime === 'double_entry')
  const simplified = books.filter((b) => b.entity.bookkeeping_regime === 'simplified')

  return (
    <PageShell>
      <FixtureNotice source={source} />

      {/*
        No eyebrow here, deliberately. The topbar says "Overview", the sidebar
        highlights "Overview", and an eyebrow reading "Overview" above a title
        would be the third. The eyebrow earns its place on the screens a reader
        arrives at from a cross-link rather than from the nav — taxes,
        patrimoine, the compliance register, a detail page — where it is the
        only thing on screen saying where they have landed.
      */}
      <PageHeader
        title={single ? t('overview.titleOne') : t('overview.titleMany')}
        lead={single ? t('overview.leadOne') : t('overview.leadMany')}
      />

      {overview.error && (
        <div className="mb-4">
          <ErrorState error={overview.error} title={t('overview.figuresFailed')} />
        </div>
      )}

      <Grid>
        <Section label={t('overview.booksLabel')} note={t('overview.booksNote')} bodyClassName="">
          <BooksTable books={books} base={base} />
        </Section>

        {doubleEntry.length > 0 && (
          <Section label={t('overview.doubleEntryBooks')} bodyClassName="">
            <DoubleEntryTable
              books={doubleEntry}
              base={base}
              loading={overview.isLoading}
            />
          </Section>
        )}

        {simplified.length > 0 && (
          <Section
            label={t('overview.simplifiedBooks')}
            bodyClassName=""
            note={<RiNote base={base} books={simplified} />}
          >
            <SimplifiedTable books={simplified} base={base} loading={overview.isLoading} />
          </Section>
        )}

        {!single && overview.data && <RollupSection totals={totals} />}
      </Grid>

      {/* The two off-nav screens, and the only way into either — both are
          deliberately not in the sidebar (`lib/nav.ts`). Tax TRACKING over time
          is a different product and this is a statutory snapshot; the compliance
          register is not part of a working loop. The links keep the scope, which
          matters for the first and is harmless for the second — the rules are
          the same for every book, and `/compliance` says so. */}
      <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
    </PageShell>
  )
}

/**
 * The book's name cell — the chip, and its registered seat under it.
 *
 * Shared by all three tables so a reader tracks the same book down the page by
 * the same mark. The seat is the mockup's arrangement too: a quiet second line
 * rather than a column of its own, because an address is long, varies wildly in
 * length, and is never the thing being compared.
 */
function BookCell({ entity }: { entity: Entity }) {
  const t = useT()
  return (
    <div className="min-w-0">
      <EntityChip entity={entity} />
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
        {entity.seat ?? t('overview.noSeat')}
      </p>
    </div>
  )
}

/**
 * Table one: what each book IS.
 *
 * Everything `<BookFacts>` rendered, as columns. `<BookFacts>` itself is
 * unchanged and still used by the patrimoine screen, which shows one book and
 * is the case a field list is right for.
 */
function BooksTable({ books, base }: { books: BookRow[]; base: string }) {
  const t = useT()

  const columns: Column<BookRow>[] = [
    {
      key: 'book',
      header: t('overview.book'),
      cell: (b) => <BookCell entity={b.entity} />,
      sortValue: (b) => b.entity.name,
    },
    {
      key: 'form',
      header: t('facts.legalForm'),
      // Served, and a legal designation rather than a word we chose — not
      // translated, in either direction.
      cell: (b) => <Badge>{b.entity.legal_form}</Badge>,
      sortValue: (b) => b.entity.legal_form,
    },
    {
      key: 'regime',
      header: t('facts.regime'),
      // A `<Badge>` rather than a `<StateChip>`: the regime is neither good nor
      // bad, and `bookkeeping_regime` is an OPEN value — this app already
      // renders a third one raw when it meets it. A qualifier, per the taxonomy.
      cell: (b) => <Badge>{regimeLabel(b.entity, t)}</Badge>,
      sortValue: (b) => b.entity.bookkeeping_regime,
    },
    {
      key: 'vat',
      header: t('facts.vat'),
      // `registered` is a BOOLEAN, not a vocabulary — the server cannot grow a
      // third value without changing the type. See `<StateChip>`. Registered is
      // the ok side because it is a live obligation being met; not-registered is
      // not a failure, so it is the neutral chip rather than the bad one.
      cell: (b) =>
        b.entity.vat.registered ? (
          <StateChip tone="ok">{vatLabel(b.entity, t)}</StateChip>
        ) : (
          <Badge>{vatLabel(b.entity, t)}</Badge>
        ),
      sortValue: (b) => String(b.entity.vat.registered),
    },
    {
      key: 'audit',
      header: t('facts.audit'),
      // `audit_status` is a served vocabulary value (`opted_out`). Translating
      // it is a backend request — a served label belongs with its value.
      cell: (b) => b.entity.audit_status?.replace('_', ' ') ?? EMDASH,
      sortValue: (b) => b.entity.audit_status ?? null,
    },
    {
      key: 'fte',
      header: t('facts.fte'),
      numeric: true,
      // A `numeric` STRING on the wire (`"4.60"`). Printed as served — no
      // parse, no rounding — because the only reason it is on screen is that it
      // is what preserves audit opt-out eligibility, and a rounded headcount is
      // not that fact.
      cell: (b) => b.entity.fte_count ?? EMDASH,
      sortValue: (b) => b.entity.fte_count,
    },
    {
      key: 'number',
      header: '#',
      numeric: true,
      cell: (b) => b.entity.number,
      sortValue: (b) => b.entity.number,
    },
  ]

  return (
    <DataTable
      rows={books}
      columns={columns}
      rowKey={(b) => b.entity.slug}
      // Restored 2026-08-21: the book cards this table replaced carried it.
      rowAttrs={(b) => ({ 'data-book': b.entity.slug })}
      onRowClick={(b) =>
        // The mockup's own affordance: a book opens its grand livre.
        window.location.assign(
          scopedHref(base, '/ledger', { entity: b.entity.slug, exercice: null })
        )
      }
    />
  )
}

/** Table two: the double-entry books' year. */
function DoubleEntryTable({
  books,
  base,
  loading,
}: {
  books: BookRow[]
  base: string
  loading: boolean
}) {
  const t = useT()

  const columns: Column<BookRow>[] = [
    {
      key: 'book',
      header: t('overview.book'),
      cell: (b) => <BookCell entity={b.entity} />,
      sortValue: (b) => b.entity.name,
    },
    {
      key: 'year',
      header: t('overview.year'),
      numeric: true,
      cell: (b) => b.row?.exercice ?? EMDASH,
      sortValue: (b) => b.row?.exercice ?? null,
    },
    {
      key: 'actif',
      header: t('statements.totalActif'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.bilan?.actif} />,
      sortValue: (b) => b.row?.bilan?.actif ?? null,
    },
    {
      key: 'passif',
      header: t('statements.totalPassif'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.bilan?.passif} />,
      sortValue: (b) => b.row?.bilan?.passif ?? null,
    },
    {
      key: 'resultat',
      header: t('overview.resultat'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.bilan?.resultat} />,
      sortValue: (b) => b.row?.bilan?.resultat ?? null,
    },
    {
      key: 'balance',
      header: t('overview.balance'),
      // The clearest closed boolean in the product: a bilan balances or it does
      // not, and there is no third answer. It was grey prose on the good side
      // and red prose on the bad, which meant the ordinary case — a correct set
      // of books — looked like every other cell on the row.
      cell: (b) =>
        b.row?.bilan ? (
          <StateChip tone={b.row.bilan.balanced ? 'ok' : 'bad'}>
            {b.row.bilan.balanced ? t('overview.balances') : t('overview.doesNotBalance')}
          </StateChip>
        ) : (
          EMDASH
        ),
      sortValue: (b) => (b.row?.bilan ? String(b.row.bilan.balanced) : null),
    },
    ...workColumns<BookRow>(t),
  ]

  return (
    <DataTable
      rows={books}
      columns={columns}
      rowKey={(b) => b.entity.slug}
      rowAttrs={(b) => ({ 'data-book': b.entity.slug })}
      attention={attentionFor}
      onRowClick={(b) =>
        window.location.assign(
          scopedHref(base, '/balance-sheet', { entity: b.entity.slug, exercice: null })
        )
      }
    />
  )
}

/** Table three: the simplified books' year. */
function SimplifiedTable({
  books,
  base,
  loading,
}: {
  books: BookRow[]
  base: string
  loading: boolean
}) {
  const t = useT()

  const columns: Column<BookRow>[] = [
    {
      key: 'book',
      header: t('overview.book'),
      cell: (b) => <BookCell entity={b.entity} />,
      sortValue: (b) => b.entity.name,
    },
    {
      key: 'year',
      header: t('overview.year'),
      numeric: true,
      cell: (b) => b.row?.exercice ?? EMDASH,
      sortValue: (b) => b.row?.exercice ?? null,
    },
    {
      key: 'recettes',
      header: t('overview.recettes'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.ri?.recettes} />,
      sortValue: (b) => b.row?.ri?.recettes ?? null,
    },
    {
      key: 'depenses',
      header: t('overview.depenses'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.ri?.depenses} />,
      sortValue: (b) => b.row?.ri?.depenses ?? null,
    },
    {
      key: 'resultat',
      header: t('overview.resultat'),
      numeric: true,
      cell: (b) => <Figure b={b} loading={loading} amount={b.row?.ri?.resultat} />,
      sortValue: (b) => b.row?.ri?.resultat ?? null,
    },
    ...workColumns<BookRow>(t),
  ]

  return (
    <DataTable
      rows={books}
      columns={columns}
      rowKey={(b) => b.entity.slug}
      rowAttrs={(b) => ({ 'data-book': b.entity.slug })}
      attention={attentionFor}
      onRowClick={(b) =>
        window.location.assign(
          scopedHref(base, '/patrimoine', { entity: b.entity.slug, exercice: null })
        )
      }
    />
  )
}

/**
 * Entries, to-resolve and staged — the three counts, on both figure tables.
 *
 * They were a line of grey text under each card. As columns they can be
 * compared, which is the only reason a person reads three counts at once.
 */
function workColumns<T extends BookRow>(t: ReturnType<typeof useT>): Column<T>[] {
  return [
    {
      key: 'entries',
      header: t('overview.entries'),
      numeric: true,
      cell: (b) => b.row?.entries ?? EMDASH,
      sortValue: (b) => b.row?.entries ?? null,
    },
    {
      key: 'worklist',
      header: t('overview.toResolve'),
      numeric: true,
      // `worklist`, not `unrecognized`. The two are different predicates and the
      // difference is an INFERRED row — one the machine guessed at and nobody
      // has confirmed, which still needs a human and which `unrecognized`
      // excludes. `bk books overview` prints this figure under TO RESOLVE, so
      // showing the smaller one made the page disagree with the CLI and with the
      // screen it links to.
      cell: (b) =>
        b.row ? (
          <span className={b.row.worklist > 0 ? 'font-medium text-primary-strong' : undefined}>
            {b.row.worklist}
          </span>
        ) : (
          EMDASH
        ),
      sortValue: (b) => b.row?.worklist ?? null,
    },
    {
      key: 'staged',
      header: t('overview.staged'),
      numeric: true,
      cell: (b) => b.row?.staged ?? EMDASH,
      sortValue: (b) => b.row?.staged ?? null,
    },
  ]
}

/**
 * Level 4 of the badge taxonomy: does this book need a human?
 *
 * Only `worklist` earns it. Staged entries are not outstanding WORK — they are
 * money whose meaning is agreed and whose posting is a separate, deliberate act
 * — and marking them would put a rule on almost every row, which marks nothing.
 */
function attentionFor(b: BookRow): 'work' | null {
  return b.row && b.row.worklist > 0 ? 'work' : null
}

/**
 * One figure cell, and the three things that are NOT a figure.
 *
 * `loading`, "no figures were served for this book", and "no fiscal year is
 * open" are three different facts and the old page said each of them in full
 * prose. In a cell they have to be short, so the long sentence for the third
 * moved to the row's title attribute rather than being dropped: a book with no
 * exercice is the single most likely thing a new user sees, and "—" would tell
 * them the app is broken.
 */
function Figure({
  b,
  loading,
  amount,
}: {
  b: BookRow
  loading: boolean
  amount: string | undefined
}) {
  const t = useT()
  if (loading) return <span className="text-muted-foreground">…</span>
  if (b.row === null)
    return (
      <span className="text-[11.5px] font-normal text-muted-foreground" title={t('overview.noFiguresServed')}>
        {t('overview.noFiguresShort')}
      </span>
    )
  if (b.row.exercice === null)
    return (
      <span className="text-[11.5px] font-normal text-muted-foreground" title={t('overview.noExercice')}>
        {t('overview.noExerciceShort')}
      </span>
    )
  if (amount === undefined) return <>{EMDASH}</>
  return <Money value={amount} bare />
}

/**
 * The art. 957 al. 2 note — ONE footnote on the simplified table.
 *
 * It was repeated inside every simplified book's card. The link is scoped to
 * the first simplified book when there is exactly one, because that is the
 * common case and a link to "the" patrimoine statement is only meaningful when
 * there is one book it can mean. With several, the sentence keeps its full
 * wording and drops the link rather than picking a book by array order — which
 * would be a statement about somebody's books read off a sort.
 */
function RiNote({ base, books }: { base: string; books: BookRow[] }) {
  const t = useT()
  const only = books.length === 1 ? books[0] : null
  return (
    <>
      {t('overview.riNote')}{' '}
      {only ? (
        <Link
          href={scopedHref(base, '/patrimoine', { entity: only.entity.slug, exercice: null })}
          className="not-italic text-primary-strong hover:underline"
        >
          {t('overview.riNoteLink')}
        </Link>
      ) : (
        t('overview.riNoteLink')
      )}
      .
    </>
  )
}

/**
 * The rollup: the disclaimer, then the four totals, then what each covers.
 *
 * Unchanged in every respect that matters. The disclaimer is still above the
 * numbers, the four figures are still `worklist` rather than `unrecognized`,
 * and all four footnotes are still whole sentences chosen by key rather than
 * assembled from fragments — French moves agreement into the article, the noun,
 * the verb AND the participle, so a sentence built by concatenation in JSX is
 * one a translator cannot write.
 */
function RollupSection({ totals }: { totals: ReturnType<typeof rollup> }) {
  const t = useT()
  return (
    <Section
      label={t('overview.rollupTitle')}
      note={
        <ul className="space-y-1">
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
      }
    >
      {/* Above the figures. Not a footnote, not a tooltip, not collapsed. */}
      <p className="mb-3 max-w-[95ch] text-[12.5px] leading-relaxed text-muted-foreground">
        {t('overview.rollupLead', { books: totals.books })}
      </p>

      <StatRow className="mb-0">
        <Stat caption={t('statements.totalActif')} value={<Money value={totals.totalActif} bare />} />
        <Stat
          caption={t('overview.combinedResult')}
          value={<Money value={totals.resultat} bare />}
        />
        <Stat caption={t('overview.entries')} value={totals.entries} />
        <Stat
          caption={t('overview.needAHuman')}
          value={totals.worklist}
          emphasis={totals.worklist > 0}
        />
      </StatRow>
    </Section>
  )
}

/**
 * The em dash for an absent value.
 *
 * A constant rather than a literal so `lib/hardcoded-strings.test.ts` is not
 * asked to decide whether a lone punctuation mark is copy, and so that the one
 * rule that matters here is visible in one place: **an em dash is "there is no
 * value". It is never `0.00`, and `0.00` is never an em dash.**
 */
const EMDASH = '—'

function regimeLabel(entity: Entity, t: ReturnType<typeof useT>) {
  if (entity.bookkeeping_regime === 'double_entry') return t('facts.doubleEntry')
  if (entity.bookkeeping_regime === 'simplified') return t('facts.simplified')
  // A third value is a regime this bundle does not know. Show it raw rather
  // than binning it into one of the two we do — the same rule `<TermChip>` uses
  // for an unserved vocabulary value.
  return entity.bookkeeping_regime
}

function vatLabel(entity: Entity, t: ReturnType<typeof useT>) {
  if (!entity.vat.registered) return t('facts.vatNot')
  return (
    [entity.vat.method, entity.vat.filing].filter(Boolean).join(', ') || t('facts.vatRegistered')
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
