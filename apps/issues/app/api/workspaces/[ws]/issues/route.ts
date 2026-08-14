import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, Errors, resolveWorkspace, resolveEntityId, publicIssue } from '@/lib/api'
import {
  createIssue,
  getIssueInWorkspace,
  listIssuesInWorkspace,
} from '@/lib/db/queries/issues'
import { getMembership } from '@/lib/db/queries/workspaces'
import { ISSUE_TITLE_MAX, LABEL_NAME_MAX } from '@/lib/limits'
import { ISSUE_STATUS_VALUES } from '@/lib/work-items'

interface Params {
  params: Promise<{ ws: string }>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// A FILTER THIS ROUTE CANNOT UNDERSTAND IS A 400, NEVER A DROPPED CLAUSE.
//
// `?priority=urgent` used to `parseInt` to NaN, collapse to `undefined`, and
// return EVERY issue in the workspace under a request that had asked for the
// urgent ones. `?status=Done` matched nothing and read as an empty project.
// Both are the two failure modes of a filter, and neither said a word — which is
// why every parse below either produces a clause or throws.
function filterInt(raw: string | null, code: string, msg: string, hint: string): number | undefined {
  if (raw === null || raw === '') return undefined
  const n = parseInt(raw, 10)
  if (Number.isNaN(n) || String(n) !== raw.trim()) throw Errors.badRequest(code, msg, hint)
  return n
}

// project_id / task_id query params are workspace #numbers (seq). 'null' filters
// for unscoped issues; absent = no filter. Returns the internal id to filter on.
async function seqFilter(
  workspaceId: number,
  type: 'project' | 'task',
  raw: string | null
): Promise<number | null | undefined> {
  if (raw === null) return undefined
  if (raw === 'null') return null
  return resolveEntityId(workspaceId, type, raw)
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const sp = req.nextUrl.searchParams

  // Assignee filter: ?assignee_id=null (unassigned), ?assignee_id=1 (single),
  // or ?assignee_ids=1&assignee_ids=2 (multi). Assignees are user ids.
  //
  // Unparseable ids used to be dropped: `?assignee_ids=alice` filtered to the
  // empty list, which the query reads as "no assignee filter", so a request
  // naming one person came back with the whole workspace. They are a 400 now.
  const badAssignee = 'assignee ids are user ids — `bk issues issue list --assignee <email>` resolves a name for you, or pass null for unassigned'
  let assigneeIds: number[] | null | undefined
  const assigneeIdRaw = sp.get('assignee_id')
  const assigneeIdsRaw = sp.getAll('assignee_ids')
  if (assigneeIdsRaw.length > 0) {
    assigneeIds = assigneeIdsRaw.map((raw) => {
      const n = parseInt(raw, 10)
      if (Number.isNaN(n)) throw Errors.badRequest('invalid_assignee_ids', `assignee_ids must be integers; got ${JSON.stringify(raw)}`, badAssignee)
      return n
    })
  } else if (assigneeIdRaw === 'null') {
    assigneeIds = null
  } else if (assigneeIdRaw !== null && assigneeIdRaw !== '') {
    const n = parseInt(assigneeIdRaw, 10)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_assignee_id', `assignee_id must be an integer or null; got ${JSON.stringify(assigneeIdRaw)}`, badAssignee)
    assigneeIds = [n]
  }

  // Creator filter: ?reporter_id=null (no creator), ?reporter_id=1 (single), or
  // ?reporter_ids=1&reporter_ids=2 (multi). Same shape and the same 400-on-junk
  // rule as the assignee filter above, for the same reason: an unparseable id
  // that got dropped would widen the query to the whole workspace, and a caller
  // cannot see that the filter it asked for was silently not applied.
  const badReporter = 'creator ids are user ids — `bk issues issue list --created-by <email>` resolves a name for you, or pass null for issues whose creator was deleted'
  let reporterIds: number[] | null | undefined
  const reporterIdRaw = sp.get('reporter_id')
  const reporterIdsRaw = sp.getAll('reporter_ids')
  if (reporterIdsRaw.length > 0) {
    reporterIds = reporterIdsRaw.map((raw) => {
      const n = parseInt(raw, 10)
      if (Number.isNaN(n)) throw Errors.badRequest('invalid_reporter_ids', `reporter_ids must be integers; got ${JSON.stringify(raw)}`, badReporter)
      return n
    })
  } else if (reporterIdRaw === 'null') {
    reporterIds = null
  } else if (reporterIdRaw !== null && reporterIdRaw !== '') {
    const n = parseInt(reporterIdRaw, 10)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_reporter_id', `reporter_id must be an integer or null; got ${JSON.stringify(reporterIdRaw)}`, badReporter)
    reporterIds = [n]
  }

  const status = sp.get('status') ?? undefined
  if (status !== undefined && !ISSUE_STATUS_VALUES.includes(status as never)) {
    throw Errors.badRequest(
      'invalid_status',
      `status must be one of: ${ISSUE_STATUS_VALUES.join(', ')}`,
      'run `bk meta` for the current status values'
    )
  }

  const priority = filterInt(
    sp.get('priority'),
    'invalid_priority',
    'priority must be an integer 1-5 (1 = urgent)',
    'the CLI takes names too — `bk issues issue list --priority urgent`'
  )
  if (priority !== undefined && (priority < 1 || priority > 5)) {
    throw Errors.badRequest('invalid_priority', 'priority must be an integer 1-5 (1 = urgent)')
  }

  // Repeatable: ?label=bug&label=regression. An issue carrying ANY of them
  // matches — the OR is stated in the CLI's help for the same reason it is
  // stated here, because a caller cannot see which one a filter chose.
  const labelNames = sp.getAll('label').map((s) => s.trim()).filter(Boolean)

  const dueBefore = sp.get('due_before') ?? undefined
  if (dueBefore !== undefined && !ISO_DATE.test(dueBefore)) {
    throw Errors.badRequest(
      'invalid_due_before',
      'due_before must be a date in YYYY-MM-DD form',
      'it is INCLUSIVE — due_before=2026-08-14 returns issues due ON the 14th as well'
    )
  }

  const page = await listIssuesInWorkspace(ctx.workspace.id, {
    projectId: await seqFilter(ctx.workspace.id, 'project', sp.get('project_id')),
    taskId: await seqFilter(ctx.workspace.id, 'task', sp.get('task_id')),
    assigneeIds,
    reporterIds,
    status,
    priority,
    labels: labelNames.length > 0 ? labelNames : undefined,
    dueBefore,
    search: sp.get('search') ?? undefined,
  })
  return NextResponse.json({ data: page.data.map(publicIssue), total: page.total })
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    throw Errors.badRequest('invalid_body', 'expected JSON object')
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) throw Errors.badRequest('invalid_title', 'title is required')
  if (title.length > ISSUE_TITLE_MAX)
    throw Errors.badRequest('title_too_long', `title max ${ISSUE_TITLE_MAX} chars`)

