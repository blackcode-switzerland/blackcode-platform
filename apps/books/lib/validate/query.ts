// Query-string numbers, refused rather than coerced.
//
// ===========================================================================
// WHY THIS IS A DOOR AND NOT A `Number()` CALL
// ===========================================================================
// `Number('abc')` is `NaN`, and `NaN` is not an error — it is a value that
// travels. Reaching a SQL `LIMIT` it produces a driver exception the caller
// sees as a bare 500, which tells them nothing about the `?limit=` they typed.
// Reaching a comparison it is silently false, which is worse.
//
// The entries route added `?cursor=` with #69, so there are now two numbers a
// caller can typo on one route. Same rule as every other door in this app: say
// what is wrong while somebody can still fix it, and say which door said so.
import { Errors } from '@blackcode/platform-api'

/**
 * A non-negative whole number from the query string.
 *
 * Absent and empty both mean "not given" — `?limit=` with nothing after it is a
 * caller who built a URL from an empty variable, and treating that as `0` would
 * silently serve them an empty page.
 */
export function wholeNumber(
  raw: string | null,
  name: string,
  hint: string
): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    throw Errors.badRequest(`bad_${name}`, `${name}=${raw} is not a whole number`, hint)
  }
  return n
}
