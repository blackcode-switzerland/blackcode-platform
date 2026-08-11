'use client'

// The workspace feed — `platform.events` filtered to this app (§8.1 of the plan).
//
// ── THERE IS NO `sales.activity` TABLE, AND THAT IS D-6 ─────────────────────
// Every row here was written by `recordEvent` inside the transaction that made
// the change it describes. A second history maintained beside the first is a
// second thing that can disagree with it, and the disagreement is silent.
//
// ── THE FEED IS FILTERED TO `app=sales`, AND THAT IS D-9's SHAPE AGAIN ──────
// `platform.events` holds every app's rows for a workspace. Reading ACROSS apps
// is `bk activity`'s job and it tags every row with the app it came from; this
// page cannot show that tag — it has no vocabulary, no colour and no URL for an
// `issue` — so it must not show those rows. The two layers stay visible in the
// product, not just in the guide.
//
// ── IT DESCRIBES; IT DOES NOT ACT ───────────────────────────────────────────
// No undo, no revert, no "restore" button. The bin has a page of its own and its
// restore is `bk sales trash restore` (§7.5). An event is history, and history
// is not a control surface.

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { BlockSkeleton, EmptyState, ErrorState } from '@/components/states'
import { useActivity, type ActivityEvent } from '@/lib/hooks'
import { recordHref } from '@/lib/record-href'
import { dateTimeShort } from '@/lib/format'

// ---------------------------------------------------------------------------
// Rendering an event
// ---------------------------------------------------------------------------

/**
 * A wire value as a human reads it: `next_action_changed` → "changed the next
 * action".
 *
 * **Unknown values fall through to the wire value with its underscores
 * loosened, never to "—" and never to nothing.** The vocabulary is served live
 * by `bk meta` and this app gains actions without a deploy, so a feed that hid
 * what it did not recognise would quietly stop showing the newest thing that
 * happened — which is the one row anybody came here for.
 */
const ACTION_PHRASE: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  deleted: 'binned',
  restored: 'restored',
  purged: 'permanently deleted',
  stage_changed: 'moved',
  assigned: 'assigned',
  unassigned: 'unassigned',
  next_action_changed: 'changed the next action on',
  labeled: 'labelled',
  unlabeled: 'unlabelled',
  member_added: 'added a member to',
  member_removed: 'removed a member from',
  member_role_changed: 'changed a role in',
  invitation_sent: 'invited someone to',
  invitation_revoked: 'revoked an invitation to',
  app_enabled: 'enabled an app on',
  app_disabled: 'disabled an app on',
  app_access_granted: 'granted app access in',
  app_access_revoked: 'revoked app access in',
}

const TYPE_NOUN: Record<string, string> = {
  prospect: 'prospect',
  contact: 'contact',
  stage_entry: 'journey step',
  meeting: 'meeting',
  communication: 'communication',
  objection: 'objection',
  product: 'product',
  template: 'template',
  document: 'document',
  match: 'match',
  label: 'label',
  workspace: 'workspace',
  workspace_member: 'membership',
  workspace_app: 'app',
  invitation: 'invitation',
}

const humanise = (v: string) => v.replace(/_/g, ' ')
const actionPhrase = (a: string) => ACTION_PHRASE[a] ?? humanise(a)
const typeNoun = (t: string) => TYPE_NOUN[t] ?? humanise(t)

/**
 * Who did it.
 *
 * `actor_token_id` with no user is the agent acting under its own token — the
 * "by Andrea / by Companion" attribution §3.4 validated, and the reason this
 * app populates a column issues leaves null. An event with neither is the
 * system, which is honest: some rows are written by a schedule.
 */
function actorLabel(e: ActivityEvent): string {
  if (e.actor_name) return e.actor_name
  if (e.actor_email) return e.actor_email
  if (e.actor_token_id != null) return 'an agent token'
  return 'the system'
}

/** `#12` when the row has a workspace number, and nothing when it does not. */
function subjectLabel(e: ActivityEvent): string {
  const noun = typeNoun(e.entity_type)
  // `entity_id` is the #number for this app's projected types (the route swaps
  // it) and null when the source row was purged. For the four child types it is
  // still a row id, which is their only address — but it is not an address a
  // READER has any use for, so it is not printed.
  const numbered = NUMBERED.has(e.entity_type)
  if (!numbered) return noun
  return e.entity_id == null ? `${noun} (deleted)` : `${noun} #${e.entity_id}`
}

/** The types whose `entity_id` the route replaced with a #number. */
const NUMBERED = new Set([
  'prospect',
  'meeting',
  'communication',
  'product',
  'template',
  'document',
])

// ---------------------------------------------------------------------------

