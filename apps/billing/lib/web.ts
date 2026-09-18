// The one `fetch` the minimal test UI uses. Browser-only.
//
// ===========================================================================
// THE MINIMAL UI IS SCAFFOLDING, AND THIS FILE SAYS WHAT IT IS FOR
// ===========================================================================
// `app/dashboard/[ws]/**` and `components/min/**` are a bare, unstyled surface
// added on 2026-09-18 so the backend can be driven from a browser (Playwright)
// before the real screens exist. They call the SAME routes `bk` calls — no
// server actions, no direct database reads — so nothing here is a capability
// the CLI lacks. The frontend tickets (#79 onward) replace them; see
// apps/billing/docs/frontend.md, "The minimal test UI".
//
// Every element a test needs carries a `data-testid`. That is the contract the
// scripts depend on, not the markup around it.

export class WebError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public suggestion: string | null
  ) {
    super(message)
  }
}

/** `/api/workspaces/{ws}` + suffix, with the slug escaped. */
export const wsApi = (ws: string, suffix = '') => `/api/workspaces/${encodeURIComponent(ws)}${suffix}`

/**
 * JSON in, JSON out, errors as `WebError` carrying the server's own sentence and
 * suggestion. Every POST gets a fresh Idempotency-Key, which is what `bk` does:
 * a double-click is one request, and a real retry is a new key.
 */
export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  if (method === 'POST') headers['idempotency-key'] = crypto.randomUUID()
  const res = await fetch(path, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  const text = await res.text()
  const json = text ? (() => { try { return JSON.parse(text) } catch { return null } })() : null
  if (!res.ok) {
    // `{ error, code, suggestion }` — `errorBody` in packages/platform-api.
    const b = (json ?? {}) as { error?: string; code?: string; suggestion?: string }
    throw new WebError(res.status, b.code ?? null, b.error ?? `${method} ${path} failed (${res.status})`, b.suggestion ?? null)
  }
  return json as T
}

/** A list route's rows: `{ data, next_cursor }`. */
export async function list<T>(path: string): Promise<T[]> {
  return (await call<{ data: T[] }>(path)).data
}

export function describeError(e: unknown): string {
  if (e instanceof WebError) return [`${e.message} (${e.status}${e.code ? ` ${e.code}` : ''})`, e.suggestion].filter(Boolean).join(' — ')
  return e instanceof Error ? e.message : String(e)
}

/** A route that answers text (the QR payload), untouched: no trimming, no newline added. */
export async function text(path: string): Promise<string> {
  const res = await fetch(path)
  const body = await res.text()
  if (!res.ok) {
    let b: { error?: string; code?: string; suggestion?: string } = {}
    try {
      b = JSON.parse(body)
    } catch {
      // not the API's envelope
    }
    throw new WebError(res.status, b.code ?? null, b.error ?? `GET ${path} failed (${res.status})`, b.suggestion ?? null)
  }
  return body
}
