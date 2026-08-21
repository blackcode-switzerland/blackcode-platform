'use client'

// One écriture — the transaction detail screen.
//
// ===========================================================================
// `raw_label` IS NEVER OVERWRITTEN AND IS THE FIRST THING ON THE PAGE
// ===========================================================================
// It is the bank's own words, the original record, and the whole product is
// about explaining them. The `explanation` sits UNDER it rather than instead of
// it: an explanation that replaced the raw text would make the record
// unverifiable against the statement it came from, which is the one thing
// art. 958f CO's retention rules exist to preserve.
//
// ===========================================================================
// THE EVIDENCE TIER AND THE VAT CLAIM ARE TWO INDEPENDENT LEGAL FACTS
// ===========================================================================
// A bank record can support a profit-tax deduction (LIFD art. 58) and can NEVER
// support an input VAT claim (LTVA art. 26). So `evidence_tier` and
// `tva.input_claimed` are rendered as separate rows and neither is derived from
// the other — `lib/types.ts` says so twice, and this screen is the place a
// reader would otherwise infer one from the other.
//
// ── THE ADDRESS IS THE #NUMBER, NEVER THE SERIAL id ───────────────────────
// `/ledger/{number}` takes the workspace seq, which is what `bk books entry
// show` takes and what a URN carries. `entry_no` — the statutory journal number
// — is shown too, labelled, because it is what a reader comparing against a
// filing needs. The payload also carries `matched_rule_id`, `source_id` and
// `related_party.mirror_entry_id`, which ARE serial ids: they are shown as
// facts and deliberately not linked, because this app has no route that
// resolves one and a link that guessed would open a different écriture.
//
// ── A BAD NUMBER IN THE URL IS A 404 FROM THE ROUTE, WITH A SUGGESTION ────
// Not a crash and not a redirect to the list. `<ErrorState>` renders the
// server's message and its `suggestion`, which is the recovery.

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useScope } from '@/lib/scope'
import { useEntry } from '@/lib/hooks'
import { scopedHref } from '@/lib/nav'
import { useLabel } from '@/lib/use-label'
import { useLocale, useT } from '@/lib/i18n'
import { JOURNAL_NAME } from '@/lib/journal'
import { percent } from '@/lib/format'
import { ScreenFrame } from '@/components/screen-frame'
import { ErrorState, Loading } from '@/components/states'
import { DateText } from '@/components/date-text'
import { VocabChip } from '@/components/chips'
import { EntryLines } from '@/components/entry-lines'
import { DriveLink } from '@/components/drive-link'
import { Money } from '@/components/money'
import { HistoryTrail, hasHistory } from '@/components/history-trail'
import { PostEntryForm, PostedNotice } from '@/components/post-entry-form'
import { VerdictPanel } from '@/components/verdict-panel'
import { blocksPosting } from '@/lib/verdict'
import { entryTotal } from '@/lib/ledger-totals'
import { PageHeader } from '@/components/page-header'
import { Grid, Section } from '@/components/section'
import { Stat, StatRow } from '@/components/stat'
import { Field, FieldGrid } from '@/components/field'
import { Badge } from '@/components/badge'
import type { PostResult } from '@/lib/mutations'

