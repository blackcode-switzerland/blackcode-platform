// Workspace administration and the invitee's half (phase 2), against a real
// Postgres.
//
//   TEST_DATABASE_URL=postgres://billing_app:…@localhost:5434/blackcode_issues \
//     npx vitest run lib/db/queries/workspace-admin.integration.test.ts
//
// Skipped — loudly — without it. The suite prints the role it runs as.
//
// ===========================================================================
// WHY THE DELETE CASES CANNOT BE UNIT TESTS
// ===========================================================================
// The rule "a workspace holding a retained record cannot be deleted" is not
// this app's code — it is the BEFORE DELETE triggers of 0005/0010/0012, which
// fire on the ON DELETE CASCADE from `billing.workspaces`. `deleteWorkspace`'s
// pre-check exists to turn that into a sentence. So the suite asserts BOTH
// halves against the database: the pre-check refuses, AND a raw DELETE that
// skips the pre-check is refused by the database too — otherwise the pre-check
// could be guarding a rule that is not there, or missing one that is.
//
// It leaves one workspace per run behind (`wsadmin-held-<stamp>`, holding a
// company), for the reason `write-paths.integration.test.ts` gives: a test able
// to clean that up would be proving the guard does not hold.
//
// ===========================================================================
// WATCHED FAILING, 2026-09-21 — each restored, 6/6 after
// ===========================================================================
//   `holdsRetainedRecords` made to return false → 2 red: "refuses a workspace
//   that holds a company" (expected false to be true) and the footprint case
//   (the held workspace was no longer in `blocked_by`)
//   `deleteWorkspace`'s pre-check AND its trigger-error mapping removed → 1
//   red: the refusal arrived as Drizzle's "Failed query: delete from
//   billing…" — the 500 path — not as `WorkspaceRetained`. (Removing only the
//   pre-check stays green by design: the mapping turns the trigger's refusal
//   into the same 409, which is the backstop for the race.)

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationDescribe } from '@blackcode/platform-testing'

const TEST_DB = process.env.TEST_DATABASE_URL
if (TEST_DB) process.env.DATABASE_URL = TEST_DB

const run = integrationDescribe({
  describe,
  name: 'billing workspace admin: delete refusal, transfer, members, invitations',
  databaseUrl: TEST_DB,
  required: process.env.REQUIRE_INTEGRATION_TESTS,
})

