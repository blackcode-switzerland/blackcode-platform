'use client'

// The rules — the app's memory of a human's judgment, made inspectable.
//
// ===========================================================================
// THE LEARNING LOOP BEING VISIBLE IS THE DESIGN, NOT DECORATION
// ===========================================================================
// A rule exists because somebody once said what a payment was. `created_from`
// is the #number of the entry that taught it, and it is a LINK: "why does this
// match?" has to be answerable forever, and the answer is a record you can open.
// A rule with no teaching entry was knowledge that arrived before the money — a
// lease, a subscription — and says so instead of showing a blank cell.
//
// ===========================================================================
// THE MATCH KEY IS THE PAIR, AND THE TABLE SHOWS IT AS A PAIR
// ===========================================================================
// `(source, counterparty)`, never the merchant alone: GitHub on the blackcode
// card and GitHub on the AIOS line are different facts, and a familiar merchant
// on an untracked source must stay queued rather than be silently matched.
//
// **The source is a serial id and this app cannot resolve it** — the source
// register is phase 3 and its routes are not on this base. So the column shows
// `source 3`, monospaced, as the fact it is, and a null shows as "no source",
// which is what the RI's rules legitimately are. It does not show a name it does
// not have, and it does not show an em dash for a value that is present.
//
// ===========================================================================
// `pattern.amount_chf` IS A NUMBER AND IS NOT MONEY
// ===========================================================================
// `books.rule.pattern` is `jsonb`, so these arrive as JSON floats rather than as
// `numeric` strings. They are a MATCH WINDOW, not an amount in anybody's books,
// and `ruleAmount()` in `lib/format.ts` is the one place that is written down.
// Nothing here renders one through `<Money>`, whose prop type is the guard that
// keeps floats off the display path.

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { scopedHref } from '@/lib/nav'
import type { Journal } from '@/lib/journal'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import { ruleAmount } from '@/lib/format'
import { useCanWrite, useCreateRule } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import { filterRows, ruleFields } from '@/lib/search'
import { DataTable, type Column } from './data-table'
import { Section } from './section'
import { DateText } from './date-text'
import { EmptyState } from './states'
import { TableSearch, useTableSearch } from './table-search'
import type { ReadScope } from '@/lib/hooks'
import type { RecognitionRule } from '@/lib/types'

const FIELD =
  'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground ' +
  'placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

