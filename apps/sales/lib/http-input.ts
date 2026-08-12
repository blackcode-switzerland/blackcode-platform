// Reading a request: the coercions and the vocabulary checks every sales route
// repeats.
//
// It is a separate module because the alternative is copying six functions into
// each route file, and a validator copied is a validator that gets fixed in one
// place. `apps/_scaffold` keeps its two helpers inline, which is right for one
// route and stops being right at the third.
//
// ---------------------------------------------------------------------------
// AN ERROR MESSAGE MUST NOT RECITE A DYNAMIC VALUE
// ---------------------------------------------------------------------------
// The same rule the guide topics live under (`bk guide` vs `bk meta`) applies to
// a 400. Stages, channels and meeting types change without a deploy of the CLI
// and without a redeploy of the web; a message that listed them would be one
// more copy to go stale, and it would go stale in the worst place — in front of
// an agent that is already failing and has no reason to doubt what it just read.
//
// So every rejection here names `bk meta` and nothing else. The one exception is
// a LIMIT, which is interpolated from `lib/limits.ts` rather than typed: the
// number is already imported by the route that enforces it, so there is no
// second copy to drift.

import { Errors } from '@blackcode/platform-api'
import { STAGE_VALUES } from './pipeline'

/** A trimmed non-empty string, or undefined. Blank and absent are the same. */
export function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

/**
 * A trimmed string, `null` when the caller explicitly sent null, undefined when
 * the key was absent.
 *
 * The three-way distinction is what makes PATCH able to CLEAR a field. `{ city:
 * null }` means "remove the city"; omitting `city` means "leave it alone". A
 * helper that collapsed them would make every optional field unclearable, and
 * the symptom is a flag that appears to do nothing.
 */
export function nullableStr(v: unknown): string | null | undefined {
  if (v === null) return null
  return str(v)
}

/** A comma-separated query parameter, e.g. `?stage=meeting,negotiation`. */
export function parseList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** A finite number from a query parameter, or undefined. */
export function numberOr(raw: string | null): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * The `{n}` path segment: a positive integer #number.
 *
 * A 404 rather than a 400 when it is not one, because `…/prospects/abc` and
 * `…/prospects/9999` are the same thing from the caller's side — there is no
 * prospect there — and the recovery is identical.
 */
export function requireNumberParam(raw: string, entity: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw Errors.notFound(
      `${entity}_not_found`,
      `${JSON.stringify(raw)} is not a #number`,
      `#numbers are positive integers — run \`bk sales ${entity} list\` to see them`
    )
  }
  return n
}

/** Reject an unknown pipeline stage, naming `bk meta` rather than the values. */
export function requireStage(stage: string): void {
  if (!STAGE_VALUES.includes(stage)) {
    throw Errors.badRequest(
      'unknown_stage',
      `unknown stage ${JSON.stringify(stage)}`,
      'run `bk meta` for the current stage values'
    )
  }
}

/** Reject an over-long field, interpolating the cap from `lib/limits.ts`. */
export function requireMaxLength(value: string, max: number, field: string): void {
  if (value.length > max) {
    throw Errors.badRequest(
      `${field}_too_long`,
      `${field} must be at most ${max} characters`,
      'run `bk meta` for the current limits'
    )
  }
}

/**
 * Reject a meeting link that is not an http(s) URL.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY ALMOST NO VALIDATION, WITH ONE HARD EDGE
 * ---------------------------------------------------------------------------
 * People paste Teams, Meet, Zoom, Whereby, Jitsi, a Webex tenant, and internal
 * hostnames that resolve only on the office network. A pattern that tried to
 * recognise "a conferencing link" would refuse a real one the week a customer
 * moved provider, and the cost of refusing is that somebody cannot record where
 * their meeting is. So: anything the URL parser accepts.
 *
 * The SCHEME check is not fussiness and is the reason this function exists
 * rather than being skipped entirely. The web app renders this value as
 * `<a href={…}>`, and `javascript:alert(1)` is a perfectly well-formed URL —
 * a stored XSS wearing the shape of a meeting link, typed by one member of a
 * workspace and clicked by another. `new URL()` alone would pass it. Allowing
 * exactly `http:` and `https:` also excludes `data:` and `vbscript:` without
 * needing to enumerate what is dangerous, which is the direction that stays
 * correct as browsers add schemes.
 */
export function requireMeetingUrl(value: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw Errors.badRequest(
      'invalid_meeting_url',
      `${JSON.stringify(value)} is not a URL`,
      'pass the full join link including https:// — e.g. --link https://meet.google.com/abc-defg-hij'
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Errors.badRequest(
      'invalid_meeting_url',
      `a meeting link must be http or https, got ${JSON.stringify(parsed.protocol)}`,
      'pass the full join link including https://'
    )
  }
}

/** Reject a deal value that is not a plain decimal amount. */
export function requireMoney(value: string): void {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
    throw Errors.badRequest(
      'invalid_value',
      `deal value ${JSON.stringify(value)} is not a number`,
      'pass a plain amount, e.g. --value 24000 (the currency is a separate flag)'
    )
  }
}
