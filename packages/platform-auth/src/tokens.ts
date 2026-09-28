// `bk_live_` API tokens — mint, verify, list, revoke.
//
// WHY THIS IS A PLATFORM PACKAGE. There is **one binary, one login, one token**
// (docs/platform-architecture.md §6): the same `bk_live_…` string authenticates
// `bk issues issue create` and `bk sales deal create`. If this stayed in
// apps/issues, the second app would write its own verifier, and two
// implementations of credential verification is not a duplication smell — it is
// two chances to get constant-time comparison, expiry or the prefix check wrong,
// against one shared `platform.api_tokens` table.
//
// WHY RAW SQL rather than the Drizzle query builder. Same reason as
// platform-db/app-access.ts: these functions have to accept both a `db` and a
// transaction handle, and the two builders do not share a type. Every statement
// interpolates the Drizzle table object (`${apiTokens}`), never a string literal,
// so it stays schema-qualified and type-checked — the standard set in Phase 3.
//
// The rewrite from the query builder to this form is covered by
// apps/issues/lib/auth/tokens.integration.test.ts, which exercises mint → verify
// → wrong-token → expired → revoked against a real database. That test was
// written FOR the move: there was none before, and moving unverified credential
// code on the strength of it looking equivalent is how an auth bug ships.

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { sql } from 'drizzle-orm'
import { apiTokens, users, type Executor, type User } from '@blackcode/platform-db'

const TOKEN_PREFIX = 'bk_live_'
const SECRET_BYTES = 32
const PREFIX_VISIBLE_LEN = 8

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export interface MintedToken {
  id: number
  /** The only time the plaintext exists. Never stored, never recoverable. */
  plaintext: string
  prefix: string
  name: string
  scopes: string[]
  expires_at: Date | null
  created_at: Date | null
}

export interface TokenSummary {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: Date | null
  expires_at: Date | null
  created_at: Date | null
}

function toDate(v: unknown): Date | null {
  if (v == null) return null
  return v instanceof Date ? v : new Date(String(v))
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

export async function mintToken(
  db: Executor,
  opts: {
    user_id: number
    name: string
    scopes?: string[]
    expires_at?: Date | null
  }
): Promise<MintedToken> {
  const secret = randomBytes(SECRET_BYTES).toString('base64url')
  const plaintext = `${TOKEN_PREFIX}${secret}`
  const token_hash = sha256(plaintext)
  const token_prefix = secret.slice(0, PREFIX_VISIBLE_LEN)
  const scopes = opts.scopes ?? ['full']

  const res = await db.execute(sql`
    INSERT INTO ${apiTokens} (user_id, name, token_hash, token_prefix, scopes, expires_at)
    VALUES (${opts.user_id}, ${opts.name}, ${token_hash}, ${token_prefix},
            ${sql`ARRAY[${sql.join(
              scopes.map((s) => sql`${s}`),
              sql`, `
            )}]::text[]`}, ${opts.expires_at ?? null})
    RETURNING id, name, token_prefix, scopes, expires_at, created_at
  `)
  const row = res.rows[0]
  if (!row) throw new Error('Failed to create token')

  return {
    id: Number(row.id),
    plaintext,
    prefix: String(row.token_prefix),
    name: String(row.name),
    scopes: (row.scopes as string[]) ?? scopes,
    expires_at: toDate(row.expires_at),
    created_at: toDate(row.created_at),
  }
}

/**
 * Resolve a plaintext token to its owner, or null.
 *
 * Null for every failure — unknown, expired, malformed — and deliberately
 * without saying which. The caller turns that into one 401; distinguishing
 * "expired" from "never existed" on an unauthenticated path tells an attacker
 * which of their guesses was once real.
 */
export async function verifyToken(db: Executor, plaintext: string): Promise<User | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null

  const expected_hash = sha256(plaintext)
  const expected_buf = Buffer.from(expected_hash, 'hex')

  const res = await db.execute(sql`
    SELECT id, user_id, token_hash, expires_at, last_used_at
    FROM ${apiTokens}
    WHERE token_hash = ${expected_hash}
    LIMIT 1
  `)
  const candidate = res.rows[0]
  if (!candidate) return null

  // The lookup above already matched on the hash, so this comparison can only
  // fail on a hash collision. It is kept because the constant-time compare is
  // what the code is *claiming* to do, and a reader who finds the claim absent
  // has to work out whether that was deliberate.
  const stored_buf = Buffer.from(String(candidate.token_hash), 'hex')
  if (stored_buf.length !== expected_buf.length || !timingSafeEqual(stored_buf, expected_buf)) {
    return null
  }

  const expiresAt = toDate(candidate.expires_at)
  if (expiresAt && expiresAt.getTime() < Date.now()) return null

  // `last_used_at` is a DAY, not a timestamp: the only reader shows a date
  // (account-settings' token list, `bk token list`), and this runs on every
  // authenticated request — an agent loop would otherwise write a row per call.
  // The stamp is skipped, with no statement issued at all, when it already
  // carries today's date. Same-day races just stamp twice, which is harmless.
  const lastUsed = toDate(candidate.last_used_at)
  if (!lastUsed || !isSameUtcDay(lastUsed, new Date())) {
    await db.execute(sql`
      UPDATE ${apiTokens} SET last_used_at = now() WHERE id = ${candidate.id}
    `)
  }

  const userRes = await db.execute(sql`
    SELECT * FROM ${users} WHERE id = ${candidate.user_id} LIMIT 1
  `)
  return (userRes.rows[0] as User | undefined) ?? null
}

export async function listTokens(db: Executor, user_id: number): Promise<TokenSummary[]> {
  const res = await db.execute(sql`
    SELECT id, name, token_prefix, scopes, last_used_at, expires_at, created_at
    FROM ${apiTokens}
    WHERE user_id = ${user_id}
    ORDER BY created_at DESC
  `)
  return res.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    token_prefix: String(r.token_prefix),
    scopes: (r.scopes as string[]) ?? [],
    last_used_at: toDate(r.last_used_at),
    expires_at: toDate(r.expires_at),
    created_at: toDate(r.created_at),
  }))
}

/** Revoke one of `user_id`'s tokens. Scoped to the owner so an id is not enough. */
export async function revokeToken(
  db: Executor,
  token_id: number,
  user_id: number
): Promise<boolean> {
  const res = await db.execute(sql`
    DELETE FROM ${apiTokens}
    WHERE id = ${token_id} AND user_id = ${user_id}
    RETURNING id
  `)
  return res.rows.length > 0
}
