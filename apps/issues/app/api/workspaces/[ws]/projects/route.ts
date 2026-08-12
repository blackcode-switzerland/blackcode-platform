import { NextRequest, NextResponse } from 'next/server'
import {
  apiHandler,
  Errors,
  resolveWorkspace,
  jsonList,
  publicProject,
  projectVocabularyError,
} from '@/lib/api'
import {
  createProject,
  listProjectsInWorkspace,
} from '@/lib/db/queries/projects'
import { PROJECT_NAME_MAX } from '@/lib/limits'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  // Returns every matching project in one shot (no cursor) — see docs/changelog/issues.md.
  const status = sp.get('status') ?? undefined
  const search = sp.get('search') ?? undefined
  const data = await listProjectsInWorkspace(ctx.workspace.id, { status, search })
  return jsonList(data.map(publicProject))
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw Errors.badRequest('invalid_name', 'name is required')
  if (name.length > PROJECT_NAME_MAX)
    throw Errors.badRequest('name_too_long', `name max ${PROJECT_NAME_MAX} chars`)

  const memberIds = Array.isArray(body.member_ids)
    ? body.member_ids.filter((n: unknown): n is number => typeof n === 'number')
    : undefined

  try {
    const project = await createProject({
      workspaceId: ctx.workspace.id,
      name,
      summary: typeof body.summary === 'string' ? body.summary : null,
      description: typeof body.description === 'string' ? body.description : null,
      color: typeof body.color === 'string' ? body.color : undefined,
      icon: typeof body.icon === 'string' ? body.icon : null,
      priority: typeof body.priority === 'string' ? body.priority : undefined,
      lead_user_id: typeof body.lead_user_id === 'number' ? body.lead_user_id : ctx.user.id,
      start_date: typeof body.start_date === 'string' ? body.start_date : null,
      due_date: typeof body.due_date === 'string' ? body.due_date : null,
      status: typeof body.status === 'string' ? body.status : undefined,
      member_ids: memberIds,
      actorUserId: ctx.user.id,
    })
    return NextResponse.json(publicProject(project), { status: 201 })
  } catch (err) {
    throw projectVocabularyError(err)
  }
})
