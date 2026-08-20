'use client'

// One prospect — the page the whole app points at.
//
// ── TABBED, NOT ONE LONG SCROLL ─────────────────────────────────────────────
// `INSTRUCTIONS.md` UPDATE 3, and the reason is specific: **Communications must
// not compete with the deal journey.** A prospect accumulates dozens of emails
// and three or four stage changes, so on one page the exchange log wins by sheer
// length and the shape of the deal disappears below it. Overview keeps the
// journey, the contacts, the objections and the triangulation together; the
// three ledgers each get their own tab.
//
// ── THE TABS ARE IN THE URL ─────────────────────────────────────────────────
// `?tab=communications`. A tab is a place, and a link somebody sends should open
// where they were.
//
// ── DOCUMENTS IS A FILTERED VIEW, NOT A STORE ───────────────────────────────
// The Documents tab calls the SAME `…/documents` route as the library page with
// `?prospect=<n>`. That is D-8 and the fix `UPDATE-6.md` was written to make: one
// library, filtered — never a parallel per-prospect store that drifts from it.
// The Meetings and Communications tabs do the same with `?prospect=`.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, ExternalLink, Globe, Linkedin, Mail, Phone, Star, Target } from 'lucide-react'
import {
  ChannelChip,
  MeetingTypeChip,
  ObjectionStatusChip,
  ObjectionTypeChip,
  RecordNumber,
  StageChip,
  VocabDot,
} from '@/components/chips'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { AgentOnly, WriteGate } from '@/components/forms'
import {
  AddContactForm,
  AddProspectNoteForm,
  EditContactForm,
  RemoveProspectNoteButton,
  EditObjectionForm,
  EditProspectForm,
  MoveStageForm,
  NextActionForm,
  RaiseObjectionForm,
} from './prospect-forms'
import {
  LogCommunicationForm,
  MeetingForm,
  RemoveCommunicationButton,
} from '@/components/ledgers/ledger-forms'
import { MeetingLink } from '@/components/ledgers/ledger-pages'
import {
  FilePreviewModal,
  PreviewFallback,
  SourceBadge,
  canPreview,
} from '@/components/documents/file-preview'
import { useCanWrite } from '@/lib/ui-mode'
import { usePageTitle } from '@/components/sales-shell'
import {
  useCommunications,
  useContacts,
  useDocuments,
  useMatches,
  useMeetings,
  useObjections,
  useProspect,
  useProspectNotes,
  type Communication,
  type JourneyStep,
} from '@/lib/hooks'
import { dateTimeShort, dayLabel, money, relativeDay } from '@/lib/format'
import {
  commDirectionLabel,
  decisionPowerColor,
  decisionPowerLabel,
  nextActionTypeLabel,
  stageColor,
  stageEntryStatusColor,
  stageLabel,
} from '@/lib/pipeline'

// `research` sits directly after `overview` on purpose: it is what you read
// BEFORE a meeting, and the issue that produced it (#39) was filed by somebody
// who had to walk into one with nothing. The ledger tabs are what you write
// after.
const TABS = ['overview', 'research', 'communications', 'meetings', 'documents'] as const
type Tab = (typeof TABS)[number]

