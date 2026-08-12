// GET    /api/workspaces/{ws}/meetings/{n} — one meeting
// PATCH  /api/workspaces/{ws}/meetings/{n} — record the outcome, or cancel it
// DELETE /api/workspaces/{ws}/meetings/{n} — bin it
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { getDb } from '@/lib/db/client'
import { resolveActor } from '@/lib/actor'
import { getMeetingBySeq, softDeleteMeeting, updateMeeting } from '@/lib/db/queries/ledger'
import { publicMeeting } from '@/lib/views'
import { MEETING_TITLE_MAX, MEETING_URL_MAX } from '@/lib/limits'
import {
  nullableStr,
  requireMaxLength,
  requireMeetingUrl,
  requireNumberParam,
  str,
} from '@/lib/http-input'
import { MEETING_STATUS_VALUES } from '@/lib/pipeline'

interface Params {
  params: Promise<{ ws: string; n: string }>
}

const notFound = (seq: number) =>
  Errors.notFound(
    'meeting_not_found',
    `no meeting #${seq} in this workspace`,
    'run `bk sales meeting list` to find it'
  )

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'meeting')
  const row = await getMeetingBySeq(ctx.workspace.id, seq)
  if (!row) throw notFound(seq)
  return NextResponse.json(publicMeeting(row, ctx.workspace.slug))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'meeting')
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  const status = str(body?.status)
  if (status && !MEETING_STATUS_VALUES.includes(status)) {
    throw Errors.badRequest(
      'unknown_status',
      `unknown meeting status ${JSON.stringify(status)}`,
      'run `bk meta` for the current values'
    )
  }
  const title = str(body?.title)
  if (title) requireMaxLength(title, MEETING_TITLE_MAX, 'title')

  const atRaw = str(body?.at)
  const startsAt = atRaw ? new Date(atRaw) : undefined
  if (startsAt && Number.isNaN(startsAt.getTime())) {
    throw Errors.badRequest(
      'invalid_at',
      `at must be an ISO 8601 timestamp, got ${JSON.stringify(atRaw)}`,
      'e.g. 2026-08-11T10:00:00Z'
    )
  }

  // `nullableStr`, so `{"meeting_url": null}` CLEARS the link and omitting the
  // key leaves it alone — the three-way distinction that file's header exists
  // for. A meeting moved from Teams to a phone call has to be able to lose its
  // link, and a PATCH that could only ever set one would make that impossible.
  const meetingUrl = nullableStr(body?.meeting_url)
  if (meetingUrl) {
    requireMaxLength(meetingUrl, MEETING_URL_MAX, 'meeting_url')
    requireMeetingUrl(meetingUrl)
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await updateMeeting(
    ctx.workspace.id,
    seq,
    {
      status,
      title,
      outcome: nullableStr(body?.outcome),
      agenda: nullableStr(body?.agenda),
      startsAt,
      durationMin: body?.duration_min === undefined ? undefined : Number(body.duration_min),
      attendees: Array.isArray(body?.attendees)
        ? (body.attendees as unknown[]).map(String).filter(Boolean)
        : undefined,
      meetingUrl,
    },
    actor
  )
  if (!row) throw notFound(seq)
  return NextResponse.json(publicMeeting(row, ctx.workspace.slug))
})

export const DELETE = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws, n } = await params
  const ctx = await resolveWorkspace(req, ws)
  const seq = requireNumberParam(n, 'meeting')

  const existing = await getMeetingBySeq(ctx.workspace.id, seq)
  if (!existing) throw notFound(seq)

  // The same server-side confirmation as every other irreversible command, and
  // the target is the TITLE rather than the number the caller already typed.
  const confirm = str(req.nextUrl.searchParams.get('confirm'))
  if (!confirm) {
    throw Errors.badRequest(
      'confirm_required',
      'binning a meeting requires its title repeated back',
      `pass --confirm ${JSON.stringify(existing.title)}`
    )
  }
  if (confirm !== existing.title) {
    throw Errors.conflict(
      'confirm_mismatch',
      `--confirm ${JSON.stringify(confirm)} does not name meeting #${seq}`,
      `#${seq} is ${JSON.stringify(existing.title)}`
    )
  }

  const actor = await resolveActor(getDb(), req, ctx.user)
  const row = await softDeleteMeeting(ctx.workspace.id, seq, actor)
  if (!row) throw notFound(seq)
  return NextResponse.json({
    deleted: true,
    type: 'meeting',
    number: row.seq,
    name: row.title,
  })
})
