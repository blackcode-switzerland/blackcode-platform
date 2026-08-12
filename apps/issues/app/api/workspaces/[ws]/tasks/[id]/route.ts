import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, publicTask, publicIssue } from '@/lib/api'
import {
  deleteTask,
  getTaskInWorkspace,
  updateTask,
} from '@/lib/db/queries/tasks'
import { getIssuesByTask } from '@/lib/db/queries/issues'
import { previewDeletion, type DeleteMode } from '@/lib/db/queries/deletion'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'task', idStr)

  if (req.nextUrl.searchParams.get('preview')) {
    const counts = await previewDeletion(ctx.workspace.id, 'task', id)
    return NextResponse.json(counts)
  }

  const m = await getTaskInWorkspace(ctx.workspace.id, id)
  if (!m) throw Errors.notFound('task')

  if (req.nextUrl.searchParams.get('includeIssues') === 'true') {
    const issues = await getIssuesByTask(id)
    return NextResponse.json({ ...publicTask(m), issues: issues.map(publicIssue) })
  }
  return NextResponse.json(publicTask(m))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'task', idStr)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // project_id is a workspace #number (seq); null detaches.
  if ('project_id' in body && body.project_id !== null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    body.project_id = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }

  let updated
  try {
    updated = await updateTask(ctx.workspace.id, id, body, ctx.user.id)
  } catch (err) {
    if ((err as Error)?.message === 'task_status_derived') {
      throw Errors.badRequest(
        'task_status_derived',
        "a task's status is derived from its issues and cannot be set",
        'change the issues instead — bk issues issue edit <id> --status done'
      )
    }
    throw err
  }
  if (!updated) throw Errors.notFound('task')
  const full = await getTaskInWorkspace(ctx.workspace.id, id)
  return NextResponse.json(publicTask(full ?? updated))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'task', idStr)

  const mode: DeleteMode = req.nextUrl.searchParams.get('mode') === 'cascade' ? 'cascade' : 'detach'
  const ok = await deleteTask(ctx.workspace.id, id, ctx.user.id, mode)
  if (!ok) throw Errors.notFound('task')
  return NextResponse.json({ deleted: true, mode })
})
