// The one `fetch` in this app's browser code. Everything a page reads or writes
// goes through here — usually via `lib/queries.ts` and `lib/mutations.ts`
// rather than directly.
//
// Pages call the SAME routes `bk` calls — no server actions, no database reads
// in a client component — so nothing in the web UI is a capability the CLI
// lacks, and a route test covers what the page does.
//
// Every element a Playwright script needs carries a `data-testid`. That is the
// contract the scripts depend on, not the markup around it; keep them when a
// page is restyled (apps/billing/docs/frontend.md).

/**
 * A refusal, carrying the server's own sentence (`error`), its `code` and its
 * recovery (`suggestion`) — the envelope `errorBody` in packages/platform-api
 * writes. Render all three; switch on `code`, never on the sentence.
 */
export class WebError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public suggestion: string | null
  ) {
    super(message)
    this.name = 'WebError'
  }
}

/** `/api/workspaces/{ws}` + suffix, with the slug escaped. */
export const wsApi = (ws: string, suffix = '') => `/api/workspaces/${encodeURIComponent(ws)}${suffix}`

/**
 * `?a=1&b=2` from an object, skipping undefined, null, '' and false — so a
 * filter left at "all" is simply absent, which is what every list route reads
 * as "no filter". Empty object → ''.
 */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

function envelopeError(status: number, method: string, path: string, body: unknown): WebError {
  const b = (body ?? {}) as { error?: string; code?: string; suggestion?: unknown }
  // `suggestion` is a string on almost every refusal, but a 409 can carry a
  // structured `details` (footprint's `blocked_by`); never render an object.
  const suggestion = typeof b.suggestion === 'string' ? b.suggestion : null
  return new WebError(status, b.code ?? null, b.error ?? `${method} ${path} failed (${status})`, suggestion)
}

/**
 * JSON in, JSON out, errors as `WebError`. Every POST gets a fresh
 * Idempotency-Key, which is what `bk` does: a double-click is one request, and
 * a real retry is a new key.
 */
export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (method === 'POST') headers['idempotency-key'] = crypto.randomUUID()
  const res = await fetch(path, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const raw = await res.text()
  // A 500 from a proxy is HTML; parse failure falls back to the status line.
  const json = raw ? (() => { try { return JSON.parse(raw) } catch { return null } })() : null
  if (!res.ok) throw envelopeError(res.status, method, path, json)
  return json as T
}

/** A list route's envelope, opened rather than cast around. */
export interface Page<T> {
  data: T[]
  next_cursor: string | number | null
}

/** A list route's whole envelope — use when the page offers "load more". */
export async function page<T>(path: string): Promise<Page<T>> {
  return await call<Page<T>>(path)
}

/** A list route's rows: `{ data, next_cursor }` → `data`. */
export async function list<T>(path: string): Promise<T[]> {
  return (await call<{ data: T[] }>(path)).data
}

/** One line: message (status code) — suggestion. For toasts and plain text. */
export function describeError(e: unknown): string {
  if (e instanceof WebError) return [`${e.message} (${e.status}${e.code ? ` ${e.code}` : ''})`, e.suggestion].filter(Boolean).join(' — ')
  return e instanceof Error ? e.message : String(e)
}

/** A route that answers text (the QR payload), untouched: no trimming, no newline added. */
export async function text(path: string): Promise<string> {
  const res = await fetch(path)
  const body = await res.text()
  if (!res.ok) {
    let b: unknown = null
    try {
      b = JSON.parse(body)
    } catch {
      // not the API's envelope
    }
    throw envelopeError(res.status, 'GET', path, b)
  }
  return body
}
