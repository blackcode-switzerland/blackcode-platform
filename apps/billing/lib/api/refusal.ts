// A domain refusal → the platform's error envelope. ONE mapping, used by every
// route that catches `InvoiceRefused` or `CompanyRefused`.
//
// ===========================================================================
// WHY THIS FILE EXISTS: THE 403 WAS SCRAMBLED IN FOUR ROUTES
// ===========================================================================
// Until 2026-09-17 each route carried its own three-line mapping:
//
//     if (e.status === 403) throw Errors.forbidden(e.code, e.message, e.suggestion)
//
// `Errors.forbidden`'s signature is `(message, suggestion, code)` — the other
// helpers take `(code, message, suggestion)`, and this one kept its older
// one-argument form working when the code was added. So the owner-only IBAN
// refusal went out as
//
//     { error: "iban_owner_only", code: "<the suggestion>", suggestion: "<the sentence>" }
//
// which `bk` prints as an error line reading `iban_owner_only`, and which an
// integration switching on `code` can never match. Four copies of one mapping
// had the same transposition, and nothing looked at a 403 body.
// `refusal.test.ts` now does, for every status this file maps.
//
// Phase 3 would have been the fifth copy, with three more statuses (404, 501,
// 502), which is when a mapping stops being a pattern and starts being a bug
// farm.

import { ApiError, Errors } from '@blackcode/platform-api'

/**
 * The shape both refusal classes share. Structural, and deliberately NOT a type
 * guard over `unknown`: each route still recognises its own class with
 * `instanceof`, so an unrelated error can never be dressed up as a refusal here.
 */
export interface Refusal {
  code: string
  message: string
  suggestion: string
  status: number
}

export function refusalToApiError(e: Refusal): ApiError {
  switch (e.status) {
    case 403:
      // `(message, suggestion, code)` — see the header. Named arguments would be
      // nicer; the order is the platform's and is not ours to change.
      return Errors.forbidden(e.message, e.suggestion, e.code)
    case 404:
      // The three-argument form uses `code` verbatim rather than appending
      // `_not_found`.
      return Errors.notFound(e.code, e.message, e.suggestion)
    case 409:
      return Errors.conflict(e.code, e.message, e.suggestion)
    case 422:
      return Errors.unprocessable(e.code, e.message, e.suggestion)
    case 400:
      return Errors.badRequest(e.code, e.message, e.suggestion)
    default:
      // 500, 501, 502, 503: there is no named helper for the first three, and
      // `ApiError` is what `apiHandler` recognises — an invented error class is
      // how a 422 once became a 500 with no code (lib/api/idempotency.ts).
      return new ApiError(e.status, e.code, e.message, e.suggestion)
  }
}
