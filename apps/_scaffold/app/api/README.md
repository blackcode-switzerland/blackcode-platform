# What this scaffold mounts, and what it deliberately does not

## The rule these entries share

**A shared factory is only shared if the table under it is.** Before mounting
one, read what it QUERIES. Four of them have now been found serving another
app's data from a premise that stopped being true underneath them, and every one
looked like a free capability.

`docs/adding-an-app.md` is the authoritative checklist.

## Removed on 2026-08-10 (multiAppFinalRefactor Phase 4)

Three routes, each a shared factory whose premise had expired, and each of which
would have taught the next app a bug:

- **`workspaces/[ws]/links/`** — `bk link` was removed. A link joined two apps'
  records in one shared index that every app wrote into; with each app owning its
  own records there is no such index. Put the far end's URN in the record's own
  text instead.
- **`workspaces/[ws]/search/`** — `searchRoute` resolves the workspace through
  `AppContext.workspaces` (this app's table) and then queries `platform.entities`
  BY THAT ID. Since each app has its own workspaces with overlapping ids, that
  serves ANOTHER app's titles to a caller who has no access to it. Measured in
  `apps/sales` before it was unmounted. An app that wants search writes its own,
  over its own tables — `apps/sales/app/api/workspaces/[ws]/sales-search` is the
  worked example.
- **`users/`** — `usersRoute` answers "people you share a workspace with" out of
  `platform.workspace_members`, which is now one app's membership table. On any
  other deployment it lists the wrong people, and for a user of only that app it
  lists nobody. `bk <app> member list` is the question an app actually has.

## NOT mounted on 2026-08-11 (Phase 7) — the fourth one

- **`workspaceInvitationsRoute` / `workspaceInvitationRoute`.** This app serves
  its own `workspaces/[ws]/invitations/` instead, over `scaffold.invitations`.
  The shared factories call platform-db's `createInvitation` /
  `listWorkspaceInvitations`, which read and write
  `platform.workspace_invitations` — one app's table since 2026-08-10.

  This is the quietest of the four, because **nothing is currently wrong**: only
  `apps/issues` still mounts them. Which is exactly why it is written down. The
  failure would have arrived with app #3, months later, as invitations into a
  workspace this app cannot see — and by then nobody would connect it to a line
  they copied from a scaffold.

## What IS safe to mount, and why

`workspaceMembersRoute`, `workspacesRoute`, `workspaceShowRoute`,
`activeWorkspaceRoute` — all four resolve tenancy through
`AppContext.workspaces`, which is THIS app's source (`lib/api.ts`). They read no
platform table on your behalf. That is the property to check: not "is it in
platform-api?" but "whose rows does it end up reading?"

`apiHandler` and `resolveWorkspace` are shared for the same reason and are not
optional — they carry the error log, the version headers and the 401/404/403
reasoning, none of which an app should reimplement.
