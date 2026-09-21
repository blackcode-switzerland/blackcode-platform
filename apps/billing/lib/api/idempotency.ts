// Idempotency: making a retried write safe on the one app where a retry is
// unrecoverable.
//
// ===========================================================================
// WHY THIS APP CANNOT SKIP IT
// ===========================================================================
// The invoice number is gapless and the row is never deleted. So a client that
// retries a timed-out `POST …/invoices` mints a **second real invoice** that can
// only be voided — leaving two documents, two consumed numbers, and a void
// record explaining a mistake nobody made.
//
// And the retry is not a hypothetical: a network timeout between our commit and
// the client's receipt is indistinguishable, to the client, from a failure. Every
// HTTP client retries. `bk` retries.
//
// The events spine carries an idempotency key for the same reason and states the
// trade: "the cost of the column is one nullable varchar against the cost of
// discovering you need it after the table has rows"
// (`apps/sales/lib/db/schema.ts`).
//
// ===========================================================================
// THE SEMANTICS, AND THE ONE THAT MATTERS MOST
// ===========================================================================
// | Case | Answer |
// |---|---|
// | new key | insert `pending`, run the handler, store the response, mark `done` |
// | same key, same body, `done` | **replay the stored response.** Nothing runs |
// | same key, different body | `422 idempotency_key_reused` — never replayed |
// | same key, still `pending` | `409 idempotency_in_progress` |
// | key older than 24h | treated as new |
//
// **The `pending` case is the one that matters**, because it is the concurrent
// double-submit — two requests in flight at once, which is what a retry
// actually looks like when the first one has not failed yet. The UNIQUE index on
// `(workspace_id, key)` is what settles it: the second INSERT violates it, and
// **this module never checks first.** A check-then-insert is a race, and the race
// is the case.
//
// ── WHY NOT IN `packages/platform-api` ─────────────────────────────────────
// Because a second app has not asked. This repo promotes a thing to the platform
// when there is a real second caller (the argument in `lib/api.ts`'s header), and
// promoting on the first is how a package acquires an API shaped by one app's
// accident. The store is behind an interface below, so the promotion is a move
// rather than a rewrite.

import { createHash } from 'node:crypto'
import { and, eq, lt } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { getDb } from '@/lib/db/client'
import { billingIdempotencyKeys } from '@/lib/db/schema'

/** How long a stored response is replayable. */
const TTL_MS = 24 * 60 * 60 * 1000

export const IDEMPOTENCY_HEADER = 'idempotency-key'
/** Set on a replay, so a caller can tell one from a fresh write. */
export const REPLAYED_HEADER = 'Idempotent-Replayed'

/** Matches `billing.idempotency_keys.key`, which matches the events spine's column. */
const KEY_MAX = 80

/**
 * The canonical form the hash covers: method, path AND body.
 *
 * ── ALL THREE, AND THE PATH IS THE ONE PEOPLE LEAVE OUT ────────────────────
 * A hash over the body alone would let one key replay across two different
 * routes — `POST …/invoices` answered from a cached `POST …/companies`. A hash
 * over method and path alone would let the same key create two DIFFERENT
 * invoices and silently return the first, which is worse than creating two:
 * the caller believes the second one exists.
 *
 * `JSON.stringify` with sorted keys at every depth, because `{a:1,b:2}` and
 * `{b:2,a:1}` are the same request and must not hash differently. Same reasoning
 * as `packages/platform-api/src/contract-version.ts`, which sorts for the same
 * reason.
 */
function canonicalHash(method: string, path: string, body: unknown): string {
  const stable = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map(stable)
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, stable(val)])
    )
  }
  return createHash('sha256')
    .update(`${method} ${path}\n${JSON.stringify(stable(body))}`)
    .digest('hex')
}

export interface IdempotentResult {
  /** The response to send. */
  response: NextResponse
  /** True when it came from the store rather than from the handler. */
  replayed: boolean
}

/**
 * Run `handler` at most once per `(workspace, key)`.
 *
 * Without a key the handler runs unguarded, which is right for a browser form
 * (the person is watching and can see what happened) and stated rather than
 * silent: `docs/billing-app-plan/integration-surface.md` §2 requires the key on
 * the PUBLIC POSTs, and `bk` sends one per invocation.
 */
