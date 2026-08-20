// GET   /api/compliance-rules/{rule} — `bk books compliance show`
// PATCH /api/compliance-rules/{rule} — `bk books compliance review`
//
// The review is the fiduciary's sign-off, one rule at a time: approve, edit
// (the corrected wording lands in `edited_logic`, the original stays), or
// reject. Recorded with who and when. Rules are never deleted — a verdict may
// cite one forever — and never reviewed BACK to draft: draft is where rules
// are born, and un-reviewing would erase the fact that somebody looked.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { apiHandler, appContext } from '@/lib/api'
import {
  ComplianceRefused,
  getComplianceRule,
  publicComplianceRule,
  reviewComplianceRule,
  type ReviewRuleData,
} from '@/lib/db/queries/compliance'

interface Params { params: Promise<{ rule: string }> }

export const GET = apiHandler(async (_req: NextRequest, { params }: Params) => {
  const { rule } = await params
  const found = await getComplianceRule(rule)
  if (!found) throw Errors.notFound('rule_not_found', `no compliance rule "${rule}"`)
  return NextResponse.json(publicComplianceRule(found))
})

export const PATCH = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { rule } = await params
  const user = await appContext.resolveUser(req)
  if (!user) throw Errors.unauthorized('a review records who signed it — authenticate first')

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) throw Errors.badRequest('bad_json', 'the payload is not JSON', 'bk books compliance review')

  try {
    const row = await reviewComplianceRule(rule, {
      state: body.state as ReviewRuleData['state'],
      editedLogic: typeof body.edited_logic === 'string' ? body.edited_logic : null,
      note: typeof body.note === 'string' ? body.note : null,
      by: user.email,
    })
    return NextResponse.json(publicComplianceRule(row))
  } catch (e) {
    if (e instanceof ComplianceRefused) {
      if (e.code === 'rule_not_found') throw Errors.notFound(e.code, e.message)
      throw Errors.badRequest(e.code, e.message, e.suggestion)
    }
    throw e
  }
})
