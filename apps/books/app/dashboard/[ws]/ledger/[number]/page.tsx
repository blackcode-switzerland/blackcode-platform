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
import { en } from '@/lib/label'
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
import type { PostResult } from '@/lib/mutations'

export default function Page() {
  const params = useParams<{ ws: string; number: string }>()
  const scope = useScope()
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

  return (
    <ScreenFrame title="Transaction">
      <Link
        href={scopedHref(base, '/ledger', scope)}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        {/* Names the journal it goes back to, not the one this app has more of.
            "Grand livre" over a simplified book is the same mislabel the ledger's
            own header carried until 2026-08-19. */}
        {scope.journal === 'recettes_depenses' ? 'Recettes et dépenses' : 'Grand livre'}
      </Link>

      {number === null && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5" role="alert">
          <p className="text-sm font-medium text-foreground">
            <span className="font-mono">{params.number}</span> is not an entry number.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            An entry is addressed by its #number — a positive integer. The general ledger lists
            them.
          </p>
        </div>
      )}

      {entry.isLoading && <Loading rows={6} label="Loading the entry" />}
      {entry.error && <ErrorState error={entry.error} title="This entry could not be loaded" />}

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
            {scope.record?.name ?? 'This book'} keeps no écritures.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Movement #{number} is a recette or a dépense under art. 957 al. 2 CO — one amount and a
            direction, with no debit, no credit and no posting step. There is no detail screen for
            one yet; the journal shows every field it has.
          </p>
          <Link
            href={scopedHref(base, '/ledger', scope)}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary-strong hover:underline"
          >
            Back to receipts and expenses
          </Link>
        </section>
      )}

      {entry.data && scope.journal !== 'recettes_depenses' && (
        <article data-entry={entry.data.number}>
          <header className="border-b border-border pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <VocabChip vocabulary="entry_status" value={entry.data.status} />
              <VocabChip vocabulary="recognition" value={entry.data.recognition} />
              <VocabChip vocabulary="evidence_tiers" value={entry.data.evidence_tier} withNote />
              <span className="ml-auto font-mono text-[12px] text-muted-foreground">
                #{entry.data.number}
              </span>
            </div>

            {/* The bank's words, verbatim, at full size. */}
            <h1 className="mt-2 text-lg font-semibold text-foreground">{entry.data.raw_label}</h1>

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
            <p className="mt-1 text-sm text-muted-foreground">
              <DateText value={entry.data.date} />
              {entry.data.counterparty && <> · {entry.data.counterparty}</>}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              An entry is addressed by its workspace #number, so the book and fiscal year
              selectors above do not filter this screen and it does not name a book — this
              record does not carry one.
            </p>
          </header>

          {/* ── THE COMPLIANCE VERDICT, ON EVERY ENTRY INCLUDING THE ONES
              NOBODY HAS CHECKED ────────────────────────────────────────────
              Rendered unconditionally, which is the opposite of how every other
              optional block on this page works — and it is why `<VerdictPanel>`
              exists. `verdict: null` means NEVER CHECKED, not clean, and a
              section that simply disappeared for a null would let the absence
              read as an accepted verdict. `lib/verdict.ts` holds the four states
              where a test can reach them.

              It sits ABOVE Posting deliberately: a blocked verdict is what stops
              the write below it, and a reader has to meet the reason before the
              button. */}
          <section className="mt-4">
            <H2>Compliance</H2>
            <div className="mt-1.5">
              <VerdictPanel verdict={entry.data.verdict} base={base} scope={scope} />
            </div>
          </section>

          {/* ── THE POSTING TRANSITION ────────────────────────────────────
              Rendered only for a STAGED entry, and gone the moment it is
              posted — there is nothing to offer on a posted one, and a disabled
              button would invite somebody to wonder what is wrong with it. The
              status chip in the header already says which it is.

              `status === 'staged'` is POSITIVE. `!== 'posted'` would render this
              on any third status added server-side, which is a write affordance
              nobody wrote, on the one write that cannot be undone. */}
          {entry.data.status === 'staged' && (
            <section className="mt-4">
              <H2>Posting</H2>
              <p className="mt-1 text-sm text-muted-foreground">
                This entry is staged. It is recorded and it counts in nothing: the balance sheet
                and the income statement both derive from posted entries only.
              </p>
              {/* ── THE FORM IS STILL OFFERED ON A BLOCKED ENTRY ─────────
                  The refusal is the SERVER'S — `postEntry` raises
                  `verdict_blocked` with the pass's own `resolves` text as the
                  suggestion — and hiding the form would replace that sentence
                  with this app's guess at it. What the reader gets instead is
                  the verdict above the button and the route's own words after
                  it, which is the same arrangement `<PostEntryForm>` uses for
                  migration 0004's guard: the last word belongs to whoever
                  actually refuses. */}
              {blocksPosting(entry.data.verdict) && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  A compliance pass has blocked this entry, so posting it will be refused. The
                  refusal is the server&apos;s and it carries the pass&apos;s own way out — the
                  panel above has it too.
                </p>
              )}
              {posted ? (
                <PostedNotice result={posted} />
              ) : (
                <PostEntryForm ws={params.ws} entry={entry.data} onPosted={setPosted} />
              )}
            </section>
          )}

          {/* A post made in this session, still shown after the entry refetched
              as `posted` — because `already` lives only in the response. */}
          {entry.data.status === 'posted' && posted && (
            <section className="mt-4">
              <H2>Posting</H2>
              <PostedNotice result={posted} />
            </section>
          )}

          {entry.data.explanation ? (
            <section className="mt-4">
              <H2>What this is</H2>
              <p className="mt-1 text-sm text-foreground">{en(entry.data.explanation)}</p>
            </section>
          ) : (
            <section className="mt-4">
              <H2>What this is</H2>
              {/* Not an em dash. An entry nobody has explained is the product's
                  central object of work, and saying so is more useful than a
                  blank that reads as a rendering gap. */}
              <p className="mt-1 text-sm text-muted-foreground">
                Nobody has said yet what this entry means. That is what the Recognition screen is
                for.
              </p>
            </section>
          )}

          <section className="mt-5">
            <H2>The écriture</H2>
            <div className="mt-1.5">
              <EntryLines lines={entry.data.lines} base={base} scope={scope} detailed />
            </div>
          </section>

          {/* ── THE ORIGINAL CURRENCY, WHICH NOTHING RENDERED UNTIL 2026-08-18 ──
              `fx` arrived with migration 0011, is in `publicEntry`, is declared
              in `lib/types.ts` as **"display-only"** — and no screen displayed
              it. A field whose entire purpose is to be shown, and which was not
              shown, is the third bug class this phase's sweep was looking for:
              the amounts on this page are CHF and correct, and a reader could
              not tell that a CHF 43.70 line was USD 49.00 at the issuer's rate.

              Rendered only when the entry has one, and field by field, because
              the writer may omit any of the three — an em dash for a missing
              `rate` would claim a rate was recorded and lost. Nothing computes
              with these: they are free-text strings from the issuer, and
              `lib/format.ts` never sees them.

              No seeded entry carries `fx`, so this was verified by writing one
              into `books.entry` #4 by hand and opening the page. */}
          {entry.data.fx && (entry.data.fx.original || entry.data.fx.rate || entry.data.fx.source) && (
            <section className="mt-5">
              <H2>Original currency</H2>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
                {entry.data.fx.original && <Fact label="Original amount" value={entry.data.fx.original} />}
                {entry.data.fx.rate && <Fact label="Rate" value={entry.data.fx.rate} />}
                {entry.data.fx.source && <Fact label="Rate source" value={entry.data.fx.source} />}
              </dl>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                Recorded as the issuer stated it. The écriture above is in CHF and is what the
                books hold; nothing here is used to derive a figure.
              </p>
            </section>
          )}

          <section className="mt-5">
            <H2>VAT</H2>
            {/* `tva` is ALWAYS an object on the wire; its FIELDS are what can be
                null. A `rate` of null means no rate was recorded and renders an
                em dash, which is not the same claim as 0%. */}
            <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
              <Fact label="Rate" value={percent(entry.data.tva.rate)} />
              <div>
                <Dt>Amount</Dt>
                <dd className="num text-foreground">
                  <Money value={entry.data.tva.amount} bare />
                </dd>
              </div>
              <Fact
                label="Input claimed"
                value={entry.data.tva.input_claimed ? 'Yes' : 'No'}
              />
            </dl>
            {entry.data.tva.note && (
              <p className="mt-1.5 text-[12px] text-muted-foreground">{en(entry.data.tva.note)}</p>
            )}
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Independent of the evidence tier, always. A bank record can support a profit-tax
              deduction (LIFD art. 58) and never an input VAT claim (LTVA art. 26).
            </p>
          </section>

          <section className="mt-5">
            <H2>Supporting document</H2>
            <div className="mt-1.5">
              <DriveLink piece={entry.data.piece} withCaptured />
            </div>
            {entry.data.evidence_note && (
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {en(entry.data.evidence_note)}
              </p>
            )}
          </section>

          {entry.data.related_party && (
            <section className="mt-5">
              <H2>Related party — art. 959a al. 4 CO</H2>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
                <Fact label="Counterpart" value={entry.data.related_party.counterpart} />
                <Fact label="Kind" value={entry.data.related_party.kind} />
                <Fact
                  label="Mirror entry"
                  // A serial id, not a #number — the field name says so and this
                  // app has no route that resolves one. Shown, never linked.
                  value={
                    entry.data.related_party.mirror_entry_id === null
                      ? 'Not recorded'
                      : `id ${entry.data.related_party.mirror_entry_id}`
                  }
                />
              </dl>
              {entry.data.related_party.justification ? (
                <p className="mt-1.5 text-[12px] text-foreground">
                  {en(entry.data.related_party.justification)}
                </p>
              ) : (
                <p className="mt-1.5 text-[12px] text-destructive">
                  No arm&apos;s-length justification is recorded. That absence is the audit risk.
                </p>
              )}
            </section>
          )}

          <section className="mt-5 border-t border-border pt-3">
            <H2>Provenance</H2>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-4">
              <Fact
                label="Journal n°"
                // NOT NULL on the wire — every entry has one, staged included.
                value={String(entry.data.entry_no)}
              />
              <Fact
                label="Source"
                value={entry.data.source_id === null ? 'Not recorded' : `id ${entry.data.source_id}`}
              />
              <Fact
                label="Matched rule"
                value={
                  entry.data.matched_rule_id === null
                    ? 'None'
                    : `id ${entry.data.matched_rule_id}`
                }
              />
              <Fact
                label="Reverses"
                value={
                  entry.data.reverses_entry_id === null
                    ? 'Nothing'
                    : `id ${entry.data.reverses_entry_id}`
                }
              />
            </dl>
            {/* ── THIS RENDERED NOTHING UNTIL 2026-08-18 ──────────────────
                It was `{en(entry.data.history)}`, because `lib/types.ts`
                declared `history: Label | null`. The value `resolveEntry`
                actually writes is an ARRAY: `en()` looks for `.en`, then `.fr`,
                finds neither, and returns `''`. So the block was truthy,
                rendered, and drew a blank — every entry resolved through the
                phase-2 write path would have shown an EMPTY audit trail, with
                nothing thrown and nothing logged. The type is a union now and
                `<HistoryTrail>` handles all three shapes the column can hold. */}
            {hasHistory(entry.data.history) && (
              <div className="mt-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  History
                </p>
                <HistoryTrail history={entry.data.history} />
              </div>
            )}
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Source, rule, mirror and reversal are internal ids and are not addressable from this
              app. The journal n° is the statutory one, gapless within the book and the year — it is
              not the #number in the header, and the two are not interchangeable.
            </p>
          </section>
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
