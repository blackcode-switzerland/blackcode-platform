'use client'

// Compliance rules — nineteen researched checks, and the fifth write.
//
// ===========================================================================
// THIS IS THE ONE SCREEN IN THE PRODUCT THAT IS ABOUT NO BOOK AT ALL
// ===========================================================================
// `GET /api/compliance-rules` is not under `/api/workspaces/{ws}/` and is served
// unauthenticated, for the reason its own header gives: the same law binds every
// book, and the payload is law text with citations holding no amounts and no
// names. So there is no `?entity=` on this page, the book selector changes
// nothing here, and the copy says so rather than leaving a control that appears
// to do nothing — `lib/nav.ts`'s rule, and the treatment the half-scoped sources
// screen already gets.
//
// It is off-nav for the reason Taxes is: it is not part of a person's working
// loop. It is reached from the overview's cross-link, and from a verdict, which
// is where a rule id is actually in front of somebody.
//
// ===========================================================================
// `draft` IS THE RESTING STATE OF THIS SCREEN AND IT IS NOT DRAWN AS A PROBLEM
// ===========================================================================
// All nineteen are born draft. Research against Fedlex is not a fiduciary's
// sign-off and `COMPLIANCE_META` says so in capitals — so nineteen rules waiting
// for a human is what this page looks like when NOTHING IS WRONG. Drawn in red
// it would say the opposite, and a reader who learns to ignore red here will
// ignore it on `rejected` too.
//
// The tones are decided in `lib/compliance.ts`, where a test can reach them, and
// `<TonePill>` only paints. There is no `switch` in this file.
//
// ===========================================================================
// `source_confidence` IS PROVENANCE, AND IT IS THE SECOND COLUMN FOR A REASON
// ===========================================================================
// `needs_fiduciary_check` is a fact about the SOURCE, not about the rule: it
// means the article behind it is not settled, not that the rule is doubtful. A
// reader must be able to see which rules rest on statute the agent read in
// Fedlex and which rest on something softer, and that is a different question
// from whether anybody has signed the rule off. So it sits beside the review
// state rather than being folded into it, and all three values wear the calm
// tone — a disclosure drawn as a defect is a disclosure people stop reading.
//
// ===========================================================================
// THE APP COMPUTES NO COMPLIANCE JUDGMENT, AND THIS SCREEN DOES NOT EITHER
// ===========================================================================
// Nothing here evaluates a rule against a book. `lib/db/queries/compliance.ts`:
// flags are facts, the Devil's Advocate is an EXTERNAL agent pass, and its
// verdicts arrive through `POST /entries/{n}/verdict` — ring 0, not ours. This
// page is the register those verdicts cite, and the place a human signs one off.

import Link from 'next/link'
import { useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useComplianceRules } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { useLabel } from '@/lib/use-label'
import { useT } from '@/lib/i18n'
import {
  appliesToText,
  countByState,
  effectiveLogic,
  isReviewed,
  provenanceOf,
  reviewStateFace,
  severityFace,
  severityRank,
} from '@/lib/compliance'
import { ScreenFrame } from '@/components/screen-frame'
import { PageHeader } from '@/components/page-header'
import { Section, Surface } from '@/components/section'
import { ErrorState, Loading } from '@/components/states'
import { DateText } from '@/components/date-text'
import { TonePill } from '@/components/tone-pill'
import { ComplianceReviewForm, ReviewedNotice } from '@/components/compliance-review-form'
import type { ComplianceRule } from '@/lib/types'