export default function Page() {
  const params = useParams<{ ws: string; number: string }>()
  const scope = useScope()
  const t = useT()
  const locale = useLocale()
  const label = useLabel()
  const base = `/dashboard/${params.ws}`

  // `Number('abc')` is NaN and `Number('')` is 0; neither is an entry number.
  // Rejected here rather than sent to the route, so a typed URL says what is
  // wrong with it instead of spending a request to be told.
  const parsed = Number(params.number)
  const number = Number.isInteger(parsed) && parsed > 0 ? parsed : null
  const entry = useEntry(params.ws, scope, number)

  /**
   * What the server answered the last time this session posted this entry.
   *
   * Held here rather than derived from the refetched entry, for the reason the
   * worklist holds its resolve results: the REFETCHED row says `posted` and
   * nothing more, and `already` — did this call change anything, or had a robot
   * already done it — exists only in the response. Dropping it would lose the
   * one distinction the idempotent route was built to make.
   */
  const [posted, setPosted] = useState<PostResult | null>(null)

  // The entry's own magnitude. `null` when it has no lines yet — see
  // `entryTotal`, which refuses to call that `0.00`.
  const total = entryTotal(entry.data?.lines)

  return (
    <ScreenFrame title={t('entry.transaction')}>
      <Link
        href={scopedHref(base, '/ledger', scope)}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {/* Names the journal it goes back to, not the one this app has more of.
            "Grand livre" over a simplified book is the same mislabel the ledger's
            own header carried until 2026-08-19. Read from `JOURNAL_NAME` rather
            than spelled here, so a third journal cannot be labelled by whichever
            of the two this ternary happened to fall through to. */}
        {locale === 'fr'
          ? JOURNAL_NAME[scope.journal ?? 'grand_livre'].fr
          : JOURNAL_NAME[scope.journal ?? 'grand_livre'].en}
      </Link>

      {number === null && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
          <p className="text-sm font-medium text-foreground">
            {t('entry.notANumber', { value: params.number })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('entry.notANumberBody')}</p>
        </div>
      )}

      {entry.isLoading && <Loading rows={6} label={t('entry.loading')} />}
      {entry.error && <ErrorState error={entry.error} title={t('entry.failed')} />}

      {/* ── A SIMPLIFIED BOOK'S MOVEMENT IS NOT AN ÉCRITURE ──────────────────
          This screen reads eight fields no RI row has — `entry_no`, `lines`,
          `status`, `tva`, `related_party`, `reverses_entry_id`, `source_id`,
          `matched_rule_id` — so it cannot render one, and `<EntryLines>` threw
          on `entry.data.lines` when it tried.

          It got here because `seq` is workspace-wide across BOTH journals:
          `entry show 3` is blackcode's rent payment and `entry show 3
          --entity ri` is the RI's AVS instalment. `useEntry` now sends the book,
          so the RIGHT record arrives — which is the fix — and this branch is
          what stands in until a simplified book has a detail screen of its own.

          A refusal that names the book beats both alternatives: a crash, and the
          older behaviour of fetching another company's écriture and drawing it
          under this book's heading. Ticket-shaped, same family as #51 and #53. */}
      {entry.data && scope.journal === 'recettes_depenses' && (
        <section className="rounded-lg border border-border bg-secondary px-4 py-4" aria-live="polite">
          <h2 className="text-sm font-medium text-foreground">
            {t('entry.riNoEcritures', { book: scope.record?.name ?? t('noExercice.thisBook') })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('entry.riNoEcrituresBody', { n: number ?? '—' })}
          </p>
          <Link
            href={scopedHref(base, '/ledger', scope)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline"
          >
            {t('entry.backToRi')}
          </Link>
        </section>
      )}

      {entry.data && scope.journal !== 'recettes_depenses' && (
        <article data-entry={entry.data.number}>
          <PageHeader
            eyebrow={t('nav.ledger')}
            /* The bank's words, verbatim, at full size. */
            title={entry.data.raw_label}
            meta={
              <>
                <VocabChip vocabulary="entry_status" value={entry.data.status} />
                <VocabChip vocabulary="recognition" value={entry.data.recognition} />
                <VocabChip vocabulary="evidence_tiers" value={entry.data.evidence_tier} withNote />
                <Badge title={t('entry.numberTitle')}>
                  <span className="figure">#{entry.data.number}</span>
                </Badge>
              </>
            }
            lead={
              <>

            {/* ── THE BOOK AND THE YEAR ARE NOT STATED, AND THAT IS THE FIX ──
                This line read `{scope.record?.name} · exercice {scope.exercice}`
                until 2026-08-18, taking both from the URL. **This route is not
                scoped by either.** `getEntryByNumber` matches on
                `workspace_id + seq` alone — correctly, because `books.entry.seq`
                is workspace-wide — so `/ledger/{n}` opens the same écriture
                whatever `?entity=` says, and the heading described the FILTER
                rather than the record.

                Reproduced in a browser, in one click: open blackcode SA's
                entry #3 (a rent payment to IMMOREGIE SA), change the book
                switcher to AIOS, and the same unchanged entry is relabelled
                "AIOS Companion SA". Nothing refetched, nothing threw, and the
                screen made a false statement about which legal entity an
                écriture belongs to. Entry #14 is AIOS's and read "blackcode SA";
                entry #1 is in exercice 2025 and read "exercice 2026", beside its
                own date of 12.09.2025.

                The payload carries NEITHER field — see `publicEntry` — so this
                screen cannot state them, and inventing them from the scope is
                what it was doing. `GET /entries/{n}` serving `entity` and
                `exercice` is a backend ask and is in the report; until then the
                honest rendering is the record's own facts and a line saying the
                switcher does not filter here, which is the same treatment
                `lib/nav.ts` gives the half-scoped sources screen. */}
                <DateText value={entry.data.date} />
                {entry.data.counterparty && <> · {entry.data.counterparty}</>}
                <span className="mt-1 block text-[11.5px]">{t('entry.notScoped')}</span>
              </>
            }
          />
          {/* ── THE HEADLINE FIGURES, WHICH THIS PAGE NEVER SHOWED ──────────
              "How much was it" is the first question anybody asks of an
              écriture, and until 2026-08-21 the only way to answer it was to
              read the lines and add them up — the amount appeared nowhere on
              the page as a figure.

              `entryTotal` sums the lines. On a POSTED entry the two sides are
              equal by migration 0004's deferred constraint, so one magnitude is
              the whole truth; on a STAGED one they need not be, and the strip
              says so rather than printing one side as though it were the
              entry. An entry with no lines yet gets no strip at all, because a
              `0.00` there would claim it moved nothing. */}
          {total && (
            <StatRow>
              <Stat
                caption={t('entry.amount')}
                value={<Money value={total.debit} bare />}
                emphasis
                basis={total.balanced ? undefined : t('entry.unbalancedBasis')}
              />
              {!total.balanced && (
                <Stat
                  caption={t('entry.creditSide')}
                  value={<Money value={total.credit} bare />}
                  tone="attention"
                  basis={t('entry.unbalancedNote')}
                />
              )}
              <Stat caption={t('entry.vat')} value={<Money value={entry.data.tva.amount} bare />} />
              <Stat
                caption={t('entry.journalNo')}
                value={<span className="figure">{entry.data.entry_no}</span>}
                basis={t('entry.journalNoBasis')}
              />
            </StatRow>
          )}

          <Grid>
            {/* ── THE MAIN COLUMN: THE RECORD, AND WHAT MAY BE DONE TO IT ──
                The écriture first. A reader who opened an entry came to see the
                entry, and the page used to put four sections above it. */}
            <div className="space-y-4 lg:col-span-8">
              <Section label={t('entry.ecriture')} span={12}>
                <EntryLines lines={entry.data.lines} base={base} scope={scope} detailed />
              </Section>

              <Section
                label={t('entry.whatThisIs')}
                span={12}
                note={entry.data.explanation ? null : undefined}
              >
                {entry.data.explanation ? (
                  <p className="max-w-[95ch] text-sm leading-relaxed text-foreground">
                    {label(entry.data.explanation)}
                  </p>
                ) : (
                  // Not an em dash. An entry nobody has explained is the
                  // product's central object of work, and saying so is more
                  // useful than a blank that reads as a rendering gap.
                  <p className="max-w-[95ch] text-sm text-muted-foreground">
                    {t('entry.nobodySaid')}
                  </p>
                )}
              </Section>

              {/* ── THE COMPLIANCE VERDICT, ON EVERY ENTRY INCLUDING THE ONES
                  NOBODY HAS CHECKED ────────────────────────────────────────
                  Rendered unconditionally, which is the opposite of how every
                  other optional block on this page works — and it is why
                  `<VerdictPanel>` exists. `verdict: null` means NEVER CHECKED,
                  not clean, and a section that simply disappeared for a null
                  would let the absence read as an accepted verdict.
                  `lib/verdict.ts` holds the four states where a test can reach
                  them.

                  It sits ABOVE Posting deliberately: a blocked verdict is what
                  stops the write below it, and a reader has to meet the reason
                  before the button. */}
              <Section label={t('entry.compliance')} span={12}>
                <VerdictPanel verdict={entry.data.verdict} base={base} scope={scope} />
              </Section>

              {/* ── THE POSTING TRANSITION ──────────────────────────────────
                  Rendered only for a STAGED entry, and gone the moment it is
                  posted — there is nothing to offer on a posted one, and a
                  disabled button would invite somebody to wonder what is wrong
                  with it. The status chip in the header already says which it
                  is.

                  `status === 'staged'` is POSITIVE. `!== 'posted'` would render
                  this on any third status added server-side, which is a write
                  affordance nobody wrote, on the one write that cannot be
                  undone.

                  **Elevation 2, and it is the only level-2 block on this page.**
                  Posting is the single act here that leaves ring 2 and freezes
                  a record for ten years; the accent rule is what stops it
                  reading as one more section among nine. */}
              {entry.data.status === 'staged' && (
                <Section label={t('entry.posting')} span={12} tone="attention">
                  <p className="mb-3 max-w-[95ch] text-sm text-muted-foreground">
                    {t('entry.stagedNote')}
                  </p>
                  {/* ── THE FORM IS STILL OFFERED ON A BLOCKED ENTRY ────────
                      The refusal is the SERVER'S — `postEntry` raises
                      `verdict_blocked` with the pass's own `resolves` text as
                      the suggestion — and hiding the form would replace that
                      sentence with this app's guess at it. What the reader gets
                      instead is the verdict above the button and the route's own
                      words after it, which is the same arrangement
                      `<PostEntryForm>` uses for migration 0004's guard: the last
                      word belongs to whoever actually refuses. */}
                  {blocksPosting(entry.data.verdict) && (
                    <p className="mb-3 max-w-[95ch] text-[12px] text-muted-foreground">
                      {t('entry.blockedNote')}
                    </p>
                  )}
                  {posted ? (
                    <PostedNotice result={posted} />
                  ) : (
                    <PostEntryForm ws={params.ws} entry={entry.data} onPosted={setPosted} />
                  )}
                </Section>
              )}

              {/* A post made in this session, still shown after the entry
                  refetched as `posted` — because `already` lives only in the
                  response. */}
              {entry.data.status === 'posted' && posted && (
                <Section label={t('entry.posting')} span={12} tone="attention">
                  <PostedNotice result={posted} />
                </Section>
              )}
            </div>

            {/* ── THE SIDE COLUMN: WHAT IS ATTACHED TO THE RECORD ──────────
                VAT, the document, the currency it arrived in, the related
                party, and where it came from. Every one of these is a fact
                ABOUT the écriture rather than the écriture itself, and on a
                1400px page they fit beside it instead of pushing the provenance
                two screens down. */}
            <div className="space-y-4 lg:col-span-4">
              <Section label={t('entry.vat')} span={12} note={t('entry.vatNote')}>
                {/* `tva` is ALWAYS an object on the wire; its FIELDS are what
                    can be null. A `rate` of null means no rate was recorded and
                    renders an em dash, which is not the same claim as 0%. */}
                <FieldGrid>
                  <Field label={t('entry.rate')} figure>
                    {percent(entry.data.tva.rate)}
                  </Field>
                  <Field label={t('entry.amount')} figure>
                    <Money value={entry.data.tva.amount} bare />
                  </Field>
                  <Field label={t('entry.inputClaimed')}>
                    {entry.data.tva.input_claimed ? t('entry.yes') : t('entry.no')}
                  </Field>
                </FieldGrid>
                {entry.data.tva.note && (
                  <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                    {label(entry.data.tva.note)}
                  </p>
                )}
              </Section>

              <Section label={t('entry.supportingDocument')} span={12}>
                <DriveLink piece={entry.data.piece} withCaptured />
                {entry.data.evidence_note && (
                  <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
                    {label(entry.data.evidence_note)}
                  </p>
                )}
              </Section>

              {/* ── THE ORIGINAL CURRENCY, WHICH NOTHING RENDERED UNTIL
                  2026-08-18 ───────────────────────────────────────────────
                  `fx` arrived with migration 0011, is in `publicEntry`, is
                  declared in `lib/types.ts` as **"display-only"** — and no
                  screen displayed it. A field whose entire purpose is to be
                  shown, and which was not shown.

                  Rendered only when the entry has one, and field by field,
                  because the writer may omit any of the three — an em dash for a
                  missing `rate` would claim a rate was recorded and lost.
                  Nothing computes with these: they are free-text strings from
                  the issuer, and `lib/format.ts` never sees them. */}
              {entry.data.fx &&
                (entry.data.fx.original || entry.data.fx.rate || entry.data.fx.source) && (
                  <Section
                    label={t('entry.originalCurrency')}
                    span={12}
                    note={t('entry.fxNote')}
                  >
                    <FieldGrid>
                      {entry.data.fx.original && (
                        <Field label={t('entry.originalAmount')} figure>
                          {entry.data.fx.original}
                        </Field>
                      )}
                      {entry.data.fx.rate && (
                        <Field label={t('entry.rate')} figure>
                          {entry.data.fx.rate}
                        </Field>
                      )}
                      {entry.data.fx.source && (
                        <Field label={t('entry.rateSource')}>{entry.data.fx.source}</Field>
                      )}
                    </FieldGrid>
                  </Section>
                )}

              {entry.data.related_party && (
                <Section
                  label={t('entry.relatedParty')}
                  span={12}
                  /* A related-party entry with no justification is an art. 959a
                     al. 4 disclosure that has not been made. It is drawn at
                     level 2 with the destructive tone because it is a statutory
                     gap in the record, not a missing nicety. */
                  tone={entry.data.related_party.justification ? 'default' : 'problem'}
                >
                  <FieldGrid>
                    <Field label={t('entry.counterpart')}>
                      {entry.data.related_party.counterpart}
                    </Field>
                    <Field label={t('entry.kind')}>{entry.data.related_party.kind}</Field>
                    <Field label={t('entry.mirrorEntry')} figure>
                      {/* A serial id, not a #number — the field name says so and
                          this app has no route that resolves one. Shown, never
                          linked. */}
                      {entry.data.related_party.mirror_entry_id === null
                        ? t('entry.notRecorded')
                        : t('entry.idValue', { id: entry.data.related_party.mirror_entry_id })}
                    </Field>
                  </FieldGrid>
                  {entry.data.related_party.justification ? (
                    <p className="mt-3 text-[12px] leading-relaxed text-foreground">
                      {label(entry.data.related_party.justification)}
                    </p>
                  ) : (
                    <p className="mt-3 text-[12px] leading-relaxed text-destructive">
                      {t('entry.noJustification')}
                    </p>
                  )}
                </Section>
              )}

              <Section label={t('entry.provenance')} span={12} note={t('entry.provenanceNote')}>
                <FieldGrid>
                  <Field label={t('entry.journalNo')} figure>
                    {/* NOT NULL on the wire — every entry has one, staged
                        included. */}
                    {String(entry.data.entry_no)}
                  </Field>
                  <Field label={t('entry.source')} figure>
                    {entry.data.source_id === null
                      ? t('entry.notRecorded')
                      : t('entry.idValue', { id: entry.data.source_id })}
                  </Field>
                  <Field label={t('entry.matchedRule')} figure>
                    {entry.data.matched_rule_id === null
                      ? t('entry.none')
                      : t('entry.idValue', { id: entry.data.matched_rule_id })}
                  </Field>
                  <Field label={t('entry.reverses')} figure>
                    {entry.data.reverses_entry_id === null
                      ? t('entry.nothing')
                      : t('entry.idValue', { id: entry.data.reverses_entry_id })}
                  </Field>
                </FieldGrid>
                {/* ── THIS RENDERED NOTHING UNTIL 2026-08-18 ────────────────
                    It was `{en(entry.data.history)}`, because `lib/types.ts`
                    declared `history: Label | null`. The value `resolveEntry`
                    actually writes is an ARRAY: `en()` looks for `.en`, then
                    `.fr`, finds neither, and returns `''`. So the block was
                    truthy, rendered, and drew a blank — every entry resolved
                    through the phase-2 write path would have shown an EMPTY
                    audit trail, with nothing thrown and nothing logged. The type
                    is a union now and `<HistoryTrail>` handles all three shapes
                    the column can hold. */}
                {hasHistory(entry.data.history) && (
                  <div className="mt-3">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      {t('entry.history')}
                    </p>
                    <HistoryTrail history={entry.data.history} />
                  </div>
                )}
              </Section>
            </div>
          </Grid>
        </article>
      )}
    </ScreenFrame>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </dt>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Dt>{label}</Dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  )
}
