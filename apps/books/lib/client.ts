// Transport. THE ONLY `fetch(` IN THIS APP.
//
// ===========================================================================
// WHY THIS FILE IS A CHOKE POINT AND NOT A CONVENIENCE
// ===========================================================================
// b/books' web surface is READ-MOSTLY: visibility, history, and a small number of
// intervention points. Across all thirteen screens there are five writes —
// resolve an entry, create a rule, post a staged entry, approve a compliance
// rule. Everything else reads.
//
// "The web is read-mostly" is only checkable if it is a PROPERTY OF THE MODULE
// GRAPH rather than an intention. So:
//
//   lib/client.ts     this file. The only `fetch(`. Transport, consults nothing.
//   lib/mutations.ts  the only module that sends `apiSend` at a record path.
//   components/**     call the hooks. No fetch, no apiSend, no method strings.
//
// Then "can a component write?" is answered by grep, not by an audit. That is the
// arrangement `apps/sales/lib/read-only.test.ts` guards, and it is worth copying
// exactly rather than approximately.
//
// ── AND IT IS NOT A SECURITY CONTROL ──────────────────────────────────────
// The gate in lib/mutations.ts is client-side and the user owns the client.
// Authorisation is workspace membership and the workspace role, on the server,
// and it refuses a write the UI allowed exactly as readily as one it did not.
// This file makes the app's shape legible; it does not make it safe.

/** The error envelope every route serves: `{ error, code, suggestion? }`. */
export interface ApiError {
  error: string
  code: string
  suggestion?: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  /**
   * The server's recovery hint, where it gave one. Surface it: the difference
   * between an agent (or a person) stopping and recovering is usually this
   * string, and swallowing it is the most common way a good error becomes a
   * dead end.
   */
  readonly suggestion?: string

  constructor(status: number, body: ApiError) {
    super(body.error)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.code
    this.suggestion = body.suggestion
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Same-origin cookie. Every fetch the dashboard makes goes to this app's own
    // origin carrying a session and no Authorization header, which is the branch
    // `resolveUser` in lib/api.ts exists to serve.
    credentials: 'same-origin',
  })

  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as ApiError | null
    throw new ApiRequestError(
      res.status,
      parsed ?? { error: `Request failed with ${res.status}`, code: 'unknown_error' }
    )
  }

  // 204 has no body. Returning undefined typed as T is the honest shape here;
  // callers of a no-content route do not read the result.
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Read. Safe to call from anywhere. */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path)
}

/**
 * Write. **Do not call this from a component.**
 *
 * Every record write goes through lib/mutations.ts, which gates on
 * `useCanWrite()`. A component calling this directly bypasses that gate and is
 * what the read-only guard is written to catch.
 */
export function apiSend<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(method, path, body)
}

/**
 * Unwrap the `{ data, next_cursor }` envelope every list route serves.
 *
 * The envelope exists so pagination can be added to a route later without
 * breaking a client, so unwrap it here rather than teaching every caller its
 * shape.
 */
export async function apiList<T>(path: string): Promise<{ data: T[]; next_cursor: number | null }> {
  const res = await apiGet<{ data: T[]; next_cursor: number | null }>(path)
  return { data: res.data ?? [], next_cursor: res.next_cursor ?? null }
}
