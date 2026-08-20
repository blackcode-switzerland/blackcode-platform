// The four fields migration 0011 added to a product, validated once for both
// the POST and the PATCH.
//
// A shared helper for `lib/http-input.ts`'s reason — a validator copied is a
// validator that gets fixed in one place — and because the two routes ask the
// identical questions with only the three-way/two-way distinction between them.

import { Errors } from '@blackcode/platform-api'
import { PRODUCT_REACH_VALUES } from '@/lib/pipeline'
import { PRODUCT_URL_MAX } from '@/lib/limits'
import { requireHttpUrl, requireMaxLength, requireMoney } from '@/lib/http-input'

/** Reject a `products.reach` outside the vocabulary, naming `bk meta`. */
export function requireReach(value: string): void {
  if (!PRODUCT_REACH_VALUES.includes(value)) {
    throw Errors.badRequest(
      'unknown_reach',
      `unknown reach ${JSON.stringify(value)}`,
      'run `bk meta` for the current values'
    )
  }
}

/**
 * `external_url` — same scheme edge as every other link this app renders as an
 * anchor. See `requireHttpUrl`.
 */
export function requireExternalUrl(value: string): void {
  requireMaxLength(value, PRODUCT_URL_MAX, 'external_url')
  requireHttpUrl(
    value,
    'external_url',
    "a product's own site",
    'pass the full url including https:// — e.g. --external-url https://aioscompanion.com'
  )
}

/**
 * The internal price range — each end optional, but `min` above `max` refused.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ORDERING IS CHECKED AT ALL
 * ---------------------------------------------------------------------------
 * It is the one mistake this pair can carry that nothing downstream would
 * notice: a rep reading "CHF 12'000 – 8'000" off the record does not see a
 * broken range, they see a number, and the number they quote is whichever half
 * they read first. Storing it costs nothing to refuse now and cannot be
 * detected later.
 *
 * Both ends are optional and a one-ended range is legitimate — "never below 8k"
 * is a real answer — so only the case where BOTH are present is comparable.
 */
export function requireInternalPriceRange(
  min: string | null | undefined,
  max: string | null | undefined
): void {
  if (min) requireMoney(min)
  if (max) requireMoney(max)
  if (min && max && Number(min) > Number(max)) {
    throw Errors.badRequest(
      'invalid_internal_price',
      `internal price floor ${min} is above the ceiling ${max}`,
      'pass --internal-price-min below --internal-price-max, or only one of them'
    )
  }
}
