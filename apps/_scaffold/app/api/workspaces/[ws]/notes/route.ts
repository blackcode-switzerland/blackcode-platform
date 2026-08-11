// GET  /api/workspaces/{ws}/notes — list this workspace's notes
// POST /api/workspaces/{ws}/notes — create one
//
// The shape every app's routes follow, and each part of it is a contract the
// CLI depends on:
//
//   - workspace-scoped path      `/api/workspaces/{ws}/…`, never an implicit
//                                "active workspace" resolved server-side
//   - auth + tenancy             one `resolveWorkspace` call, which resolves the
//                                workspace through THIS app's own source and
//                                404s anything the caller is not a member of
//   - lists return an envelope   `{ data, next_cursor }`, so pagination can be
//                                added later without breaking a client
//   - create returns 201         and the bare entity, not an envelope
//   - errors carry a suggestion  the CLI prints it as `hint:` — the difference
//                                between an agent stopping and recovering
//
// Every route needs a matching `bk` command with a `routes` annotation, or
// lib/cli-parity.test.ts fails the build. That is not bureaucracy: a route no
// command reaches is a capability agents cannot use.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { createNote, listNotes } from '@/lib/db/queries/notes'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const limitRaw = req.nextUrl.searchParams.get('limit')
  const rows = await listNotes(ctx.workspace.id, limitRaw ? Number(limitRaw) : undefined)
  return jsonList(rows.map(publicNote), null)
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as { title?: unknown; body?: unknown } | null

  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) {
    throw Errors.badRequest('missing_title', 'title is required', 'pass --title "…"')
  }

  const note = await createNote(ctx.workspace.id, {
    title,
    body: typeof body?.body === 'string' ? body.body : null,
    createdBy: ctx.user.id,
  })
  return NextResponse.json(publicNote(note), { status: 201 })
})

/**
 * The public shape of a note.
 *
 * `number` is the workspace #number; the serial `id` is NOT exposed. That is the
 * rule the whole platform follows and the one `bk trash` broke until Phase 8 —
 * once a row id reaches an agent, it ends up in a script, and then it is a
 * contract.
 */
function publicNote(n: { seq: number; title: string; body: string | null; created_at: Date }) {
  return {
    number: n.seq,
    title: n.title,
    body: n.body,
    created_at: n.created_at,
  }
}
