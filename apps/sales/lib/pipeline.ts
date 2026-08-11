// Canonical vocabularies and colours for the sales pipeline. This app's analog
// of `apps/issues/lib/work-items.ts`, and the same rule applies:
//
//   ONE SOURCE OF TRUTH. Imported by the query layer (validation), by the
//   routes (400s on an unknown value), by `/api/meta` (so `bk meta` carries the
//   live vocabulary) and by the UI (dropdowns, board columns, badges).
//   **Nothing else in this app names a hex for a stage, channel or objection.**
//
// Plain data with no imports — safe on the server and in a client component.
//
// ── AND NOTHING HERE IS EVER RESTATED IN A GUIDE TOPIC ──────────────────────
// These are DYNAMIC values: they change without a CLI release, so an agent must
// read them from `bk meta`, not from a document embedded in its binary.
// `cli/internal/guide/guide_test.go` fails the build on a topic that hardcodes
// one. Write "run `bk meta` for the current stage values", never the values.
//
// ── WHY THE COLOURS ARE NOT THE MOCKUP'S ────────────────────────────────────
// `bsales-mockup/assets/js/data.js` gives each stage a hex, and the SEMANTICS of
// that ramp are kept exactly — neutral lead, cool contact, warming through the
// middle, positive close, muted loss. The VALUES move onto sales' own palette
// (D-4): emerald-teal primary, warm neutrals. The mockup's `#5b8def` is issues'
// blue family, and the point of D-4 is that the two apps must not feel alike.

export interface Option {
  value: string
  label: string
  color: string
}

/**
 * Look a value up in a vocabulary; HUMANISE anything it has never heard of.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FALLBACK IS NOT THE RAW VALUE, AND WHY THIS IS NOT A GUARD
 * ---------------------------------------------------------------------------
 * It was `?? value`, and that shipped `check_in` onto the prospect page — a wire
 * value in front of a human. The instinct is to write a guard that catches a
 * vocabulary rendered without a label helper, and it is the wrong instinct:
 *
 * **The vocabularies are served live by `bk meta` and can gain a value without a
 * deploy.** So the value that breaks a page is by definition one no static
 * check in this repo can see — it does not exist yet when the check runs. A
 * scanner would prove the call site correct and say nothing about the case that
 * actually fails.
 *
 * The cure has to be total, not detective: whatever arrives renders acceptably.
 * `check_in` becomes "Check in"; a stage added next month becomes something a
 * reader can read; and the page stops needing to know the vocabulary at all,
 * which is the property `bk meta` was supposed to buy.
 *
 * This is the third bug in this family (`check_in` raw, "1 deals",
 * "3 whatsapps"), all three of which passed typecheck, lint and tests. The
 * pluralisation half was fixed at `ledger-pages.tsx` by not inflecting at all —
 * same reasoning, applied one layer up: a page cannot inflect a label it has
 * never seen, so it must not try.
 */
function labelOf(options: Option[], value: string | null | undefined): string {
  const known = options.find((o) => o.value === value)?.label
  if (known) return known
  if (!value) return '—'
  return humanise(value)
}

/**
 * `check_in` → `Check in`. The last resort, for a value this build predates.
 *
 * Deliberately dumb: underscores and hyphens to spaces, first letter up, the
 * rest left alone so an acronym a vocabulary carries survives. It is not trying
 * to be the label — it is trying to not be a wire value.
 */
function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return '—'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
function colorOf(options: Option[], value: string | null | undefined): string {
  return options.find((o) => o.value === value)?.color ?? NEUTRAL
}

/** The warm grey everything unrecognised falls back to. */
const NEUTRAL = '#8a8578'

/**
 * This app's primary, as a literal hex — the emerald-teal `--primary` in
 * `app/globals.css`.
 *
 * It is here rather than in `lib/email/send.ts` because `lib/palette.test.ts`
 * is right: colour is decided in this file and nowhere else. An email is the
 * one surface that cannot read a CSS variable — mail clients get inline styles
 * or nothing — so the value has to be written down somewhere in TypeScript, and
 * this is where writing a colour down is allowed.
 *
 * If `--primary` ever changes, this changes with it. That is one coupling in
 * one place, which is strictly better than the alternative the guard caught: a
 * hex sitting in the email binding, where nothing would ever compare the two.
 */
export const EMAIL_ACCENT = '#10a37f'

