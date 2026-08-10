// This app's upload ledger: which workspace a file is filed under, and where
// the row is written.
//
// ===========================================================================
// WHAT WOULD SILENTLY BE WRONG, AND IS THEREFORE WHAT THIS ASSERTS
// ===========================================================================
// The shared implementation this replaces (`attributeUpload` in
// platform-storage) falls back to `platform.users.active_workspace_id`. That
// column is ONE column shared by every deployment; this app never writes it, so
// for a sales caller it holds whichever workspace they last selected IN ISSUES.
// An upload attributed from it lands in another app's workspace — under that
// workspace's slug in the blob path, and with its id in the ledger row — and
// nothing reports it. The bytes are fine; the filing is a different team's.
//
// So the discriminating case is a caller whose `active_workspace_id` is SET to
// something this app's tenancy does not contain. The right answer is
// unattributed. "Returns the sales workspace when there is one" passes just as
// well against the old implementation whenever the two ids happen to agree —
// which, because Phase 2 MIRRORED ids, is the common case, not the edge one.
//
// ===========================================================================
// WATCHED FAILING — 2026-08-10
// ===========================================================================
//   (a) the platform fallback pasted back in, in the position it occupied
//       there (`explicit`, then the app's default, then
//       `user.active_workspace_id`) → the shared-column case RED **and** the
//       never-throws case, whose fixture carries the same column. The two
//       POSITIVE cases stayed green, which is the discrimination working: a
//       test that only checked "an upload gets a workspace" would have passed
//       this injection completely.
//   (b) `attribute` made to throw instead of returning unattributed → the
//       never-throws case RED. An upload is never rejected for being
//       unattributable; that costs a file its bytes rather than its folder.
//   (c) `ON CONFLICT (url) DO NOTHING` deleted from `record` → the idempotency
//       case RED. The blob completion callback arrives server-to-server and
//       retries; a second row double-counts the quota.
//   (d) `record` pointed back at `platform.uploads` → the table case RED.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { WorkspaceSource } from '@blackcode/platform-api'
import type { User } from '@blackcode/platform-db'

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
process.env.PLATFORM_DB_DRIVER = 'pg'

/** Every statement `record()` sent, as raw SQL with its parameters. */
const statements = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>)

// The statement is RENDERED by Drizzle's own dialect rather than reconstructed
// by walking chunks: what this file asserts on is then the SQL Postgres would
// have received, not a paraphrase of it. (`error-events-app.test.ts` in
// apps/issues walks chunks by hand and its author found the hard way that a
// bare `toContain('app')` matches the table object — finding #11.)
const dialect = new PgDialect()
vi.mock('../client', () => ({
  getDb: () => ({
    execute: async (q: never) => {
      const { sql, params } = dialect.sqlToQuery(q)
      statements.push({ sql, params })
    },
  }),
}))

const { salesUploadLedger } = await import('./uploads')

const WS = {
  id: 1014,
  name: "Alice's workspace",
  slug: 'alice',
  owner_id: 7,
  updated_at: new Date(1),
  member_role: 'owner' as const,
}

/**
 * A caller whose SHARED `active_workspace_id` names an issues workspace. That
 * is the normal state of a person who uses both apps.
 */
const USER = { id: 7, email: 'alice@phase3.test', active_workspace_id: 3 } as unknown as User

function sourceWith(opts: { mine: typeof WS | null; byName?: typeof WS | null }): WorkspaceSource {
  return {
    getForUser: async () => opts.byName ?? null,
    getDefaultForUser: async () => opts.mine,
    listForUser: async () => (opts.mine ? [opts.mine] : []),
    getById: async () => {
      throw new Error('getById must not be reached: it takes an id from the SHARED user record')
    },
    listMembers: async () => [],
    assertAppAccess: async () => {},
    setDefaultForUser: async () => {},
  } as unknown as WorkspaceSource
}

describe('sales upload attribution', () => {
  beforeEach(() => {
    statements.length = 0
  })

  it('an explicit workspace the caller belongs to wins', async () => {
    const ledger = salesUploadLedger(sourceWith({ mine: null, byName: WS }))
    expect(await ledger.attribute(USER, 'alice')).toEqual({ id: 1014, slug: 'alice' })
  })

  it("with no explicit target it uses THIS APP'S default workspace", async () => {
    const ledger = salesUploadLedger(sourceWith({ mine: WS }))
    expect(await ledger.attribute(USER)).toEqual({ id: 1014, slug: 'alice' })
  })

  it('THE ONE THAT DISCRIMINATES: it never falls back to the shared active_workspace_id', async () => {
    // This caller HAS an active workspace — id 3, in `platform.workspaces`,
    // written by apps/issues. This app's tenancy holds nothing for them.
    const ledger = salesUploadLedger(sourceWith({ mine: null }))
    const attribution = await ledger.attribute(USER)

    expect(
      attribution,
      'the ledger read platform.users.active_workspace_id — an issues workspace id ' +
        'in a sales ledger row, and the file under that workspace\'s slug'
    ).toEqual({ id: null, slug: null })
    expect(USER.active_workspace_id, 'the premise: the caller really does have one').toBe(3)
  })

  it('never throws — an unattributable upload keeps its bytes', async () => {
    const exploding = {
      getForUser: async () => {
        throw new Error('tenancy lookup exploded')
      },
      getDefaultForUser: async () => {
        throw new Error('tenancy lookup exploded')
      },
    } as unknown as WorkspaceSource
    await expect(salesUploadLedger(exploding).attribute(USER, 'alice')).resolves.toEqual({
      id: null,
      slug: null,
    })
  })
})

describe('sales upload ledger writes', () => {
  beforeEach(() => {
    statements.length = 0
  })

  it('writes sales.uploads, idempotently on url, with no `app` column', async () => {
    await salesUploadLedger(sourceWith({ mine: WS })).record({
      url: 'https://blob.test/sales/alice/contract.pdf',
      pathname: 'sales/alice/contract.pdf',
      filename: 'contract.pdf',
      size: 12,
      mime_type: 'application/pdf',
      workspace_id: 1014,
      uploaded_by: 7,
    })

    expect(statements.length, 'THE PREMISE: exactly one statement was captured').toBe(1)
    const { sql, params } = statements[0]

    expect(sql, "the ledger row must land in THIS app's table").toMatch(/"sales"\."uploads"/)
    expect(sql).not.toMatch(/"platform"\."uploads"/)
    // The COLUMN LIST, as a fragment. Not `toContain('app')`: there is no `app`
    // column here and the word appears in the statement for other reasons, so a
    // substring test would be asserting nothing.
    expect(sql).toMatch(/\(url, pathname, filename, size, mime_type, workspace_id, uploaded_by\)/)
    expect(sql).toMatch(/ON CONFLICT \(url\) DO NOTHING/)
    expect(params).toContain('https://blob.test/sales/alice/contract.pdf')
    expect(params).toContain(1014)
  })
})
