'use client'

// `<ResolveForm>` — the first button in b/books that changes a company's books.
//
// ===========================================================================
// IT TAKES A TARGET, NOT A ROW — AND THE TARGET NAMES THE JOURNAL
// ===========================================================================
// `GET …/worklist` serves three kinds of row and **their #number series
// overlap**: `books.entry`, `books.ri_entry` and `books.piece_inbox` keep
// separate `seq` counters, so `{kind:'entry', number:5}` and
// `{kind:'ri_entry', number:5}` are two different rows that both exist.
//
// Until 2026-08-19 `POST /entries/{n}/resolve` addressed `books.entry` and
// nothing else, so asking it to resolve an RI row by the number printed on that
// row rewrote an unrelated journal entry and answered **200**. Reproduced
// against the seeded workspace on 2026-08-18: RI #5 (TWINT *8842) resolved and
// what changed was `books.entry` #5 — the January payroll, in a different book.
// Ticket #51. This component's prop was `WorklistRow & { kind: 'entry' }` for
// exactly that reason.
//
// **Phase 4A's backend fixed it, WITH A CONDITION**, and the condition is what
// this component now carries: the route reads `body.entity`, and when that names
// a simplified book it resolves against that book's recettes-dépenses journal
// instead of the grand livre. Verified both ways before this form was widened —
// with the book named, the RI row changed and the grand-livre entry did not;
// **without it, the January payroll was rewritten exactly as before**. The two
// commands and their outcomes are in `lib/resolvable.ts`'s header.
//
// So the prop is a `ResolveTarget` — a discriminated union of
// `{journal:'grand_livre', row}` and `{journal:'recettes_depenses', row}` — and
// the RI arm is the ONLY thing that puts `entity` in the body. Handing this a
// pièce, or an RI row under an unknown journal, is a COMPILE ERROR rather than a
// runtime check somebody can forget to write, and `resolveTargetFor` is what
// produces the value. There is no disabled button to re-enable in devtools and
// no handler to call, because for a row with no target neither is rendered.
//
// ── AND THE RI ARM HAS NO ACCOUNT CONTROL, BECAUSE THERE ARE NO LINES ─────
// `resolveRiEntry` refuses `account` outright (`ri_no_lines`: *"a simplified
// book keeps recettes and dépenses, not a chart mapping"*). The control is not
// rendered and the field is not sent — two guards, for the same reason the
// posted case has two.
//
// ===========================================================================
// THE FAILURE IS READ OFF THE RESULT, NEVER OFF HOOK STATE
// ===========================================================================
// `resolve.error` is React state and is null in the tick its setter ran, so a
// handler reading it shows a generic fallback while the server's own sentence is
// discarded. That bug shipped once already, on the sign-up form. Every refusal
// this route raises is one a person can act on:
//
//   posted_lines_frozen  "a correction is a reversing entry; resolve may still
//                         set explanation, counterparty and recognition"
//
// Rendering "Could not save" over that tells an accountant the app is broken
// when what happened is the law working. See `lib/mutations.ts`.
//
// ===========================================================================
// TEACHING A RULE IS A DELIBERATE CHOICE, NEVER A DEFAULT
// ===========================================================================
// A rule changes what happens to FUTURE payments, on a key the person cannot see
// from here (the pair (source, counterparty) — the source comes from the entry).
// So the checkbox starts unticked, the fields only appear once it is ticked, and
// the button says which of the two things it is about to do.
//
// The counterparty fragment is PREFILLED from the raw label and is not validated
// here. If somebody clears it the server refuses with `bad_rule` and its own
// suggestion, which is the correct authority and the correct sentence — a second
// copy of that rule in this file would be a second thing to keep in sync.

'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ResolvableRow, ResolveTarget } from '@/lib/resolvable'
import { useAccounts } from '@/lib/hooks'
import { useCanWrite, useResolveEntry, type ResolveBody } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import type { ReadScope } from '@/lib/hooks'
import type { ResolveResult, WorklistRow } from '@/lib/types'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'

