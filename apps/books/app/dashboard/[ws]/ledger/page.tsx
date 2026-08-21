'use client'

// The journal of one book, one fiscal year — and since phase 4A there are TWO
// of them behind this one screen.
//
// ===========================================================================
// THE SCREEN BRANCHES ON THE REGIME BEFORE IT READS A ROW
// ===========================================================================
// `GET …/entries` serves the grand livre for a double-entry book and the
// recettes-dépenses journal for a simplified one, and there is **deliberately no
// marker field on the wire** — from the route's own header: *"The caller named
// the book (or accepted the default), so the caller knows which shape it gets —
// context explicit, no marker field."*
//
// So the discriminator is `bookkeeping_regime`, which `useScope()` already
// resolves, and the branch is `lib/journal.ts`'s — POSITIVE and enumerated,
// `journal === 'grand_livre'`, never `!== 'recettes_depenses'`. The reason is on
// record in `lib/resolvable.ts`: the worklist's `!== 'ri_entry'` was exhaustive
// for two kinds and, when a third arrived, failed toward a write.
//
// ── WHAT THIS SCREEN DID BEFORE THE BRANCH, IN A BROWSER, ON 2026-08-19 ────
// `/dashboard/blackcode/ledger?entity=ri` rendered the six seeded RI movements
// through grand-livre columns:
//
//   · `N°` blank on every row       — an RI journal has no `entry_no`
//   · `Status` blank on every row   — it has no posting lifecycle
//   · "This entry has no lines."    — six times, over rows that are not lines
//   · **no amount and no direction shown anywhere** — the ONLY two facts an
//     RI movement carries, and neither had a column
//   · every label linked to `/ledger/{n}`, which reads `books.entry` and opened
//     **another book's écriture** under this book's name in the header: RI #3
//     (CAISSE DE COMPENSATION VD, 640.00 dépense) opened blackcode SA's
//     WIR-PMT REF-88213 IMMOREGIE SA.
//
// The last one is this app's worst failure mode — one book's record under
// another's name — and nothing threw. This is the THIRD payload to change shape
// under a merged screen; phase 1's and phase 3's are in `phase-4a/README.md`.
//
// ── AND THE OLD EMPTY STATE BECAME UNREACHABLE WITHOUT BEING TOUCHED ──────
// This file used to carry a `simplified` empty state saying "this book keeps no
// grand livre… a screen for the simplified movements needs a route that does not
// exist yet". It was correct when written and it is gone now, both because the
// route exists and because **it was already dead**: it only rendered when the
// list came back empty, and after 4A the list comes back FULL. A correct backend
// change retargeted a correct branch — CLAUDE.md finding #10 — and the symptom
// was not an empty screen but a wrong one.
//
// ===========================================================================
// THE LIST-AND-DETAIL PATTERN THE REST OF THE APP REUSES. GET IT RIGHT ONCE.
// ===========================================================================
// A grand-livre row is one écriture, shown WHOLE: every line of it, both sides,
// because the other side is what says where the money went. `?account=` filters
// which entries appear and never which lines of them are shown — that is the
// route's behaviour and this screen must not undo it by rendering only the
// matching line.
//
// ── `?account=` ARRIVES FROM THE INCOME STATEMENT ─────────────────────────
// Each CR line carries its `accounts`, `<AccountRef>` links to here with the
// number, and this page reads it out of the URL. It is a URL a reader can
// bookmark and an agent can construct, so it is shown as a removable filter
// rather than as hidden state.
//
// ── THE #NUMBER IS THE ADDRESS, NOT THE JOURNAL NUMBER ────────────────────
// `number` is the workspace seq and is what `/ledger/{number}`, `bk books entry
// show` and a URN all take. `entry_no` is the statutory journal number, gapless
// within (entity, exercice), and is what a reader comparing against a filing
// needs. Both are shown; they are not interchangeable and the columns say so.
//
// **The two journals keep SEPARATE `seq` counters**, which is why an RI row is
// not a link: `/ledger/{n}` reads `books.entry` and there is no route that
// serves one recettes-dépenses movement. That is the same fact ticket #51 is
// about, and it is a backend ask in the report.

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { useScope, type ScopeState } from '@/lib/scope'
import { useEntries, useRiEntries, LEDGER_LIMIT } from '@/lib/hooks'
import { accountTotals, riTotals } from '@/lib/ledger-totals'
import { journalAccepts, JOURNAL_NAME, type Journal } from '@/lib/journal'
import { scopedHref } from '@/lib/nav'
import { useLabel } from '@/lib/use-label'
import { useLocale, useT } from '@/lib/i18n'
import { ScreenFrame } from '@/components/screen-frame'
import { usePageTitle } from '@/components/books-shell'
import { DataTable, type Column } from '@/components/data-table'
import { EmptyState, Loading } from '@/components/states'
import { DateText } from '@/components/date-text'
import { Money } from '@/components/money'
import { VocabChip } from '@/components/chips'
import { EntryLines } from '@/components/entry-lines'
import { PageHeader } from '@/components/page-header'
import { Section, Surface } from '@/components/section'
import { Stat, StatRow } from '@/components/stat'
import type { Entry, RiEntry } from '@/lib/types'
import type { BooksKey } from '@/lib/dictionary'

