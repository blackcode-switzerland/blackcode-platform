package client

// The app address book lives in the CLI's own config (learned from `/api/meta`),
// not behind an API call — see `internal/commands/platform/app.go`.
//
// This file held six methods over `platform.workspace_apps` and
// `platform.app_access`: ListWorkspaceApps, UpdateWorkspaceApp, ListAppAccess,
// GrantAppAccess, RevokeAppAccess and ListAllMyWorkspaces (`?all=1`). All six
// went on 2026-08-10 with the two tables and the routes that served them
// (multiAppFinalRefactor Phase 5).
//
// `ListAllMyWorkspaces` is the one worth a note, because it was not a gate
// method: it fetched every workspace you belonged to regardless of app, with the
// apps reachable in each, so `bk workspace list --all` could show a workspace
// this app had been switched off in. Nothing switches an app off inside a
// workspace any more — a workspace belongs to exactly one app — so the widened
// list and the plain one returned the same rows. `ListMyWorkspaces` in
// workspace.go is the whole answer now.
