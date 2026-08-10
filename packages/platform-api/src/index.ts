export { ApiError, Errors, errorBody } from './errors'
export { jsonList } from './responses'
export type { ListPage } from './responses'
export { sanitize, truncate } from './sanitize'
export * from './limits'

// Per-app access enforcement — the 403-with-a-hint. Moved here from
// @blackcode/platform-auth on 2026-08-06; that file's header says why.
export { requireAppAccess, isAppAccessEnforced } from './require-app-access'
export type { RequireAppAccessArgs } from './require-app-access'

// The shared request layer (2026-08-06, docs/sales-app-plan.md Phase 1a / D-2).
// An app binds these to its own AppContext in `lib/api` — see handler.ts.
export type { AppContext, AppManifest } from './app-context'

// WHERE AN APP'S WORKSPACES LIVE (2026-08-10, multiAppFinalRefactor Phase 2).
// `platformWorkspaceSource` is what an app on `platform.workspaces` supplies;
// an app that owns its own tenancy writes its own. Read workspace-source.ts
// before implementing one — the `getDefaultForUser` note in particular.
export { platformWorkspaceSource } from './workspace-source'
export type {
  WorkspaceSource,
  WorkspaceRef,
  WorkspaceMembershipRef,
  WorkspaceMemberRef,
} from './workspace-source'

// WHERE AN APP RECORDS ITS UPLOADS (2026-08-10, multiAppFinalRefactor Phase 3).
// The ledger splits per app; the Blob store, the quota and
// `platform.blob_references` do not. Read upload-ledger.ts before implementing
// one — `attribute` must never throw.
export { platformUploadLedger } from './upload-ledger'
export type { UploadLedger, UploadAttribution, UploadRecord } from './upload-ledger'

export {
  createApiHandler,
  createResolveWorkspace,
  requireOwner,
  errorLogContext,
} from './handler'
export type { WorkspaceContext } from './handler'

// The platform half of /api/meta. A HELPER, not a factory: /api/meta is Class C
// (D-20) — each app writes its own route, because its vocabulary is the reason
// the route exists rather than a contribution to a shared one.
export { platformMetaBlock } from './meta'
export type { PlatformMetaOptions, PlatformMetaResult } from './meta'
