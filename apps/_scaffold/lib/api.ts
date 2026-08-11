// This app, as the shared request layer sees it — plus the two things every
// route imports: `apiHandler` and `resolveWorkspace`.
//
// ---------------------------------------------------------------------------
// THIS FILE USED TO CONTAIN THE IMPLEMENTATION. IT NO LONGER DOES.
// ---------------------------------------------------------------------------
// Until 2026-08-06 this was ~60 lines duplicating `apps/issues`, under a long
// header arguing that extracting them was deliberately deferred until a REAL
// second app needed them unchanged. `apps/sales` is that app, the extraction
// happened (docs/sales-app-plan.md Phase 1a, decision D-2), and the argument is
// gone rather than left sitting here — a doc that prescribes a superseded design
// is how the next person re-litigates a settled one.
//
// What you get from the shared version that the copy never had:
//   - `platform.error_events` logging, so `bk super-admin errors` covers this
//     app from its first commit instead of being an item on a checklist
//   - the agent breadcrumb headers, and the X-BK-CLI-* version headers
//   - one implementation of the 401/404/403 gates, so a new app cannot get the
//     404-vs-403 distinction subtly wrong (read them in
//     `packages/platform-api/src/handler.ts` before changing any of them)
//
// WHAT YOU STILL OWN when you copy this app: the four lines of `appContext`
// below. Everything else follows from them.
import type { NextRequest } from 'next/server'
import {
  createApiHandler,
  createResolveWorkspace,
  type AppContext,
  type UploadLedger,
  type WorkspaceSource,
} from '@blackcode/platform-api'
import { verifyToken } from '@blackcode/platform-auth'
import { getDb } from './db/client'
import { getValidatedSessionUser } from './auth/session'
import { APP_SLUG } from './app'
import {
  getWorkspaceById,
  getWorkspaceForUser,
  listWorkspaceMembers,
  listWorkspacesForUser,
} from './db/queries/workspaces'

/**
 * The caller, from a `bk_live_…` bearer token **or** a browser session.
 *
 * ── THE ORDER IS NOT ARBITRARY ──────────────────────────────────────────────
 * Token first. A request carrying an explicit `Authorization` header is stating
 * which credential it wants used; falling through to an ambient cookie when that
 * token is invalid would mean a revoked token silently kept working for anyone
 * signed in in the same browser. A bad token is an answer, not a reason to look
 * elsewhere.
 *
 * The session half arrives with a web surface: every fetch the dashboard makes
 * goes to this app's own origin carrying a cookie and no Authorization header,
 * so without this branch every page would 401 against its own API.
 */
async function resolveUser(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (header.startsWith('Bearer ')) {
    return verifyToken(getDb(), header.slice('Bearer '.length).trim())
  }
  return getValidatedSessionUser()
}

/**
 * THIS APP'S WORKSPACES ARE `scaffold.workspaces` (Phase 7, 2026-08-11).
 *
 * This field used to be `platformWorkspaceSource(getDb())`, with a header saying
 * "`platform.workspaces`, for now" and naming this phase as where it changed. It
 * was right: an app copied from here would have been born unable to serve a
 * request until somebody granted it a workspace in ANOTHER app.
 *
 * ── THE NO-OP BELOW IS THE INTERESTING PART ─────────────────────────────────
 * `setDefaultForUser` does nothing, and that is not an omission.
 * `platform.users.active_workspace_id` is ONE column shared by every deployment.
 * After the split, a scaffold workspace id written into it is read back by
 * `apps/issues` as one of ITS ids — by `/api/meta`, by the dashboard's default
 * picker, and by upload attribution. Writing it would be the
 * `error_events.workspace_id` ambiguity all over again, in the identity table.
 *
 * Nothing is lost: `getDefaultForUser` answers from this app's own tenancy, and
 * `bk scaffold workspace use` persists its choice in the CLI's own per-app
 * config (agent 5 keyed `ActiveWorkspaces` by app slug for exactly this reason).
 */
const scaffoldWorkspaceSource: WorkspaceSource = {
  getForUser: (slugOrId, userId) => getWorkspaceForUser(slugOrId, userId),
  listForUser: (userId) => listWorkspacesForUser(userId),
  getById: (id) => getWorkspaceById(id),
  listMembers: (workspaceId) => listWorkspaceMembers(workspaceId),
  setDefaultForUser: async () => {},
  getDefaultForUser: async (userId) => {
    const mine = await listWorkspacesForUser(userId)
    return mine.length > 0 ? mine[mine.length - 1] : null
  },
}