export function RulesPanel({
  ws,
  scope,
  journal,
  base,
  rules,
  isLoading,
  error,
}: {
  ws: string | undefined
  scope: ReadScope
  /** Which journal this book keeps. Decides whether `created_from` is addressable. */
  journal: Journal | null
  base: string
  rules: RecognitionRule[] | undefined
  isLoading: boolean
  error: unknown
}) {
  const t = useT()
  const label = useLabel()
  // `?rule=` and not `?q=`: this page also carries the worklist, and a bare `q`
  // is the parameter a second search would want. Naming it after its table
  // means the day one is added the two do not collide silently.
  const [query, setQuery] = useTableSearch('rule')
  const shown = useMemo(() => filterRows(rules, query, (r) => ruleFields(r, label)), [rules, query, label])
  const columns: Column<RecognitionRule>[] = [
    {
      key: 'key',
      header: t('rules.colKey'),
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-foreground">
            (
            {/* `source`, not `source_id`: renamed on the wire by #66, which
                changed it from the serial to the workspace #number the source
                register prints. Our translation keys were written against the
                old name and the merge caught it. */}
            {r.source === null ? t('rules.noSource') : t('rules.source', { id: r.source })},{' '}
            {r.pattern.counterparty})
          </span>
          <div className="text-[11.5px] text-muted-foreground">
            {ruleAmount(r.pattern.amount_chf, r.pattern.tolerance_chf)}
            {/* Cadence is documentation: `matchesRule` never reads it. Saying so
                here stops a reader believing a rule fires on a schedule. */}
            {r.pattern.interval && (
              <span> · {t('rules.notMatchedOn', { interval: r.pattern.interval })}</span>
            )}
          </div>
        </div>
      ),
      sortValue: (r) => r.pattern.counterparty,
    },
    {
      key: 'explanation',
      header: t('rules.colExplanation'),
      cell: (r) => (
        <div className="min-w-0">
          {/* A rule may genuinely have none — `POST /rules` does not require one
              — so this is the absence, drawn as an absence. */}
          <span className="text-[12.5px] text-foreground">
            {label(r.explanation) || (
              <span className="text-muted-foreground">{t('rules.noExplanation')}</span>
            )}
          </span>
          {label(r.note) && (
            <div className="text-[11.5px] text-muted-foreground">{label(r.note)}</div>
          )}
        </div>
      ),
      // Sorted on the reader's own side of the pair, so the order matches what
      // is on screen rather than what an English reader would have seen.
      sortValue: (r) => label(r.explanation),
    },
    {
      key: 'account',
      header: t('rules.colAccount'),
      cell: (r) =>
        r.account ? (
          <span className="font-mono text-[12px]">{r.account}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">{t('statements.unmapped')}</span>
        ),
      sortValue: (r) => r.account,
    },
    {
      key: 'learned_from',
      header: t('rules.colOrigin'),
      cell: (r) =>
        // `learned_from` is `varchar(40)` and nullable, and the route validates
        // nothing — so it is rendered as whatever it is, never mapped through a
        // switch that would go stale, and a null says so.
        r.learned_from ? (
          <span className="text-[12px]">{r.learned_from}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">{t('rules.notRecorded')}</span>
        ),
      sortValue: (r) => r.learned_from,
    },
    {
      key: 'created_from',
      header: t('rules.colTaughtBy'),
      // ── NOT A LINK, AND NOT EVEN A NUMBER, ON A SIMPLIFIED BOOK ───────────
      // `created_from_entry_id` is ONE column holding ids from TWO tables:
      // `resolve.ts` writes a `books.entry` id at :130 and a `books.ri_entry` id
      // at :236. `teachingSeqs()` resolves every one of them against
      // `books.entry` alone, so a rule taught from an RI movement comes back
      // carrying some other book's écriture number — all six seeded RI rows
      // collide with real entry ids.
      //
      // Reproduced in three clicks: resolve RI #5 with "Teach a rule", and the
      // rules panel offers "Taught by #4", which opens blackcode SA's Swisscom
      // invoice. **This phase opened that door**: until `resolveTargetFor` was
      // widened to close #51, no RI-taught rule could be created from the
      // browser at all.
      //
      // The number is wrong, so it is not shown — a plausible wrong écriture
      // number on an audit trail is worse than an absent one, and linking it
      // sends the reader into another company's books. The rule itself is real
      // and its provenance IS recorded; only the address is unresolvable until
      // the payload says which table it came from. Backend ask, ticket #55.
      cell: (r) =>
        r.created_from === null ? (
          <span className="text-[12px] text-muted-foreground">{t('rules.knownFirst')}</span>
        ) : journal === 'recettes_depenses' ? (
          <span
            className="text-[12px] text-muted-foreground"
            title={t('rules.notAddressableTitle')}
          >
            {t('rules.notAddressable')}
          </span>
        ) : (
          <Link
            href={scopedHref(base, `/ledger/${r.created_from}`, scope)}
            className="font-mono text-[12px] text-primary-strong hover:underline"
          >
            #{r.created_from}
          </Link>
        ),
      sortValue: (r) => r.created_from,
    },
    {
      key: 'created_on',
      header: t('rules.colSince'),
      cell: (r) =>
        // `created_on` is a Postgres `date` and nullable. `<DateText>` slices the
        // string and never constructs a `Date` — a rule's birthday printed in the
        // reader's timezone would land on the wrong day west of Greenwich.
        r.created_on ? (
          <DateText value={r.created_on} className="text-[12px] text-muted-foreground" />
        ) : (
          <span className="text-[12px] text-muted-foreground">{t('rules.notRecorded')}</span>
        ),
      sortValue: (r) => r.created_on,
    },
    {
      key: 'active',
      header: t('rules.colActive'),
      cell: (r) => (
        <span className="text-[12px]">{r.active ? t('rules.yes') : t('rules.no')}</span>
      ),
      sortValue: (r) => String(r.active),
    },
  ]

  return (
    <Section
      span={12}
      label={
        <>
          {t('rules.title')}
          {rules && <span className="ml-2 font-normal">{rules.length}</span>}
        </>
      }
      /* The box is offered only once there is a table to search. Over an empty
         list, a loading skeleton or an error it would be a control that cannot
         do anything — and typing into it would replace the reason the table is
         empty with "no rule matches that search", which is a different and
         wrong explanation. */
      tools={
        rules && rules.length > 0 ? (
          <TableSearch
            param="rule"
            label={t('rules.searchLabel')}
            placeholder={t('rules.searchPlaceholder')}
            value={query}
            onChange={setQuery}
            matches={{ shown: shown?.length ?? 0, total: rules.length }}
          />
        ) : null
      }
      bodyClassName=""
    >
      <p className="max-w-[95ch] px-4 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {t('rules.lead')}
      </p>

      <div className="mt-3">
        <DataTable
          rows={shown}
          columns={columns}
          rowKey={(r) => r.number}
          isLoading={isLoading}
          error={error}
          initialSort={{ key: 'key', direction: 'asc' }}
          empty={
            // Which emptiness it is. "No rules yet" over a table the READER
            // just filtered to nothing would blame the book for the search.
            query.trim() !== '' ? (
              <EmptyState title={t('rules.searchEmpty')}>
                <p>{t('rules.searchEmptyBody')}</p>
              </EmptyState>
            ) : (
              <EmptyState title={t('rules.emptyTitle')}>
                <p>{t('rules.emptyBody')}</p>
              </EmptyState>
            )
          }
        />
      </div>

      <div className="px-4 pb-3">
        <CreateRuleForm ws={ws} scope={scope} />
      </div>
    </Section>
  )
}

