// GET  /api/workspaces/{ws}/meetings — the meetings ledger
// POST /api/workspaces/{ws}/meetings — schedule one, or log one that happened
//
// ONE route for both, because they are one insert with a different `status`.
// `bk sales meeting schedule` sends `upcoming`; `bk sales meeting log` sends
// `done` with an outcome. The app is not doing two things — the caller is
// telling it about two different moments.
//
// Workspace-scoped rather than nested under a prospect, because "what am I
// doing this week" spans prospects and is the question the ledger exists for.
// `--prospect` filters it.
import { NextRequest, NextResponse } from 'next/server'
import { Errors, jsonList } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { createMeeting, listMeetings } from '@/lib/db/queries/ledger'
import { prospectIdBySeq } from '@/lib/db/queries/prospect-children'
import { publicMeeting } from '@/lib/views'
import { MEETING_TITLE_MAX, MEETING_URL_MAX } from '@/lib/limits'
import {
  numberOr,
  parseList,
  requireMaxLength,
  requireMeetingUrl,
  str,
} from '@/lib/http-input'
import { MEETING_STATUS_VALUES, MEETING_TYPE_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string }>
}

function requireDate(raw: string | undefined, field: string): Date {
  const d = raw ? new Date(raw) : null
  if (!d || Number.isNaN(d.getTime())) {
    throw Errors.badRequest(
      `invalid_${field}`,
      `${field} must be an ISO 8601 timestamp, got ${JSON.stringify(raw ?? null)}`,
      'e.g. --at 2026-08-11T10:00:00Z — resolve "Thursday" to a real instant first'
    )
  }
  return d
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const q = req.nextUrl.searchParams

  const statuses = parseList(q.get('status'))
  for (const s of statuses) {
    if (!MEETING_STATUS_VALUES.includes(s)) {
      throw Errors.badRequest(
        'unknown_status',
        `unknown meeting status ${JSON.stringify(s)}`,
        'run `bk meta` for the current values'
      )
    }
  }

  const page = await listMeetings({
    workspaceId: ctx.workspace.id,
    prospectSeq: numberOr(q.get('prospect')),
    statuses,
    from: q.get('from') ? requireDate(q.get('from')!, 'from') : undefined,
    to: q.get('to') ? requireDate(q.get('to')!, 'to') : undefined,
    includeDeleted: q.get('include_deleted') === 'true',
    limit: numberOr(q.get('limit')),
    cursor: numberOr(q.get('cursor')) ?? null,
  })
  return jsonList(
    page.data.map((m) => publicMeeting(m, ctx.workspace.slug)),
    page.next_cursor
  )
})

export const POST = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const prospectSeq = numberOr(String(body?.prospect ?? ''))
  if (prospectSeq == null) {
    throw Errors.badRequest(
      'missing_prospect',
      'prospect is required (its #number)',
      'run `bk sales prospect list` for the numbers'
    )
  }
  const prospectId = await prospectIdBySeq(ctx.workspace.id, prospectSeq)
  if (prospectId == null) {
    throw Errors.notFound(
      'prospect_not_found',
      `no prospect #${prospectSeq} in this workspace`,
      'run `bk sales prospect list --q <name>` to find it'
    )
  }

  const title = str(body?.title)
  if (!title) throw Errors.badRequest('missing_title', 'title is required', 'pass --title "…"')
  requireMaxLength(title, MEETING_TITLE_MAX, 'title')

  const type = str(body?.type)
  if (!type || !MEETING_TYPE_VALUES.includes(type)) {
    throw Errors.badRequest(
      'unknown_meeting_type',
      type ? `unknown meeting type ${JSON.stringify(type)}` : 'type is required',
      'run `bk meta` for the current meeting types'
    )
  }

  const outcome = str(body?.outcome) ?? null
  // The status follows the evidence unless the caller overrides it: an outcome
  // means the meeting happened. Same rule as `updateMeeting`, stated in both
  // places because a caller reading one route should not have to find the other.
  const status = str(body?.status) ?? (outcome ? 'done' : 'upcoming')
  if (!MEETING_STATUS_VALUES.includes(status)) {
    throw Errors.badRequest(
      'unknown_status',
      `unknown meeting status ${JSON.stringify(status)}`,
      'run `bk meta` for the current values'
    )
  }

  const attendees = Array.isArray(body?.attendees)
    ? (body.attendees as unknown[]).map(String).filter(Boolean)
    : null

  // Optional on every meeting type, including `call` and `in_person`: a room
  // with a dial-in bridge is both, and refusing the link for an in-person
  // meeting would be the app having an opinion about how people meet.
  const meetingUrl = str(body?.meeting_url) ?? null
  if (meetingUrl) {
    requireMaxLength(meetingUrl, MEETING_URL_MAX, 'meeting_url')
    requireMeetingUrl(meetingUrl)
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await createMeeting({
    workspaceId: ctx.workspace.id,
    prospectId,
    actor,
    startsAt: requireDate(str(body?.at), 'at'),
    type,
    status,
    title,
    durationMin: body?.duration_min == null ? null : Number(body.duration_min),
    attendees,
    agenda: str(body?.agenda) ?? null,
    outcome,
    meetingUrl,
  })
  return NextResponse.json(
    publicMeeting(
      { ...row, prospect_number: prospectSeq, prospect_name: '' },
      ctx.workspace.slug
    ),
    { status: 201 }
  )
})
