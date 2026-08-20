// The sales app's own server-enforced limits, plus the composed `limits` object
// that GET /api/meta serves.
//
// Platform-wide caps (workspace, token, profile, invitation, pagination, search)
// live in `@blackcode/platform-api` and are re-exported here so every
// `@/lib/limits` import in this app has a single site. What stays in this file
// is the caps only a CRM has — `apps/issues` has no use for PROSPECT_NAME_MAX
// and must not inherit it, exactly as this app must not inherit ISSUE_TITLE_MAX.
//
// The rule: a limit is DECLARED once, IMPORTED by the route that enforces it,
// and SERVED by GET /api/meta (→ `bk meta.limits`). The embedded `bk guide`
// never restates a number.

import { PLATFORM_LENGTH_LIMITS } from '@blackcode/platform-api'

export {
  WORKSPACE_NAME_MAX,
  TOKEN_NAME_MAX,
  PROFILE_NAME_MAX,
  PROFILE_TAGLINE_MAX,
  INVITE_EMAIL_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SEARCH_QUERY_MIN,
  SEARCH_RESULTS_MAX,
} from '@blackcode/platform-api'

/** Prospect `name` — the company. */
export const PROSPECT_NAME_MAX = 120
/** Contact `name` — a decision maker at the prospect. */
export const CONTACT_NAME_MAX = 120
/** Meeting `title`. */
export const MEETING_TITLE_MAX = 200
/**
 * Meeting `meeting_url` — the online-meeting link.
 *
 * The COLUMN is `text` and stays `text` (migration 0007): this number is a
 * paste-accident bound, not a schema fact, and it is deliberately generous.
 * A Teams join link carrying a tenant id, a thread id and a base64 context blob
 * runs past 400 characters as a matter of course, so a tighter cap would refuse
 * ordinary real links — and the failure mode of refusing one is that somebody
 * cannot record where their meeting is.
 */
export const MEETING_URL_MAX = 2048
/**
 * Prospect `website` and contact `linkedin` — migration 0008.
 *
 * Both COLUMNS are `text` and stay `text`, for `MEETING_URL_MAX`'s reason
 * directly above: this is a paste-accident bound, not a schema fact. Smaller
 * than the meeting cap because neither of these is ever a session URL carrying
 * a base64 context blob — a company homepage and a LinkedIn profile are short,
 * and anything approaching 1 KB in these fields is a mistake worth refusing
 * with a message that names the limit.
 */
export const CONTACT_URL_MAX = 1024
/** Prospect `address` — one postal line. Matches the `varchar(200)` column. */
export const PROSPECT_ADDRESS_MAX = 200
/** Communication `subject` — an email subject line, mostly. */
export const COMM_SUBJECT_MAX = 300
/** Product `name`. */
export const PRODUCT_NAME_MAX = 120
/** Template `name`. */
export const TEMPLATE_NAME_MAX = 120
/** Document `title`. */
export const DOCUMENT_TITLE_MAX = 200
/**
 * A research note's `body` — migration 0009, sales #39.
 *
 * Generous on purpose. This is where a site audit, a competitor teardown or a
 * set of personnel findings lands, and the failure mode of a tight cap is that
 * somebody has to split one observation into two rows that then read as two
 * observations. The column is `text`; this is a paste-accident bound.
 */
export const PROSPECT_NOTE_BODY_MAX = 20000
/** A note's `kind` bucket — "site audit", "competitor". Matches the column. */
export const PROSPECT_NOTE_KIND_MAX = 40
/**
 * Prospect `game_plan` — the pre-meeting angle (#35).
 *
 * The same generous bound `PROSPECT_NOTE_BODY_MAX` takes and for the same
 * reason: this holds talking points, an upsell angle and the objections to
 * expect, and a tight cap would make somebody split one plan into two places.
 */
export const GAME_PLAN_MAX = 20000
/** Product `external_url` — its own site. A paste bound, like the others. */
export const PRODUCT_URL_MAX = 1024
/** Strategy `name` — the segment, e.g. "Lausanne watch & jewellery". */
export const STRATEGY_NAME_MAX = 120
/** How many `sales.labels` may be attached to one prospect. */
export const LABELS_PER_PROSPECT_MAX = 20

/**
 * The character/count caps GET /api/meta serves under `limits`.
 *
 * The two halves stay visibly separate: this app's own caps first, the platform
 * block spread in after, so a reader can see which is which without checking the
 * import.
 */
export const LENGTH_LIMITS = {
  prospect_name_max: PROSPECT_NAME_MAX,
  contact_name_max: CONTACT_NAME_MAX,
  contact_url_max: CONTACT_URL_MAX,
  prospect_address_max: PROSPECT_ADDRESS_MAX,
  meeting_title_max: MEETING_TITLE_MAX,
  meeting_url_max: MEETING_URL_MAX,
  comm_subject_max: COMM_SUBJECT_MAX,
  product_name_max: PRODUCT_NAME_MAX,
  template_name_max: TEMPLATE_NAME_MAX,
  document_title_max: DOCUMENT_TITLE_MAX,
  prospect_note_body_max: PROSPECT_NOTE_BODY_MAX,
  prospect_note_kind_max: PROSPECT_NOTE_KIND_MAX,
  product_url_max: PRODUCT_URL_MAX,
  game_plan_max: GAME_PLAN_MAX,
  strategy_name_max: STRATEGY_NAME_MAX,
  labels_per_prospect_max: LABELS_PER_PROSPECT_MAX,
  ...PLATFORM_LENGTH_LIMITS,
} as const