export function ProspectDetail({ ws, n }: { ws: string; n: number }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const raw = params?.get('tab') ?? 'overview'
  const tab: Tab = (TABS as readonly string[]).includes(raw) ? (raw as Tab) : 'overview'

  const prospect = useProspect(ws, n)
  const canWrite = useCanWrite(ws)
  usePageTitle(prospect.data?.name ?? null)

  if (prospect.isPending) return <BlockSkeleton rows={6} />
  if (prospect.error) return <ErrorState error={prospect.error} />

  const p = prospect.data

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* The header: who they are, where the deal is, what it is worth. */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <h2 className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight text-foreground">
            {/* The address, where a human can read it off the screen and say
                it — see `RecordNumber` for why this had to be everywhere. It is
                what `bk sales prospect show` prints on the same line. */}
            <RecordNumber n={p.number} className="text-sm" />
            {p.name}
          </h2>
          <StageChip value={p.stage} />
          {p.labels.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              // The label's own colour, from platform.labels. Falls back to the
              // muted token rather than a hex when a label has none.
              style={l.color ? { backgroundColor: `${l.color}22`, color: l.color } : undefined}
            >
              {l.name}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="tabular-nums text-foreground">{money(p.value, p.currency)}</span>
          {[p.city, p.sector, p.source].filter(Boolean).map((v) => (
            <span key={v}>{v}</span>
          ))}
          {p.address && <span>{p.address}</span>}
          {/*
            The website is a LINK and not a chip, because the whole complaint in
            #34 was that a rep "can't look up their own contact without hunting
            elsewhere" — a url rendered as text is the hunt.

            `rel="noreferrer"` is not decoration on a field a prospect's own
            staff can populate: without it the opened page gets `window.opener`
            and can navigate this tab. The route already refuses any scheme but
            http(s) (`requireHttpUrl`), so `javascript:` cannot reach here; this
            is the second half of the same edge.
          */}
          {p.website && (
            <a
              href={p.website}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Globe size={12} />
              {p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {/* The segment this deal belongs to (#37). A LINK, because the
              reasoning lives on the strategy and copying it here is how it goes
              stale nine times — the whole argument for a separate record. */}
          {p.strategy != null && (
            <Link
              href={`/dashboard/${ws}/strategies?focus=${p.strategy}`}
              className="flex items-center gap-1 text-primary hover:underline"
            >
              <Target size={12} />
              Strategy #{p.strategy}
            </Link>
          )}
          <span>Owner: {p.owner?.name ?? p.owner?.email ?? '—'}</span>
          {/*
            THE BARE URN CHIP IS GONE (2026-08-12).

            It rendered `bc:sales:acme/prospect/11` in a monospace box on the
            header line of every deal, between the sector and the summary. The
            argument for it was that the row is addressable from other apps and
            somebody referencing it needs to copy it — which is true of an
            AGENT, and an agent does not read this page. To the human looking at
            a customer record it is a string of punctuation that reads as debug
            output left switched on, sitting in the most valuable space on the
            page.

            It is not lost: the URN is on the wire (`lib/views.ts`), it is what
            `bk sales prospect show` prints, and it is derivable by anybody who
            knows the workspace slug and the #number, both of which are in the
            URL of this page. Nothing that could resolve it has stopped being
            able to.
          */}
        </div>
        {p.summary && <p className="text-sm leading-relaxed text-foreground">{p.summary}</p>}

        {/*
          THE GAME PLAN SITS ABOVE THE FOLD, NOT IN A TAB (#35)
          ------------------------------------------------------------------
          The issue is about what a rep sees on the way INTO a meeting: "here
          is the situation, here is the angle, here is what to say." A tab is
          somewhere you click when you already know to look; this is the thing
          that has to be in front of you when you did not.

          `whitespace-pre-wrap`, like the research log: talking points are
          written as a list and losing the breaks turns them into a paragraph
          nobody can read live on a call.
        */}
        {p.game_plan && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Game plan
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {p.game_plan}
            </p>
          </div>
        )}

        {/*
          The two write affordances on the deal itself, and they are two buttons
          rather than one form because the routes are two. Moving a deal writes
          a journey step and may close it; `PATCH …/prospects/{n}` refuses
          `stage` outright with a 400 naming the other route, so a single form
          carrying both would be a form that always fails on one field.
        */}
        {/* Both gates on this page carried the DEFAULT note until 2026-08-11,
            so a read-only reader met the identical sentence twice inside 150px
            — the header's and the next-action strip's. Each says what it is
            about instead, which keeps `forms.tsx`'s "both always SAY
            something" rule while saying two different things. */}
        <WriteGate ws={ws} note="The deal and its stage are maintained by the agent.">
          <div className="flex flex-wrap gap-2">
            <EditProspectForm ws={ws} p={p} />
            <MoveStageForm ws={ws} p={p} />
          </div>
        </WriteGate>
      </header>

      {/* What is owed next. Its own strip: it is the single most actionable fact
          on the page and it is the reason the prospect appears in Today.

          The strip renders when there is an action OR when the reader can write
          one. Without the second half, a deal with nothing owed would offer no
          way to say what is — the affordance would be missing exactly where it
          is most needed. */}
      {(p.next_action.type || canWrite) && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Next action
          </p>
          {p.next_action.type ? (
            <>
              <p className="mt-1 text-sm text-foreground">
                {/* The agent's own note wins; the vocabulary LABEL is the
                    fallback. Never the raw wire value — `check_in` is a schema
                    detail. */}
                {p.next_action.note ?? nextActionTypeLabel(p.next_action.type)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {p.next_action.due ? relativeDay(p.next_action.due) : 'no date'}
                {p.next_action.owner && ` · ${p.next_action.owner}`}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Nothing owed.</p>
          )}
          <WriteGate ws={ws} note="What is owed next is set by the agent.">
            <div className="mt-2">
              <NextActionForm ws={ws} p={p} />
            </div>
          </WriteGate>
        </div>
      )}

      <nav className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => {
              const next = new URLSearchParams(params?.toString() ?? '')
              if (t === 'overview') next.delete('tab')
              else next.set('tab', t)
              router.replace(`${pathname}?${next.toString()}`, { scroll: false })
            }}
            aria-current={tab === t ? 'page' : undefined}
            className={
              '-mb-px border-b-2 px-3 py-2 text-sm capitalize transition-colors ' +
              (tab === t
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview ws={ws} n={n} journey={p.journey} />}
      {tab === 'research' && <ResearchTab ws={ws} n={n} />}
      {tab === 'communications' && <CommunicationsTab ws={ws} n={n} />}
      {tab === 'meetings' && <MeetingsTab ws={ws} n={n} />}
      {tab === 'documents' && <DocumentsTab ws={ws} n={n} />}
    </div>
  )
}

/**
 * `action` is where a block's write affordance goes — beside the heading, not
 * under the list, so it is in the same place on every section and it does not
 * move when the list grows. In read-only mode the gate puts the line naming the
 * command there instead, which is why the slot is not conditional on writing.
 */
function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Overview({
  ws,
  n,
  journey,
}: {
  ws: string
  n: number
  journey: JourneyStep[]
}) {
  const contacts = useContacts(ws, n)
  const objections = useObjections(ws, n)
  const matches = useMatches(ws, n)
  const canWrite = useCanWrite(ws)

  return (
    <div className="space-y-6">
      {/*
        THE JOURNEY IS READ-ONLY IN BOTH MODES, and it is not an oversight.
        Moving a deal writes a step; `journey add` records one that did NOT move
        it, which is for backfilling history and for the rungs ahead. That is a
        distinction worth a flag on a command and not worth a form here — and a
        form offering both would be the second, undocumented way to change a
        stage the two routes exist to prevent.
      */}
      <Section
        title="Deal journey"
        action={<AgentOnly what="Journey steps" />}
      >
        {journey.length === 0 ? (
          <EmptyState title="No journey recorded" />
        ) : (
          <ol className="space-y-0">
            {journey.map((s, i) => (
              <li key={`${s.stage}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <VocabDot color={stageEntryStatusColor(s.status)} />
                  {i < journey.length - 1 && <span className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm text-foreground">
                    <span style={{ color: stageColor(s.stage) }}>{stageLabel(s.stage)}</span>
                    {/* `upcoming` rows are placeholders with no date and no
                        actor — the mockup renders the whole ladder including the
                        steps not taken yet, which is what makes it a journey
                        rather than a history. */}
                    {s.occurred_at && (
                      <span className="text-muted-foreground"> · {dayLabel(s.occurred_at.slice(0, 10))}</span>
                    )}
                    {s.actor && <span className="text-muted-foreground"> · {s.actor}</span>}
                  </p>
                  {s.note && <p className="mt-0.5 text-xs text-muted-foreground">{s.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        title="Contacts"
        action={
          <WriteGate ws={ws} note="Contacts are maintained by the agent.">
            <AddContactForm ws={ws} n={n} />
          </WriteGate>
        }
      >
        {contacts.isPending ? (
          <BlockSkeleton rows={2} />
        ) : contacts.error ? (
          <ErrorState error={contacts.error} />
        ) : contacts.data.length === 0 ? (
          <EmptyState title="No contacts recorded" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {contacts.data.map((c, i) => (
              <div
                key={c.id}
                className={'flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ' + (i > 0 ? 'border-t border-border' : '')}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {c.is_primary && (
                    <Star size={13} className="text-primary" aria-label="Primary contact" />
                  )}
                  {c.name}
                </span>
                {c.role && <span className="text-xs text-muted-foreground">{c.role}</span>}
                {/*
                  What this person can DO in the deal (#33). A badge rather than
                  another grey line: `champion` and `economic` are the two a rep
                  scans for, and the difference between them decides whether the
                  next meeting can close anything.
                */}
                {c.decision_power && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: `${decisionPowerColor(c.decision_power)}22`,
                      color: decisionPowerColor(c.decision_power),
                    }}
                  >
                    {decisionPowerLabel(c.decision_power)}
                  </span>
                )}
                {/*
                  #34 is titled "reps can't call, email, or look up their own
                  contact". These were text. `mailto:`/`tel:` is the whole
                  difference between a record of a phone number and a phone
                  number you can ring from the page you are already on.
                */}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    <Mail size={12} />
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <a
                    href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    <Phone size={12} />
                    {c.phone}
                  </a>
                )}
                {c.linkedin && (
                  <a
                    href={c.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
                  >
                    <Linkedin size={12} />
                    Profile
                  </a>
                )}
                {canWrite && (
                  <span className="ml-auto">
                    <EditContactForm ws={ws} n={n} contact={c} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Objections"
        action={
          <WriteGate
            ws={ws}
            note="Objections are recorded by the agent."
          >
            <RaiseObjectionForm ws={ws} n={n} />
          </WriteGate>
        }
      >
        {objections.isPending ? (
          <BlockSkeleton rows={2} />
        ) : objections.error ? (
          <ErrorState error={objections.error} />
        ) : objections.data.length === 0 ? (
          <EmptyState title="Nothing pushed back on yet" />
        ) : (
          <div className="space-y-2">
            {objections.data.map((o) => (
              <div key={o.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ObjectionTypeChip value={o.type} />
                  <ObjectionStatusChip value={o.status} />
                  {o.raised_by && (
                    <span className="text-xs text-muted-foreground">{o.raised_by}</span>
                  )}
                  {canWrite && (
                    <span className="ml-auto">
                      <EditObjectionForm ws={ws} n={n} objection={o} />
                    </span>
                  )}
                </div>
                {/*
                  THREE FIELDS, RENDERED AS THREE. `lib/views.ts` refuses to
                  collapse them into one "notes" and this page must not either:
                  what they SAID, what we think they MEAN, and what we say back is
                  the only structured sales insight in the product.
                */}
                <dl className="mt-2 space-y-1.5 text-sm">
                  {o.spoken && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Said</dt>
                      <dd className="text-foreground">&ldquo;{o.spoken}&rdquo;</dd>
                    </div>
                  )}
                  {o.real_fear && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Real fear</dt>
                      <dd className="text-foreground">{o.real_fear}</dd>
                    </div>
                  )}
                  {o.counter && (
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Our counter</dt>
                      <dd className="text-foreground">{o.counter}</dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/*
        TRIANGULATION — the reason this app exists (§1.2 rule 2).

        Client × Product × Message. **This block DISPLAYS a stored result.** The
        matching ran in the agent and was written with `bk sales match set`;
        `computed_by` says who decided and `computed_at` says when. Nothing here
        ranks, scores or recomputes anything — a component that started sorting
        products by fit in the browser would be the single thing the doctrine
        forbids, and it would look like a feature.
      */}
      <Section
        title="Triangulation — matched products"
        action={<AgentOnly what="Matches" />}
      >
        {matches.isPending ? (
          <BlockSkeleton rows={2} />
        ) : matches.error ? (
          <ErrorState error={matches.error} />
        ) : matches.data.length === 0 ? (
          <EmptyState
            title="No match computed yet"
            hint="Matches are written by the agent — they are never derived here."
          />
        ) : (
          <div className="space-y-2">
            {matches.data.map((m) => (
              <div
                key={`${m.product_number}-${m.template_number ?? 'x'}`}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link
                    href={`/dashboard/${ws}/products?focus=${m.product_number}`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {m.product_name}
                  </Link>
                  {m.template_name && (
                    <Link
                      href={`/dashboard/${ws}/templates?focus=${m.template_number}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      via {m.template_name}
                    </Link>
                  )}
                  {m.fit != null && (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      fit {m.fit}
                    </span>
                  )}
                </div>
                {m.why && <p className="mt-1.5 text-sm text-foreground">{m.why}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  Decided by {m.computed_by ?? 'unknown'}
                  {m.computed_at && ` · ${dayLabel(m.computed_at.slice(0, 10))}`}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/*
        THE "RELATED IN OTHER APPS" SECTION IS GONE (2026-08-10, Phase 3).

        It rendered `platform.links` — the shared cross-app index this app no
        longer writes or reads. Leaving it would have meant a permanently empty
        panel telling the reader to run a command that 404s from this
        deployment, which is worse than the absence: it advertises a capability.

        D-18's requirement stands and is not what was deleted. A relationship has
        to be VISIBLE and not merely storable. What carries it now is the far
        end's URN written into the prospect's own summary or a note — this app's
        data, rendered by this app, and something an agent reading either record
        can act on. If a dedicated field for it is wanted later, it is a sales
        column, not a shared table.
      */}
    </div>
  )
}

function CommunicationsTab({ ws, n }: { ws: string; n: number }) {
  const comms = useCommunications(ws, { prospect: n })
  const gate = (
    <WriteGate ws={ws} note="Exchanges are logged by the agent.">
      <LogCommunicationForm ws={ws} prospect={n} />
    </WriteGate>
  )
  if (comms.isPending) return <BlockSkeleton rows={4} />
  if (comms.error) return <ErrorState error={comms.error} />
  if (comms.data.length === 0)
    return (
      <div className="space-y-3">
        <EmptyState title="No exchanges logged" />
        {gate}
      </div>
    )

  return (
    <div className="space-y-2">
      <div className="flex justify-end">{gate}</div>
      {comms.data.map((c) => (
        <article key={c.number} className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <ChannelChip value={c.channel} />
            {/* The vocabulary's label, not a ternary on the wire value — see
                `COMM_DIRECTIONS` in lib/pipeline.ts. This was the second of the
                two copies. */}
            <span className="text-xs text-muted-foreground">
              {commDirectionLabel(c.direction)}
            </span>
            <span className="text-xs text-muted-foreground">{dateTimeShort(c.occurred_at)}</span>
            {c.contact && <span className="text-xs text-muted-foreground">· {c.contact}</span>}
            {c.logged_by && (
              <span className="ml-auto text-xs text-muted-foreground">by {c.logged_by}</span>
            )}
            <span className={c.logged_by ? '' : 'ml-auto'}>
              <RemoveCommWhenWritable ws={ws} comm={c} />
            </span>
          </div>
          {c.subject && <p className="mt-1.5 text-sm font-medium text-foreground">{c.subject}</p>}
          {c.body && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {c.body}
            </p>
          )}
        </article>
      ))}
    </div>
  )
}

function MeetingsTab({ ws, n }: { ws: string; n: number }) {
  const meetings = useMeetings(ws, { prospect: n })
  const canWrite = useCanWrite(ws)
  const gate = (
    <WriteGate ws={ws} note="Meetings are recorded by the agent.">
      <MeetingForm ws={ws} prospect={n} />
    </WriteGate>
  )
  if (meetings.isPending) return <BlockSkeleton rows={3} />
  if (meetings.error) return <ErrorState error={meetings.error} />
  if (meetings.data.length === 0)
    return (
      <div className="space-y-3">
        <EmptyState title="No meetings recorded" />
        {gate}
      </div>
    )

  return (
    <div className="space-y-2">
      <div className="flex justify-end">{gate}</div>
      {meetings.data.map((m) => (
        <article key={m.number} className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <MeetingTypeChip value={m.type} />
            <span className="text-sm font-medium text-foreground">{m.title}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {dateTimeShort(m.starts_at)}
            </span>
            {canWrite && <MeetingForm ws={ws} meeting={m} />}
          </div>
          {m.attendees.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{m.attendees.join(', ')}</p>
          )}
          {/* The same component the cross-prospect ledger uses, so the two
              views of one meeting cannot render its link differently. */}
          <MeetingLink url={m.meeting_url} />
          {m.agenda && <p className="mt-1.5 text-sm text-foreground">{m.agenda}</p>}
          {/* The outcome is the point of a meetings LEDGER as against a calendar
              (§1.2 rule 4): what was discussed, not when it is. */}
          {m.outcome && (
            <p className="mt-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
              {m.outcome}
            </p>
          )}
        </article>
      ))}
    </div>
  )
}

/**
 * A per-row bin button that renders nothing at all in read-only mode.
 *
 * `WriteGate` is the wrong component INSIDE a row: it would put "editing is
 * hidden" beside every line. The note belongs once, at the top of the block; a
 * row just has no button.
 */
function RemoveCommWhenWritable({ ws, comm }: { ws: string; comm: Communication }) {
  const canWrite = useCanWrite(ws)
  if (!canWrite) return null
  return <RemoveCommunicationButton ws={ws} comm={comm} />
}

/**
 * The research log (#39) — append-only, newest first.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO EDIT AFFORDANCE, AND ITS ABSENCE IS THE FEATURE
 * ---------------------------------------------------------------------------
 * Every other block on this page has a pencil. This one does not, because the
 * whole reason the tab exists is that `summary` — which does have one — was the
 * only place to write research, and editing it destroyed what was there before.
 * A pencil here would rebuild the bug in a nicer shape.
 *
 * Remove IS offered, for a note pasted onto the wrong prospect, and it goes
 * through `useConfirm()` because the delete is hard: this table has no
 * `deleted_at`, so there is no bin behind it.
 */
function ResearchTab({ ws, n }: { ws: string; n: number }) {
  const notes = useProspectNotes(ws, n)
  const canWrite = useCanWrite(ws)

  return (
    <div className="space-y-3">
      <Section
        title="Research & intelligence"
        action={
          <WriteGate ws={ws} note="The research log is written by the agent.">
            <AddProspectNoteForm ws={ws} n={n} />
          </WriteGate>
        }
      >
        <p className="mb-2 px-1 text-xs text-muted-foreground">
          Append-only. A note is never overwritten, so this reads as what was
          known and when — unlike the summary above, which states the current
          position and replaces itself.
        </p>
        {notes.isPending ? (
          <BlockSkeleton rows={3} />
        ) : notes.error ? (
          <ErrorState error={notes.error} />
        ) : notes.data.length === 0 ? (
          <EmptyState
            title="Nothing researched yet"
            hint="Site audits, competitor notes, personnel details, timing signals — anything you would otherwise have to overwrite the summary to record."
          />
        ) : (
          <ol className="space-y-2">
            {notes.data.map((note) => (
              <li
                key={note.id}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {note.kind && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                      {note.kind}
                    </span>
                  )}
                  <span>{dateTimeShort(note.created_at)}</span>
                  {/* WHO observed it. Most of these are agent-written and the
                      page says so — a log you cannot attribute is one you
                      cannot weigh. */}
                  {note.author && <span>· {note.author}</span>}
                  {canWrite && (
                    <span className="ml-auto">
                      <RemoveProspectNoteButton ws={ws} n={n} note={note} />
                    </span>
                  )}
                </div>
                {/* `whitespace-pre-wrap`: a site audit is written with line
                    breaks and losing them turns a list of findings into one
                    paragraph. */}
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {note.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

function DocumentsTab({ ws, n }: { ws: string; n: number }) {
  const docs = useDocuments(ws, { prospect: n })
  if (docs.isPending) return <BlockSkeleton rows={3} />
  if (docs.error) return <ErrorState error={docs.error} />
  if (docs.data.length === 0) {
    return (
      <EmptyState
        title="No documents linked"
        hint="Documents live in one shared library and are linked to a prospect — this tab is a filtered view of it, not a separate store."
      />
    )
  }

  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-muted-foreground">
        A filtered view of the{' '}
        <Link href={`/dashboard/${ws}/documents`} className="underline">
          document library
        </Link>
        , not a separate store.
      </p>
      {/* Read-only in BOTH modes: a document's location is not patchable (a
          CHECK requires exactly one of upload_url/external_url, and swapping
          one for the other silently changes whether the blob-delete gate can
          see it), and nobody independently learns the library changed. */}
      <AgentOnly what="Documents" />
      <DocumentList docs={docs.data} />
    </div>
  )
}

/** Shared by this tab and the library page, so the two cannot render differently. */
/**
 * One row of the library: what it is, whose it is, and a preview on demand.
 *
 * THUMBNAIL BY DEFAULT, PLAYER ON REQUEST. #40 asks for "thumbnail/player", and
 * the split is not just taste: a thumbnail is one `<img>`, while a player is an
 * iframe to a third party. Ten of those on one page is ten round trips to
 * Google before the page settles, for previews nobody asked to watch.
 *
 * The row is a `<div>` rather than the `<a>` it used to be, because an anchor
 * may not contain a button or an iframe — nesting interactive content inside a
 * link is invalid and browsers resolve it unpredictably.
 */
function DocumentRow({
  doc,
  first,
  focused,
}: {
  doc: import('@/lib/hooks').SalesDocument
  first: boolean
  focused: boolean
}) {
  // The scroll ref is OWNED HERE, not passed in — this file's `DocumentList`
  // header already records why: threading a ref across a component boundary
  // hits two copies of `@types/react` disagreeing about `Ref`, and it does not
  // compile. The row knows whether it is the focused one.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])
  const [open, setOpen] = useState(false)
  // A thumbnail the browser refuses — see the render below. Falling back to the
  // icon is the whole point; a broken-image glyph in a customer record is worse
  // than no picture at all.
  const [thumbFailed, setThumbFailed] = useState(false)
  const f = doc.file
  const hasPlayer = canPreview(doc)

  return (
    <div
      ref={ref}
      className={
        'px-4 py-3 ' +
        (first ? '' : 'border-t border-border') +
        (focused ? ' bg-accent ring-1 ring-inset ring-primary' : '')
      }
    >
      <div className="flex items-center gap-3">
        <RecordNumber n={doc.number} />
        {/* The thumbnail IS the recognisability #40 is about: a video that
            looks like a video before you click anything. */}
        {/*
          Gated on the same rule as the player: a thumbnail we are not allowed
          to fetch would render as a broken-image glyph.

          `onError` hides it entirely rather than leaving the glyph, and it is
          NOT belt-and-braces — it fires for real. A Google thumbnail is refused
          by Opaque Response Blocking on an INSECURE origin, so this is exactly
          what every developer sees on `http://localhost` while production
          renders it fine. Without the fallback, local dev looks broken and
          somebody "fixes" a thing that works — which is what happened once.
        */}
        {f.thumbnail_url && !thumbFailed && (f.internal || f.preview_status === 'public') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={f.thumbnail_url}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="h-9 w-14 shrink-0 rounded border border-border object-cover"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{doc.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[doc.kind, doc.added_by ? `added by ${doc.added_by}` : null, ...doc.tags]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <SourceBadge doc={doc} />
        {hasPlayer && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent"
          >
            Preview
          </button>
        )}
        <a
          href={f.open_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Open ${doc.title}`}
        >
          <ArrowUpRight size={14} />
        </a>
      </div>
      {/* The only thing that still renders INLINE: "this cannot be previewed,
          and here is why". A reader needs that in the row; a preview does not
          belong there and now opens full screen. */}
      {!hasPlayer && (f.preview_status === 'restricted' || f.preview_status === 'unknown') && (
        <div className="mt-2">
          <PreviewFallback doc={doc} />
        </div>
      )}
      {open && <FilePreviewModal doc={doc} onClose={() => setOpen(false)} />}
    </div>
  )
}

export function DocumentList({
  docs,
  focus = null,
}: {
  docs: import('@/lib/hooks').SalesDocument[]
  /**
   * The #number to highlight and scroll to, from `?focus=` — how a cross-app
   * link and ⌘K both arrive at a document, which has no page of its own.
   * Optional because the prospect Documents tab has nothing to focus.
   *
   * The scroll ref lives on the ROW (`DocumentRow`), not here: threading one
   * across a component boundary hits two copies of `@types/react` disagreeing
   * about `Ref` and does not compile. The row knows whether it is focused.
   */
  focus?: number | null
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {docs.map((d, i) => (
        <DocumentRow key={d.number} doc={d} first={i === 0} focused={d.number === focus} />
      ))}
    </div>
  )
}
