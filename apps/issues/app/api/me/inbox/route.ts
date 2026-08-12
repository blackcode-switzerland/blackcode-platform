import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { apiHandler, Errors } from '@/lib/api'
import { countUnread, listInbox, type ListInboxFilter } from '@/lib/db/queries/inbox'
import { resolveSeqToId } from '@/lib/db/queries/locate'

// THE INBOX IS GLOBAL BY DEFAULT (decision Q3) AND EVERY FILTER HERE IS OPT-IN.
//
// `project_id` / `task_id` are workspace #numbers, so they are meaningless
// without a workspace: #4 is a different project in every workspace the caller
// belongs to. Passing one without `workspace_id` is a 400 rather than a guess —
// resolving it against "the first workspace that has a #4" would return a
// plausible, wrong feed with nothing to distinguish it from the right one.
async function narrowingFilters(
  sp: URLSearchParams,
  workspaceId: number | null | undefined
): Promise<Pick<ListInboxFilter, 'projectId' | 'taskId' | 'actorUserId' | 'since'>> {
  const out: Pick<ListInboxFilter, 'projectId' | 'taskId' | 'actorUserId' | 'since'> = {}

  for (const [param, type] of [
    ['project_id', 'project'],
    ['task_id', 'task'],
  ] as const) {
    const raw = sp.get(param)
    if (raw === null || raw === '') continue
    if (workspaceId == null) {
      throw Errors.badRequest(
        'workspace_required',
        `${param} is a workspace #number, so it needs workspace_id alongside it`,
        'pass the root --ws flag: `bk issues inbox list --ws <slug> --project <#>`'
      )
    }
    const seq = parseInt(raw, 10)
    if (Number.isNaN(seq)) {
      throw Errors.badRequest(
        `invalid_${param}`,
        `${param} must be the ${type}'s #number`,
        `\`bk issues ${type} list\` shows them`
      )
    }
    const internalId = await resolveSeqToId(workspaceId, type, seq)
    if (internalId == null) throw Errors.notFound(type)
    if (type === 'project') out.projectId = internalId
    else out.taskId = internalId
  }

  const actorRaw = sp.get('actor_id')
  if (actorRaw !== null && actorRaw !== '') {
    const n = parseInt(actorRaw, 10)
    if (Number.isNaN(n)) {
      throw Errors.badRequest(
        'invalid_actor_id',
        'actor_id must be a user id',
        '`bk issues user list` shows ids; the CLI resolves an email or name for you'
      )
    }
    out.actorUserId = n
  }

  const sinceRaw = sp.get('since')
  if (sinceRaw !== null && sinceRaw !== '') {
    const d = new Date(sinceRaw)
    if (Number.isNaN(d.getTime())) {
      throw Errors.badRequest(
        'invalid_since',
        'since must be a date or timestamp (YYYY-MM-DD or an ISO-8601 instant)',
        'a bare date is read as midnight UTC on that day'
      )
    }
    out.since = d
  }

  return out
}

export const GET = apiHandler(async (request: NextRequest) => {
  const user = await resolveUser(request)
  if (!user) throw Errors.unauthorized()

  const sp = request.nextUrl.searchParams
  const countOnly = sp.get('count_only') === 'true'
  const wsRaw = sp.get('workspace_id')
  let workspaceId: number | null | undefined
  if (wsRaw === 'null' || wsRaw === '') workspaceId = null
  else if (wsRaw) {
    const n = parseInt(wsRaw)
    if (Number.isNaN(n)) throw Errors.badRequest('invalid_workspace_id', 'workspace_id must be an integer or null')
    workspaceId = n
  }

  const narrowed = await narrowingFilters(sp, workspaceId)

  if (countOnly) {
    // The count now honours every filter the listing does — it is the number
    // printed under that list, so answering a wider question would be worse than
    // printing nothing.
    const count = await countUnread({ userId: user.id, workspaceId, ...narrowed })
    return NextResponse.json({ unread_count: count })
  }

  const cursor = sp.get('cursor') ? parseInt(sp.get('cursor')!) : null
  if (cursor !== null && Number.isNaN(cursor)) {
    throw Errors.badRequest('invalid_cursor', 'cursor must be an integer')
  }
  const limit = sp.get('limit') ? parseInt(sp.get('limit')!) : undefined
  if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
    throw Errors.badRequest('invalid_limit', 'limit must be a positive integer')
  }

  const result = await listInbox({
    userId: user.id,
    workspaceId,
    type: sp.get('type'),
    unreadOnly: sp.get('unread') === 'true',
    includeArchived: sp.get('include_archived') === 'true',
    archivedOnly: sp.get('archived_only') === 'true',
    ...narrowed,
    cursor,
    limit,
  })
  return NextResponse.json(result)
})
