// The public shape of each entity — what a route serves and what `bk` parses.
//
// It lives in one file rather than beside each route because two routes serve
// the same entity (`…/prospects` and `…/prospects/{n}`), and a shape defined
// twice is a shape that drifts once. The scaffold puts its `publicNote` in the
// route file; that works with one route per entity and stops working at two.
//
// ---------------------------------------------------------------------------
// THREE RULES, ALL INHERITED
// ---------------------------------------------------------------------------
// 1. **`number`, never `id`.** The workspace #number is the address. Once a
//    serial id reaches an agent it ends up in a script, and then it is a
//    contract nobody agreed to.
//
// 2. **The wire stays bare** (D-29). No app-qualified values, no `sales:`
//    prefixes on a type: the route is already scoped to one app by its path, so
//    the segment adds nothing a caller could act on.
//
// 3. **No rendering.** `value` goes out as the raw numeric string and `CHF` as a
//    separate field; `next_action.due` is an ISO date and `due_label` is the
//    phrase the agent wrote. Swiss formatting (`CHF 105'000`) and "2 days ago"
//    are things the WEB does with these — §5.1: a relative string is a
//    rendering, never storage, and by the same argument never a wire format.

import type { ProspectLabel, ProspectRow } from './db/queries/prospects'
import { describeFile } from '@blackcode/platform-file-providers'
import { entityUrnOrNull } from './entity-address'
import { APP_SLUG } from './app'

export interface PublicProspect {
  number: number
  name: string
  city: string | null
  sector: string | null
  /** Migration 0008 — the identity card (#34). */
  website: string | null
  address: string | null
  /** Migration 0010. The reusable segment (#37), by #number, and the angle for
   *  THIS prospect on top of it (#35). */
  strategy: number | null
  game_plan: string | null
  stage: string
  value: string | null
  currency: string
  owner: { id: number; name: string | null; email: string } | null
  source: string | null
  summary: string | null
  next_action: {
    type: string | null
    due: string | null
    due_label: string | null
    note: string | null
    owner: string | null
  }
  closed_at: string | null
  closed_reason: string | null
  labels: ProspectLabel[]
  /** `bc:sales:{ws}/prospect/{n}` — how another app addresses this row. */
  urn: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function publicProspect(row: ProspectRow, workspaceSlug: string): PublicProspect {
  return {
    number: row.seq,
    name: row.name,
    city: row.city,
    sector: row.sector,
    website: row.website,
    address: row.address,
    // The strategy's #number, never its row id — `lib/views.ts`'s first rule.
    // Resolved by the caller, which has it: `getProspectBySeq` joins it in.
    strategy: row.strategy_seq ?? null,
    game_plan: row.game_plan,
    stage: row.stage,
    value: row.value,
    currency: row.currency,
    owner:
      row.owner && row.owner.id != null && row.owner.email != null
        ? { id: row.owner.id, name: row.owner.name, email: row.owner.email }
        : null,
    source: row.source,
    summary: row.summary,
    next_action: {
      type: row.next_action_type,
      // `next_action_due` is a Postgres `date`, which the driver hands back as
      // 'YYYY-MM-DD'. Left exactly as it is: turning it into a Date here would
      // make it a timestamp at midnight UTC, and a due date is not an instant.
      due: row.next_action_due,
      due_label: row.next_action_due_label,
      note: row.next_action_note,
      owner: row.next_action_owner_label,
    },
    closed_at: iso(row.closed_at),
    closed_reason: row.closed_reason,
    labels: row.labels,
    urn: entityUrnOrNull(workspaceSlug, 'prospect', row.seq),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
    deleted_at: iso(row.deleted_at),
  }
}

// THE CROSS-APP LINK SHAPE IS GONE (2026-08-10, Phase 3). It projected a
// `platform.links` row, and this app neither writes nor reads that index any
// more — `bk link` is retiring and the prospect route stopped serving `links`.
// D-18's requirement, that a relationship be visible rather than merely stored,
// is met by the far end's URN in the prospect's own text.

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

// ---------------------------------------------------------------------------
// The children of a prospect — no #number, so no `number` field and no URN
// ---------------------------------------------------------------------------
// `id` here is a row id, and that is the correct address for a row with no
// independent identity: `lib/db/queries/prospect-children.ts` states the rule
// once, and `apps/issues` addresses comments the same way. The absence of `urn`
// is the visible half — a caller can tell from the shape that there is no
// cross-app address to be had.

export function publicContact(c: {
  id: number
  name: string
  role: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  notes: string | null
  /** Migration 0008 — sales #34 and #33. */
  linkedin: string | null
  decision_power: string | null
}) {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    phone: c.phone,
    linkedin: c.linkedin,
    // What this person can DO in the deal (#33's structured half). The
    // freeform half is `notes`, which predates the issue.
    decision_power: c.decision_power,
    is_primary: c.is_primary,
    notes: c.notes,
  }
}