/**
 * The colour a label gets when its creator names none — `sales.labels.color`'s
 * default, and the DEFAULT in migration 0003.
 *
 * It is re-exported from here rather than written into `lib/db/schema.ts`
 * because D-4 is that every colour in this app is decided in this file, and
 * `lib/palette.test.ts` enforces it by scanning for hex literals. The platform
 * table this replaces defaults to `#6b7280` — issues' cool grey — and carrying
 * that over is exactly the "sales feels like issues" the decision is about.
 *
 * `lib/db/label-default-color.test.ts` holds this and the migration's literal
 * together; SQL cannot import a constant, so the second copy is unavoidable and
 * the test is what stops it drifting.
 */
export const DEFAULT_LABEL_COLOR = NEUTRAL

// ---------- stages: the deal pipeline ----------
// Order is the pipeline order and the board's column order. `won` and `lost` are
// the terminal pair; everything before them is open pipeline.

export const STAGES: Option[] = [
  { value: 'new_lead', label: 'New lead', color: '#8a8578' },
  { value: 'contacted', label: 'Contacted', color: '#14b8a6' },
  { value: 'meeting', label: 'Demo / Meeting', color: '#f0b66b' },
  { value: 'negotiation', label: 'Negotiation', color: '#e08658' },
  { value: 'won', label: 'Won', color: '#10a37f' },
  { value: 'lost', label: 'Lost', color: '#a8a29e' },
]
export const STAGE_VALUES = STAGES.map((s) => s.value)
/** Stages that close a deal — `closed_at` and `closed_reason` are set here. */
export const TERMINAL_STAGES = ['won', 'lost']
/** Stages that count toward open pipeline value. */
export const OPEN_STAGES = STAGE_VALUES.filter((s) => !TERMINAL_STAGES.includes(s))
export const stageLabel = (v?: string | null) => labelOf(STAGES, v)
export const stageColor = (v?: string | null) => colorOf(STAGES, v)

// ---------- the deal journey ----------
// One `sales.stage_entries` row per stage of a prospect's journey. `upcoming`
// rows are placeholders with no date and no actor — the mockup renders the whole
// ladder including the steps not taken yet.

export const STAGE_ENTRY_STATUSES: Option[] = [
  { value: 'done', label: 'Done', color: '#10a37f' },
  { value: 'current', label: 'Current', color: '#e08658' },
  { value: 'upcoming', label: 'Upcoming', color: '#a8a29e' },
]
export const STAGE_ENTRY_STATUS_VALUES = STAGE_ENTRY_STATUSES.map((s) => s.value)
export const stageEntryStatusLabel = (v?: string | null) => labelOf(STAGE_ENTRY_STATUSES, v)
export const stageEntryStatusColor = (v?: string | null) => colorOf(STAGE_ENTRY_STATUSES, v)

// ---------- communications ----------
// The mockup calls the prospecting channel `maps` (Google Maps sweeps). Stored
// as `discovery`: the record is "we found them by looking", and naming the tool
// in the schema would need a migration the first time the tool changes. `note`
// is new — D-13: sales has no platform comments, so an internal note about a
// prospect is `bk sales comm log --channel note`.

export const CHANNELS: Option[] = [
  { value: 'email', label: 'Email', color: '#14b8a6' },
  { value: 'whatsapp', label: 'WhatsApp', color: '#10a37f' },
  { value: 'call', label: 'Call', color: '#8b5cf6' },
  { value: 'note', label: 'Note', color: '#8a8578' },
  { value: 'discovery', label: 'Discovery', color: '#f0b66b' },
  { value: 'system', label: 'System', color: '#a8a29e' },
]
export const CHANNEL_VALUES = CHANNELS.map((c) => c.value)
export const channelLabel = (v?: string | null) => labelOf(CHANNELS, v)
export const channelColor = (v?: string | null) => colorOf(CHANNELS, v)

/** `out` = we → them, `in` = them → us. */
export const COMM_DIRECTIONS: Option[] = [
  { value: 'out', label: 'Outbound', color: '#10a37f' },
  { value: 'in', label: 'Inbound', color: '#8b5cf6' },
]
export const COMM_DIRECTION_VALUES = COMM_DIRECTIONS.map((d) => d.value)
export const commDirectionLabel = (v?: string | null) => labelOf(COMM_DIRECTIONS, v)

// ---------- meetings ----------

export const MEETING_TYPES: Option[] = [
  { value: 'video', label: 'Video', color: '#14b8a6' },
  { value: 'call', label: 'Call', color: '#8b5cf6' },
  { value: 'in_person', label: 'In person', color: '#10a37f' },
]
export const MEETING_TYPE_VALUES = MEETING_TYPES.map((t) => t.value)
export const meetingTypeLabel = (v?: string | null) => labelOf(MEETING_TYPES, v)
export const meetingTypeColor = (v?: string | null) => colorOf(MEETING_TYPES, v)