/**
 * The result count — "N entries on this page", and never "N of M".
 *
 * ===========================================================================
 * THERE IS NO TOTAL ON THE WIRE, AND THE LIST IS CAPPED
 * ===========================================================================
 * The mockup's `f-count` prints `rows.length + ' entries'` and it is honest
 * there because that mockup holds the whole journal in a JavaScript array. This
 * screen does not:
 *
 *   · `listEntries` caps at `limit ?? 100`, clamped to 500. This page sends no
 *     `limit`, so a book with more than a hundred écritures is served a hundred
 *     — the demo workspace has 115. The rows are real; the LIST is short.
 *   · Since #69 the wire DOES carry the missing figure: `GET …/entries` serves
 *     a real `next_cursor` and a `total`. So "115 of 200" is now available and
 *     true. It is deliberately not printed yet: a screen that shows a total
 *     invites the reader to scroll to it, and this table still holds one page.
 *     Paging the ledger is the frontend change that earns the fuller sentence.
 *
 * So the only true sentence available is about this page. `{n} entries on this
 * page`, with the caveat printed beside it rather than left implied — a bare
 * `115 entries` under a filter bar reads as a total to every reader who has
 * ever seen one, which is the confident-wrong-answer shape this app keeps
 * finding in its own history.
 *
 * **The count is taken from the rows the table was handed**, so it can never
 * disagree with what is on screen — the same reason `<RulesPanel>` counts its
 * own rows and the recognition screen does not.
 *
 * Serving a total is a backend ask, and it is one: a truncated ledger with
 * nothing to say so is worth a route change. Until then this line is the
 * honest half of it.
 */
function ResultCount({ n, journal }: { n: number; journal: Journal }) {
  const t = useT()
  const key: BooksKey =
    journal === 'grand_livre'
      ? n === 1
        ? 'ledger.countOne'
        : 'ledger.countMany'
      : n === 1
        ? 'ledger.riCountOne'
        : 'ledger.riCountMany'

  // ── THE CAVEAT IS PRINTED WHEN IT IS TRUE, AND NOT OTHERWISE ────────────
  // It was printed on all four counts unconditionally until 2026-08-21, and in
  // three of those cases it was over-cautious to the point of being wrong:
  // `listRiEntries` applies no limit at all, and a grand livre that came back
  // short of the cap returned everything the filter matched.
  //
  // `n === LEDGER_LIMIT` is the one state where the list really is short and
  // nothing on the wire says so. It is an exact equality rather than `>=`
  // because the server clamps — a full page is exactly the cap, and
  // `lib/count-honesty.test.ts` pins `LEDGER_LIMIT` to the clamp so this
  // comparison cannot quietly stop being reachable.
  //
  // A caveat on a figure that does not need one is not free: it teaches the
  // reader to skip caveats, and this app prints several that matter.
  const atCap = journal === 'grand_livre' && n === LEDGER_LIMIT

  return (
    <span
      className="text-[11.5px] text-muted-foreground"
      data-result-count={n}
      data-at-cap={atCap ? 'true' : undefined}
    >
      <span className="text-foreground">{t(key, { n })}</span>
      {atCap && <span> — {t('ledger.countAtCap')}</span>}
    </span>
  )
}