/**
 * One research-log entry (#39).
 *
 * `id` rather than `number`, for `publicContact`'s reason directly above: a
 * note is never addressed on its own, so a #number would advertise an identity
 * `bk` cannot resolve. There is no `updated_at` because there is no update —
 * see `schema.ts` at `prospectNotes`.
 */
/** One segment strategy (#37) — reusable reasoning, addressable by #number. */
export function publicStrategy(
  s: {
    seq: number
    name: string
    vertical: string | null
    area: string | null
    rationale: string | null
    case_studies: string | null
    products: Array<{ number: number; name: string }>
    prospect_count: number
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  return {
    number: s.seq,
    name: s.name,
    vertical: s.vertical,
    area: s.area,
    rationale: s.rationale,
    case_studies: s.case_studies,
    products: s.products,
    // How many live deals this segment covers. Served rather than derivable,
    // because the one moment somebody needs it is before retiring a strategy —
    // and at that moment they are looking at this record, not at the prospects.
    prospect_count: s.prospect_count,
    urn: entityUrnOrNull(workspaceSlug, 'strategy', s.seq),
    created_at: iso(s.created_at)!,
    updated_at: iso(s.updated_at)!,
    deleted_at: iso(s.deleted_at),
  }
}

export function publicProspectNote(n: {
  id: number
  body: string
  kind: string | null
  author_label: string | null
  created_at: Date
}) {
  return {
    id: n.id,
    body: n.body,
    kind: n.kind,
    // WHO observed it. A research log you cannot attribute is one you cannot
    // weigh, and most of these are written by an agent.
    author: n.author_label,
    created_at: iso(n.created_at)!,
  }
}

export function publicJourneyStep(s: {
  id: number
  stage: string
  status: string
  occurred_at: Date | null
  actor_label: string | null
  note: string | null
}) {
  return {
    id: s.id,
    stage: s.stage,
    status: s.status,
    occurred_at: iso(s.occurred_at),
    actor: s.actor_label,
    note: s.note,
  }
}

export function publicObjection(o: {
  id: number
  type: string
  raised_by: string | null
  raised_at: Date | null
  status: string
  spoken: string | null
  real_fear: string | null
  counter: string | null
}) {
  return {
    id: o.id,
    type: o.type,
    raised_by: o.raised_by,
    raised_at: iso(o.raised_at),
    status: o.status,
    // The three columns stay three. Collapsing them into one "notes" field
    // would delete the only structured sales insight in the product: what they
    // SAID, what we think they MEAN, and what we say back.
    spoken: o.spoken,
    real_fear: o.real_fear,
    counter: o.counter,
  }
}

export function publicMatch(m: {
  product_number: number
  product_name: string
  template_number: number | null
  template_name: string | null
  fit: number | null
  why: string | null
  computed_at: Date
  computed_by_label: string | null
}) {
  return {
    product_number: m.product_number,
    product_name: m.product_name,
    template_number: m.template_number,
    template_name: m.template_name,
    fit: m.fit,
    why: m.why,
    computed_at: iso(m.computed_at),
    // WHO decided. A match is a judgement, so the record says whose.
    computed_by: m.computed_by_label,
  }
}

// ---------------------------------------------------------------------------
// The ledgers and the catalog — all six have a #number and a URN
// ---------------------------------------------------------------------------

export function publicMeeting(
  m: {
    seq: number
    prospect_number: number
    prospect_name: string
    starts_at: Date
    duration_min: number | null
    type: string
    status: string
    title: string
    attendees: string[] | null
    agenda: string | null
    outcome: string | null
    meeting_url: string | null
    created_at: Date
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  return {
    number: m.seq,
    prospect_number: m.prospect_number,
    prospect_name: m.prospect_name,
    starts_at: iso(m.starts_at)!,
    duration_min: m.duration_min,
    type: m.type,
    status: m.status,
    title: m.title,
    attendees: m.attendees ?? [],
    agenda: m.agenda,
    outcome: m.outcome,
    // Null on most rows — this ledger is mostly calls and in-person meetings —
    // and served as null rather than "" so a reader can tell "no link" from
    // "a link that is the empty string". Every renderer omits the field
    // entirely when it is absent; a "Link: —" line on every past phone call is
    // noise, which is rule 3 of this file (no rendering) pointed at absence.
    meeting_url: m.meeting_url,
    urn: entityUrnOrNull(workspaceSlug, 'meeting', m.seq),
    created_at: iso(m.created_at)!,
    deleted_at: iso(m.deleted_at),
  }
}

export function publicComm(
  c: {
    seq: number
    prospect_number: number
    prospect_name: string
    channel: string
    direction: string
    occurred_at: Date
    subject: string | null
    body: string | null
    contact_name: string | null
    logged_by_label: string | null
    created_at: Date
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  return {
    number: c.seq,
    prospect_number: c.prospect_number,
    prospect_name: c.prospect_name,
    channel: c.channel,
    direction: c.direction,
    occurred_at: iso(c.occurred_at)!,
    subject: c.subject,
    body: c.body,
    contact: c.contact_name,
    logged_by: c.logged_by_label,
    urn: entityUrnOrNull(workspaceSlug, 'communication', c.seq),
    created_at: iso(c.created_at)!,
    deleted_at: iso(c.deleted_at),
  }
}

export function publicProduct(
  p: {
    seq: number
    category: string
    name: string
    price_label: string | null
    price_from: string | null
    price_to: string | null
    currency: string
    description: string | null
    fit: string[] | null
    pitch: string | null
    status_label: string | null
    refs: string[] | null
    internal_price_min: string | null
    internal_price_max: string | null
    internal_price_note: string | null
    reach: string
    external_url: string | null
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  return {
    number: p.seq,
    category: p.category,
    name: p.name,
    // The price AS WRITTEN and the machine-readable half, both. Half the
    // catalogue is not a single number, and neither derives from the other.
    price_label: p.price_label,
    price_from: p.price_from,
    price_to: p.price_to,
    currency: p.currency,
    description: p.description,
    fit: p.fit ?? [],
    pitch: p.pitch,
    status_label: p.status_label,
    refs: p.refs ?? [],
    // ── INTERNAL-ONLY (migration 0011, #27) ──────────────────────────────
    // Served here because every consumer of this route today is authenticated
    // into the workspace: `bk sales product show`, the internal web catalog.
    // **When #26's public product pages are built they must NOT reuse this
    // view.** A public renderer needs its own projection that omits these three
    // — this is the exact function somebody would reach for, and the whole
    // point of the field is that a customer never sees it.
    internal_price_min: p.internal_price_min,
    internal_price_max: p.internal_price_max,
    internal_price_note: p.internal_price_note,
    // How far our own site carries it (#29) — `internal | external`.
    reach: p.reach,
    external_url: p.external_url,
    urn: entityUrnOrNull(workspaceSlug, 'product', p.seq),
    deleted_at: iso(p.deleted_at),
  }
}

export function publicTemplate(
  t: {
    seq: number
    channel: string
    category: string
    stage: string | null
    name: string
    subject: string | null
    body: string | null
    variables: string[] | null
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  return {
    number: t.seq,
    channel: t.channel,
    category: t.category,
    stage: t.stage,
    name: t.name,
    subject: t.subject,
    body: t.body,
    // Parsed from the body on write, served so a caller knows what `render`
    // will demand BEFORE it fails.
    variables: t.variables ?? [],
    urn: entityUrnOrNull(workspaceSlug, 'template', t.seq),
    deleted_at: iso(t.deleted_at),
  }
}

export function publicDocument(
  d: {
    seq: number
    title: string
    kind: string
    upload_url: string | null
    external_url: string | null
    size_bytes: number | null
    mime_type: string | null
    description: string | null
    tags: string[] | null
    added_by_label: string | null
    prospect_numbers: number[]
    product_numbers: number[]
    strategy_numbers: number[]
    template_numbers: number[]
    storage_provider: string | null
    external_id: string | null
    preview_status: string | null
    preview_checked_at: Date | null
    deleted_at: Date | null
  },
  workspaceSlug: string
) {
  // ── WHERE IT LIVES AND HOW TO SHOW IT (migration 0012, sales #40) ────────
  // DERIVED on every read rather than read from a column, so improving the
  // recogniser improves every existing row with no backfill. `storage_provider`
  // IS a column, but only so `--provider` can be a query — the value served
  // here is the derived one, which is why a row the migration could not
  // classify still renders correctly.
  const url = d.upload_url ?? d.external_url ?? ''
  // `filename` is NOT the title. Passing it was a live bug: a document called
  // "Probe test image (ours)" beat its own `…/probe-test.png` path and typed as
  // `other`, so an image we host rendered as a download card. The title is a
  // label a human wrote; the filename is in the url, and the provider reads it
  // from there. Only the recorded `mime` is a better source than the path.
  const file = describeFile(url, { mime: d.mime_type })
  return {
    number: d.seq,
    title: d.title,
    kind: d.kind,
    // One of the two is always null — the CHECK enforces it — and both are
    // served rather than collapsed into a single `url`, because which one it is
    // decides whether the blob-reference index has anything to say about it.
    upload_url: d.upload_url,
    external_url: d.external_url,
    size_bytes: d.size_bytes,
    mime_type: d.mime_type,
    description: d.description,
    tags: d.tags ?? [],
    added_by: d.added_by_label,
    prospects: d.prospect_numbers,
    products: d.product_numbers,
    strategies: d.strategy_numbers,
    // Read back at last (2026-08-17). `doc link --template` has written this
    // since 0001 and nothing served it, so the link was unverifiable.
    templates: d.template_numbers,
    /**
     * Everything a surface needs to SHOW the file, in one block.
     *
     * Nested rather than spread flat so a caller can hand `file` straight to a
     * renderer, and so adding a field here cannot collide with a document
     * column called the same thing.
     */
    file: {
      provider: file.provider,
      /** True when WE hold the bytes — the delete gate applies, and the UI
       *  badge says so. */
      internal: file.internal,
      label: file.label,
      external_id: file.external_id ?? d.external_id,
      media_kind: file.media_kind,
      embed_mode: file.embed.mode,
      embed_url: file.embed.url,
      thumbnail_url: file.thumbnail_url,
      open_url: file.open_url,
      /**
       * `public | restricted | unknown | null`.
       *
       * NOT derivable — a probe result. `null` for our own files, which are
       * always viewable by anyone who can see the record. A web surface must
       * treat anything other than `public` as "do not embed": showing Google's
       * request-access screen inside a customer record is worse than a card.
       */
      preview_status: d.preview_status,
      preview_checked_at: iso(d.preview_checked_at),
    },
    urn: entityUrnOrNull(workspaceSlug, 'document', d.seq),
    deleted_at: iso(d.deleted_at),
  }
}

/**
 * A label, in the shape `bk <app> label` already parses.
 *
 * `issue_count` is the field name that wire uses for "how many things carry
 * this", and it is filled with the PROSPECT count here. Renaming it would mean
 * a sales-specific client type for a command whose whole point is that it is the
 * same one under every app; the honest fix is to rename the field on both sides,
 * which is a platform change and not this phase's.
 */
export function publicLabel(l: {
  id: number
  workspace_id: number | null
  name: string
  color: string | null
  description: string | null
  usage: number
}) {
  return {
    id: l.id,
    workspace_id: l.workspace_id,
    name: l.name,
    color: l.color,
    description: l.description,
    // `app` is no longer a COLUMN — Phase 3 moved labels to `sales.labels`,
    // where every row is this app's — but it is still a field on the wire, and
    // it is answered with a constant rather than dropped. `bk <app> label list`
    // prints it, and a client that has always seen it would start showing an
    // empty column against a fact that has not changed: this label belongs to
    // this app. Removing the field is a CLI change and belongs to Phase 4.
    app: APP_SLUG,
    issue_count: l.usage,
  }
}
