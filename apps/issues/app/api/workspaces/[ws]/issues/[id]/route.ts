import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, publicIssue } from '@/lib/api'
import {
  deleteIssue,
  getIssueInWorkspace,
  updateIssue,
} from '@/lib/db/queries/issues'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const issue = await getIssueInWorkspace(ctx.workspace.id, id)
  if (!issue) throw Errors.notFound('issue')
  return NextResponse.json(publicIssue(issue))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // LABELS ARE NOT PATCHABLE HERE, AND SAYING SO IS THE POINT.
  //
  // `updateIssue` copies a fixed whitelist of fields out of the patch, so
  // `labels` / `label_ids` used to arrive, be dropped on the floor, and come
  // back inside a 200 with the issue unchanged. Two independent reporters
  // concluded from that silence that labeling was a UI-only feature and gave
  // up (Todo/issues-app-feedback.md item 1) — the label sub-resource below was
  // one request away the whole time.
  //
  // Labels live at POST/DELETE …/issues/{id}/labels because they are a
  // many-to-many edge with its own create-on-the-fly-by-name behaviour, not a
  // column on the issue. That stays the one write path; this route's job is to
  // stop pretending it is a second one. A rejection an agent can act on beats
  // a success it cannot verify.
  //
  // Deliberately narrow: only these two keys. A blanket unknown-field rejection
  // would break any client sending anything extra, which is a different and
  // breaking decision — see Todo/report-2-issues-feedback.md.
  for (const key of ['labels', 'label_ids'] as const) {
    if (key in body) {
      throw Errors.badRequest(
        'labels_not_patchable',
        `\`${key}\` cannot be set here — labels are a sub-resource, not a field on the issue`,
        'attach with `bk issues label attach <issue_id> <label_id>` (or POST /api/workspaces/{ws}/issues/{id}/labels), detach with `bk issues label detach`; `bk issues issue view <id>` shows the current labels'
      )
    }
  }

  // project_id / task_id are workspace #numbers (seq) → translate to internal ids.
  if ('project_id' in body && body.project_id != null) {
    body.project_id = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }
  if ('task_id' in body && body.task_id != null) {
    body.task_id = await resolveEntityId(ctx.workspace.id, 'task', String(body.task_id))
  }
  try {
    const updated = await updateIssue(ctx.workspace.id, id, body, ctx.user.id)
    if (!updated) throw Errors.notFound('issue')
    const full = await getIssueInWorkspace(ctx.workspace.id, id)
    return NextResponse.json(publicIssue(full ?? updated))
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'issue', idStr)
  const ok = await deleteIssue(ctx.workspace.id, id, ctx.user.id)
  if (!ok) throw Errors.notFound('issue')
  return NextResponse.json({ deleted: true })
})