/**
 * Re-exported from `lib/resolvable.ts`, which owns both the types and the
 * FUNCTION that produces them. The function is the half that can be tested —
 * `lib/resolvable.test.ts` calls it over the whole (kind × journal) cross
 * product — and splitting them would put the type and the rule that enforces it
 * in two places. See that file's header for the bug this arrangement exists
 * after, and for the widening it survived.
 */
export type { ResolvableRow, ResolveTarget }

const FIELD =
  'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground ' +
  'placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'

/**
 * The first word of the bank's label, as a starting guess at the merchant.
 *
 * The mockup does the same thing. It is a GUESS shown in an editable field, not
 * a decision: the field is the one the rule keys on, so it has to be visible and
 * changeable before anybody presses the button.
 */
function counterpartyGuess(row: ResolveTarget['row']): string {
  return row.counterparty ?? row.raw_label.split(/\s+/)[0] ?? ''
}

export function ResolveForm({
  ws,
  scope,
  target,
  initialExplanation = '',
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  /**
   * The row AND the journal its #number is read in. See the header — the
   * journal is not decoration, it is what decides whether `entity` goes in the
   * body, and `entity` is the whole of #51's fix.
   */
  target: ResolveTarget
  /**
   * Text to start the box with, when a suggestion was taken.
   *
   * **It is a starting point, not an application.** The caller only ever passes
   * a rule's own explanation, after the reader pressed "use this explanation",
   * and nothing has been written at that point — the person still edits it and
   * still presses Resolve. `suggested_rules` is an opinion; this is where the
   * opinion stops.
   */
  initialExplanation?: string
  /** Called with what the server actually returned, so the row can show it. */
  onResolved: (result: ResolveResult) => void
}) {
  const canWrite = useCanWrite()
  const t = useT()
  const label = useLabel()
  const queryClient = useQueryClient()
  const row = target.row
  // The recettes-dépenses journal, positively. Never `!== 'grand_livre'`.
  const ri = target.journal === 'recettes_depenses'
  const resolve = useResolveEntry(ws, row.number)
  // Not fetched for an RI book: it has no lines to map, the account control is
  // not rendered, and a chart of accounts nothing reads is a request nobody
  // needed. (The route serves one for a simplified book — 26 rows, seeded — so
  // this is a decision rather than an absence.)
  const accounts = useAccounts(ws, ri ? { entity: null, exercice: null } : scope)

  const [explanation, setExplanation] = useState(initialExplanation)
  const [recognition, setRecognition] = useState<'known_one_off' | 'known_recurring'>('known_one_off')
  const [counterparty, setCounterparty] = useState('')
  const [account, setAccount] = useState('')
  const [evidenceNote, setEvidenceNote] = useState('')
  const [teachRule, setTeachRule] = useState(false)
  const [ruleCounterparty, setRuleCounterparty] = useState(() => counterpartyGuess(row))
  const [ruleAmountChf, setRuleAmountChf] = useState('')
  const [ruleToleranceChf, setRuleToleranceChf] = useState('')
  const [ruleInterval, setRuleInterval] = useState('')
  const [ruleLearnedFrom, setRuleLearnedFrom] = useState('manual')

  /** The refusal, taken from the RESULT. Not from `resolve.error`. */
  const [refusal, setRefusal] = useState<{ message: string; code: string } | null>(null)

  /**
   * In-flight, synchronously.
   *
   * ── WHY A REF AND NOT `resolve.pending` ────────────────────────────────────
   * The submit button carries `disabled={resolve.pending || …}`, and that was
   * the whole guard. `pending` is React STATE: `run` sets it, but the button's
   * `disabled` attribute does not exist until the next render, so every click
   * landing in the same tick passes straight through. An ordinary two-click
   * double-click on the seeded data sent two POSTs 20ms apart and taught TWO
   * rules — #8 and #9, both from entry #13 — while the row reported one.
   *
   * A rule changes how future payments are classified, so that is a lasting
   * consequence written invisibly from a reflex action, in a product whose claim
   * is that its records are defensible. F-1 of the phase-2 review.
   *
   * A ref updates in the same tick as the click. `disabled` stays as the visible
   * affordance; this is the one that actually holds.
   */
  const inFlight = useRef(false)

  // The freeze line, stated rather than discovered as a 400. Interpretation
  // stays open on a posted entry — explanation, counterparty and recognition all
  // still apply — and only the ACCOUNT is frozen, because posted lines are
  // accounting facts.
  // `status` is null for EVERY ri_entry — a simplified book has no staging step
  // — so this is false there, and the account control it gates is not rendered
  // for an RI row anyway. Left as a positive comparison rather than widened.
  const posted = row.status === 'posted'

  if (!canWrite) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">{t('rec.cannotWrite')}</p>
    )
  }

  /**
   * A rule pattern amount, as a number, or null.
   *
   * `books.rule.pattern` is `jsonb` and the route only accepts a JSON `number`
   * for these two (`typeof body[k] === 'number'`, else it stores null silently).
   * So the field is parsed here — this is not money in anybody's books, it is a
   * match threshold, and `lib/types.ts`'s `RulePattern` says so at length.
   * A blank field is null, which means "any amount", not zero.
   */
  function patternNumber(raw: string): number | null {
    const t = raw.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }


  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setRefusal(null)

    const body: ResolveBody = {
      // ── STILL FILED UNDER `en`, WHATEVER LANGUAGE THE READER IS IN ────────
      // The route refuses a non-object, and `bk books resolve` sends
      // `{"en": text}`. This is a `{fr, en}` pair on the wire and a French
      // reader typing French prose puts it in the `en` half — which is wrong,
      // and is deliberately NOT fixed here.
      //
      // Guessing is worse than the known wrongness: writing the reader's UI
      // language into `fr` would file an explanation under a language the person
      // may not have been writing in (nothing stops an English reader typing
      // French), and it would make the SAME record read differently to two
      // people. Which side an explanation belongs on is a question about the
      // record, not about the chrome, and it is the backend's — raised as a
      // tracker finding in phase 7's report. Until it is answered, one
      // consistent side beats a guess per session.
      explanation: { en: explanation.trim() },
      recognition,
    }
    // ── THE FIELD THAT MAKES #51 STAY FIXED ────────────────────────────
    // Without it the server reads this #number in the GRAND LIVRE, and an RI
    // row's number is also, usually, some écriture's. Verified on 2026-08-19:
    // the same command without it rewrote blackcode SA's January payroll and
    // exited 0. `scope.entity` is the book the worklist is scoped to, which is
    // the book this row came from.
    if (ri) body.entity = scope.entity ?? undefined
    if (counterparty.trim()) body.counterparty = counterparty.trim()
    // Never sent on a posted entry, and never on an RI row — `resolveRiEntry`
    // refuses it (`ri_no_lines`). The controls are not rendered in either case
    // either; these are the second of the two guards, because one of them will
    // be edited someday.
    if (!posted && !ri && account) body.account = account
    if (evidenceNote.trim()) body.evidence_note = { en: evidenceNote.trim() }
    if (teachRule) {
      body.rule = {
        counterparty: ruleCounterparty,
        amount_chf: patternNumber(ruleAmountChf),
        tolerance_chf: patternNumber(ruleToleranceChf),
        interval: ruleInterval.trim() || null,
        learned_from: ruleLearnedFrom,
      }
    }

    // `finally`, so a refusal or a thrown error releases the guard too. A guard
    // that only clears on success turns one failed submit into a form nobody can
    // use again without a reload.
    try {
      const result = await resolve.run(body)
      if (!result.ok) {
        // THE SERVER'S OWN SENTENCE. `message` already carries the route's
        // `suggestion` joined onto its reason — see `sentence()` in lib/mutations.
        setRefusal({ message: result.message, code: result.error.code })
        return
      }

      // Everything scoped to this app's cache root. The worklist shrinks, the
      // overview's count follows it, the rules list gains a taught rule, and the
      // ledger and the entry both carry the new explanation and the new history.
      // Invalidating the root rather than four keys is deliberate: a resolution
      // can change a derived statement (a staged line that had no account now has
      // one), and enumerating what it touched is a list that goes stale.
      await queryClient.invalidateQueries(booksCacheFilter())
      onResolved(result.data)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-md border border-border bg-secondary/40 p-3">
      {/* ── WHICH JOURNAL THIS #NUMBER IS READ IN, SAID BEFORE THE BUTTON ──
          The two journals number themselves separately, so "#5" names two rows.
          The request carries the book, the server resolves the number inside it,
          and if the pair were ever wrong the answer is a refusal rather than a
          wrong write. The reader cannot see that from the number alone, so it is
          said — the same treatment `<MatchPieceForm>` gives the same fact. */}
      {ri && (
        <p
          className="text-[11.5px] text-muted-foreground"
          data-journal="recettes_depenses"
        >
          {t('resolve.riJournalNote', { book: scope.entity ?? t('rec.thisBook') })}
        </p>
      )}
      <div>
        <label className={LABEL} htmlFor={`expl-${row.number}`}>
          {t('resolve.whatWasThis')}
        </label>
        <textarea
          id={`expl-${row.number}`}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
          className={FIELD + ' mt-1'}
          placeholder={t('resolve.explanationPlaceholder')}
        />
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {t('resolve.explanationNote')}
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>{t('resolve.conclusion')}</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {(
            [
              ['known_one_off', 'resolve.oneOff'],
              ['known_recurring', 'resolve.recurring'],
            ] as const
          ).map(([value, labelKey]) => (
            <label key={value} className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground">
              <input
                type="radio"
                name={`recognition-${row.number}`}
                value={value}
                checked={recognition === value}
                onChange={() => setRecognition(value)}
                className="accent-[var(--primary)]"
              />
              {t(labelKey)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`cp-${row.number}`}>
            {t('resolve.counterparty')}{' '}
            <span className="font-normal normal-case tracking-normal">
              {t('resolve.optional')}
            </span>
          </label>
          <input
            id={`cp-${row.number}`}
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder={row.counterparty ?? t('resolve.counterpartyPlaceholder')}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor={`acct-${row.number}`}>
            {t('resolve.account')}{' '}
            <span className="font-normal normal-case tracking-normal">
              {t('resolve.optional')}
            </span>
          </label>
          {ri ? (
            // NOT a disabled select and NOT a hidden field. A simplified book
            // has no chart mapping at all — `resolveRiEntry` refuses `account`
            // with "a simplified book keeps recettes and dépenses, not a chart
            // mapping" — so there is nothing to choose, rather than something
            // this reader may not choose.
            <p
              className="mt-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
              data-frozen="ri_no_lines"
            >
              {t('resolve.riNoAccount')}
            </p>
          ) : posted ? (
            // NOT a disabled input. A greyed field invites somebody to wonder
            // what is wrong with it; the fact is that this entry is posted and
            // its lines are accounting facts, which is a sentence, not a state.
            <p
              className="mt-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
              data-frozen="posted"
            >
              {t('resolve.postedNoAccount')}
            </p>
          ) : (
            <>
              <select
                id={`acct-${row.number}`}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={FIELD + ' mt-1'}
              >
                <option value="">{t('resolve.leaveUnassigned')}</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.no} value={a.no}>
                    {a.no} · {label(a.label)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {t('resolve.fillsStagedLine')}
              </p>
            </>
          )}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor={`ev-${row.number}`}>
          {t('resolve.evidenceNote')}{' '}
          <span className="font-normal normal-case tracking-normal">{t('resolve.optional')}</span>
        </label>
        <input
          id={`ev-${row.number}`}
          value={evidenceNote}
          onChange={(e) => setEvidenceNote(e.target.value)}
          className={FIELD + ' mt-1'}
          placeholder={t('resolve.evidencePlaceholder')}
        />
      </div>

      <div className="rounded-md border border-border p-2.5">
        <label className="inline-flex items-start gap-2 text-[12.5px] text-foreground">
          <input
            type="checkbox"
            checked={teachRule}
            onChange={(e) => setTeachRule(e.target.checked)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            {t('resolve.teachRule')}
            <span className="block text-[11.5px] font-normal text-muted-foreground">
              {t('resolve.teachRuleNote')}
            </span>
          </span>
        </label>

        {teachRule && (
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor={`rc-${row.number}`}>
                {t('resolve.fragment')}
              </label>
              <input
                id={`rc-${row.number}`}
                value={ruleCounterparty}
                onChange={(e) => setRuleCounterparty(e.target.value)}
                className={FIELD + ' mt-1 font-mono'}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`ra-${row.number}`}>
                {t('resolve.expectedAmount')}
              </label>
              <input
                id={`ra-${row.number}`}
                value={ruleAmountChf}
                onChange={(e) => setRuleAmountChf(e.target.value)}
                inputMode="decimal"
                className={FIELD + ' mt-1'}
                placeholder={t('resolve.anyAmount')}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`rt-${row.number}`}>
                {t('resolve.tolerance')}
              </label>
              <input
                id={`rt-${row.number}`}
                value={ruleToleranceChf}
                onChange={(e) => setRuleToleranceChf(e.target.value)}
                inputMode="decimal"
                className={FIELD + ' mt-1'}
                placeholder={t('resolve.exact')}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`ri-${row.number}`}>
                {t('resolve.cadence')}
              </label>
              <input
                id={`ri-${row.number}`}
                value={ruleInterval}
                onChange={(e) => setRuleInterval(e.target.value)}
                className={FIELD + ' mt-1'}
                placeholder={t('resolve.cadencePlaceholder')}
              />
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {t('resolve.cadenceNote')}
              </p>
            </div>
            <div>
              <label className={LABEL} htmlFor={`rl-${row.number}`}>
                {t('resolve.learnedFrom')}
              </label>
              <select
                id={`rl-${row.number}`}
                value={ruleLearnedFrom}
                onChange={(e) => setRuleLearnedFrom(e.target.value)}
                className={FIELD + ' mt-1'}
              >
                <option value="manual">manual</option>
                <option value="contract">contract</option>
                <option value="subscription">subscription</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {refusal && (
        // The server's words, not ours. `code` is here because this box means a
        // write was refused and the code is what makes it reportable — the same
        // split `components/states.tsx` settled: a calm notice drops the code, a
        // real refusal keeps it.
        <div
          role="alert"
          data-refusal={refusal.code}
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
        >
          <p className="text-[12.5px] text-foreground">{refusal.message}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{refusal.code}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={resolve.pending || explanation.trim() === ''}
          className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* `manual` / `contract` / `subscription` in the select above are the
              values the route stores in `books.rule.learned_from`, verbatim.
              They are data, not chrome — translating an option label would file
              a French word into a column `bk books rule list` prints raw. */}
          {resolve.pending
            ? t('resolve.saving')
            : teachRule
              ? t('resolve.resolveAndTeach')
              : t('resolve.resolve')}
        </button>
        {explanation.trim() === '' && (
          // Not an error and not a fallback: nothing has failed, and the button
          // says why it is not available rather than the reader finding out by
          // pressing it.
          <span className="text-[11.5px] text-muted-foreground">{t('resolve.writeFirst')}</span>
        )}
      </div>
    </form>
  )
}