export async function withIdempotency(
  req: NextRequest,
  workspaceId: number,
  body: unknown,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const key = (req.headers.get(IDEMPOTENCY_HEADER) ?? '').trim()
  if (!key) return handler()

  if (key.length > KEY_MAX) {
    throw Errors.badRequest(
      'idempotency_key_too_long',
      `Idempotency-Key is ${key.length} characters; the limit is ${KEY_MAX}`,
      'a UUID is 36 characters and is what `bk` sends'
    )
  }

  const path = req.nextUrl.pathname
  const hash = canonicalHash(req.method, path, body)
  const db = getDb()

  // Expire first, so a key reused after the TTL is treated as new rather than
  // replaying a day-old response. One statement, and it is scoped to THIS key:
  // sweeping the whole table here would make every write pay for the cleanup.
  await db
    .delete(billingIdempotencyKeys)
    .where(
      and(
        eq(billingIdempotencyKeys.workspace_id, workspaceId),
        eq(billingIdempotencyKeys.key, key),
        lt(billingIdempotencyKeys.created_at, new Date(Date.now() - TTL_MS))
      )
    )

  // CLAIM THE KEY. `ON CONFLICT DO NOTHING` and then read what is there — never
  // SELECT-then-INSERT, which is the race this whole module exists for.
  const claimed = await db
    .insert(billingIdempotencyKeys)
    .values({ workspace_id: workspaceId, key, request_hash: hash, status: 'pending' })
    .onConflictDoNothing()
    .returning({ id: billingIdempotencyKeys.id })

  if (claimed.length === 0) {
    // Somebody else holds it. What happens next depends on what they were doing.
    const existing = (
      await db
        .select()
        .from(billingIdempotencyKeys)
        .where(
          and(
            eq(billingIdempotencyKeys.workspace_id, workspaceId),
            eq(billingIdempotencyKeys.key, key)
          )
        )
        .limit(1)
    )[0]

    if (!existing) {
      // The row was expired away between the DELETE and the INSERT by a
      // concurrent request. Rare, recoverable, and honest about which it is.
      throw Errors.conflict(
        'idempotency_in_progress',
        'that key was being expired as this request arrived',
        'retry with the same key'
      )
    }

    if (existing.request_hash !== hash) {
      // 422, not 409: the request is understood and the CONFLICT is with what
      // the key already means. Replaying here would answer a question the caller
      // did not ask, which is worse than refusing.
      // 422 via the platform's own helper. An earlier draft of this file threw
      // a hand-rolled `ApiStatusError` with `{status, code, message,
      // suggestion}`, on the assumption that `apiHandler` would recognise any
      // error shaped like that. It does not — it recognises `ApiError` — so the
      // refusal became a 500 with no code and no suggestion, which is the
      // opposite of what this branch exists to produce.
      //
      // Found by curl on 2026-09-17. `Errors.unprocessable` was there the whole
      // time; the mistake was inventing a shape rather than reading the module
      // that owns error responses.
      throw Errors.unprocessable(
        'idempotency_key_reused',
        'that Idempotency-Key was already used for a different request',
        'use a new key for a different request; reuse a key only to retry the same one'
      )
    }

    if (existing.status !== 'done' || existing.response_status === null) {
      throw Errors.conflict(
        'idempotency_in_progress',
        'a request with that key is still running',
        'retry in a few seconds with the same key'
      )
    }

    return NextResponse.json(existing.response_body, {
      status: existing.response_status,
      headers: { [REPLAYED_HEADER]: 'true' },
    })
  }

  // We hold the key. Run the handler.
  let response: NextResponse
  try {
    response = await handler()
  } catch (e) {
    // ── RELEASE THE KEY ON FAILURE, AND THIS IS THE SUBTLE ONE ─────────────
    // If the row were left `pending`, every retry would get
    // `409 idempotency_in_progress` until the TTL expired — so a transient
    // failure would become a 24-hour outage for that key, and the caller's
    // correct behaviour (retry with the same key) would be the thing that never
    // worked.
    //
    // Deleting also means a FAILED request is not replayed as a failure, which
    // is right: the caller asked us to do something and we did not do it.
    await db
      .delete(billingIdempotencyKeys)
      .where(
        and(
          eq(billingIdempotencyKeys.workspace_id, workspaceId),
          eq(billingIdempotencyKeys.key, key)
        )
      )
      .catch(() => {
        // Swallowed on purpose: the original error is what the caller needs, and
        // a cleanup failure must not replace it. The row expires on its own.
      })
    throw e
  }

  // Store the response, then mark done. A 5xx is NOT stored — see above.
  if (response.status < 500) {
    const stored = await response.clone().json().catch(() => null)
    await db
      .update(billingIdempotencyKeys)
      .set({ status: 'done', response_status: response.status, response_body: stored })
      .where(
        and(
          eq(billingIdempotencyKeys.workspace_id, workspaceId),
          eq(billingIdempotencyKeys.key, key)
        )
      )
  }

  return response
}

/**
 * Delete keys past their TTF, for `bk billing maintenance purge-keys`.
 *
 * **The app schedules nothing** — the same rule phase 4's recurrence follows. An
 * agent or a cron outside the app calls it; nothing in here fires on a timer,
 * because a timer inside a serverless deployment is a thing that either does not
 * run or runs on every instance.
 */
export async function purgeExpiredKeys(workspaceId: number): Promise<number> {
  const res = await getDb()
    .delete(billingIdempotencyKeys)
    .where(
      and(
        eq(billingIdempotencyKeys.workspace_id, workspaceId),
        lt(billingIdempotencyKeys.created_at, new Date(Date.now() - TTL_MS))
      )
    )
    .returning({ id: billingIdempotencyKeys.id })
  return res.length
}


