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

import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { scopedHref } from '@/lib/nav'
import type { Journal } from '@/lib/journal'
import { en } from '@/lib/label'
import { ruleAmount } from '@/lib/format'
import { useCanWrite, useCreateRule } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import { DataTable, type Column } from './data-table'
import { DateText } from './date-text'
import { EmptyState } from './states'
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
  const columns: Column<RecognitionRule>[] = [
    {
      key: 'key',
      header: 'Key: (source, merchant)',
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-mono text-[12px] text-foreground">
            ({r.source_id === null ? 'no source' : `source ${r.source_id}`}, {r.pattern.counterparty})
          </span>
          <div className="text-[11.5px] text-muted-foreground">
            {ruleAmount(r.pattern.amount_chf, r.pattern.tolerance_chf)}
            {/* Cadence is documentation: `matchesRule` never reads it. Saying so
                here stops a reader believing a rule fires on a schedule. */}
            {r.pattern.interval && <span> · {r.pattern.interval} (not matched on)</span>}
          </div>
        </div>
      ),
      sortValue: (r) => r.pattern.counterparty,
    },
    {
      key: 'explanation',
      header: 'Explanation',
      cell: (r) => (
        <div className="min-w-0">
          {/* A rule may genuinely have none — `POST /rules` does not require one
              — so this is the absence, drawn as an absence. */}
          <span className="text-[12.5px] text-foreground">
            {en(r.explanation) || <span className="text-muted-foreground">no explanation</span>}
          </span>
          {en(r.note) && (
            <div className="text-[11.5px] text-muted-foreground">{en(r.note)}</div>
          )}
        </div>
      ),
      sortValue: (r) => en(r.explanation),
    },
    {
      key: 'account',
      header: 'Posts to',
      cell: (r) =>
        r.account ? (
          <span className="font-mono text-[12px]">{r.account}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">unmapped</span>
        ),
      sortValue: (r) => r.account,
    },
    {
      key: 'learned_from',
      header: 'Origin',
      cell: (r) =>
        // `learned_from` is `varchar(40)` and nullable, and the route validates
        // nothing — so it is rendered as whatever it is, never mapped through a
        // switch that would go stale, and a null says so.
        r.learned_from ? (
          <span className="text-[12px]">{r.learned_from}</span>
        ) : (
          <span className="text-[12px] text-muted-foreground">not recorded</span>
        ),
      sortValue: (r) => r.learned_from,
    },
    {
      key: 'created_from',
      header: 'Taught by',
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
          <span className="text-[12px] text-muted-foreground">no entry — known first</span>
        ) : journal === 'recettes_depenses' ? (
          <span
            className="text-[12px] text-muted-foreground"
            title="Taught by an entry in this book. The number the API returns for a simplified book resolves against the double-entry journal, so it is not shown rather than shown wrong."
          >
            taught here — not addressable yet
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
      header: 'Since',
      cell: (r) =>
        // `created_on` is a Postgres `date` and nullable. `<DateText>` slices the
        // string and never constructs a `Date` — a rule's birthday printed in the
        // reader's timezone would land on the wrong day west of Greenwich.
        r.created_on ? (
          <DateText value={r.created_on} className="text-[12px] text-muted-foreground" />
        ) : (
          <span className="text-[12px] text-muted-foreground">not recorded</span>
        ),
      sortValue: (r) => r.created_on,
    },
    {
      key: 'active',
      header: 'Active',
      cell: (r) => (
        <span className="text-[12px]">{r.active ? 'yes' : 'no'}</span>
      ),
      sortValue: (r) => String(r.active),
    },
  ]

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">
          Recognition rules
          {rules && <span className="ml-2 text-[13px] font-normal text-muted-foreground">{rules.length}</span>}
        </h2>
      </div>
      <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
        Inspectable data, not logic written into the app. The match key is the pair (source
        account, merchant) — never the merchant alone, so a familiar name on a source nobody
        tracks comes back to the list above rather than explaining itself.
      </p>

      <div className="mt-3">
        <DataTable
          rows={rules}
          columns={columns}
          rowKey={(r) => r.number}
          isLoading={isLoading}
          error={error}
          initialSort={{ key: 'key', direction: 'asc' }}
          empty={
            <EmptyState title="This book has taught the app nothing yet.">
              <p>
                A rule is created either by resolving an entry above, or here — when the knowledge
                arrives before the money does.
              </p>
            </EmptyState>
          }
        />
      </div>

      <CreateRuleForm ws={ws} scope={scope} />
    </section>
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
        Add a rule the app has not been taught
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-border bg-secondary/40 p-3">
      <p className="text-[12.5px] text-muted-foreground">
        For knowledge that arrives before the money — a signed lease, a subscription. A rule taught
        by resolving an entry is created up there instead, and records which entry taught it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="rule-cp">
            Fragment matched against the raw label
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
            Account a match posts to <span className="font-normal normal-case tracking-normal">(optional)</span>
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
            Explanation a match will carry
          </label>
          <input
            id="rule-expl"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder="Prilly office rent — commercial lease"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="rule-interval">
            Cadence <span className="font-normal normal-case tracking-normal">(documentation only)</span>
          </label>
          <input
            id="rule-interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder="monthly"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="rule-learned">
            Learned from
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
        A rule added here has no source, so it matches only entries that arrived without one. The
        source register is not built yet — until it is, teach a rule by resolving an entry above and
        the server keys it to that entry’s own source.
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
        <p className="text-[12.5px] text-foreground">Rule #{created} created.</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={create.pending}
          className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {create.pending ? 'Creating…' : 'Create rule'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
