// The browser's side of this app's own API.
//
// ── EVERY FETCH IS SAME-ORIGIN, AND THAT IS D-10 ────────────────────────────
// Paths only — never an absolute URL, never a base-URL constant, never an env
// var pointing at another deployment. `sales.blackcode.ch` talks to
// `sales.blackcode.ch` and nothing else, which is what makes the shared route
// factories (D-2) mandatory rather than nice: this app serves its own
// `/api/upload` and `/api/meta` because a fetch is not allowed to go and find
// somebody else's.
//
// Cross-app links (D-18) are the deliberate exception and they are not fetches:
// they are anchors carrying an absolute `url` the SERVER built from the other
// app's registered `base_url`.
//
// ── THE ERROR SHAPE IS THE ONE THE CLI PRINTS ───────────────────────────────
// `{ error, code, suggestion? }` — the same body `bk` turns into a `hint:` line
// (`packages/platform-api/src/errors.ts`). Carrying `suggestion` through to the
// browser means a 400 an agent could act on is also a 400 a human can act on,
// rather than "something went wrong".

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly suggestion?: string

  constructor(status: number, code: string, message: string, suggestion?: string) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.suggestion = suggestion
  }
}

/** A list route's envelope. Single resources come back bare — see `jsonList()`. */
export interface ListPage<T> {
  data: T[]
  next_cursor: number | null
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    // A 500 from a proxy is HTML, and `res.json()` on HTML throws something that
    // reads like a parser bug rather than a server error. Fall back to the
    // status line: wrong-ish and honest beats "Unexpected token < in JSON".
    const body = (await res.json().catch(() => null)) as
      | { error?: string; code?: string; suggestion?: string }
      | null
    throw new ApiClientError(
      res.status,
      body?.code ?? String(res.status),
      body?.error ?? `Request failed (${res.status})`,
      body?.suggestion
    )
  }
  return (await res.json()) as T
}



/**
 * The other verbs. **The ONLY place in this app that sends a non-GET request.**
 *
 * ── THIS IS TRANSPORT, NOT PERMISSION, AND THE DIFFERENCE IS D-7 ────────────
 * Nothing here consults `ui_mode`. A gate inside the transport would be a gate
 * every caller shares whether or not it is writing a sales RECORD — and two of
 * this app's writes deliberately are not: minting a CLI token and editing your
 * own profile are account operations that belong to the platform, not to the
 * pipeline, and hiding them in `read_only` would mean a person who switched a
 * display preference could no longer sign a terminal in.
 *
 * The affordance switch lives one layer up, in `lib/mutations.ts`, which is
 * where every sales-record write is built and where `useCanWrite()` is read.
 * `lib/read-only.test.ts` asserts the arrangement rather than trusting it: one
 * `fetch(` in the app, and `apiSend` reachable only from `lib/mutations.ts` and
 * a named list of account-surface modules, none of which may name an
 * `/api/workspaces/` path.
 *
 * ── AND IT IS STILL NOT A PERMISSION ANYWHERE ───────────────────────────────
 * The server does not consult `ui_mode` either (D-7). Authorisation is
 * `platform.app_access` and workspace role, and it refuses a write the UI
 * allowed exactly as readily as one it did not.
 */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  // ── `FormData` PASSES THROUGH UNTOUCHED, AND WITHOUT A content-type ────────
  // Added 2026-08-11 for the profile photo, which is the app's first multipart
  // write. Serialising it would send the string "[object FormData]"; setting the
  // header would send a `multipart/form-data` with **no boundary parameter**,
  // which the parser rejects — the browser has to write that header itself,
  // from the FormData it is given.
  //
  // It is here rather than in a second helper because `lib/read-only.test.ts`
  // asserts there is exactly ONE `fetch(` in this app, and that assertion is the
  // thing that makes "no mutation reaches the network except through this
  // module" checkable rather than merely intended. It caught the first version
  // of the photo upload, which called `fetch` from the settings component.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as
      | { error?: string; code?: string; suggestion?: string }
      | null
    throw new ApiClientError(
      res.status,
      parsed?.code ?? String(res.status),
      parsed?.error ?? `Request failed (${res.status})`,
      parsed?.suggestion
    )
  }
  // 204 has no body; `res.json()` on an empty one throws a parser error that
  // reads like a bug. No route in this app answers 204 today, and the day one
  // does it must not look like a failure.
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** `?a=1&b=2`, with null/undefined/empty dropped. Returns '' when nothing is set. */
export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** `/api/workspaces/{ws}` + the rest. One place so no page hand-builds it. */
export function wsPath(ws: string, rest: string): string {
  return `/api/workspaces/${encodeURIComponent(ws)}${rest}`
}
