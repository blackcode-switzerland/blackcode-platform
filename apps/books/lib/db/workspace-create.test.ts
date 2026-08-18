// Manual workspace creation: `bk books workspace create` behind
// POST /api/workspaces.
//
// `ensureWorkspaceForUser` mints a person's FIRST workspace at sign-in and
// deliberately refuses to mint a second. `createWorkspaceForUser` is the
// second (and tenth): one set of books per venture. Three properties matter:
//
//   1. The membership row lands WITH the workspace, one transaction — a
//      workspace without it locks its own owner out (the seed shipped that
//      exact bug once; `listWorkspacesForUser` joins membership).
//   2. It always creates — an existing workspace is not an answer.
//   3. Slug collisions get a typeable counter suffix, never a random string.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { config } from 'dotenv'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
config({ path: join(APP_ROOT, '.env.local') })
config({ path: join(APP_ROOT, '.env') })

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

if (!HAS_DB) {
  console.warn('\n  lib/db/workspace-create.test.ts SKIPPED: no DATABASE_URL. Manual workspace creation was NOT verified.\n')
}

d('createWorkspaceForUser', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any
  let userId = 0
  // Unique per run so reruns never collide on the slug assertions.
  const stamp = Date.now().toString(36)
  const NAME = `Venture ${stamp}`

  beforeAll(async () => {
    const { getDb } = await import('./client')
    db = getDb()
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name) VALUES ('ws-create@example.test', 'ws-create')
      ON CONFLICT (email) DO UPDATE SET name = 'ws-create' RETURNING id`)
    userId = Number(u.rows[0].id)
  })

  it('creates workspace and owner membership together, visible to its owner', async () => {
    const { createWorkspaceForUser, listWorkspacesForUser } = await import('./queries/workspaces')
    const ws = await createWorkspaceForUser(userId, `  ${NAME}  `)
    expect(ws.name, 'the name is used as given, trimmed, no suffix').toBe(NAME)
    expect(ws.slug).toBe(`venture-${stamp}`)
    expect(ws.member_role).toBe('owner')

    // Visibility goes through the membership join — the property the seed
    // once broke. If the membership row were missing, this list is empty.
    const mine = await listWorkspacesForUser(userId)
    expect(mine.map((w: { id: number }) => w.id)).toContain(ws.id)
  })

  it('always creates: a person with a workspace gets a second, not the first back', async () => {
    const { createWorkspaceForUser } = await import('./queries/workspaces')
    const second = await createWorkspaceForUser(userId, `Second ${stamp}`)
    const rows = await db.execute(sql`
      SELECT count(*) AS n FROM books.workspace_members WHERE user_id = ${userId}`)
    expect(Number(rows.rows[0].n)).toBeGreaterThanOrEqual(2)
    expect(second.slug).toBe(`second-${stamp}`)
  })

  it('suffixes a colliding slug with a counter, and stays owner on both', async () => {
    const { createWorkspaceForUser } = await import('./queries/workspaces')
    const again = await createWorkspaceForUser(userId, NAME)
    expect(again.slug, 'same name, next typeable slug').toBe(`venture-${stamp}-2`)
    expect(again.member_role).toBe('owner')
  })
})
