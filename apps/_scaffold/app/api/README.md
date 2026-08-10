# What this scaffold mounts, and what it deliberately does not

Three routes were REMOVED on 2026-08-10 (multiAppFinalRefactor Phase 4). Each was
a shared factory whose premise stopped being true, and each would have taught the
next app a bug:

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

The rule these three share: **a shared factory is only shared if the table under
it is.** Before mounting one, read what it queries.

`docs/adding-an-app.md` is the authoritative checklist; agent 7 rewrites it.
