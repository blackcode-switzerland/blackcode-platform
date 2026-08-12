import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, jsonList, publicTask } from '@/lib/api'
import {
  createTask,
  getTaskInWorkspace,
  listTasksInWorkspace,
} from '@/lib/db/queries/tasks'
import { TASK_NAME_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  // project_id filter is a workspace #number (seq); 'null' = standalone tasks.
  let projectId: number | null | undefined
  const raw = sp.get('project_id')
  if (raw === 'null') projectId = null
  else if (raw) projectId = await resolveEntityId(ctx.workspace.id, 'project', raw)

  const data = await listTasksInWorkspace(ctx.workspace.id, {
    projectId,
    search: sp.get('search') ?? undefined,
  })
  return jsonList(data.map(publicTask))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  // Symmetric with PATCH: a task's status is derived from its issues. Accepting
  // and ignoring the field would let a caller believe it had set one.
  if ('status' in body) {
    throw Errors.badRequest(
      'task_status_derived',
      "a task's status is derived from its issues and cannot be set",
      'create the task, then attach issues — bk issues task attach <task> <issue…>'
    )
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > TASK_NAME_MAX)
    throw Errors.badRequest('name_too_long', `name max ${TASK_NAME_MAX} chars`)

  // project_id is a workspace #number (seq) → resolve to the internal id.
  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    projectId = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }

  const task = await createTask({
    workspaceId: ctx.workspace.id,
    projectId,
    name,
    description: typeof body.description === 'string' ? body.description : null,
    due_date: typeof body.due_date === 'string' ? body.due_date : null,
    // Absent → default the lead to the creator (mirrors projects). An EXPLICIT
    // null → genuinely no lead. Those are different requests and used to
    // collapse into the same one, so `--lead none` on create silently made the
    // caller the lead — the opposite of what it says.
    lead_user_id:
      body.lead_user_id === null
        ? null
        : typeof body.lead_user_id === 'number'
          ? body.lead_user_id
          : ctx.user.id,
    actorUserId: ctx.user.id,
  })
  // Re-fetch the joined row so project_id (FK) serializes to the project seq.
  const full = await getTaskInWorkspace(ctx.workspace.id, task.id)
  return NextResponse.json(publicTask(full ?? task), { status: 201 })
})
