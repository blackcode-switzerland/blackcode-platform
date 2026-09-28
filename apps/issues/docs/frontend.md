# Frontend — issues app

> **App doc.** The issue tracker's own screens: its dashboard routes, its
> feature components, its analytics view. Everything shared — the theme and
> token system, `components/ui/` primitives, the app shell and providers, the
> workspace-scoped URL model, TanStack Query conventions and toasts — is in
> **`/docs/frontend.md`** at the repo root. Read that first; this assumes it.
>
> The rule (docs/platform-architecture.md §7.5): root docs never describe an app's
> internals, and an app's docs never describe another app.

Paths are relative to **`apps/issues/`**. Backend counterpart:
[`apps/issues/docs/backend.md`](./backend.md).

## Table of contents

- [Dashboard routes](#dashboard-routes)
- [Feature components](#feature-components)
- [Analytics dashboard](#analytics-dashboard-analytics-viewtsx)

## Dashboard routes

Under `/dashboard`, guarded by `middleware.ts` + the dashboard layout.

Workspace-scoped pages live under `/dashboard/[ws]/…` — see *Workspace-scoped
URLs* in `/docs/frontend.md` for the model. Detail pages use the workspace
#number (`seq`); labels use the id.

| Path | Renders |
|------|---------|
| `/dashboard/[ws]` | Projects listing (`ProjectsListing`) |
| `/dashboard/[ws]/projects/[seq]` | Project detail (`ProjectDetailView`) |
| `/dashboard/[ws]/issues` · `/issues/[seq]` | Issues listing · issue detail |
| `/dashboard/[ws]/tasks` · `/tasks/[seq]` | Tasks listing · detail |
| `/dashboard/[ws]/labels` · `/labels/new` · `/labels/[id]` | Labels listing · create page (`LabelCreateView`) · detail (`LabelDetailView`, inline-editable name/color + associated issues) |
| `/dashboard/[ws]/settings` | Workspace settings (`WorkspaceSettings`, `components/workspace-settings.tsx`) — the shared sections (`/docs/frontend.md`, *Workspace management*): General (name, read-only slug, role, logo), a **Storage** link section, Members, Invitations (owner), Leave (member) / Danger zone (owner, typed-slug delete). Since 2026-09-28 |
| `/dashboard/[ws]/members` · `/members/invite` | **Redirects** to `/dashboard/[ws]/settings` (since 2026-09-28) |
| `/dashboard/[ws]/activity` | Activity feed |
| `/dashboard/[ws]/analytics` · `/analytics/print` | Analytics · print-to-PDF view |
| `/dashboard/[ws]/trash` | Recycle bin |
| `/dashboard/inbox` | Notifications (cross-workspace, unscoped) |
| `/dashboard/settings/{profile,account,tokens,workspace}` | Settings (own sub-layout + nav, unscoped) |
| `/dashboard/super-admin/*` | Super-admin pages (unscoped) |
| `/dashboard/workspaces` | Every workspace you belong to, as the shared chooser (`WorkspacesView`); choosing one remembers it. `?new=1` opens the create modal over it |
| `/dashboard/workspaces/new` | **Redirects** to `/dashboard/workspaces?new=1` (since 2026-09-28; it was a create page) |
| `/dashboard/workspaces/[slug]` | **Redirects** to `/dashboard/[slug]/settings` (since 2026-09-28; it was the settings page, outside the workspace) |
| `/dashboard/workspaces/[slug]/storage` | Storage management (`StorageView`) — owner only; lists every uploaded file with its references + usage, deletes unused (0-reference) files. Removing a file from a body never deletes bytes; only an owner-confirmed delete here does (server re-checks references). |

Legacy `/dashboard`, `/dashboard/issues/[id]`, `/dashboard/tasks/[id]`, and old
`/dashboard/{projectId}` paths still resolve — they redirect to the canonical
`/dashboard/{ws}/…` URLs. The bare `/dashboard` opens the remembered workspace
(`platform.users.active_workspace_id`), else the first one
(`lib/default-workspace.ts`) — unlike the other apps it does not stop at the
chooser when several exist and none is remembered.

**Workspace management since 2026-09-28** is the shared kit
(`@blackcode/platform-ui/workspace/*`, described in `/docs/frontend.md`): the
sidebar switcher is its dropdown (it was a link to `/dashboard/workspaces`),
the sidebar's **Members** entry became **Settings**, and creating a workspace is
its name-only modal (`WorkspaceCreateModal` re-exports it; the logo is set in
Settings). The modal is also what `OnboardingCreateWorkspace` (the forced
first-workspace screen) renders. `/invitations/[token]` renders the shared
card, and its not-yours refusal names only the signed-in address — it used to
print the invitee's, which told whoever held the link who it was sent to.

`app/dashboard/layout.tsx` validates the session, shows
`OnboardingCreateWorkspace` when the user has no workspace, and renders the
sidebar shell (`DashboardLayout`). It is `force-dynamic`.

`app/dashboard/super-admin/layout.tsx` additionally guards its sub-tree with a
server-side `isSuperAdmin(user.email)` check and redirects non-admins to
`/dashboard`.


## Feature components

Primitives (`components/ui/`) are platform and documented at the root. These are
this app's own.

- **Shell:** `dashboard-layout`, `workspace-switcher`, `inbox-badge`,
  `settings-nav`, `super-admin-nav`.
- **Listings (`components/listings/`):** `projects-listing` (+ `projects-kanban`,
  `projects-timeline`), `issues-listing` (+ `issues-kanban`, `issues-timeline`),
  `tasks-listing` (list-only — no kanban/timeline view), plus `filter-bar`
  (`MultiSelect`, `SearchInput`, `ViewToggle`), `labels-pill`,
  (Projects listing filters: Status / Priority / Lead; Tasks listing filters:
  Project / Lead. Both show an inline-editable **Lead** column and the task
  detail sidebar has a **Lead** property — mirrors projects.)
  **Search** on all three listings is client-side (`lib/listing-search.ts`,
  `rankSearch`/`searchScore`/`field`/`idTokens`): the full set is already loaded,
  so the `SearchInput` filters+ranks in-memory (instant, no per-keystroke
  refetch — `search` is intentionally not sent to the API). It matches across
  the `#N` identifier the row actually displays — `seq ?? id` (e.g. `#123` or
  `123`; falls back to `id` if `seq` is ever null) — plus title/name,
  description/summary, status, priority, assignees/lead, project/task names
  and labels. All three listings display and search the same `seq ?? id`
  value (issues already did; tasks/projects previously showed raw `id` in the
  row while search/nav used `seq ?? id`, so the visible number could silently
  fail to search or even navigate to the wrong item — fixed). Multiple
  whitespace-separated terms are ANDed (a term can match a different field than
  its siblings). Per term/field, matches are scored — exact > prefix >
  word-boundary substring > mid-word substring > fuzzy (typo-tolerant,
  bounded-edit-distance, never applied to purely numeric terms so ID search
  stays exact) — and fields are weighted (identifier and title/name
  outrank status/project/lead, which outrank description). Results are sorted
  best-match-first while the query is non-empty and the Sort control is left on
  "Manual"; picking an explicit sort overrides relevance ordering as before.
  Filter/search/view state on all three listings persists across navigation via
  `usePersistentState` (`use-persistent-filters.ts`) — an in-memory, per-workspace
  store that survives client-side navigation (open a detail, come back) but
  resets on a full reload. Selection state is intentionally **not** persisted.
  A **Sort** control (`SortSelect` + `sort.ts`, client-side: Manual/Name/Newest/
  Oldest/Updated, plus Priority+Due for issues/projects, Due for tasks) sets the
  order. Drag-to-reorder (`position`) is **only enabled under "Manual"**; other
  sorts disable the drag handle. In kanban, a non-manual sort disables in-column
  reorder but cross-column status-drag still works. Drag-reorder mutations
  invalidate the listing query in `onSettled` so the new order survives
  navigation (previously the optimistic order was lost until a reload).
  List rows animate to their new order on sort change: the list view branches
  on `dragEnabled` — manual → `@hello-pangea/dnd` (dnd owns motion), sorted →
  `motion.li` with `layout` (the two libs don't share an element, avoiding
  conflicts). Detail-page inline title edits write the new title to the query
  cache optimistically (`setQueryData`) so clearing the draft doesn't flash the
  old title during the PATCH + refetch.
  **List-view grouping:** the list view (not kanban/timeline) on all three
  listings renders as collapsible sections over the already filtered+sorted
  rows — grouping never changes which rows appear or their relative order,
  only how they're bucketed for display. Issues group by `status` into up to
  five sections (In Progress / Todo / Backlog / Done / Cancelled, plus any
  other status value seen). Projects and tasks group into exactly two sections,
  **In Progress** / **Done**, keyed off completion rather than the `status`
  column: a project is "Done" when `open_issues === 0 && issue_count > 0`; a
  task is "Done" when `completed_issues >= issue_count && issue_count > 0`
  (zero-issue items are "In Progress"). Each section header shows a
  select-all-in-section checkbox, item count, and a collapse toggle (all
  sections open by default; collapse state is local, not persisted). Manual-sort
  drag-to-reorder is confined within a section — cross-section drag is a no-op
  — matching the issues list's cross-status drag restriction; for projects the
  `position` column is a single global sequence (shared with kanban), so a
  same-section drag rewrites the *full* project order with only that section's
  slots permuted, rather than sending a section-scoped id list.
  `bulk-action-bar` (multi-select toolbar for batch status/delete), and the
  `use-active-workspace` hook.
- **Detail views:** `project-detail-view`, `issue-detail-view`,
  `task-detail-view`.
- **Create / edit modals:** `issue-create-modal` (kanban flow only — all other
  "new" buttons POST immediately then redirect to the detail page with `?new=1`),
  `project-settings-modal`, `workspace-create-modal`.
- **Management views:** `project-members-panel`, `labels-view`,
  `activity-view` (full workspace feed page), `activity-feed` (reusable feed
  component used by the activity page and issue/project detail sidebars),
  `comment-section` (reusable polymorphic comment thread), `analytics-view`
  (see Analytics dashboard below), `print-analytics-view`, `inbox-view`,
  `trash-view` (recycle bin —
  `/dashboard/{ws}/trash`), `workspaces-view` (the shared chooser at
  `/dashboard/workspaces`).
- **Settings:** `profile-settings-view`, `account-settings-view`,
  `api-tokens-settings`, `workspace-settings` (`/dashboard/{ws}/settings`: the
  shared sections wired to this app's routes — logo is `POST/DELETE /api/workspaces/{ws}/logo`
  (the shared logo-only route; `PATCH { logo_url }` still works for `bk`), leave is `POST …/leave`; it
  replaced `workspace-settings-view`, `members-view` and `invite-members-view`
  on 2026-09-28), `storage-view` (owner-only workspace file management at
  `/dashboard/workspaces/[slug]/storage`, linked from Settings).
  (`workspace-apps-panel`, the per-app access section, went with
  `app_access` on 2026-08-10.)
- **Super admin:** `super-admin-users-view` (platform-wide member table with workspace count),
  `super-admin-whitelist-view` (add/remove allowed domains and emails),
  `super-admin-errors-view` (error log with status/level/date filters, stat cards,
  expandable rows showing stack + sanitized context, resolve/reopen toggle,
  row checkboxes + select-all for bulk delete, and single-row delete;
  destructive actions go through `useConfirm()`; `useInfiniteQuery` cursor pagination).
  All visible only when `me.is_super_admin === true` (from `/api/me`).
- **Client error capture:** `app/error.tsx` (React error boundary, render errors) and
  `global-error-listener` (mounted in `Providers`; catches `window.onerror` +
  unhandled promise rejections, de-duped and capped per session) both POST to
  `/api/errors/client`, feeding the super-admin Errors tab.
- **Auth & marketing:** `landing-page`, `cli-authorize-form`,
  `password-reset-flow`, `onboarding-create-workspace`,
  `accept-invitation-button`, `components/marketing/*` (the marketing site
  footer, `components/marketing/site-footer.tsx`, links to
  "For agents" link to `/agent-updator`).
- **Helpers:** `rich-text-editor`, `project-icon`, `icon-picker`,
  `image-upload-field`, `image-lightbox`.

> **Legacy / orphaned (safe to ignore — not imported by any route):**
> `project-view.tsx` and its private subtree — `kanban-board.tsx`,
> `issue-list-view.tsx`, `gantt-view.tsx`, `create-issue-modal.tsx` — plus
> `timeline-view.tsx`. These predate the listings rewrite. (`dashboard.tsx` is
> **not** dead — it's a shared utility module imported widely.)


## Analytics dashboard (`analytics-view.tsx`)

The `/dashboard/analytics` page is a multi-tab BI dashboard over the analytics
payload (see `docs/backend.md` → *Analytics contract*). All chart primitives
come from **`@blackcode/platform-ui/charts`** (hand-rolled themed SVG — **no
chart library**). They moved out of this app on 2026-08-06 (D-12); the kit is
shared because the second app needs four of the six, and `docs/frontend.md` is
now where it is documented.

What stays this app's business is the **palette**: the kit names no colour, and
this app defines `--chart-series-{created,completed,activity,ideal}` in
`app/globals.css`. Use `var(--primary)` and the `SERIES` roles, never a literal —
a hardcoded hex in a chart is a colour a second app cannot re-theme, and
`lib/charts-parity.test.ts` will fail on it if it changes what this page renders.

- **Controls (sticky):** a scope segmented control (Workspace / Project /
  Task / Member) with a searchable target picker; a granularity toggle
  (Daily / Weekly); date-range presets (7D/30D/90D/12M/All) + a Custom range
  built from two `DatePicker` chips; and a faceted **filter bar** (Status /
  Priority / Assignee / Label multi-selects via `FilterMenu`, with an active
  count badge and "Clear all"). Every control feeds the React Query key, so the
  whole dashboard refetches as one.
- **Tabs:** Overview (KPI grid + velocity + status/priority/project), Throughput
  (velocity, cumulative flow, cycle-time + aging histograms), Workload (assignee
  table, labels), Activity (event series + by-action + top members), and —
  task scope only — Burndown.
- **Export:** "PDF" opens `/dashboard/analytics/print` (the same payload,
  forwarding **all** params incl. filters + interval + theme, then auto-prints).
  "CSV" downloads a client-built summary + velocity table.
- Chart kit: `KpiCard` (value + `TrendBadge` vs. previous period + sparkline),
  `AreaLineChart` (multi-series, gradient fill, hover crosshair + tooltip),
  `DonutChart`, `HorizontalBars`, `ColumnChart` (histograms), `BurndownChart`.

