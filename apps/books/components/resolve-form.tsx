'use client'

// `<ResolveForm>` — the first button in b/books that changes a company's books.
//
// ===========================================================================
// IT CANNOT BE HANDED AN RI ROW, AND THAT IS ENFORCED BY THE TYPE
// ===========================================================================
// `GET …/worklist` serves two kinds of row and **their #number series overlap**:
// `books.entry` and `books.ri_entry` have separate `seq` counters, so
// `{kind:'entry', number:5}` and `{kind:'ri_entry', number:5}` are two different
// rows that both exist. `POST /entries/{n}/resolve` addresses `books.entry` and
// nothing else — `lib/db/queries/resolve.ts` has no RI path at all — so asking it
// to resolve an RI row by the number printed on that row rewrites an unrelated
// journal entry and answers **200**.
//
// Reproduced against the seeded workspace on 2026-08-18:
//
//     bk books worklist --entity ri   →  #5  ri_entry  TWINT *8842  120.00
//     bk books resolve 5 --explanation "probe"
//       resolved #5 -> known_one_off        ← exit 0, no error
//
// and what changed was `books.entry` #5 — the January payroll, in a different
// book — whose explanation was overwritten. The RI row was untouched. Raised on
// ticket #51.
//
// So this component's prop is `WorklistRow & { kind: 'entry' }`. Passing an RI
// row is a COMPILE ERROR, not a runtime check somebody can forget to write, and
// `<WorklistRows>` branches on `kind` before it can reach here. There is no
// disabled button to re-enable in devtools and no handler to call, because for
// an RI row neither is rendered.
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

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ResolvableRow } from '@/lib/resolvable'
import { useAccounts } from '@/lib/hooks'
import { useCanWrite, useResolveEntry, type ResolveBody } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import type { ReadScope } from '@/lib/hooks'
import type { ResolveResult, WorklistRow } from '@/lib/types'
import { accountLabelEn } from '@/lib/label'

/** A worklist row this form is allowed to act on. See the header. */
/**
 * Re-exported from `lib/resolvable.ts`, which now owns both the type and the
 * PREDICATE that produces it. The predicate is the half that can be tested —
 * `lib/resolvable.test.ts` calls it over every kind the worklist serves — and
 * splitting them would put the type and the rule that enforces it in two
 * places. See that file's header for the bug this arrangement exists after.
 */
export type { ResolvableRow }

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
function counterpartyGuess(row: ResolvableRow): string {
  return row.counterparty ?? row.raw_label.split(/\s+/)[0] ?? ''
}

export function ResolveForm({
  ws,
  scope,
  row,
  initialExplanation = '',
  onResolved,
}: {
  ws: string | undefined
  scope: ReadScope
  row: ResolvableRow
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
  const queryClient = useQueryClient()
  const resolve = useResolveEntry(ws, row.number)
  const accounts = useAccounts(ws, scope)

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
  const posted = row.status === 'posted'

  if (!canWrite) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">
        This session cannot change records.
      </p>
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
      // The route refuses a non-object, and `bk books resolve` sends
      // `{"en": text}`. English chrome (D-A) — a French side here would be a
      // translation nobody wrote.
      explanation: { en: explanation.trim() },
      recognition,
    }
    if (counterparty.trim()) body.counterparty = counterparty.trim()
    // Never sent on a posted entry. The control is not rendered there either;
    // this is the second of the two, because one of them will be edited someday.
    if (!posted && account) body.account = account
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
      <div>
        <label className={LABEL} htmlFor={`expl-${row.number}`}>
          What was this money?
        </label>
        <textarea
          id={`expl-${row.number}`}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
          className={FIELD + ' mt-1'}
          placeholder="e.g. team lunch after the March release — business meal"
        />
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          This is the product. It is kept forever, and the row keeps what it said before.
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>Conclusion</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {(
            [
              ['known_one_off', 'One-off'],
              ['known_recurring', 'Recurring'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground">
              <input
                type="radio"
                name={`recognition-${row.number}`}
                value={value}
                checked={recognition === value}
                onChange={() => setRecognition(value)}
                className="accent-[var(--primary)]"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`cp-${row.number}`}>
            Counterparty <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id={`cp-${row.number}`}
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            className={FIELD + ' mt-1'}
            placeholder={row.counterparty ?? 'Who was on the other side'}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor={`acct-${row.number}`}>
            Account <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          {posted ? (
            // NOT a disabled input. A greyed field invites somebody to wonder
            // what is wrong with it; the fact is that this entry is posted and
            // its lines are accounting facts, which is a sentence, not a state.
            <p
              className="mt-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12px] text-muted-foreground"
              data-frozen="posted"
            >
              This entry is posted: its lines are accounting facts and the account cannot be
              changed. A correction is a reversing entry. Everything else on this form still
              applies.
            </p>
          ) : (
            <>
              <select
                id={`acct-${row.number}`}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={FIELD + ' mt-1'}
              >
                <option value="">Leave unassigned</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.no} value={a.no}>
                    {a.no} · {accountLabelEn(a.label)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Fills the staged line that has none.
              </p>
            </>
          )}
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor={`ev-${row.number}`}>
          Evidence note <span className="font-normal normal-case tracking-normal">(optional)</span>
        </label>
        <input
          id={`ev-${row.number}`}
          value={evidenceNote}
          onChange={(e) => setEvidenceNote(e.target.value)}
          className={FIELD + ' mt-1'}
          placeholder="What document backs this, or why there is none"
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
            Teach a rule from this
            <span className="block text-[11.5px] font-normal text-muted-foreground">
              Future payments matching it will explain themselves. The rule is keyed to the PAIR
              (this entry’s source, the fragment below) — the same merchant on another card is a new
              fact and comes back here.
            </span>
          </span>
        </label>

        {teachRule && (
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL} htmlFor={`rc-${row.number}`}>
                Fragment matched against future labels
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
                Expected amount
              </label>
              <input
                id={`ra-${row.number}`}
                value={ruleAmountChf}
                onChange={(e) => setRuleAmountChf(e.target.value)}
                inputMode="decimal"
                className={FIELD + ' mt-1'}
                placeholder="blank = any amount"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`rt-${row.number}`}>
                Tolerance
              </label>
              <input
                id={`rt-${row.number}`}
                value={ruleToleranceChf}
                onChange={(e) => setRuleToleranceChf(e.target.value)}
                inputMode="decimal"
                className={FIELD + ' mt-1'}
                placeholder="blank = exact"
              />
            </div>
            <div>
              <label className={LABEL} htmlFor={`ri-${row.number}`}>
                Cadence
              </label>
              <input
                id={`ri-${row.number}`}
                value={ruleInterval}
                onChange={(e) => setRuleInterval(e.target.value)}
                className={FIELD + ' mt-1'}
                placeholder="monthly, quarterly, weekly"
              />
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Documentation only — the matcher does not read it.
              </p>
            </div>
            <div>
              <label className={LABEL} htmlFor={`rl-${row.number}`}>
                Learned from
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
          {resolve.pending
            ? 'Saving…'
            : teachRule
              ? 'Resolve and teach a rule'
              : 'Resolve'}
        </button>
        {explanation.trim() === '' && (
          // Not an error and not a fallback: nothing has failed, and the button
          // says why it is not available rather than the reader finding out by
          // pressing it.
          <span className="text-[11.5px] text-muted-foreground">
            Write the explanation first — that is what is being saved.
          </span>
        )}
      </div>
    </form>
  )
}