function useParam(key: string) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const set = (v: string) => {
    const next = new URLSearchParams(params?.toString() ?? '')
    if (v) next.set(key, v)
    else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }
  return [params?.get(key) ?? '', set] as const
}

export function ActivityPage({ ws }: { ws: string }) {
  const [entityType, setEntityType] = useParam('entity_type')
  const [action, setAction] = useParam('action')

  const filtered = entityType !== '' || action !== ''

  // TWO QUERIES, and with no filter set they are ONE — same key, one request,
  // one cache entry. The unfiltered feed is what the dropdowns are built from.
  const all = useActivity(ws, {})
  const feed = useActivity(ws, {
    entity_type: entityType || undefined,
    action: action || undefined,
  })
  const rows = feed.data?.data ?? []

  // The options are built from WHAT THE FEED CONTAINS, not from a hand-written
  // list. Two reasons, and the second is the load-bearing one:
  //
  //   1. The vocabularies are `lib/db/queries/events.ts`'s and they grow. A
  //      select built from a copy here would stop offering the newest action,
  //      quietly, and D-38 is the record of what a hand-written vocabulary in a
  //      second place costs.
  //   2. `GET …/activity` DROPS an unrecognised `?action=` rather than rejecting
  //      it. So a stale option in this dropdown would not error — it would
  //      return the WHOLE feed and look like it had worked, which is the same
  //      failure that let issues' `app_*` actions go unfiltered for months.
  //
  // Built from the UNFILTERED feed rather than the current one, so choosing a
  // filter cannot remove the options you would use to change it.
  const options = useMemo(() => {
    const types = new Set<string>()
    const actions = new Set<string>()
    for (const e of all.data?.data ?? []) {
      types.add(e.entity_type)
      actions.add(e.action)
    }
    // A value that is filtered ON but absent from the sample must still appear,
    // or the select would render blank and read as "no filter" while one is
    // applied — a URL somebody shared showing a different page than they saw.
    if (entityType) types.add(entityType)
    if (action) actions.add(action)
    return { types: [...types].sort(), actions: [...actions].sort() }
  }, [all.data, entityType, action])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={entityType}
          onChange={setEntityType}
          allLabel="Everything"
          options={options.types}
          render={typeNoun}
        />
        <Select
          value={action}
          onChange={setAction}
          allLabel="Any change"
          options={options.actions}
          render={actionPhrase}
        />
        {filtered && (
          <button
            onClick={() => {
              setEntityType('')
              setAction('')
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>

      {feed.isPending ? (
        <BlockSkeleton rows={6} />
      ) : feed.error ? (
        <ErrorState error={feed.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nothing matches that filter' : 'No activity yet'}
          hint={
            filtered
              ? 'Clear the filter to see the whole feed.'
              : 'Every change the agent makes through `bk sales` is recorded here, in the same transaction as the change itself.'
          }
        />
      ) : (
        <ol className="space-y-1">
          {rows.map((e) => (
            <EventRow key={e.id} ws={ws} event={e} />
          ))}
        </ol>
      )}

      {feed.data?.next_cursor != null && (
        // Said, not paged over. A feed that quietly stops at 100 rows looks like
        // a workspace with 100 events. Paging is `bk sales activity --cursor`,
        // which is the surface an agent walking history should be using anyway.
        //
        // This named `bk activity --app sales` until 2026-08-11, which was wrong
        // twice over after Phase 4: the verb moved behind the app name, and
        // `--app` was removed in the same release — it selected among the apps
        // writing one shared feed, and each app keeps its own now.
        <p className="text-xs text-muted-foreground">
          Showing the most recent 100 events. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5">bk sales activity</code> to page through
          the rest.
        </p>
      )}
    </div>
  )
}

function EventRow({ ws, event }: { ws: string; event: ActivityEvent }) {
  const href = NUMBERED.has(event.entity_type)
    ? recordHref(ws, { type: event.entity_type, number: event.entity_id })
    : null
  const subject = subjectLabel(event)

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-lg px-3 py-2 text-sm hover:bg-accent/40">
      <span className="font-medium text-foreground">{actorLabel(event)}</span>
      <span className="text-muted-foreground">{actionPhrase(event.action)}</span>
      {href ? (
        <Link href={href} className="text-foreground hover:underline">
          {subject}
        </Link>
      ) : (
        <span className="text-foreground">{subject}</span>
      )}
      {typeof (event.meta as { title?: string } | null)?.title === 'string' && (
        <span className="text-muted-foreground">
          — {(event.meta as { title?: string }).title}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {dateTimeShort(String(event.occurred_at))}
      </span>
    </li>
  )
}

function Select({
  value,
  onChange,
  options,
  allLabel,
  render,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  allLabel: string
  render: (v: string) => string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm capitalize outline-none focus:border-ring"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
  )
}