  // project_id / task_id in the body are workspace #numbers (seq) → resolve to
  // the internal id (also validates they exist in this workspace).
  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') {
      throw Errors.badRequest('invalid_project_id', 'project_id must be an integer or null')
    }
    projectId = await resolveEntityId(ctx.workspace.id, 'project', String(body.project_id))
  }
  let taskId: number | null = null
  if (body.task_id != null) {
    if (typeof body.task_id !== 'number') {
      throw Errors.badRequest('invalid_task_id', 'task_id must be an integer or null')
    }
    taskId = await resolveEntityId(ctx.workspace.id, 'task', String(body.task_id))
  }

  // Accept assignee_ids (preferred) or legacy assignee_id (single). User ids.
  const rawAssigneeIds: number[] = []
  if (Array.isArray(body.assignee_ids)) {
    for (const v of body.assignee_ids) {
      if (typeof v !== 'number') throw Errors.badRequest('invalid_assignee_ids', 'assignee_ids must be an array of integers')
      rawAssigneeIds.push(v)
    }
  } else if (body.assignee_id != null) {
    if (typeof body.assignee_id !== 'number') {
      throw Errors.badRequest('invalid_assignee_id', 'assignee_id must be an integer or null')
    }
    rawAssigneeIds.push(body.assignee_id)
  }
  for (const uid of rawAssigneeIds) {
    const member = await getMembership(ctx.workspace.id, uid)
    if (!member) throw Errors.badRequest('assignee_not_member', `User ${uid} is not a workspace member`)
  }

  // Labels: existing ids via label_ids, and/or names via labels. Label ids are
  // their own (workspace-scoped) ids, not seq.
  let labelIds: number[] | undefined
  if (body.label_ids !== undefined) {
    if (!Array.isArray(body.label_ids) || !body.label_ids.every((n: unknown) => typeof n === 'number')) {
      throw Errors.badRequest(
        'invalid_label_ids',
        'label_ids must be an array of integers; pass label names via "labels" to use or create them by name'
      )
    }
    labelIds = body.label_ids
  }
  let labelNames: string[] | undefined
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || !body.labels.every((s: unknown) => typeof s === 'string')) {
      throw Errors.badRequest('invalid_labels', 'labels must be an array of label-name strings')
    }
    const names = (body.labels as string[]).map((s) => s.trim()).filter(Boolean)
    for (const n of names) {
      if (n.length > LABEL_NAME_MAX)
        throw Errors.badRequest('label_name_too_long', `label names are max ${LABEL_NAME_MAX} chars`)
    }
    labelNames = names
  }

  try {
    const created = await createIssue({
      workspaceId: ctx.workspace.id,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      status: typeof body.status === 'string' ? body.status : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      assigneeIds: rawAssigneeIds,
      taskId,
      projectId,
      startDate: typeof body.start_date === 'string' ? body.start_date : null,
      dueDate: typeof body.due_date === 'string' ? body.due_date : null,
      estimatedHours: typeof body.estimated_hours === 'number' ? body.estimated_hours : null,
      labelIds,
      labelNames,
      reporterId: ctx.user.id,
      actorUserId: ctx.user.id,
    })
    // Re-fetch the joined row so the response carries parent seqs for FK fields.
    const full = await getIssueInWorkspace(ctx.workspace.id, created.id)
    return NextResponse.json(publicIssue(full ?? created), { status: 201 })
  } catch (err) {
    const m = (err as Error)?.message
    if (m === 'invalid_status') throw Errors.badRequest('invalid_status', 'invalid status value')
    if (m === 'invalid_priority') throw Errors.badRequest('invalid_priority', 'priority must be 1-5')
    throw err
  }
})
