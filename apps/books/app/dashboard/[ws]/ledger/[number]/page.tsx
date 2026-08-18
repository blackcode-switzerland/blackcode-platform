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

  return (
    <ScreenFrame title="Transaction">
      <Link
        href={scopedHref(base, '/ledger', scope)}
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} />
        Grand livre
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

      {entry.data && (
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

            <p className="mt-1 text-sm text-muted-foreground">
              <DateText value={entry.data.date} />
              {' · '}
              {scope.record?.name ?? '—'}
              {' · exercice '}
              {scope.exercice ?? '—'}
              {entry.data.counterparty && <> · {entry.data.counterparty}</>}
            </p>
          </header>

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