export const MEETING_STATUSES: Option[] = [
  { value: 'upcoming', label: 'Upcoming', color: '#e08658' },
  { value: 'done', label: 'Done', color: '#10a37f' },
  { value: 'cancelled', label: 'Cancelled', color: '#a8a29e' },
]
export const MEETING_STATUS_VALUES = MEETING_STATUSES.map((s) => s.value)
export const meetingStatusLabel = (v?: string | null) => labelOf(MEETING_STATUSES, v)
export const meetingStatusColor = (v?: string | null) => colorOf(MEETING_STATUSES, v)

// ---------- objections ----------

export const OBJECTION_TYPES: Option[] = [
  { value: 'pricing', label: 'Pricing', color: '#e11d48' },
  { value: 'complexity', label: 'Complexity', color: '#8b5cf6' },
  { value: 'existing_solution', label: 'Existing solution', color: '#e08658' },
  { value: 'timing', label: 'Timing', color: '#f0b66b' },
  { value: 'decision_pending', label: 'Decision pending', color: '#8a8578' },
]
export const OBJECTION_TYPE_VALUES = OBJECTION_TYPES.map((o) => o.value)
export const objectionTypeLabel = (v?: string | null) => labelOf(OBJECTION_TYPES, v)
export const objectionTypeColor = (v?: string | null) => colorOf(OBJECTION_TYPES, v)

export const OBJECTION_STATUSES: Option[] = [
  { value: 'open', label: 'Open', color: '#e11d48' },
  { value: 'countered', label: 'Countered', color: '#f0b66b' },
  { value: 'resolved', label: 'Resolved', color: '#10a37f' },
]
export const OBJECTION_STATUS_VALUES = OBJECTION_STATUSES.map((s) => s.value)
export const objectionStatusLabel = (v?: string | null) => labelOf(OBJECTION_STATUSES, v)
export const objectionStatusColor = (v?: string | null) => colorOf(OBJECTION_STATUSES, v)

// ---------- catalog ----------
// `licence` is spelled the British way throughout, matching the mockup.

export const PRODUCT_CATEGORIES: Option[] = [
  { value: 'module', label: 'Module', color: '#10a37f' },
  { value: 'service', label: 'Service', color: '#14b8a6' },
  { value: 'licence', label: 'Licence', color: '#8b5cf6' },
]
export const PRODUCT_CATEGORY_VALUES = PRODUCT_CATEGORIES.map((c) => c.value)
export const productCategoryLabel = (v?: string | null) => labelOf(PRODUCT_CATEGORIES, v)
export const productCategoryColor = (v?: string | null) => colorOf(PRODUCT_CATEGORIES, v)

export const TEMPLATE_CHANNELS: Option[] = [
  { value: 'email', label: 'Email', color: '#14b8a6' },
  { value: 'whatsapp', label: 'WhatsApp', color: '#10a37f' },
  { value: 'call', label: 'Call script', color: '#8b5cf6' },
]
export const TEMPLATE_CHANNEL_VALUES = TEMPLATE_CHANNELS.map((c) => c.value)
export const templateChannelLabel = (v?: string | null) => labelOf(TEMPLATE_CHANNELS, v)

export const TEMPLATE_CATEGORIES: Option[] = [
  { value: 'intro', label: 'Intro', color: '#8a8578' },
  { value: 'follow_up', label: 'Follow-up', color: '#14b8a6' },
  { value: 'objection', label: 'Objection', color: '#e08658' },
  { value: 'meeting', label: 'Meeting', color: '#f0b66b' },
  { value: 'kickoff', label: 'Kickoff', color: '#10a37f' },
]
export const TEMPLATE_CATEGORY_VALUES = TEMPLATE_CATEGORIES.map((c) => c.value)
export const templateCategoryLabel = (v?: string | null) => labelOf(TEMPLATE_CATEGORIES, v)
export const templateCategoryColor = (v?: string | null) => colorOf(TEMPLATE_CATEGORIES, v)

export const DOCUMENT_KINDS: Option[] = [
  { value: 'pdf', label: 'PDF', color: '#e11d48' },
  { value: 'deck', label: 'Deck', color: '#e08658' },
  { value: 'image', label: 'Image', color: '#8b5cf6' },
  { value: 'video', label: 'Video', color: '#14b8a6' },
  { value: 'link', label: 'Link', color: '#8a8578' },
]
export const DOCUMENT_KIND_VALUES = DOCUMENT_KINDS.map((k) => k.value)
export const documentKindLabel = (v?: string | null) => labelOf(DOCUMENT_KINDS, v)
export const documentKindColor = (v?: string | null) => colorOf(DOCUMENT_KINDS, v)