/**
 * The reader-facing name of each filter, for the "this was dropped" sentence.
 *
 * The URL keys stay `account` / `status` / `recognition` — they are the route's
 * parameter names and the `data-ignored-filters` attribute a test reads. This
 * table is only what the sentence says out loud.
 */
const FILTER_NAME: Record<'account' | 'status' | 'recognition', BooksKey> = {
  account: 'ledger.colAccountName',
  status: 'ledger.colStatus',
  recognition: 'ledger.colRecognition',
}

export default function Page() {
  const params = useParams<{ ws: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const scope = useScope()
  const t = useT()
  const locale = useLocale()
  const base = `/dashboard/${params.ws}`

  // Every filter comes from the URL, so a filtered ledger is a shareable page
  // and the browser's Back button undoes a filter. Same reason as the scope.
  const account = search?.get('account') ?? null
  const status = search?.get('status') ?? null
  const recognition = search?.get('recognition') ?? null

  const journal = scope.journal

  /**
   * The heading, and the SHELL is told it too.
   *
   * `<ScreenFrame title>` labels the loading and error states and nothing else,
   * so setting it here alone left the H1 reading "General ledger" over a book
   * that keeps no general ledger — the ternary was correct and rendered nowhere
   * (phase-4A review, F-5). `usePageTitle` is what reaches the header.
   *
   * `null` while the journal is unknown, so the nav label stands rather than
   * this screen guessing which document the reader is looking at.
   */
  // The reader's side of `JOURNAL_NAME`, which already carries both. `'Journal'`
  // is the same word in both languages and is the fallback while the journal is
  // being resolved — not a dictionary entry, because it is not chrome we chose.
  const heading =
    journal === null ? 'Journal' : locale === 'fr' ? JOURNAL_NAME[journal].fr : JOURNAL_NAME[journal].en
  usePageTitle(journal === null ? null : heading)

  // ── THE FILTERS ARE SPLIT BY WHAT THIS JOURNAL WILL ACCEPT ──────────────
  // Not by what the URL says. `?status=` and `?account=` are REFUSED by an RI
  // journal (400 `ri_no_such_filter`), not ignored, so a URL carrying one is a
  // request this screen must not send. `journalAccepts` is the one table that
  // decides it, and the rejected ones are still listed below — dropping a filter
  // silently would be a list the reader believes is narrower than it is.
  const applied = {
    account: journalAccepts(journal, 'account') ? account : null,
    status: journalAccepts(journal, 'status') ? status : null,
    recognition: journalAccepts(journal, 'recognition') ? recognition : null,
  }
  const ignored = [
    account !== null && applied.account === null ? ('account' as const) : null,
    status !== null && applied.status === null ? ('status' as const) : null,
    recognition !== null && applied.recognition === null ? ('recognition' as const) : null,
  ].filter((k): k is 'account' | 'status' | 'recognition' => k !== null)

  // Both hooks are always CALLED — hooks are not conditional — and each one is
  // enabled only for its own journal. The one that is not this book's fires no
  // request and holds no data, so there is never a moment where a payload of one
  // shape is in the slot of the other.
  const entries = useEntries(params.ws, scope, journal, {
    account: applied.account ?? undefined,
    status: applied.status ?? undefined,
    recognition: applied.recognition ?? undefined,
    // Sent from 2026-08-21. Without it the route defaults to 100 and a book
    // with more écritures than that was served a hundred and rendered as
    // though that were the journal — no count on the wire, `next_cursor`
    // always null, nothing anywhere saying the list was short. `northgate` has
    // 115. See `EntryFilters.limit`.
    limit: LEDGER_LIMIT,
  })
  const riEntries = useRiEntries(params.ws, scope, journal, {
    recognition: applied.recognition ?? undefined,
  })

  const name = journal === null ? null : JOURNAL_NAME[journal]

  function clearFilter(key: string) {
    const next = new URLSearchParams(search?.toString() ?? '')
    next.delete(key)
    router.replace(`${base}/ledger?${next.toString()}`, { scroll: false })
  }

  const anyFilter = !!(applied.account || applied.status || applied.recognition)

  return (
    <ScreenFrame title={heading}>
      {/*
        The statutory document's own name, in the reader's language, with the
        LEGAL French beneath — the same arrangement `<StatementHeading>` uses,
        and the same test: identical strings mean the two are one word, so only
        one is rendered. `JOURNAL_NAME` carries both.

        It is read from the JOURNAL, never from the book's name: two books of the
        same regime keep the same document.
      */}
      <PageHeader
        eyebrow={t('nav.ledger')}
        title={
          <>
            {name ? heading : EMDASH}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {name ? (name.fr !== heading ? name.fr : null) : t('ledger.resolvingJournal')}
            </span>
          </>
        }
        lead={t('ledger.subheading', {
          book: scope.record?.name ?? EMDASH,
          year: scope.exercice ?? EMDASH,
        })}
        meta={
          anyFilter ? (
            <>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('ledger.filtered')}
              </span>
              {applied.account && (
                <FilterPill
                  label={t('ledger.filterAccount', { value: applied.account })}
                  onClear={() => clearFilter('account')}
                />
              )}
              {applied.status && (
                <FilterPill
                  label={t('ledger.filterStatus', { value: applied.status })}
                  onClear={() => clearFilter('status')}
                />
              )}
              {applied.recognition && (
                <FilterPill
                  label={t('ledger.filterRecognition', { value: applied.recognition })}
                  onClear={() => clearFilter('recognition')}
                />
              )}
              {applied.account && (
                <span className="text-[11.5px] text-muted-foreground">
                  {t('ledger.accountFilterNote')}
                </span>
              )}
            </>
          ) : null
        }
      />

      {/* ── A DROPPED FILTER IS SAID OUT LOUD ───────────────────────────────
          The URL asked for something this journal cannot answer. Sending it is
          a 400; dropping it quietly hands the reader a LONGER list than the one
          they asked for, with nothing on the page to say so — and a list that is
          wider than its own filter chip claims is the shape of every confident
          wrong answer in this app's history.

          Elevation 2, and this is what that level is for: the one thing on the
          page that is different from the rest of it. */}
      {ignored.length > 0 && (
        <Surface tone="attention" role="status" className="mb-4">
          <p
            data-ignored-filters={ignored.join(',')}
            className="max-w-[95ch] text-[12px] leading-relaxed text-muted-foreground"
          >
            {t('ledger.ignoredLead', {
              fields: ignored.map((k) => t(FILTER_NAME[k])).join(` ${t('ledger.and')} `),
            })}{' '}
            {journal === 'recettes_depenses'
              ? t('ledger.ignoredRi')
              : t('ledger.ignoredUnknown')}
          </p>
        </Surface>
      )}

      {journal === null ? (
        // Not an empty table and not a guess. `null` means the books have not
        // arrived, or `?entity=` names nothing, or the regime is a value this
        // bundle does not know — and each of those is a different sentence from
        // "this book has no entries".
        <UnknownJournal scope={scope} />
      ) : journal === 'grand_livre' ? (
        <GrandLivre
          rows={entries.data}
          isLoading={entries.isLoading}
          error={entries.error}
          base={base}
          scope={scope}
          filtered={anyFilter}
          account={applied.account}
        />
      ) : (
        <RecettesDepenses
          rows={riEntries.data}
          isLoading={riEntries.isLoading}
          error={riEntries.error}
          scope={scope}
          filtered={!!applied.recognition}
          base={base}
        />
      )}
    </ScreenFrame>
  )
}