run('billing workspace administration (integration)', () => {
  let getDb: typeof import('../client')['getDb']
  let sql: typeof import('drizzle-orm')['sql']
  let workspaces: typeof import('./workspaces')
  let invitations: typeof import('./invitations')
  let footprint: typeof import('./footprint')['billingFootprintSource']

  let owner: { id: number; email: string }
  let other: { id: number; email: string }
  const stamp = Date.now()

  const count = async (table: string, workspaceId: number) => {
    const r = await getDb().execute<{ n: number }>(
      sql.raw(`SELECT COUNT(*)::int AS n FROM billing.${table} WHERE workspace_id = ${Number(workspaceId)}`)
    )
    return Number(r.rows[0]?.n ?? 0)
  }

  beforeAll(async () => {
    ;({ getDb } = await import('../client'))
    ;({ sql } = await import('drizzle-orm'))
    workspaces = await import('./workspaces')
    invitations = await import('./invitations')
    ;({ billingFootprintSource: footprint } = await import('./footprint'))

    const who = await getDb().execute<{ current_user: string }>(sql`SELECT current_user`)
    process.stderr.write(`\n  workspace-admin integration suite running as: ${who.rows[0]?.current_user}\n`)

    const u = await getDb().execute<{ id: number; email: string }>(
      sql`SELECT id, email FROM platform.users WHERE deleted_at IS NULL ORDER BY id LIMIT 2`
    )
    if (u.rows.length < 2) throw new Error('need two users in platform.users — sign up locally first')
    ;[owner, other] = u.rows
  })

  afterAll(async () => {
    // The pool is global (platform-db); vitest's process exit closes it.
  })

  // -------------------------------------------------------------------------
  // DELETE
  // -------------------------------------------------------------------------

  it('deletes an EMPTY workspace, with its members, invitations and counters', async () => {
    const ws = await workspaces.createWorkspaceForUser(owner.id, `wsadmin-empty-${stamp}`)
    await invitations.createInvitation({ workspaceId: ws.id, email: `x-${stamp}@example.invalid`, invitedBy: owner.id })
    await getDb().execute(
      sql`INSERT INTO billing.counters (workspace_id, entity_type, last_value) VALUES (${ws.id}, 'probe', 1)`
    )
    expect(await count('workspace_members', ws.id)).toBe(1)
    expect(await count('invitations', ws.id)).toBe(1)

    expect(await workspaces.deleteWorkspace(ws.id)).toBe(true)

    // The rows, not the return value.
    const left = await getDb().execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM billing.workspaces WHERE id = ${ws.id}`)
    expect(Number(left.rows[0].n)).toBe(0)
    expect(await count('workspace_members', ws.id)).toBe(0)
    expect(await count('invitations', ws.id)).toBe(0)
    expect(await count('counters', ws.id)).toBe(0)
  })

  it('refuses a workspace that holds a company — before the DELETE, with the count', async () => {
    const ws = await workspaces.createWorkspaceForUser(owner.id, `wsadmin-held-${stamp}`)
    const companies = await import('./companies')
    await companies.createCompany(
      { workspaceId: ws.id, actorUserId: owner.id, via: 'token', isOwner: true },
      { slug: `held-${stamp}`, name: 'Held SA', number_format: 'H-{SEQ4}' } as never
    )

    const h = await workspaces.workspaceHoldings(ws.id)
    expect(h.companies).toBe(1)
    expect(workspaces.holdsRetainedRecords(h)).toBe(true)

    // The refusal must come from the PRE-CHECK, as `WorkspaceRetained`. A raw
    // driver error here would mean the DELETE was attempted and the trigger
    // stopped it — the 500 path this phase removed.
    let thrown: unknown = null
    try {
      await workspaces.deleteWorkspace(ws.id)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(workspaces.WorkspaceRetained)
    expect((thrown as InstanceType<typeof workspaces.WorkspaceRetained>).holdings.companies).toBe(1)
    expect(workspaces.describeHoldings(h)).toMatch(/1 company/)

    const still = await getDb().execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM billing.workspaces WHERE id = ${ws.id}`)
    expect(Number(still.rows[0].n)).toBe(1)
  })

  it('and the DATABASE refuses the same delete when the pre-check is skipped', async () => {
    const rows = await getDb().execute<{ id: number }>(
      sql`SELECT id FROM billing.workspaces WHERE slug LIKE ${`wsadmin-held-${stamp}%`} LIMIT 1`
    )
    const id = rows.rows[0].id
    let err: Error | null = null
    try {
      await getDb().execute(sql`DELETE FROM billing.workspaces WHERE id = ${id}`)
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
    // Drizzle wraps the driver error; the trigger's own sentence is on `cause`.
    const text = `${err?.message ?? ''} ${String((err as { cause?: unknown })?.cause ?? '')}`
    expect(text).toMatch(/never deleted|958f|permission denied/)
  })

  // -------------------------------------------------------------------------
  // TRANSFER, REMOVE
  // -------------------------------------------------------------------------

  it('transfers ownership to a member, and refuses a non-member', async () => {
    const ws = await workspaces.createWorkspaceForUser(owner.id, `wsadmin-xfer-${stamp}`)
    await expect(workspaces.transferOwnership(ws.id, other.id)).rejects.toThrow('not_a_member')

    await getDb().execute(
      sql`INSERT INTO billing.workspace_members (workspace_id, user_id, role) VALUES (${ws.id}, ${other.id}, 'member')`
    )
    await workspaces.transferOwnership(ws.id, other.id)

    const after = await workspaces.listWorkspaceMembers(ws.id)
    expect(after.find((m) => m.user_id === other.id)?.role).toBe('owner')
    expect(after.find((m) => m.user_id === owner.id)?.role).toBe('member')
    const w = await getDb().execute<{ owner_id: number }>(sql`SELECT owner_id FROM billing.workspaces WHERE id = ${ws.id}`)
    expect(w.rows[0].owner_id).toBe(other.id)

    // The previous owner can now be removed (they are a member), and a second
    // remove reports "was not there".
    expect(await workspaces.removeMember(ws.id, owner.id)).toBe(true)
    expect(await workspaces.removeMember(ws.id, owner.id)).toBe(false)

    await workspaces.deleteWorkspace(ws.id)
  })

  // -------------------------------------------------------------------------
  // THE INVITEE'S HALF
  // -------------------------------------------------------------------------

  it('accept adds the membership and spends the token; decline revokes; a stranger is refused', async () => {
    const ws = await workspaces.createWorkspaceForUser(owner.id, `wsadmin-inv-${stamp}`)
    const inv = await invitations.createInvitation({ workspaceId: ws.id, email: other.email, invitedBy: owner.id })
    expect(inv).not.toBeNull()

    const pending = await invitations.listPendingInvitationsForEmail(other.email)
    expect(pending.some((p) => p.token === inv!.token)).toBe(true)

    // A stranger holding the token learns nothing and changes nothing.
    expect(await invitations.acceptInvitation(inv!.token, owner.id, 'stranger@example.invalid')).toEqual({
      ok: false,
      reason: 'email_mismatch',
    })

    const ok = await invitations.acceptInvitation(inv!.token, other.id, other.email.toUpperCase())
    expect(ok).toMatchObject({ ok: true, workspace_id: ws.id, workspace_slug: ws.slug, already_member: false })
    expect((await workspaces.listWorkspaceMembers(ws.id)).some((m) => m.user_id === other.id)).toBe(true)
    expect(await invitations.acceptInvitation(inv!.token, other.id, other.email)).toEqual({ ok: false, reason: 'accepted' })

    // Decline, on a fresh invitation to a fresh address.
    const inv2 = await invitations.createInvitation({ workspaceId: ws.id, email: `decl-${stamp}@example.invalid`, invitedBy: owner.id })
    expect(await invitations.declineInvitation(inv2!.token, `decl-${stamp}@example.invalid`)).toEqual({ ok: true })
    const d = await invitations.getInvitationByToken(inv2!.token)
    expect(d?.status).toBe('revoked')

    await workspaces.removeMember(ws.id, other.id)
    await workspaces.deleteWorkspace(ws.id)
  })

  // -------------------------------------------------------------------------
  // THE FOOTPRINT AGREES WITH THE DELETE
  // -------------------------------------------------------------------------

  it('footprint reports a retention-held workspace as BLOCKED, never as will_delete', async () => {
    const f = await footprint.read(owner.id)
    const held = f.blocked_by.find((w) => w.name === `wsadmin-held-${stamp}`)
    expect(held).toMatchObject({ reason: 'retention' })
    expect(held?.detail).toMatch(/1 company/)
    expect(f.will_delete.some((w) => w.name === `wsadmin-held-${stamp}`)).toBe(false)
    // And the purge refuses rather than attempting a delete the triggers would abort.
    await expect(footprint.purge(owner.id)).rejects.toThrow(/refusing to purge/)
  })
})