export default function Page() {
  const params = useParams<{ ws: string }>()
  const search = useSearchParams()
  const scope = useScope()
  const base = `/dashboard/${params.ws}`
  const rules = useComplianceRules()
  const t = useT()
  // What a verdict deep-links to: `?rule=vat-008`. Highlighted, never filtered
  // to — the register is the point, and a reader arriving from a verdict still
  // needs the rules around it.
  const highlighted = search?.get('rule') ?? null

  const sorted = [...(rules.data ?? [])].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.rule_id.localeCompare(b.rule_id)
  )
  const counts = countByState(rules.data ?? [])
  const drafts = counts.draft ?? 0

  return (
    <ScreenFrame title={t('compliance.uiName')}>
      <Link
        href={scopedHref(base, '', scope)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {t('tax.back')}
      </Link>

      {/* ── NOT `<StatementHeading>`, AND THAT WAS FOUND BY OPENING IT ────
          Every other screen in this app uses it, and it renders
          `{bookName} · exercice {exercice}` with an em dash for each missing
          half. On a register that belongs to no book and no year that prints
          `— · exercice —`, which reads as a rendering gap rather than as the
          absence of two things that genuinely do not apply here. Caught in the
          browser, not in review. */}
      <PageHeader
        eyebrow={t('nav.compliance')}
        title={
          <>
            {t('compliance.uiName')}
            {t('compliance.legalName') !== t('compliance.uiName') && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t('compliance.legalName')}
              </span>
            )}
          </>
        }
        lead={
          <>
            {t('compliance.leadA')}{' '}
            <span className="text-foreground">{t('compliance.leadB')}</span>
            {t('compliance.leadC')}
          </>
        }
        /* `compliance.subheading` is a SCOPE fact — "every book · the articles
           these rules cite" — not a sentence, and running it into the lead made
           one long broken one. It sits where the other screens put the book and
           the year, which is what it is the equivalent of: this register belongs
           to no book and no year, and saying so is the point. */
        meta={
          <span className="text-[12.5px] text-muted-foreground">
            {t('compliance.subheading')}
          </span>
        }
      />

      {rules.isLoading && <Loading rows={8} label={t('compliance.loading')} />}
      {rules.error && <ErrorState error={rules.error} title={t('compliance.failed')} />}

      {rules.data && (
        <>
          {/* ── THE RESTING STATE, SAID IN WORDS BEFORE ANY COLOUR ────────
              Nineteen drafts is not a backlog and must not read as one. */}
          <Surface role="note" className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {t(drafts === 1 ? 'compliance.draftsOne' : 'compliance.draftsMany', {
                n: drafts,
                total: rules.data.length,
              })}
            </span>{' '}
            {t('compliance.draftsBody')}
            {Object.entries(counts)
              .filter(([state]) => state !== 'draft')
              .map(([state, n]) => {
                const face = reviewStateFace(state)
                return (
                  <span key={state}>
                    {' '}
                    {n} {face ? t(face.labelKey).toLowerCase() : state}.
                  </span>
                )
              })}
          </Surface>

          <Section label={t('compliance.registerLabel')} bodyClassName="">
            {sorted.map((rule) => (
              <RuleCard key={rule.rule_id} rule={rule} highlighted={rule.rule_id === highlighted} />
            ))}
          </Section>
        </>
      )}
    </ScreenFrame>
  )
}

