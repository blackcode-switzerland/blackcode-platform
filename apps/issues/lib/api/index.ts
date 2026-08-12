// The issues app's API barrel.
//
// The app-agnostic half — the error envelope, the list envelope, log
// sanitisation, and (since 2026-08-06) the request layer itself — lives in
// @blackcode/platform-api and is re-exported here so every existing `@/lib/api`
// import keeps working unchanged.
//
// What stays app-local is what names an issue, task or project: the entity
// serializers, seq→id resolution, and analytics parameter parsing. That split is
// the test for anything new here — "would a sales app need this UNCHANGED?"
export { ApiError, Errors, errorBody, jsonList, sanitize, truncate } from '@blackcode/platform-api'
export type { ListPage } from '@blackcode/platform-api'

// This app as the shared layer sees it. Platform route factories are mounted
// with it: `export const GET = searchRoute(appContext)`.
export { appContext } from './context'

export { apiHandler } from './handler'
export { resolveWorkspace, requireOwner } from './workspace-context'
export type { WorkspaceContext } from './workspace-context'
export { resolveEntityId } from './resolve-entity'
export {
  publicProject,
  publicTask,
  publicIssue,
  publicComment,
  publicAttachment,
  publicProjectUpdate,
} from './serialize'
export { projectVocabularyError } from './project-vocabulary'
export { parseAnalyticsParams } from './analytics-params'
export type { ParsedAnalyticsParams } from './analytics-params'