/**
 * The em dash for an absent value. Never `0.00`, and `0.00` is never this.
 */
const EMDASH = '—'

/**
 * The grand livre — one écriture per row, shown whole.
 *
 * Unchanged from phase 1 except that it is now reached only for a
 * `grand_livre` book, which is what makes every column on it true.
 */
function GrandLivre({
  rows,
  isLoading,
  error,
  base,
  scope,
  filtered,
  account,
}: {
  rows: Entry[] | undefined
  isLoading: boolean
  error: unknown
  base: string
  scope: ScopeState
  filtered: boolean
  /** The account currently filtered to, if any. Drives the totals strip. */
  account: string | null
}) {
  const t = useT()
  const columns = useMemo<Column<Entry>[]>(
    () => [
      {
        key: 'entry_no',
        header: t('ledger.colNo'),
        cell: (e) => (
          <span className="font-mono text-[12px] text-muted-foreground">{e.entry_no}</span>
        ),
        sortValue: (e) => e.entry_no,
      },
      {
        key: 'date',
        header: t('ledger.colDate'),
        cell: (e) => <DateText value={e.date} />,
        // The ISO string sorts correctly as text and needs no Date. See
        // `components/date-text.tsx` for why that matters here specifically.
        sortValue: (e) => e.date,
      },
      {
        key: 'label',
        header: t('ledger.colEntry'),
        cell: (e) => (
          <div className="min-w-0">
            <Link
              href={scopedHref(base, `/ledger/${e.number}`, scope)}
              className="font-medium text-foreground hover:text-primary-strong"
            >
              {/* The bank's own words. Never overwritten, and the first thing on
                  the row — the whole product is about explaining these. */}
              {e.raw_label}
            </Link>
            {e.counterparty && (
              <span className="ml-2 text-[12px] text-muted-foreground">{e.counterparty}</span>
            )}
            <EntryLines lines={e.lines} base={base} scope={scope} />
          </div>
        ),
        sortValue: (e) => e.raw_label,
      },
      {
        key: 'recognition',
        header: t('ledger.colRecognition'),
        cell: (e) => <VocabChip vocabulary="recognition" value={e.recognition} />,
        sortValue: (e) => e.recognition,
      },
      {
        key: 'evidence',
        header: t('ledger.colEvidence'),
        cell: (e) => <VocabChip vocabulary="evidence_tiers" value={e.evidence_tier} withNote />,
        sortValue: (e) => e.evidence_tier,
      },
      {
        key: 'status',
        header: t('ledger.colStatus'),
        cell: (e) => <VocabChip vocabulary="entry_status" value={e.status} />,
        sortValue: (e) => e.status,
      },
      {
        key: 'number',
        header: t('ledger.colNumber'),
        numeric: true,
        cell: (e) => <span className="font-mono text-[12px] text-muted-foreground">{e.number}</span>,
        sortValue: (e) => e.number,
      },
    ],
    // `t` is in the dependency list, so the headers are rebuilt when the reader
    // switches language. Without it the table would keep the headers it was
    // first rendered with — the one place a memoised value can go stale in a
    // way nothing else on the page would show.
    [base, scope, t]
  )

  // ── THE TOTALS STRIP, AND WHY ONLY UNDER AN ACCOUNT FILTER ─────────────
  // A grand-livre row has no single amount — the money is in the lines, and an
  // entry has at least two of them. Summing "the ledger" would mean summing
  // every debit, which equals every credit, which is a true figure that tells a
  // reader nothing they did not already know from the words "double entry".
  //
  // Under `?account=` there IS a question with an answer: this reader arrived
  // from the income statement by clicking one account, and what they want is
  // what that account moved. `accountTotals` walks into the LINES and counts
  // only the ones naming it, because each listed entry also carries its other
  // side — see that function's header.
  const totals = account && rows ? accountTotals(rows, account) : null

  return (
    <>
      {totals && account && (
        <StatRow>
          <Stat caption={t('ledger.totalDebit')} value={<Money value={totals.debit} bare />} />
          <Stat caption={t('ledger.totalCredit')} value={<Money value={totals.credit} bare />} />
          <Stat
            caption={t('ledger.totalNet')}
            value={<Money value={totals.net} bare />}
            emphasis
            basis={t('ledger.totalBasis', { account, lines: totals.lines })}
          />
        </StatRow>
      )}
      <Section
        label={t('ledger.entriesLabel')}
        bodyClassName=""
        tools={rows && rows.length > 0 ? <ResultCount n={rows.length} journal="grand_livre" /> : null}
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(e) => e.number}
          isLoading={isLoading}
          error={error}
          initialSort={{ key: 'date', direction: 'asc' }}
          // Level 4: an écriture nobody has explained yet. `unrecognized` and
          // `inferred` are the two states `resolve` moves AWAY from, and they
          // are exactly what the recognition screen lists — so the rule marks
          // the same rows that screen would, and a reader scanning the ledger
          // sees the shape of the outstanding work without filtering for it.
          attention={(e) =>
            e.recognition === 'unrecognized' || e.recognition === 'inferred' ? 'work' : null
          }
          empty={
            filtered ? (
              <EmptyState title={t('ledger.emptyFiltered')}>
                <p>{t('ledger.emptyFilteredBody')}</p>
              </EmptyState>
            ) : (
              <EmptyState title={t('ledger.empty')}>
                <p>
                  {t('ledger.emptyBody', {
                    book: scope.record?.name ?? t('rec.thisBook'),
                    year: scope.exercice ?? t('rec.thisYear'),
                  })}
                </p>
              </EmptyState>
            )
          }
        />
      </Section>
    </>
  )
}

