// This app, as the shared request layer sees it.
//
// `AppContext` is the whole of what `@blackcode/platform-api` needs in order to
// serve a route on this app's behalf: who we are in `platform.apps`, how to talk
// to the database, and how to work out who is calling. The shared `apiHandler`,
// `resolveWorkspace` and every platform route factory are bound to this object
// and nothing else.
//
// It is the mount point for the shared routes too:
//
//   import { searchRoute } from '@blackcode/platform-api/routes'
//   import { appContext } from '@/lib/api'
//   export const GET = searchRoute(appContext)
//
// See `packages/platform-api/src/app-context.ts` for the bar a new field has to
// clear before it is added here.

import {
  platformUploadLedger,
  platformWorkspaceSource,
  type AppContext,
} from '@blackcode/platform-api'
import { db } from '@/lib/db/client'
import { resolveUser } from '@/lib/auth/resolve'
import { getValidatedSessionUser } from '@/lib/auth/session'
import { APP_SLUG } from '@/lib/app'
import { AGENT_MANIFEST } from '@/lib/agent-manifest'

/**
 * The browser-session caller, with NO bearer-token path. Feeds `/api/tokens`,
 * where accepting a token would be privilege escalation — see
 * `AppContext.resolveSessionUser`.
 *
 * ── WHY THE VALIDATED RESOLVER, AS OF 2026-08-06 ────────────────────────────
 * `getValidatedSessionUser` rejects two sessions that a bare
 * `getServerSession` + `getUserByEmail` accepts: one belonging to a soft-deleted
 * user, and one issued BEFORE a password reset (it compares the session's
 * `pwStamp` against the user's `password_changed_at`).
 *
 * The token routes inlined the bare version until today, and the gap mattered:
 * **a session invalidated by a password reset could still mint a long-lived API
 * token, and revoking that session did not revoke what it minted.** A password
 * reset is what somebody does when they believe their account is compromised, so
 * a reset that leaves the attacker able to create a permanent credential does not
 * do the thing it exists to do.
 *
 * Every other session-authenticated path in this app already used this resolver.
 * Changed on its own, deliberately not folded into the extraction that found it —
 * `lib/api/session-resolver.test.ts` is the proof, in both directions.
 */
// Passed by reference, not wrapped in an arrow, so a test can assert that THIS
// is the resolver the app actually wires up. A wrapper would make the wiring
// unobservable, and the wiring is the part that regresses.
const resolveSessionUser = getValidatedSessionUser

export const appContext: AppContext = {
  appSlug: APP_SLUG,
  db,

  // ── THIS APP'S WORKSPACES ARE `platform.workspaces`, AND STAY THERE ────────
  // The multi-app refactor moves SALES onto its own tenancy tables; it moves not
  // one row of this app's. `platformWorkspaceSource` is a thin binding of the
  // five platform-db functions these routes already called, in the same order
  // with the same arguments — including the `workspace_apps` / `app_access`
  // gate, which is still enforced here and behind `PLATFORM_ENFORCE_APP_ACCESS`
  // exactly as before. See packages/platform-api/src/workspace-source.ts.
  //
  // Renaming these tables to `issues.*` was considered and rejected: it would
  // mean moving production data for a cosmetic gain (PLAN.md §2).
  workspaces: platformWorkspaceSource(db, APP_SLUG),

  // ── AND SO IS THIS APP'S UPLOAD LEDGER ────────────────────────────────────
  // `platform.uploads`, unchanged. `platformUploadLedger` is a binding of the
  // two platform-storage calls `/api/upload` already made — `attributeUpload`
  // and `recordUpload`, same arguments, same order — so this app's attribution
  // and its ledger row are unchanged by construction rather than by review.
  // `apps/sales` supplies its own; the Blob store, the quota and
  // `platform.blob_references` are shared by both and untouched.
  uploads: platformUploadLedger(db, APP_SLUG),

  resolveUser,
  resolveSessionUser,
  manifest: {
    help: AGENT_MANIFEST.help,
    changelog: AGENT_MANIFEST.changelog,
  },
  // Absent, deliberately. D-19 item 2 gives `apps/sales` body redaction because
  // it holds names, emails and call notes about people at other companies. This
  // app records issue titles, and its error rows are the only thing that makes a
  // 500 diagnosable. Leaving it off is today's behaviour, unchanged.
}
