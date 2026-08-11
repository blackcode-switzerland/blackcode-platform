// GET /api/workspaces/{ws}/invite-candidates — `bk invite candidates`.
//
// This app's own since Phase 2. The shared factory reads
// `platform.workspace_members`, so it suggested people you share an ISSUES
// workspace with — which is precisely the coupling this refactor removes: an
// issues colleague is not a sales colleague.
//
// Owner-only, the same gate as POST /invitations: this answers "who do you
// already share a workspace with", which a non-owner has no reason to be able
// to ask.
//
// ── `is_super_admin` WIDENS THE LIST AGAIN, AND THIS PARAGRAPH REPLACES THE
//    ONE THAT SAID IT MUST NOT (2026-08-11) ──────────────────────────────────
//
// What stood here: handing a super admin every account would be "a directory of
// everyone with an issues login, offered inside sales", and a super admin who
// wants to invite a stranger can type the address.
//
// The second half is what did not survive. Typing the address is only cheaper
// than picking from a list if you already know it — and the job this exists for
// is the opposite one: somebody has a blackcode account and needs putting into
// b/sales, and the person doing it knows their NAME. The refusal did not
// protect anything either, because the capability was never withheld: a super
// admin can already invite any address, and `platform.email_whitelist` is what
// decides who may hold an account at all. All the refusal removed was knowing
// whether the address you were about to type was the one on file.
//
// The FIRST half is answered by keeping the two sources apart rather than by
// dropping one: candidates carry `from_platform`, the UI renders them as a
// separate, super-admin-only section, and "somebody you already work with" is
// never silently mixed with "somebody who has a login". An ordinary owner's
// list is unchanged and still cannot see past their own workspaces.
//
// This is the same widening `packages/platform-db/src/directory.ts` does for
// `apps/issues`; the difference that remains is the tenancy — the shared half
// of the list is `sales.workspace_members`, never `platform.workspace_members`.
import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@blackcode/platform-api'
import { isSuperAdmin } from '@blackcode/platform-auth'
import { apiHandler, resolveWorkspace } from '@/lib/api'
import { listInviteCandidates } from '@/lib/db/queries/workspaces'

interface Params {
  params: Promise<{ ws: string }>
}

export const GET = apiHandler(async (req: NextRequest, { params }: Params) => {
  const { ws } = await params
  const ctx = await resolveWorkspace(req, ws)
  if (ctx.role !== 'owner') {
    throw Errors.forbidden('Only the workspace owner can perform this action')
  }

  // Asked ONCE and used for both, so the list and the flag cannot disagree —
  // a payload whose `is_super_admin` is false while carrying platform rows (or
  // the reverse) would put the UI's gate and the data on opposite sides.
  const superAdmin = isSuperAdmin(ctx.user.email)

  const data = await listInviteCandidates({
    userId: ctx.user.id,
    currentWorkspaceId: ctx.workspace.id,
    includePlatform: superAdmin,
  })
  return NextResponse.json({ data, is_super_admin: superAdmin })
})