/**
 * The recettes-dépenses journal — art. 957 al. 2 CO's half of a simplified book.
 *
 * ===========================================================================
 * WHAT IS ON A ROW HERE, AND WHY IT IS NOT THE SAME COLUMNS
 * ===========================================================================
 * A movement carries ONE amount and a DIRECTION. There is no debit and no
 * credit, no chart account, no journal number and no posting status — those are
 * facts about a double entry and this is not one. Rendering the grand livre's
 * columns here produced four blank cells and a false sentence; see the file
 * header.
 *
 * ── THE AMOUNT AND THE DIRECTION ARE TWO COLUMNS, NOT ONE SIGNED NUMBER ───
 * Folding them into a signed amount would be arithmetic on the display path,
 * and it would be WRONG in a way that matters: **`neutral` is a third
 * direction** (migration 0009 — a transfer between the owner's own accounts is
 * logged and counts in neither recettes nor dépenses), and a signed column has
 * nowhere to put it. `<Money>` also renders a negative in the destructive
 * colour, which would paint every ordinary expense red.
 *
 * ── THE DIRECTION IS NOT A CHIP, AND THAT IS A GAP, NOT A CHOICE ──────────
 * Vocabulary colours come from `/api/meta` and never from CSS or a `switch`.
 * **There is no `ri_direction` vocabulary in that payload** — the seven it
 * serves are recognition, evidence_tiers, entry_status, source_types,
 * source_layers, source_status and manifest_states. So the value is rendered as
 * the server's own word, uncoloured, which is the same treatment the worklist
 * gives a pièce's status and for the same reason: borrowing another
 * vocabulary's colour for a different fact is worse than plain text.
 * **Asking for `ri_direction` in `/api/meta` is in the report.**
 *
 * ── AND A ROW IS NOT A LINK ──────────────────────────────────────────────
 * `/ledger/{n}` reads `books.entry`. The two journals keep separate `seq`
 * counters, so this row's #number is also, usually, some écriture's #number, and
 * linking it would open a different record in a different book — which is
 * exactly what this screen was doing before the branch. There is no route
 * serving one recettes-dépenses movement; that is a backend ask.
 */