/**
 * A rule that predates its first matching entry.
 *
 * ── WHY THIS FORM EXISTS WHEN THE MOCKUP HAS NO SUCH THING ────────────────
 * `POST /rules` and `bk books rule create` both exist, and the platform rule is
 * that anything an agent can do a human can do and the other way round. A
 * capability that lives only in the CLI is a decision, and this is not one: a
 * signed lease or a subscription is knowledge before the first franc moves, and
 * the person who signed it is the person who knows.
 *
 * ── THE SOURCE IS NOT ON THIS FORM, AND THAT IS A REAL LIMIT ──────────────
 * The match key is the PAIR, and the source half is a serial id from a register
 * this app cannot read until phase 3. A number field asking a human to type a
 * database id would be worse than not offering it: a wrong id silently keys the
 * rule to somebody else's account. So a rule created here has `source_id: null`
 * and matches SOURCELESS entries only — which the copy says, because a rule that
 * quietly matches nothing is the most reassuring wrong answer this form can
 * give. The report asks for the source register.
 */
function CreateRuleForm({ ws, scope }: { ws: string | undefined; scope: ReadScope }) {
  const t = useT()
  const canWrite = useCanWrite()
  const queryClient = useQueryClient()
  const create = useCreateRule(ws, scope.entity)
  const [open, setOpen] = useState(false)
  const [counterparty, setCounterparty] = useState('')
  const [explanation, setExplanation] = useState('')
  const [account, setAccount] = useState('')
  const [interval, setInterval] = useState('')
  const [learnedFrom, setLearnedFrom] = useState('contract')
  const [refusal, setRefusal] = useState<{ message: string; code: string } | null>(null)
  const [created, setCreated] = useState<number | null>(null)

  if (!canWrite) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setRefusal(null)
    setCreated(null)
    const result = await create.run({
      counterparty,
      explanation: explanation.trim() ? { en: explanation.trim() } : undefined,
      account: account.trim() || undefined,
      interval: interval.trim() || undefined,
      learned_from: learnedFrom,
    })
    if (!result.ok) {
      // The server's sentence, read off the RESULT. `create.error` is state and
      // is null in this tick — see lib/mutations.ts.
      setRefusal({ message: result.message, code: result.error.code })
      return
    }
    await queryClient.invalidateQueries(booksCacheFilter())
    setCreated(result.data.number)
    setCounterparty('')
    setExplanation('')
    setAccount('')
    setInterval('')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
      >
        {t('rules.addRule')}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-border bg-secondary/40 p-3">
      <p className="text-[12.5px] text-muted-foreground">
        {t('rules.formLead')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="rule-cp">
            {t('rules.fragment')}
          </label>
          <input
            id="rule-cp"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            className={FIELD + ' mt-1 font-mono'}
            placeholder="IMMOREGIE"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="rule-acct">
            {t('rules.accountLabel')}{' '}
            <span className="font-normal normal-case tracking-normal">
              {t('resolve.optional')}
            </span>
          </label>
          <input
            id="rule-acct"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className={FIELD + ' mt-1 font-mono'}
            placeholder="6000"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="rule-expl">
            {t('rules.explanationLabel')}
          </label>
          <input
            id="rule-expl"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder={t('rules.explanationPlaceholder')}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="rule-interval">
            {t('resolve.cadence')}{' '}
            <span className="font-normal normal-case tracking-normal">
              {t('rules.cadenceDocOnly')}
            </span>
          </label>
          <input
            id="rule-interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder={t('rules.cadencePlaceholder')}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="rule-learned">
            {t('resolve.learnedFrom')}
          </label>
          <select
            id="rule-learned"
            value={learnedFrom}
            onChange={(e) => setLearnedFrom(e.target.value)}
            className={FIELD + ' mt-1'}
          >
            <option value="contract">contract</option>
            <option value="subscription">subscription</option>
            <option value="manual">manual</option>
          </select>
        </div>
      </div>

      <p className="text-[11.5px] text-muted-foreground">
        {t('rules.sourceless')}
      </p>

      {refusal && (
        <div
          role="alert"
          data-refusal={refusal.code}
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <p className="text-[12.5px] text-foreground">{refusal.message}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{refusal.code}</p>
        </div>
      )}
      {created !== null && (
        <p className="text-[12.5px] text-foreground">{t('rules.created', { n: created })}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={create.pending}
          className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {create.pending ? t('rules.creating') : t('rules.create')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          {t('rules.cancel')}
        </button>
      </div>
    </form>
  )
}
