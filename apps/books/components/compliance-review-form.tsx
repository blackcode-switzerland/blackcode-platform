'use client'

// The fiduciary's sign-off on one compliance rule — **the fifth write, and the
// last of the five to land.**
//
// ===========================================================================
// THERE IS NO UN-REVIEW AND NO DELETE, SO THE CONFIRMATION SAYS SO
// ===========================================================================
// `reviewComplianceRule` refuses `draft` as a verdict — *"draft is where rules
// are born, not a state a review sets"* — because reviewing backwards would
// erase the fact that somebody looked. There is no DELETE on the table either: a
// verdict may cite a rule forever. The row records WHO and WHEN from the
// session, and the client cannot set either.
//
// So this is in `entry post`'s class for the CONFIRMATION: a second, explicit
// step that states what becomes permanent before the button that does it
// appears. It is deliberately NOT in `entry post`'s class for the RITUAL —
// no typed-target-repeated-back — and the difference is the ring, not the
// severity:
//
//   entry post   crosses OUT of ring 2 into ring 0. Amounts and accounts freeze
//                under migration 0004's triggers; nobody, human or agent, can
//                change them again. The target is typed back because a dialog is
//                answered by reflex and that write must not be reachable by one.
//   this         ring 2. It writes MEANING about a rule and moves no franc, no
//                account and no balance. What is permanent is the RECORD OF THE
//                REVIEW, not a number.
//
// Making them identical would be the mistake in the other direction: a ritual
// used for everything is a ritual nobody reads.
//
// ===========================================================================
// AN EDIT WITH NO CORRECTED WORDING IS REFUSED — BY THE ROUTE, AND THE READER
// SEES THE ROUTE'S OWN SENTENCE
// ===========================================================================
// `edited_needs_logic`, 400: *"an edit without the corrected wording is an
// approval wearing a different name"*, with the suggestion *"pass the corrected
// check logic"*.
//
// **The submit button is NOT disabled for it, and that is deliberate.**
// `canSubmitReview` in `lib/compliance.ts` is the same test, and it drives an
// inline hint rather than the `disabled` attribute — so the refusal stays
// reachable and what the reader sees is the SERVER'S sentence rather than this
// app's paraphrase of it. Three reasons, and the third is the one that decided
// it:
//
//   1. The route is the rule. A client-side copy that ever disagreed would hide
//      a real refusal behind a stale button state.
//   2. It is the phase brief's requirement in so many words: *"The route refuses
//      an edit carrying no corrected wording — show its refusal verbatim."* A
//      refusal that can never arrive cannot be shown.
//   3. **A disabled button explains nothing.** A reader who types nothing into
//      the wording box and finds the button dead learns that something is wrong;
//      a reader who presses it learns *why an edit needs wording*, in the
//      route's own words, which is a sentence about the law and not about a
//      form.
//
// ── AND THE WORDING BOX IS NOT PREFILLED ────────────────────────────────
// Prefilling it with `check_logic` would make "edit" the cheapest button on the
// screen — press, press, done — and produce an `edited` review whose correction
// is identical to the original. `edited_logic` is a separate column so the
// original survives a correction; a correction that corrects nothing puts a
// fiduciary's name on a change they did not make.

'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useCanWrite, useReviewComplianceRule } from '@/lib/mutations'
import { booksCacheFilter } from '@/lib/query-keys'
import {
  REVIEW_CHOICES,
  canSubmitReview,
  reviewBody,
  type ReviewChoice,
} from '@/lib/compliance'
import type { ComplianceRule } from '@/lib/types'
import { useT } from '@/lib/i18n'
import type { BooksKey } from '@/lib/dictionary'

/** Keys, not words — the same arrangement `lib/compliance.ts`'s faces use. */
const CHOICE_COPY: Record<ReviewChoice, { labelKey: BooksKey; whatKey: BooksKey }> = {
  approved: { labelKey: 'review.approve', whatKey: 'review.approveWhat' },
  edited: { labelKey: 'review.edit', whatKey: 'review.editWhat' },
  rejected: { labelKey: 'review.reject', whatKey: 'review.rejectWhat' },
}

