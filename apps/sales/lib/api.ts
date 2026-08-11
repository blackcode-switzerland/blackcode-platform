// This app, as the shared request layer sees it — plus the two things every
// route imports: `apiHandler` and `resolveWorkspace`.
//
// The implementation lives in `@blackcode/platform-api` (D-2, Phase 1a). What
// this file owns is the `appContext` below; everything else follows from it.
import type { NextRequest } from 'next/server'
import {
  createApiHandler,
  createResolveWorkspace,
  type AppContext,
  type WorkspaceSource,
} from '@blackcode/platform-api'
import { verifyToken } from '@blackcode/platform-auth'
import { getDb } from './db/client'
import { getValidatedSessionUser } from './auth/session'
import { APP_SLUG } from './app'
import {
  getWorkspaceForUser,
  listWorkspaceMembers,
  listWorkspacesForUser,
} from './db/queries/workspaces'
import { salesUploadLedger } from './db/queries/uploads'

/**
 * The caller, from a `bk_live_…` bearer token **or** a browser session.
 *
 * The token half was the whole of it until Phase 6, because the CLI path is the
 * path agents use and it had to work from the first commit. The session half
 * arrives with the web surface: every fetch the dashboard makes goes to this
 * app's own origin carrying a cookie and no Authorization header (D-10), so
 * without this branch every page would 401 against its own API.
 *
 * ── THE ORDER IS NOT ARBITRARY ──────────────────────────────────────────────
 * Token first. A request carrying an explicit `Authorization` header is stating
 * which credential it wants used; falling through to an ambient cookie when that
 * token is invalid would mean a revoked token silently kept working for anyone
 * who happened to be signed in in the same browser. A bad token is an answer,
 * not a reason to look elsewhere.
 */
async function resolveUser(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    return verifyToken(getDb(), header.slice('Bearer '.length).trim())
  }
  return getValidatedSessionUser()
}

/**
 * THIS APP'S WORKSPACES ARE `sales.workspaces` (Phase 2, 2026-08-10).
 *
 * ── WHAT CHANGED, IN ONE SENTENCE ──────────────────────────────────────────
 * A person no longer needs an ISSUES workspace to hold a sales account. Before
 * this, every shared route resolved `platform.workspaces`, so "who may use
 * b/sales" was decided in another app's tenancy table and gated by
 * `platform.workspace_apps` — which is why this app's own files never named
 * `workspace_members` while depending on it completely.
 *
 * ── THE NO-OP BELOW IS THE INTERESTING PART ────────────────────────────────
 * `setDefaultForUser` does nothing here, and that is not an omission. Read it
 * before deciding it is a gap.
 *
 * There were TWO no-ops until 2026-08-10. `assertAppAccess` is gone from the
 * interface entirely: Phase 5 dropped `platform.app_access`, so the platform
 * implementation it was defined against no longer exists either, and a method
 * every app implements as an empty function is not a seam.
 */
const salesWorkspaces: WorkspaceSource = {
  getForUser: (slugOrId, userId) => getWorkspaceForUser(slugOrId, userId),

  // This took a `{ scopedToApp }` argument until 2026-08-10 and answered both
  // ways identically, because there is no app-inside-a-workspace to scope to: a
  // `sales.workspaces` row is this app's, entirely. Phase 5 removed the argument
  // from the interface — the platform implementation stopped being able to
  // narrow too, so every app now answers the one question.
  listForUser: (userId) => listWorkspacesForUser(userId),

  listMembers: (workspaceId) => listWorkspaceMembers(workspaceId),

  // ── DELIBERATELY NOT `setActiveWorkspace` ─────────────────────────────────
  // `platform.users.active_workspace_id` is ONE column shared by every app, and
  // after the split a sales workspace id written into it is read back by
  // `apps/issues` as an ISSUES workspace id — by `/api/meta`, by the dashboard's
  // default-workspace picker, and by upload attribution. Writing it would be the
  // `error_events.workspace_id` ambiguity all over again, in the identity table.
  //
  // Nothing is lost by not writing it: a person has exactly one sales workspace,
  // so `getDefaultForUser` below already knows the answer, and `bk workspace use`
  // persists its choice in the CLI's own config regardless.
  setDefaultForUser: async () => {},

  // One workspace per person (PLAN.md §1), so "the default" is "theirs" and
  // there is nothing to remember. `listWorkspacesForUser` is ordered oldest-first
  // (it matches the platform listing), so the most recently touched one is the
  // LAST — which is the sensible answer on the day this app grows a switcher and
  // a person has two.
  getDefaultForUser: async (userId) => {
    const mine = await listWorkspacesForUser(userId)
    return mine.length > 0 ? mine[mine.length - 1] : null
  },
}

/**
 * THIS APP'S UPLOAD LEDGER IS `sales.uploads` (Phase 3, 2026-08-10).
 *
 * Built from the workspace source above rather than importing its own, so both
 * AppContext fields agree about where this app's workspaces live. The store,
 * the quota and `platform.blob_references` are shared and unchanged — only the
 * record of which files exist moved. See `lib/db/queries/uploads.ts`.
 */
const salesUploads = salesUploadLedger(salesWorkspaces)

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  workspaces: salesWorkspaces,
  uploads: salesUploads,
  // A GETTER, not `db: getDb()`. Calling it here would open a connection at
  // module import time, and `next build` imports every route module to collect
  // page data — so an eager client makes the app unbuildable without a
  // DATABASE_URL. See the header of ./db/client.ts.
  get db() {
    return getDb()
  },
  resolveUser,

  // Session ONLY — never a bearer token. `/api/tokens` and `/api/cli/authorize`
  // use this one, because a token that can mint another token is privilege
  // escalation: revoking the original does not revoke what it created. Passed by
  // reference rather than wrapped so the wiring stays observable to a test.
  // Full reasoning: `packages/platform-api/src/app-context.ts`.
  resolveSessionUser: getValidatedSessionUser,

  // ── D-19 ITEM 2 — AND READ ITS CEILING BEFORE QUOTING IT ───────────────────
  // Sales holds names, emails, phone numbers and free-text notes about people at
  // OTHER companies. `sanitize()` strips credentials by KEY NAME; it cannot know
  // that `contact_email` or `call_notes` matter. So this app opts out of
  // carrying `ApiError.details` into `platform.error_events.context` entirely,
  // and a `{ redacted: 'body' }` marker distinguishes "withheld" from "there was
  // none".
  //
  // WHAT IT DOES NOT DO, stated here so nobody claims more than it delivers:
  // `message` and `stack` are recorded regardless, and a Postgres driver will
  // put a rejected value straight into an error message ("Key (email)=(…)
  // already exists"). Redacting those was considered and REJECTED — an error row
  // nobody can triage is not a privacy win. **The honest control on message and
  // stack is retention**, D-19 item 1's 90-day horizon, which covers sales error
  // rows too. See docs/sales-app-plan.md §12 and
  // packages/platform-api/src/handler.ts at `errorLogContext`.
  redactBody: true,

  // No `manifest`: sales has no agent landing page yet, and an X-BK-Help header
  // pointing at a 404 is worse than no header. It arrives with Phase 6.
}

export const apiHandler = createApiHandler(appContext)
export const resolveWorkspace = createResolveWorkspace(appContext)

export { requireOwner } from '@blackcode/platform-api'
export type { WorkspaceContext } from '@blackcode/platform-api'
