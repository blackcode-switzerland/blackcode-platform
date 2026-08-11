export { createDb } from './client'
export type { Executor, PlatformDatabase, PlatformDb, PlatformTx } from './client'
export * from './schema'
export * from './qualified-type'
export * from './app-registry'
export * from './urn'
export * from './entities'
export * from './links'

// Platform reads the shared route factories need (2026-08-06, Phase 1b / D-2).
// Each app's query layer re-exports these bound to its own `db`, so existing
// call sites are unchanged.
export * from './account'
export * from './directory'
export * from './workspace-listing'
export * from './error-events'
export * from './events-listing'

// Writing a platform event, and the inbox rows it fans out to (2026-08-06,
// D-23). `fanOutPlatformEvent` is deliberately NOT exported: it is reached only
// through `recordPlatformEvent`, and an app calling it directly would post the
// same notification twice.
export * from './events-write'
export * from './inbox-write'

// What next-auth's callbacks do to platform.users. `authOptions` stays per-app;
// see the header of ./sign-in.ts and of packages/platform-auth/src/index.ts.
export * from './sign-in'

// Membership and invitation WRITES. They record events, so they could not be
// shared until the D-23 seam existed; they are its first non-app callers.
export * from './workspace-writes'
