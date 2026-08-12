import { NextRequest, NextResponse } from 'next/server'
import {
  apiHandler,
  Errors,
  resolveWorkspace,
  resolveEntityId,
  publicProject,
  projectVocabularyError,
} from '@/lib/api'
import {
  deleteProject,
  getProjectInWorkspace,
  updateProject,
} from '@/lib/db/queries/projects'
import { previewDeletion, type DeleteMode } from '@/lib/db/queries/deletion'
import {
  listProjectMembers,
  setProjectMembers,
} from '@/lib/db/queries/project-relations'
import { db } from '@/lib/db/client'

interface Params {
  params: Promise<{ ws: string; id: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'project', idStr)

  // ?preview=1 reports how many attached issues/tasks a delete would touch.
  if (req.nextUrl.searchParams.get('preview')) {
    const counts = await previewDeletion(ctx.workspace.id, 'project', id)
    return NextResponse.json(counts)
  }

  const project = await getProjectInWorkspace(ctx.workspace.id, id)
  if (!project) throw Errors.notFound('project')
  const members = await listProjectMembers(id)
  return NextResponse.json({ ...publicProject(project), members })
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'project', idStr)
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  // member_ids replaces the full set when present.
  if (Array.isArray(body.member_ids)) {
    const ids = body.member_ids.filter((n: unknown): n is number => typeof n === 'number')
    await setProjectMembers(db, id, ids)
  }

  let updated
  try {
    updated = await updateProject(ctx.workspace.id, id, body, ctx.user.id)
  } catch (err) {
    throw projectVocabularyError(err)
  }
  if (!updated) throw Errors.notFound('project')
  const members = await listProjectMembers(id)
  return NextResponse.json({ ...publicProject(updated), members })
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, id: idStr } = await params
  const ctx = await resolveWorkspace(req, ws)
  const id = await resolveEntityId(ctx.workspace.id, 'project', idStr)

  const mode: DeleteMode = req.nextUrl.searchParams.get('mode') === 'cascade' ? 'cascade' : 'detach'
  const ok = await deleteProject(ctx.workspace.id, id, ctx.user.id, mode)
  if (!ok) throw Errors.notFound('project')
  return NextResponse.json({ deleted: true, mode })
})