export function ComplianceReviewForm({
  rule,
  onReviewed,
}: {
  rule: ComplianceRule
  /** Called with the row the server returned, so the page can say what landed. */
  onReviewed: (row: ComplianceRule) => void
}) {
  const canWrite = useCanWrite()
  const t = useT()
  const review = useReviewComplianceRule(rule.rule_id)
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<ReviewChoice>('approved')
  const [editedLogic, setEditedLogic] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<{ message: string; code: string } | null>(null)

  // ── IN FLIGHT, SYNCHRONOUSLY ────────────────────────────────────────────
  // `disabled={pending}` is React state and the attribute does not exist until
  // the next render, so two clicks in one tick both go through. On the resolve
  // form that shipped two POSTs 20ms apart and taught two rules (F-1 of the
  // phase-2 review). Here the second would overwrite the first review's
  // timestamp with an identical one — harmless in effect and still a second
  // sign-off nobody made.
  const inFlight = useRef(false)

  // ── THE AFFORDANCE ITSELF IS GATED, NOT ONLY WHAT IT OPENS ──────────────
  // A button that renders and then explains it cannot do anything teaches the
  // reader the app is broken rather than that they lack a permission. Phase 2
  // learned this on the resolve button.
  if (!canWrite) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">{t('review.cannotWrite')}</p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-review-open={rule.rule_id}
        className="mt-2 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
      >
        {t('review.open')}
      </button>
    )
  }

  const wordingMissing = !canSubmitReview(choice, editedLogic)

  function cancel() {
    setOpen(false)
    setConfirming(false)
    setRefusal(null)
    setEditedLogic('')
    setNote('')
    setChoice('approved')
  }

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true
    setRefusal(null)
    try {
      // The route is the rule — the client test above drives a hint, not this.
      const result = await review.run(reviewBody(choice, editedLogic, note))
      if (!result.ok) {
        // THE SERVER'S OWN SENTENCE, reason and recovery already joined by
        // `sentence()` in lib/mutations.ts. Never off `review.error`, which is
        // null in the tick its setter ran.
        setRefusal({ message: result.message, code: result.error.code })
        setConfirming(false)
        return
      }
      // The whole cache root. A review changes the rules list, the counts on the
      // register, and — the day a verdict panel resolves a cited rule to its
      // state — every screen that cites one. Enumerating that is a list that
      // goes stale; see `booksCacheFilter`.
      await queryClient.invalidateQueries(booksCacheFilter())
      cancel()
      onReviewed(result.data)
    } finally {
      inFlight.current = false
    }
  }

  return (
    <div
      className="mt-2.5 rounded-md border border-border bg-secondary px-3 py-2.5"
      data-review-form={rule.rule_id}
    >
      <fieldset disabled={confirming}>
        <legend className="text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('review.legend', { rule: rule.rule_id })}
        </legend>

        <div className="mt-1.5 space-y-1.5">
          {REVIEW_CHOICES.map((c) => (
            <label key={c} className="flex cursor-pointer items-start gap-2 text-[12.5px]">
              <input
                type="radio"
                name={`review-${rule.rule_id}`}
                value={c}
                checked={choice === c}
                onChange={() => setChoice(c)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">{t(CHOICE_COPY[c].labelKey)}</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {t(CHOICE_COPY[c].whatKey)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {choice === 'edited' && (
          <div className="mt-2.5">
            <label
              htmlFor={`edited-${rule.rule_id}`}
              className="block text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {t('review.correctedWording')}
            </label>
            <textarea
              id={`edited-${rule.rule_id}`}
              value={editedLogic}
              onChange={(e) => setEditedLogic(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[12px] text-foreground focus:border-primary focus:outline-none"
              // Empty on purpose. See the header: a prefilled box makes "edit"
              // the cheapest button on the screen.
              placeholder={t('review.correctedPlaceholder')}
            />
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {t('review.correctedNote')}
            </p>
          </div>
        )}

        <div className="mt-2.5">
          <label
            htmlFor={`note-${rule.rule_id}`}
            className="block text-[11.5px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            {t('review.note')}{' '}
            <span className="font-normal normal-case tracking-normal">
              {t('resolve.optional')}
            </span>
          </label>
          <input
            id={`note-${rule.rule_id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[12.5px] text-foreground focus:border-primary focus:outline-none"
            placeholder={t('review.notePlaceholder')}
          />
        </div>
      </fieldset>

      {/* ── THE HINT, NOT THE `disabled` ATTRIBUTE ────────────────────────
          Nothing has failed and the reader is not being scolded — the box is
          empty because they have not typed yet. Pressing on anyway reaches the
          route, and the route's own sentence is what appears. */}
      {wordingMissing && !confirming && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {t('review.wordingMissing')}
        </p>
      )}

      {!confirming ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-review-continue={rule.rule_id}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:border-primary"
          >
            {t('review.continue')}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="px-1 text-[12px] text-muted-foreground hover:text-foreground"
          >
            {t('review.cancel')}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
          <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-foreground">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>{t('review.cannotTakeBack')}</span>
          </p>
          <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
            <li>{t('review.item1')}</li>
            <li>{t('review.item2')}</li>
            <li>
              {t('review.item3', {
                choice: t(CHOICE_COPY[choice].labelKey).toLowerCase(),
                rule: rule.rule_id,
                citation: rule.citation,
              })}
            </li>
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={review.pending}
              data-review-submit={rule.rule_id}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {review.pending ? t('review.recording') : t('review.record')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              {t('review.back')}
            </button>
          </div>
        </div>
      )}

      {refusal && (
        <div
          role="alert"
          data-refusal={refusal.code}
          className="mt-2 rounded-md border border-destructive/40 bg-background px-2.5 py-2"
        >
          {/* VERBATIM. The route's reason and its suggestion, joined and
              otherwise untouched — a paraphrase of a refusal about what an edit
              legally is would be this app restating the rule it is enforcing. */}
          <p className="text-[12.5px] text-foreground">{refusal.message}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{refusal.code}</p>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {t('review.nothingRecorded')}
          </p>
        </div>
      )}
    </div>
  )
}

/** What the screen says after a review landed. Kept beside the form for
 *  `<PostedNotice>`'s reason: the sentence is the point of the component. */
export function ReviewedNotice({ row }: { row: ComplianceRule }) {
  const t = useT()
  return (
    <p
      role="status"
      data-reviewed={row.rule_id}
      data-state={row.review_state}
      className="mt-2 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[12px] text-foreground"
    >
      <span className="font-medium">{t('review.recordedLead')}</span>{' '}
      {t('review.recordedBody', {
        rule: row.rule_id,
        // The SERVER's state word, verbatim — `review_state` is a stored value
        // and `bk books compliance` prints the same one.
        state: row.review_state,
        by: row.reviewed_by ? t('review.recordedBy', { name: row.reviewed_by }) : '',
      })}
    </p>
  )
}
