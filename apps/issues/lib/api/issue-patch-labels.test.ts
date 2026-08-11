// `PATCH /api/workspaces/{ws}/issues/{id}` must REFUSE `labels` / `label_ids`,
// not accept them and drop them.
//
// ---------------------------------------------------------------------------
// WHY THIS TEST EXISTS
// ---------------------------------------------------------------------------
// `updateIssue` copies a fixed whitelist of keys out of the patch body. Anything
// else is simply not copied — so `{"label_ids":[99]}` returned 200, with the
// issue's labels unchanged and nothing anywhere saying why. Two independent
// reporters concluded from that 200 that labeling was a UI-only feature and
// stopped trying (Todo/issues-app-feedback.md item 1). It was not: the label
// sub-resource, and `bk issues label attach`, worked the whole time.
//
// The silence is the defect, and it is invisible to every other guard in this
// repo — cli-parity checks that routes exist, not what they ignore.
//
// ---------------------------------------------------------------------------
// THE POSITIVE CASE IS THE LOAD-BEARING HALF (CLAUDE.md finding #21)
// ---------------------------------------------------------------------------
// A test built only from "these two bodies are rejected" passes just as well
// against a PATCH that rejects EVERYTHING — a broken route and a working one
// are indistinguishable to it. So the first case asserts the RESPONSE of an
// ordinary patch (status 200, and the field applied), and it asserts the
// response rather than a side effect on the way to one, which is the specific
// way finding #21's guard was satisfied by its own error path.
//
// The rejection cases then also assert that `updateIssue` was NEVER CALLED, so
// "rejected" cannot be satisfied by a write that happened and then threw.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused'
  process.env.PLATFORM_DB_DRIVER = 'pg'
})

const WORKSPACE_ID = 1234
const ISSUE_ID = 5678
const USER_ID = 42

/** Every patch body `updateIssue` was actually handed, in order. */
const applied = vi.hoisted(() => [] as Array<Record<string, unknown>>)

// Only the two resolvers are replaced. `apiHandler` and `Errors` stay REAL:
// the status code and the `suggestion` this test asserts are produced by them,
// and stubbing them would leave the test asserting against its own mock.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    resolveWorkspace: async () => ({
      workspace: { id: WORKSPACE_ID, slug: 'test-ws' },
      user: { id: USER_ID },
    }),
    resolveEntityId: async () => ISSUE_ID,
  }
})

const ISSUE_ROW = {
  id: ISSUE_ID,
  seq: 7,
  title: 'a real issue',
  status: 'backlog',
  priority: 3,
  labels: [],
}

vi.mock('@/lib/db/queries/issues', () => ({
  updateIssue: async (_ws: number, _id: number, patch: Record<string, unknown>) => {
    applied.push(patch)
    return { ...ISSUE_ROW, ...patch }
  },
  getIssueInWorkspace: async () => ({ ...ISSUE_ROW, ...(applied.at(-1) ?? {}) }),
  deleteIssue: async () => true,
}))

const { PATCH } = await import('@/app/api/workspaces/[ws]/issues/[id]/route')

function patch(body: unknown) {
  const req = new NextRequest('http://localhost/api/workspaces/test-ws/issues/7', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
  return PATCH(req, { params: Promise.resolve({ ws: 'test-ws', id: '7' }) })
}

describe('PATCH issue — labels are not a field on the issue', () => {
  beforeEach(() => {
    applied.length = 0
  })

  // FIRST, and deliberately: the thing that must SUCCEED.
  it('applies an ordinary field change and answers 200', async () => {
    const res = await patch({ priority: 4 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ priority: 4 })
    // The premise of every case below: this route does reach updateIssue.
    expect(applied).toEqual([{ priority: 4 }])
  })

  for (const key of ['labels', 'label_ids']) {
    it(`rejects \`${key}\` with 400 + a suggestion naming the working command`, async () => {
      const res = await patch({ [key]: key === 'labels' ? ['urgent'] : [99] })
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.code).toBe('labels_not_patchable')
      expect(body.error).toContain(key)
      // A dead end must name its own exit — and the exit must be runnable.
      expect(body.suggestion).toContain('bk issues label attach')

      // Rejected means the write never happened, not that it happened and threw.
      expect(applied).toEqual([])
    })
  }

  it('rejects even when the label key is mixed in with valid fields', async () => {
    const res = await patch({ title: 'renamed', label_ids: [99] })
    expect(res.status).toBe(400)
    // The whole patch is refused — a partial apply would be the silent no-op
    // wearing a different hat.
    expect(applied).toEqual([])
  })
})
