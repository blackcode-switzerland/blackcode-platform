// Manual workspace creation: `bk books workspace create` behind
// POST /api/workspaces.
//
// `ensureWorkspaceForUser` mints a person's FIRST workspace at sign-in.
// `createWorkspaceForUser` is the manual door. From 2026-08-20 to 2026-09-28 it
// refused a SECOND workspace (one per person); that was lifted when the
// invitation-accept flow and the web switcher landed. Three properties matter:
//
//   1. The membership row lands WITH the workspace, one transaction — a
//      workspace without it locks its own owner out (the seed shipped that
//      exact bug once; `listWorkspacesForUser` joins membership).
//   2. A person who already owns one can create another — the case that
//      REPLACED the one-per-person refusal, so a revert of the lift goes red.
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

  it('creates a second workspace for somebody who already owns one', async () => {
    const { createWorkspaceForUser, listWorkspacesForUser } = await import('./queries/workspaces')
    const second = await createWorkspaceForUser(userId, `Second ${stamp}`)
    expect(second.member_role).toBe('owner')
    const mine = await listWorkspacesForUser(userId)
    expect(
      mine.filter((w: { member_role: string }) => w.member_role === 'owner').length,
      'both workspaces are theirs'
    ).toBe(2)
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