/**
 * THIS APP RECORDS NO UPLOADS, AND SAYS SO BY THROWING.
 *
 * ── WHY NOT `platformUploadLedger`, WHICH IS WHAT WAS HERE ──────────────────
 * Because it writes `platform.uploads`, and since Phase 3 the ledger is per app:
 * `apps/sales` writes `sales.uploads`, and only the Blob STORE, the quota and
 * `platform.blob_references` are still shared. Leaving the platform ledger wired
 * up here would teach every copy of this app the one coupling the refactor
 * removed, in a field it never calls.
 *
 * ── WHY NOT A `scaffold.uploads` TABLE ──────────────────────────────────────
 * Because this app serves no `/api/upload` route, and a table with no writer is
 * a shape somebody later mistakes for a feature (agent 2's rule, applied to
 * `sales.deletion_batches`). Creating one would be inventing a ledger for
 * uploads that cannot happen.
 *
 * ── SO WHY DOES THE FIELD EXIST? ────────────────────────────────────────────
 * `AppContext.uploads` is REQUIRED, and required is what makes a new app answer
 * rather than inherit. The honest answer for an app with no upload route is "not
 * this one", and the honest way to say it in a required field is a value that
 * FAILS LOUDLY if anything reaches it — the same proxy shape `apps/issues` uses
 * for its test fixtures.
 *
 * **When you add an upload route to your copy, replace this** — see
 * `apps/sales/lib/db/queries/uploads.ts` for the worked example, and note that
 * its `attribute` resolves the workspace through THIS APP'S source rather than
 * `platform.users.active_workspace_id`. Agent 4 found that fallback filing sales
 * uploads under an issues workspace's blob prefix.
 */
const noUploadLedger: UploadLedger = {
  attribute: async () => {
    throw new Error(
      'apps/_scaffold records no uploads: it serves no /api/upload route. If you ' +
        'have just mounted one, give this app its own ledger table and replace ' +
        '`noUploadLedger` in lib/api.ts — see apps/sales/lib/db/queries/uploads.ts.'
    )
  },
  record: async () => {
    throw new Error(
      'apps/_scaffold records no uploads: it serves no /api/upload route. If you ' +
        'have just mounted one, give this app its own ledger table and replace ' +
        '`noUploadLedger` in lib/api.ts — see apps/sales/lib/db/queries/uploads.ts.'
    )
  },
}

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  // A GETTER, not `db: getDb()`. Calling it here would open a connection at
  // module import time, and `next build` imports every route module to collect
  // page data — so an eager client makes the app unbuildable without a
  // DATABASE_URL. See the header of ./db/client.ts, which is where that was
  // found the hard way.
  get db() {
    return getDb()
  },

  // ── WHERE THIS APP'S WORKSPACES LIVE ──────────────────────────────────────
  // Its own, since 2026-08-11. See `scaffoldWorkspaceSource` above.
  //
  // No getter is needed, unlike `db`: these functions call `getDb()` when they
  // RUN, so nothing opens a connection at module import time and `next build`
  // can still collect page data without a DATABASE_URL.
  workspaces: scaffoldWorkspaceSource,

  // ── WHERE THIS APP RECORDS ITS UPLOADS ────────────────────────────────────
  // Nowhere — it serves no upload route, and says so by throwing. See
  // `noUploadLedger` above before you assume this is a gap.
  uploads: noUploadLedger,

  resolveUser,

  // Session ONLY — never a bearer token. `/api/tokens` and `/api/cli/authorize`
  // use this one where an app mounts them, because a token that can mint another
  // token is privilege escalation: revoking the original does not revoke what it
  // created. Passed by reference rather than wrapped so the wiring stays
  // observable to a test.
  resolveSessionUser: getValidatedSessionUser,
  // No `manifest`: this scaffold has no agent landing page, and a X-BK-Help
  // header pointing at a 404 is worse than no header. A real app adds one.
  //
  // No `redactBody` either — see `AppContext` for when an app wants it. An app
  // holding personal data about people outside the company does.
}

export const apiHandler = createApiHandler(appContext)
export const resolveWorkspace = createResolveWorkspace(appContext)

export { requireOwner } from '@blackcode/platform-api'
export type { WorkspaceContext } from '@blackcode/platform-api'