function RecettesDepenses({
  rows,
  isLoading,
  error,
  scope,
  filtered,
  base,
}: {
  rows: RiEntry[] | undefined
  isLoading: boolean
  error: unknown
  scope: ScopeState
  filtered: boolean
  base: string
}) {
  const t = useT()
  const label = useLabel()
  const columns = useMemo<Column<RiEntry>[]>(
    () => [
      {
        key: 'date',
        header: t('ledger.colDate'),
        cell: (r) => <DateText value={r.date} />,
        sortValue: (r) => r.date,
      },
      {
        key: 'label',
        header: t('ledger.colMovement'),
        cell: (r) => (
          <div className="min-w-0">
            {/* The bank's own words, never overwritten, and NOT a link. */}
            <span className="font-medium text-foreground">{r.raw_label}</span>
            {r.counterparty && (
              <span className="ml-2 text-[12px] text-muted-foreground">{r.counterparty}</span>
            )}
            {r.explanation && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">{label(r.explanation)}</p>
            )}
          </div>
        ),
        sortValue: (r) => r.raw_label,
      },
      {
        key: 'category',
        header: t('ledger.colCategory'),
        // What kind of movement, in place of a chart account. `{fr, en}` from the
        // server; the English side, per D-A. Null is a real value — it renders as
        // nothing rather than as an em dash, because there is no missing account
        // here for an em dash to stand in for.
        cell: (r) =>
          r.category ? (
            <span className="text-[12.5px] text-muted-foreground">{label(r.category)}</span>
          ) : null,
        sortValue: (r) => (r.category ? label(r.category) : ''),
      },
      {
        key: 'direction',
        header: t('ledger.colDirection'),
        // The server's own word. No colour and no translation — see the header.
        cell: (r) => (
          <span
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
            data-direction={r.direction}
          >
            {r.direction}
          </span>
        ),
        sortValue: (r) => r.direction,
      },
      {
        key: 'amount',
        header: t('ledger.colAmount'),
        numeric: true,
        // Unsigned, always. The sign is the Direction column beside it.
        cell: (r) => <Money value={r.amount} bare />,
        // Sorted as TEXT, deliberately — `sortValue` takes a string or a number,
        // and `Number("2800.00")` on the display path is the float this app does
        // not do. A `numeric(14,2)` string sorts wrongly as text across
        // magnitudes, so this column is sorted by the wire value and that is a
        // known limit rather than a hidden one: the honest fix is an `order`
        // parameter on the route, which `components/data-table.tsx` already says
        // is the answer for a list this one cannot sort correctly.
        sortValue: (r) => r.amount,
      },
      {
        key: 'recognition',
        header: t('ledger.colRecognition'),
        cell: (r) => <VocabChip vocabulary="recognition" value={r.recognition} />,
        sortValue: (r) => r.recognition,
      },
      {
        key: 'evidence',
        header: t('ledger.colEvidence'),
        cell: (r) => <VocabChip vocabulary="evidence_tiers" value={r.evidence_tier} withNote />,
        sortValue: (r) => r.evidence_tier,
      },
      {
        key: 'number',
        header: t('ledger.colNumber'),
        numeric: true,
        cell: (r) => <span className="font-mono text-[12px] text-muted-foreground">{r.number}</span>,
        sortValue: (r) => r.number,
      },
    ],
    [t, label]
  )

  // Totals of the SHOWN set, in centimes. Unlike the grand livre these are
  // always available: a movement carries one amount, so a column of them has a
  // meaningful sum. `neutral` is its own figure and is in neither of the other
  // two — migration 0009, and the defect it fixed misstated somebody's income.
  const totals = rows ? riTotals(rows) : null

  return (
    <>
      {totals && rows && rows.length > 0 && (
        <StatRow>
          <Stat caption={t('overview.recettes')} value={<Money value={totals.recettes} bare />} />
          <Stat caption={t('overview.depenses')} value={<Money value={totals.depenses} bare />} />
          <Stat
            caption={t('overview.resultat')}
            value={<Money value={totals.resultat} bare />}
            emphasis
            basis={t('ledger.totalRiBasis', { n: rows.length })}
          />
          {/* Rendered only when there IS one. A permanent `0.00` neutral tile on
              every simplified book would be a fourth figure most readers never
              have, competing with the three they always do. */}
          {totals.neutral !== '0.00' && (
            <Stat
              caption={t('ledger.totalNeutral')}
              value={<Money value={totals.neutral} bare />}
              basis={t('ledger.totalNeutralBasis')}
            />
          )}
        </StatRow>
      )}

      {/* A direction this bundle does not know is COUNTED and SHOWN, never
          folded into a total. Silently counting one as a dépense is exactly what
          misstated Andrea's income before migration 0009 existed. */}
      {totals && totals.unknown > 0 && (
        <Surface tone="problem" role="status" className="mb-4">
          <p className="max-w-[95ch] text-[12px] leading-relaxed text-muted-foreground">
            {t('ledger.unknownDirection', { n: totals.unknown })}
          </p>
        </Surface>
      )}

      <Section
        label={t('ledger.movementsLabel')}
        bodyClassName=""
        tools={
          rows && rows.length > 0 ? <ResultCount n={rows.length} journal="recettes_depenses" /> : null
        }
        note={
          rows && rows.length > 0 ? (
            <>
              {t('ledger.riFootnote', { neutral: 'neutral' })}{' '}
              {t('ledger.riNoteBefore')}{' '}
              <Link
                href={scopedHref(base, '/patrimoine', scope)}
                className="not-italic text-primary-strong hover:underline"
              >
                {t('ledger.riNoteLink')}
              </Link>
              {t('ledger.riNoteAfter')}
            </>
          ) : null
        }
      >
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.number}
          isLoading={isLoading}
          error={error}
          initialSort={{ key: 'date', direction: 'asc' }}
          attention={(r) =>
            r.recognition === 'unrecognized' || r.recognition === 'inferred' ? 'work' : null
          }
          empty={
            filtered ? (
              <EmptyState title={t('ledger.riEmptyFiltered')}>
                <p>{t('ledger.riEmptyFilteredBody')}</p>
              </EmptyState>
            ) : (
              <EmptyState title={t('ledger.riEmpty')}>
                <p>
                  {t('ledger.riEmptyBody', {
                    book: scope.record?.name ?? t('rec.thisBook'),
                    year: scope.exercice ?? t('rec.thisYear'),
                  })}
                </p>
              </EmptyState>
            )
          }
        />
      </Section>
    </>
  )
}

