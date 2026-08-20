// Manual workspace creation: `bk books workspace create` behind
// POST /api/workspaces.
//
// `ensureWorkspaceForUser` mints a person's FIRST workspace at sign-in.
// `createWorkspaceForUser` is the manual door — and since 2026-08-20 it refuses
// a SECOND one: b/books gives one workspace per person for now. Three
// properties matter:
//
//   1. The membership row lands WITH the workspace, one transaction — a
//      workspace without it locks its own owner out (the seed shipped that
//      exact bug once; `listWorkspacesForUser` joins membership).
//   2. A person who already owns one is refused, in words, pointing at the
//      workspace they have. This case REPLACED "it always creates".
//   3. Slug collisions get a typeable counter suffix, never a random string.
//      Still reachable, and now only ACROSS people — two different Annas — so
//      the case below uses a second user rather than the same one twice.

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
    // A FRESH person per run. The old fixture reused one address, which was
    // harmless while this door always created — and became a false failure the
    // moment it started refusing a second workspace, because the user arrived
    // owning the ones previous runs had left. Nothing is deleted to fix that:
    // the test simply stops sharing a person with its own history.
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name)
      VALUES (${`ws-create-${stamp}@example.test`}, 'ws-create') RETURNING id`)
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

  it('refuses a second workspace, and names the one they already have', async () => {
    const { createWorkspaceForUser } = await import('./queries/workspaces')
    await expect(createWorkspaceForUser(userId, `Second ${stamp}`)).rejects.toMatchObject({
      code: 'one_workspace_per_person',
    })
    // The refusal has to be actionable: it names the workspace to work in, and
    // says what to do instead — a second company is a second BOOK.
    await expect(createWorkspaceForUser(userId, `Second ${stamp}`)).rejects.toMatchObject({
      suggestion: expect.stringContaining(`bk books workspace use venture-${stamp}`),
    })

    const rows = await db.execute(sql`
      SELECT count(*) AS n FROM books.workspace_members WHERE user_id = ${userId}`)
    expect(Number(rows.rows[0].n), 'nothing was minted').toBe(1)
  })

  it('suffixes a colliding slug with a counter — across two people', async () => {
    const { createWorkspaceForUser } = await import('./queries/workspaces')
    // The other Anna. The suffix path is not dead under the one-per-person
    // rule, it just belongs to a different person now.
    const u = await db.execute(sql`
      INSERT INTO platform.users (email, name)
      VALUES (${`ws-create-other-${stamp}@example.test`}, 'ws-create-2') RETURNING id`)
    const otherId = Number(u.rows[0].id)

    const again = await createWorkspaceForUser(otherId, NAME)
    expect(again.slug, 'same name, next typeable slug').toBe(`venture-${stamp}-2`)
    expect(again.member_role).toBe('owner')
  })
})