function RuleCard({ rule, highlighted }: { rule: ComplianceRule; highlighted: boolean }) {
  const t = useT()
  const label = useLabel()
  // The row the SERVER returned after a review in this session — kept so the
  // screen reports what landed rather than what was asked for. The list refetches
  // too; this is what survives the tick in between.
  const [reviewed, setReviewed] = useState<ComplianceRule | null>(null)
  const shown = reviewed ?? rule

  const state = reviewStateFace(shown.review_state)
  const severity = severityFace(shown.severity)
  const provenance = provenanceOf(shown.source_confidence)
  const logic = effectiveLogic(shown)

  return (
    <section
      id={shown.rule_id}
      data-rule={shown.rule_id}
      data-review-state={shown.review_state}
      className={
        'border-b border-border py-3 ' + (highlighted ? 'bg-secondary/60 px-3 -mx-3' : '')
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] font-medium text-foreground">{shown.rule_id}</span>

        {/* ── AN UNKNOWN VALUE IS NAMED, NEVER BINNED ───────────────────
            Each of these three is a `varchar`, not an enum this bundle owns. A
            value added server-side falls to `null` here and renders raw beside a
            note, rather than into `draft`'s calm treatment (which would hide a
            rejection) or `blocker`'s (which would invent one). */}
        {severity ? (
          <TonePill tone={severity.tone} value={shown.severity} title={t(severity.meaningKey)}>
            {t(severity.labelKey)}
          </TonePill>
        ) : (
          <TonePill
            tone="warn"
            value={shown.severity}
            title={t('compliance.unknownSeverity')}
          >
            {t('compliance.unknownSuffix', { value: shown.severity })}
          </TonePill>
        )}

        {state ? (
          <TonePill tone={state.tone} value={shown.review_state} title={t(state.meaningKey)}>
            {t(state.labelKey)}
          </TonePill>
        ) : (
          <TonePill tone="warn" value={shown.review_state} title={t('compliance.unknownState')}>
            {t('compliance.unknownSuffix', { value: shown.review_state })}
          </TonePill>
        )}

        <span className="ml-auto text-[11.5px] text-muted-foreground">
          {appliesToText(shown.applies_to)}
        </span>
      </div>

      <p className="mt-1.5 text-[13px] text-foreground">
        {/* The one-liner when there is one; the trigger condition otherwise.
            `summary` is nullable jsonb and `en()` returns '' for anything that
            is not a `{fr, en}` pair — so the fallback is a positive test on the
            rendered string, never on the field's truthiness. */}
        {label(shown.summary) || shown.trigger_condition}
      </p>

      <p className="mt-1 text-[11.5px] text-muted-foreground">
        <span className="text-foreground">{shown.citation}</span>
        {provenance ? (
          <>
            {' · '}
            <span title={t(provenance.meaningKey)}>{t(provenance.labelKey)}</span>
          </>
        ) : (
          <>
            {' · '}
            {t('compliance.unknownProvenance', { value: shown.source_confidence })}
          </>
        )}
      </p>

      {provenance && (
        <p className="mt-1 text-[11.5px] text-muted-foreground">{t(provenance.meaningKey)}</p>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11.5px] text-muted-foreground hover:text-foreground">
          {t('compliance.checkSummary')}
        </summary>
        <div className="mt-1.5 space-y-2 text-[12px]">
          <Field label={t('compliance.triggersWhen')}>{shown.trigger_condition}</Field>
          <Field
            label={
              logic.corrected
                ? t('compliance.checkLogicCorrected')
                : t('compliance.checkLogic')
            }
          >
            <span className="font-mono text-[11.5px]">{logic.text}</span>
          </Field>
          {/* ── THE ORIGINAL SURVIVES A CORRECTION, AND IS SHOWN ─────────
              `edited_logic` is a separate column precisely so `check_logic` is
              not lost. A screen showing only the correction would lose the
              record OF the correction. */}
          {logic.original !== null && (
            <Field label={t('compliance.checkLogicOriginal')}>
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {logic.original}
              </span>
            </Field>
          )}
          <Field label={t('compliance.consequence')}>{shown.consequence}</Field>
        </div>
      </details>

      {isReviewed(shown.review_state) && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {state ? t(state.meaningKey) : null}{' '}
          {shown.reviewed_by && (
            <>
              {t('compliance.signedOffBy', { name: shown.reviewed_by })}
              {shown.reviewed_at && (
                <>
                  {' '}
                  {t('compliance.signedOffOn')} <DateText value={shown.reviewed_at} />
                </>
              )}
              .
            </>
          )}
          {shown.review_note && <> “{shown.review_note}”</>}
        </p>
      )}

      {/* The form stays available after a review: the states are not terminal
          against each other — an approved rule can later be rejected, and the
          route allows it. What is impossible is going BACK to draft. */}
      {reviewed && <ReviewedNotice row={reviewed} />}
      <ComplianceReviewForm rule={shown} onReviewed={setReviewed} />
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  )
}