// ---------- next actions ----------
// What the owner owes this prospect next. `wait` is a real value, not the
// absence of one: "we have done our part and are waiting on them" is a
// deliberate state, and it is what the mockup's StaffUp record is in.
//
// `demo_prep` likewise. The mockup's Today queue distinguishes "prepare the
// demo" from "do the demo" — they fall to different people on different days —
// and §5.5's list did not carry it, so the queue had a purpose with no storable
// value behind it.

export const NEXT_ACTION_TYPES: Option[] = [
  { value: 'email', label: 'Email', color: '#14b8a6' },
  { value: 'call', label: 'Call', color: '#8b5cf6' },
  { value: 'demo', label: 'Demo', color: '#f0b66b' },
  { value: 'demo_prep', label: 'Demo prep', color: '#f3c583' },
  { value: 'follow_up', label: 'Follow-up', color: '#e08658' },
  { value: 'check_in', label: 'Check-in', color: '#10a37f' },
  { value: 'wait', label: 'Waiting', color: '#8a8578' },
]
export const NEXT_ACTION_TYPE_VALUES = NEXT_ACTION_TYPES.map((a) => a.value)
export const nextActionTypeLabel = (v?: string | null) => labelOf(NEXT_ACTION_TYPES, v)
export const nextActionTypeColor = (v?: string | null) => colorOf(NEXT_ACTION_TYPES, v)

// ---------- the read-only / full affordance switch (D-7) ----------
//
// **`ui_mode` IS NOT A PERMISSION, AND THIS IS NOT A ROLE.** It decides what the
// WEB APP renders. The server never consults it: authorisation is
// `platform.app_access` and the workspace role, and a write refused by those is
// refused whichever mode the reader happens to have set. Anybody who can open
// this app can write through `bk` in either mode.
//
// It lives here rather than in `lib/ui-mode.ts` on purpose, and the reason is
// the guard D-7 mandates: `lib/ui-mode.test.ts` asserts that **no server module
// imports `ui-mode`**, and that assertion is only worth anything if there is
// nothing in `ui-mode` a server module would want. The route that validates a
// PATCH needs these two values; it takes them from the vocabulary module every
// other route already takes its vocabulary from, and `ui-mode` is left holding
// nothing but React hooks.
//
// The colours are the app's neutral and its primary — this is a setting, not a
// pipeline value, and a stage-like hue would read as one.

export const UI_MODES: Option[] = [
  { value: 'read_only', label: 'Read-only', color: '#8a8578' },
  { value: 'full', label: 'Full', color: '#10a37f' },
]
export const UI_MODE_VALUES = UI_MODES.map((m) => m.value)
/** The default, and the honest one: this product's doctrine is that the agent writes. */
export const UI_MODE_DEFAULT = 'read_only'
/**
 * The one mode that renders editing.
 *
 * Named, so `useCanWrite()` can ask `mode === UI_MODE_FULL` rather than
 * `mode !== UI_MODE_DEFAULT`. The two are identical today and differ the moment
 * a third mode exists: the first defaults it to showing nothing, the second
 * defaults it to showing everything. Only one of those is the safe direction for
 * a value somebody adds without reading this file.
 */
export const UI_MODE_FULL = 'full'
export const uiModeLabel = (v?: string | null) => labelOf(UI_MODES, v)

/**
 * Everything above, in the shape `GET /api/meta` serves under
 * `apps.sales.vocabulary` (D-20). Assembled here rather than in the route so the
 * route cannot serve a stale subset — adding a vocabulary above adds it to
 * `bk meta` with no second edit.
 */
export const VOCABULARY = {
  stages: STAGES,
  stage_entry_statuses: STAGE_ENTRY_STATUSES,
  channels: CHANNELS,
  comm_directions: COMM_DIRECTIONS,
  meeting_types: MEETING_TYPES,
  meeting_statuses: MEETING_STATUSES,
  objection_types: OBJECTION_TYPES,
  objection_statuses: OBJECTION_STATUSES,
  product_categories: PRODUCT_CATEGORIES,
  template_channels: TEMPLATE_CHANNELS,
  template_categories: TEMPLATE_CATEGORIES,
  document_kinds: DOCUMENT_KINDS,
  next_action_types: NEXT_ACTION_TYPES,
  ui_modes: UI_MODES,
} as const
