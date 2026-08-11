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
  platformWorkspaceSource,
  platformUploadLedger,
  type AppContext,
} from '@blackcode/platform-api'
import { verifyToken } from '@blackcode/platform-auth'
import { getDb } from './db/client'
import { APP_SLUG } from './app'

/**
 * The caller, from a `bk_live_…` bearer token.
 *
 * Token only, deliberately. The browser half is a NextAuth session, and NextAuth
 * config is genuinely app-specific (providers, callbacks, cookie domain) — see
 * the note in `packages/platform-auth/src/index.ts` explaining why
 * `apps/issues/lib/auth.ts` stayed put. A new app adds that when it grows a UI;
 * the CLI path works from the first commit, which is the path agents use.
 */
async function resolveUser(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  return verifyToken(getDb(), header.slice('Bearer '.length).trim())
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
  // `platform.workspaces`, for now. That is the smallest honest answer while
  // this scaffold has no sign-up, no members page and no tenancy tables of its
  // own — a copy of it is not usable until somebody grants it a workspace, which
  // is exactly the add-on shape `apps/sales` spent Phase 2 leaving behind.
  //
  // **Phase 7 of multiAppFinalRefactor changes this**, and it is the point of
  // that phase: the scaffold gains its own workspaces/members/invitations so the
  // DEFAULT for a new app is independence, and this line becomes
  // `scaffoldWorkspaceSource`. Until then, read
  // `packages/platform-api/src/workspace-source.ts` and `apps/sales/lib/api.ts`
  // before copying this app for anything real.
  //
  // A getter for the same reason `db` is one: `platformWorkspaceSource` closes
  // over the client, so building it eagerly here would open a connection at
  // module import time and make the app unbuildable without a DATABASE_URL.
  get workspaces() {
    return platformWorkspaceSource(getDb())
  },

  // ── WHERE THIS APP RECORDS ITS UPLOADS ────────────────────────────────────
  // `platform.uploads`, for now, and the same caveat as `workspaces` above
  // applies: Phase 7 of multiAppFinalRefactor gives the scaffold its own
  // tenancy, and a `sales.uploads`-shaped ledger goes with it. The STORE is
  // shared either way — one Blob store, one quota, one
  // `platform.blob_references` — so this field is about the record, not the
  // bytes. Read `packages/platform-api/src/upload-ledger.ts` before copying it.
  //
  // A getter for `db`'s reason: it closes over the client.
  get uploads() {
    return platformUploadLedger(getDb(), APP_SLUG)
  },

  resolveUser,
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