/**
 * The book, and therefore the journal, is not known.
 *
 * Three different situations, and the screen says which: the books are still in
 * flight, `?entity=` names nothing, or the regime is a value this bundle does
 * not know. None of them is "no entries", and none of them may be resolved into
 * a default journal — a default is a document somebody else chose.
 */
function UnknownJournal({ scope }: { scope: ScopeState }) {
  const t = useT()
  if (scope.isLoading || (scope.entity !== null && scope.record === null && scope.entities.length === 0)) {
    return <Loading rows={6} label={t('ledger.loadingJournal')} />
  }

  if (scope.record === null) {
    return (
      <EmptyState title={t('ledger.noSuchBook')}>
        <p>{t('ledger.noSuchBookBody', { slug: scope.entity ?? '—' })}</p>
      </EmptyState>
    )
  }

  // The book resolved and its regime is a value this bundle does not know. The
  // list is not requested, because which shape the route would answer with is
  // exactly what is unknown.
  return (
    <EmptyState title={t('ledger.unknownJournal')}>
      <p>
        {t('ledger.unknownJournalBody', {
          book: scope.record.name,
          regime: scope.record.bookkeeping_regime,
        })}
      </p>
      <p className="mt-2">
        {t('ledger.unknownJournalBody2', { command: 'bk books entry list' })}
      </p>
    </EmptyState>
  )
}

function FilterPill({
  label,
  onClear,
}: {
  /** Already translated by the caller — it interpolates the filter's VALUE. */
  label: string
  onClear: () => void
}) {
  const t = useT()
  const removeLabel = t('ledger.removeFilter', { label })
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-[1px] text-[11px] text-foreground">
      <span className="font-mono">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={removeLabel}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={11} />
      </button>
    </span>
  )
}
