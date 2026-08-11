// Canonical error model for API routes.
//
// Throw an ApiError from anywhere inside an apiHandler-wrapped route. The
// wrapper (lib/api/handler.ts → buildResponseBody) flattens it into a JSON
// response of shape:
//   { error: string, code: string, suggestion?: string, details?: unknown }
// where `error` is the human-readable message, `code` is the machine-readable
// identifier, `suggestion` is set when `details` is a string (the CLI hint),
// and `details` carries structured context otherwise.
//
// 4xx errors are not written to error_events (they are normal client errors).
// 5xx errors and any non-ApiError throwable are recorded.

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const Errors = {
  unauthorized: (message = 'Authentication required') => new ApiError(401, 'unauthorized', message),

  // `suggestion` and `code` are optional so existing callers are unchanged. Pass
  // them when a 403 is RECOVERABLE — "ask an owner to grant you the app" is
  // actionable, a bare "forbidden" is a dead end, and the CLI prints the
  // suggestion as its `hint:` line.
  forbidden: (
    message = 'You do not have permission to perform this action',
    suggestion?: string,
    code = 'forbidden'
  ) => new ApiError(403, code, message, suggestion),

  // One-arg form unchanged: `notFound('issue')` → 404 issue_not_found.
  //
  // The three-arg form exists because a 404 is often the most recoverable failure
  // an agent hits and was the only class that could not carry a `suggestion` —
  // "run `bk search <query>` to find the current URN" turns a dead end into a
  // next step. Same reasoning that added one to `forbidden` in Phase 4. When
  // `message` is given, `entity` is used verbatim as the code rather than having
  // `_not_found` appended, so a caller can name the exact condition.
  notFound: (entity: string, message?: string, suggestion?: string) =>
    message === undefined
      ? new ApiError(404, `${entity}_not_found`, `${entity} not found`)
      : new ApiError(404, entity, message, suggestion),

  badRequest: (code: string, message: string, details?: unknown) =>
    new ApiError(400, code, message, details),

  conflict: (code: string, message: string, details?: unknown) =>
    new ApiError(409, code, message, details),

  unprocessable: (code: string, message: string, details?: unknown) =>
    new ApiError(422, code, message, details),

  tooManyRequests: (message = 'Too many requests') =>
    new ApiError(429, 'too_many_requests', message),

  internal: (message = 'Internal server error', details?: unknown) =>
    new ApiError(500, 'internal_error', message, details),

  // 503 — the request is fine, this DEPLOYMENT cannot serve it. Added
  // 2026-08-11 (Phase 10) for `email_not_configured`: an app with no
  // `RESEND_API_KEY` must refuse a password reset rather than accept it and
  // deliver nothing, because "no email arrived" and "the email is slow" look
  // identical to the person waiting. Carries a `suggestion` like every other
  // recoverable class.
  serviceUnavailable: (code: string, message: string, suggestion?: string) =>
    new ApiError(503, code, message, suggestion),
}

/**
 * The canonical error envelope, from an `ApiError`.
 *
 *   { error: string, code: string, suggestion?: string, details?: unknown }
 *
 * `error` is the human message the CLI surfaces. `code` is what a client
 * branches on. `suggestion` is the "what to do about it" line the CLI prints as
 * `hint:` — the difference between an agent stopping and an agent recovering.
 * `details` is structured context for a web client; the CLI ignores it.
 *
 * It lives HERE, beside `ApiError`, because the shape is the contract every app
 * serves and `bk` parses. It was inside `apps/issues/lib/api/handler.ts` until
 * Phase 8, where building a second app made the duplication concrete: an app
 * that reimplemented this slightly differently would produce errors the CLI
 * silently fails to read a `suggestion` out of.
 *
 * The `string` special case is not a wart — `Errors.badRequest(code, msg, 'do X')`
 * passes the suggestion through `details`, and dozens of call sites rely on it.
 */
export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.message, code: err.code }
  if (typeof err.details === 'string') {
    body.suggestion = err.details
  } else if (err.details !== undefined) {
    body.details = err.details
  }
  return body
}
