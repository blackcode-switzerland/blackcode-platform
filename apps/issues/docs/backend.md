# Backend — issues app

> **App doc.** This describes the **issues** app only: its Postgres schema, its
> routes, its work-item model. Everything shared — identity, workspaces,
> membership, per-app access, labels, uploads, comments, the event spine, the
> `apiHandler`/`Errors` contract, the query-layer conventions — is in
> **`/docs/backend.md`** at the repo root. Read that one first; this one assumes
> it.
>
> The rule (docs/platform-architecture.md §7.5): root docs never describe an app's
> internals, and an app's docs never describe another app.

> **Internal.** The HTTP API is private plumbing — **the only public contract is
> the `bk` CLI.** Do not treat this as an integration guide or link external
> consumers to it. Agent-facing usage lives in `bk guide`, under
> `cli/internal/guide/topics/issues/`.

Paths below are relative to **`apps/issues/`** unless stated otherwise. Source of
truth is the code: `lib/db/schema.ts` for the schema, `app/api/**` for routes.

## Table of contents

- [Postgres schema: `issues.*`](#postgres-schema-issues)
- [Enum vocabulary](#enum-vocabulary)
- [The `#number` model](#the-number-model)
- [Routes](#routes)
- [Query layer](#query-layer)
- [CLI surface](#cli-surface)

## Postgres schema: `issues.*`

Ten tables, all in the `issues` Postgres schema since Phase 3. Everything else
this app reads — `users`, `workspaces`, `workspace_members`, `comments`,
`labels`, `uploads`, `events`, `inbox_messages` — is in `platform.*` and is
documented at the root. An app **may** FK into and query `platform.*`; it **may
not** touch another app's schema, and the `issues_app` Postgres role has no
grant that would let it.

| Table | Purpose / notable columns |
|-------|---------------------------|
| `projects` | `workspace_id`, `seq` (workspace-scoped #number, unique per workspace), `name`, `status`, `priority` (`P0`–`P4`), `owner_id` (lead), `color`, `icon`, `start_date`, `due_date` |
| `project_updates` | status-update feed; `status` ∈ `on_track`/`at_risk`/`off_track`, rich-text `body`, `author_id`. Latest row = project's current health |
| `tasks` | `workspace_id`, `seq` (workspace-scoped #number, unique per workspace — mirrors `issues.seq`), optional `project_id` (ON DELETE SET NULL — tasks can be standalone), `due_date`, `lead_id` (task lead, ON DELETE SET NULL — mirrors `projects.owner_id`). **`status` is VESTIGIAL — do not read it.** A task's status is derived from its issues (see below); every row in the column is `active` |
| `issues` | `workspace_id`, `seq` (unique per workspace), optional `project_id`/`task_id`, `title`, `status`, `priority` (int 1–5, checked), `reporter_id`, `start_date`/`due_date`, `estimated_hours`, `completed_at`/`cancelled_at`. **No `assignee_id` — see `issue_assignees`** |
| `issue_assignees` | many-to-many junction: `(issue_id, user_id)` composite PK; `assigned_at`. Replaces the old single `assignee_id` column so issues can have multiple assignees. Both FKs cascade on delete |
| `attachments` | `issue_id`, `filename`, `file_url`, `file_size`, `mime_type`, `uploaded_by`. Issues-only; written via API/CLI (`bk issues issue attach`) |
| `issue_labels` / `project_labels` | join tables (composite PKs) linking workspace labels to issues / projects |
| `project_members` | the project's "people working on it" list (not access control); `(project_id, user_id)` unique |
| `issue_watchers` | `(issue_id, user_id)` PK; `reason` ∈ `manual`/`assigned`/`reporter`. Auto-watchers are pruned when their reason no longer applies (unless `manual`) |

### A task's status is derived, and the column is dead

`issues.tasks.status` exists, defaults to `'active'`, and **has never held
another value** — 12/12 rows in local dev on 2026-08-12, and no write path in
the product ever set one. It was read in three places that disagreed with each
other: the schema default, a listing that counted `status === 'done'`, and a
detail view that suppressed an overdue badge on `'completed'`. Two of those
comparisons were permanently false.

Since 2026-08-12 the status is **computed from the task's issues**, in SQL, in
one shared fragment (`lib/db/queries/tasks.ts` → `taskProgressSql`) selected by
every task query. It is exposed on the wire as `status`; the column is not
exposed under any name (`lib/api/serialize.ts` → `publicTask`).

| Wire field | Meaning |
|---|---|
| `issue_count` | attached issues, excluding soft-deleted |
| `completed_issues` | issues in the `done` status |
| `cancelled_issues` | issues in the `cancelled` status |
| `open_issues` | everything else — a NULL status counts as open |
| `status` | `empty` \| `active` \| `done` \| `cancelled`, derived |

Two edge cases are encoded deliberately, both documented at length in
`lib/work-items.ts` → "tasks":

1. **A task with no issues is `empty`, not `done`.** "No issues are open" is
   vacuously true of a task with nothing in it, so the naive `open === 0 → done`
   reports a brand-new task as finished.
2. **Cancelled is not done.** A task whose issues were all cancelled is
   `cancelled`. A task with one done and one cancelled issue is `done`, because
   nothing is still open.

`updateTask` **throws `task_status_derived`** if a caller passes `status`, and
both routes map it to a 400 with a suggestion. Silently dropping the field would
leave the caller believing the write landed and then reading back something
else.

It must stay in SQL: a client that computed progress by listing a task's issues
would be wrong the moment paging truncated the list, and wrong *silently* — a
bad count is indistinguishable from a good one. Guarded by
`lib/db/queries/task-progress.integration.test.ts`, which asserts exact tuples
rather than "a number appeared".

**Where the app boundary actually falls.** `comments` and `labels` look like
issue-tracker tables and are not: comments are already polymorphic
(`parent_type`/`parent_id`) and labels are workspace-scoped, so a sales app
would need both unchanged. They live in `platform.*`. The test is always
"would a second app need this as-is?", not "which feature shipped it".

`comments.issue_id` was dropped in migration `0032` — a `platform` → `issues`
FK that would have broken `pg_dump --schema=issues`, the extraction path
Phase 8 rehearses.

## Enum vocabulary

Canonical in `lib/work-items.ts`, **not** in the schema, and served live at
`GET /api/meta` under `apps.issues.vocabulary`:

Status/priority **values** (the labels and colors the UI uses) are canonical in
`lib/work-items.ts`, not the schema:

- Issue status: `backlog`, `todo`, `in_progress`, `done`, `cancelled`.
- Issue priority: `1` urgent … `4` low, `5` none.
- Project status: `backlog`, `planned`, `in_progress`, `completed`, `cancelled`;
  priority `P0`–`P4`.
- Project update health: `on_track`, `at_risk`, `off_track`.


Never hardcode these anywhere else — not in a route, not in a component, and
above all not in a `bk guide` topic (`cli/internal/guide/guide_test.go` fails
the build if a topic states one). They change without a CLI release, which is
exactly why `bk meta` carries them.

## The `#number` model

> **`{id}` for projects/tasks/issues = the workspace `seq` (the `#N` shown in the
> app), not the global PK.** Route handlers resolve `(workspace, seq) → internal
> id` via `resolveEntityId` (`lib/api`); responses serialize through
> `publicProject`/`publicTask`/`publicIssue` (`lib/api/serialize.ts`) so the
> global id is never emitted and FK fields (`project_id`/`task_id`) are the
> parent's seq. List endpoints return everything (no cursor). See
> `docs/changelog/`. Sub-entities (comments/labels/attachments/updates)
> keep their own ids — but any FK that points **back** at a work item is also
> mapped to that item's `#number`, never the internal id: comments expose
> `parent_id` (+ `parent_type`) and drop the legacy internal `issue_id`;
> attachments expose `issue_id` as the `#number`; project updates expose
> `project_id` as the `#number`. These go through `publicComment` /
> `publicAttachment` / `publicProjectUpdate` (`lib/api/serialize.ts`), which take
> the parent's seq from the request path (or resolve it for by-id routes). The
> activity feed (`GET …/activity`) likewise maps `entity_id` to the `#number` for
> issue/task/project events (`publicEvent` + `resolveEventEntitySeqs`, batch seq
> lookup incl. trashed rows; purged → `meta.seq` fallback or `null`); other
> entity types (comment/label/attachment/workspace/member/invitation) keep their
> own-domain id. No route emits an internal work-item serial.


Sequence allocation is per workspace **and** per entity type, in-transaction, via
`allocateNext*Seq` against `issues.workspace_counters` (moved out of `platform` in migration 0040 — the columns name this app's entity types, so it is app data).

## Routes

All workspace-scoped, under `/api/workspaces/{ws}/…`. Conventions (`apiHandler`,
`Errors`, `jsonList`, the `{ data, next_cursor }` envelope, 201-on-create,
`{ deleted: true }`-on-delete) are the platform's and are documented at the root.

```
GET    /api/workspaces/{ws}/projects            list projects
POST   /api/workspaces/{ws}/projects            create project
GET    /api/workspaces/{ws}/projects/{id}       project detail (+ members, labels)
PATCH  /api/workspaces/{ws}/projects/{id}       update (also member_ids/label_ids)
                                               (name, summary, description, status, priority,
                                                color, icon, icon_url (the LOGO — shown instead of
                                                the icon tile), banner_url, visibility, start_date,
                                                due_date, and lead_user_id.
                                                THE LEAD IS `lead_user_id`, not `owner_id`: the
                                                column is owner_id so GET returns that name, but no
                                                write path reads it back. icon_url/banner_url/
                                                visibility were accepted-and-dropped until
                                                2026-08-13 — a 200 with the row unchanged.
                                                visibility is METADATA: nothing reads it to decide
                                                who may see a project. icon_url/banner_url are a
                                                blob-reference surface — see migration 0047)
GET    /api/workspaces/{ws}/projects/{id}/members  list members / POST add (owner|admin) / DELETE remove ({user_id})
GET    /api/workspaces/{ws}/projects/{id}?preview=1   child counts for delete dialog
DELETE /api/workspaces/{ws}/projects/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/projects/{id}/comments   list / POST comment
GET    /api/workspaces/{ws}/projects/{id}/updates    list status updates
POST   /api/workspaces/{ws}/projects/{id}/updates    post update (status + body)
DELETE /api/workspaces/{ws}/projects/{id}/updates/{updateId}   delete (author)
POST   /api/workspaces/{ws}/projects/reorder    update display order (drag-and-drop)
GET    /api/workspaces/{ws}/tasks          list / POST create
GET    /api/workspaces/{ws}/tasks/{id}?preview=1   child counts for delete dialog
PATCH  /api/workspaces/{ws}/tasks/{id}     update
DELETE /api/workspaces/{ws}/tasks/{id}?mode=cascade|detach   move to Trash (default: detach)
GET    /api/workspaces/{ws}/tasks/{id}/comments  list / POST
GET    /api/workspaces/{ws}/issues              list / POST create
                                               (filters: project_id, task_id (workspace #numbers, or
                                                `null` for unscoped), assignee_id (or `null` for
                                                unassigned) / assignee_ids (user ids), status, priority,
                                                reporter_id (or `null` for issues whose AUTHOR was
                                                deleted — reporter_id is ON DELETE SET NULL, so this is
                                                not a synonym for unassigned) / reporter_ids (user ids,
                                                several are an OR) — who CREATED the issue, 2026-08-13,
                                                label (REPEATABLE, label NAMES, several are an OR;
                                                only labels this app owns are matched),
                                                due_before (YYYY-MM-DD, INCLUSIVE of that day; issues
                                                with no due_date are never returned), search.
                                                A value it cannot PARSE is a 400 with a code and a
                                                suggestion, never a dropped clause: ?priority=urgent
                                                and ?assignee_ids=alice used to return every issue in
                                                the workspace under a request that had asked for a
                                                subset, silently (2026-08-12).
                                                search = case-insensitive substring on title/description,
                                                and the #id when the query is numeric (e.g. "123"/"#123");
                                                same for tasks (name/description) and projects (name/description)
                                                via lib/db/queries/search.ts.
                                                Returns { data, total } — every match, no pagination.
                                                create accepts project_id/task_id as #numbers; label_ids
                                                (existing) and labels: string[] — names matched
                                                case-insensitively, unknown ones created on the fly)
GET    /api/workspaces/{ws}/issues/{id}         detail / PATCH — PATCH REJECTS labels/label_ids
                                                (400 labels_not_patchable, since 2026-08-11). They are a
                                                sub-resource, not a column; it used to accept and silently
                                                drop them, and two reporters read the 200 as "labeling is
                                                UI-only". Use the /labels routes below. `labels` IS in the
                                                response of both GET and PATCH.
                                                PATCH also REFUSES a project_id change that would leave
                                                the issue in a task belonging to a DIFFERENT project
                                                (400 task_project_mismatch, naming the task; 2026-08-12).
                                                Carrying the link across makes that task's progress count
                                                an issue no longer under it; detaching it silently changes
                                                a second record from a call that never mentioned it. Pass
                                                task_id: null in the same PATCH. The rule fires ONLY when
                                                project_id is being changed — task attach/detach and
                                                already-crossed rows are untouched. See updateIssue.
DELETE /api/workspaces/{ws}/issues/{id}         move to Trash
GET    /api/workspaces/{ws}/issues/{id}/comments     list / POST
GET    /api/workspaces/{ws}/issues/{id}/labels       list / POST attach ({label_id} or {name} — name created on the fly)
DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid} detach
GET    /api/workspaces/{ws}/issues/{id}/activity      activity feed for the issue
GET    /api/workspaces/{ws}/issues/{id}/attachments   list / POST attach
DELETE /api/workspaces/{ws}/issues/{id}/attachments/{attachmentId}  remove attachment
POST   /api/workspaces/{ws}/issues/{id}/watch        watch / DELETE unwatch
POST   /api/workspaces/{ws}/issues/reorder      update display order (drag-and-drop)
```

Every one of these is reachable from `bk issues …`, and
`lib/cli-parity.test.ts` fails the build if one is not.

## Query layer

App-specific query modules in `lib/db/queries/`. They may read `platform.*`
freely; nothing in `platform.*` may depend on them.

| File | Responsibility |
|------|----------------|
| `projects.ts` | project CRUD; list joins lead + latest update health |
| `tasks.ts` | task CRUD, project association |
| `issues.ts` | issue CRUD, filters, assignees, watchers, labels |
| `search.ts` | case-insensitive substring search over title/name/description, plus `#id` match when the query is numeric |
| `workspace-search.ts` | `searchWorkspace` — the query behind `GET …/issues-search`: one arm per type (issue, task, project, label, member, comment), ranked, `ILIKE` over the source tables with HTML stripped in SQL (see *Workspace search*) |
| `analytics.ts` | `computeAnalytics` — snapshot counts, throughput, cycle time, distributions, burndown |
| `overview.ts` | `computeOverview` — `analytics?view=overview`: `computeAnalytics` for the workspace plus the leaderboard, project health, attention lists, workload and recent activity (see *Workspace overview*) |
| `move.ts` | cross-workspace move/copy in one transaction |
| `entities.ts` | this app's half of the cross-app projection: project/mark-deleted/purge into `platform.entities`, plus `reconcileEntities` |

### Workspace overview (`view=overview`)

`/dashboard/[ws]/overview` reads `GET /api/workspaces/{ws}/analytics?view=overview`
and `bk issues analytics --view overview` prints the same payload. It is a
**view of the analytics route, not a route of its own**: the parity test already
covers `GET …/analytics`, and a new route would have needed its own command,
claim and exclusion. The response is the ordinary workspace `AnalyticsPayload`
(so KPIs, trends, `by_status`, `by_priority` and the velocity series are the very
numbers Analytics shows) plus one `overview` block. `lib/db/queries/overview.ts`
owns the block; its header comment is the authority on the counting rules.

Input is `from`/`to` only (absent = **All**). `id`, the faceted filters and
`interval` do not apply — the server buckets by day up to 60 days and by week
beyond. For All it draws the series from the first issue and disables the
previous-period comparison (`comparePrevious: false` in `computeAnalytics`, so
`period.from` is reported as `null`, not the synthetic start).

What `overview` holds, and the rules that are not obvious:

- **Leaderboard** — every workspace member, once per period in `range`,
  `this_week`, `this_month`, `last_month`, `this_year`, `last_year`, `all_time`
  (UTC calendar, Monday-based weeks; the arithmetic is `lib/overview-periods.ts`,
  db-free and unit tested). Per member and period: `created`, `completed`,
  `comments`, `activity`, `avg_cycle_time_hours` and a `rank`; plus
  `open_assigned` (a snapshot) and a 12-week `spark`.
  - **completed** is per *assignee*: `status = 'done'`, `completed_at` inside the
    period. An issue with three assignees is one completion for each of them and
    never two for one person, so the per-member sum can exceed the headline
    `completed_in_period` — by design, and pinned by the integration test.
  - **created** is per `reporter_id`. **comments** counts `commented` events (a
    comment records two events, `created` on the comment and `commented` on its
    parent; counting all events would double it). **activity** is every event
    the member is the actor of. Soft-deleted issues count nowhere.
  - **rank** orders by completed, then created, then name — positional and
    unique, never a tie. **leaders** names, per period and metric, every member
    tied on the best value, and nobody when the best is 0 (`fastest_cycle` needs
    at least one completion; lower wins).
- **`kpi_trends`** — change vs the previous period for the snapshot figures
  (total, open, overdue, unassigned, completion rate). They are stock figures, so
  the previous value is *reconstructed* at `from` from timestamps
  (`snapshotAt`): created/completed/cancelled times and `assigned_at`. It cannot
  see an assignment removed since, a due date moved since, or a deleted issue —
  say so if a number looks off by a few. Flow figures (created, completed, cycle
  time) keep using `trends`.
- **`projects`** — non-deleted projects that are not completed/cancelled, with
  progress (`done / (total − cancelled)`) and the *latest* `project_updates` row
  as health (`null` = never posted). Risk first. Capped at 24.
- **`attention`** — overdue, urgent (priority 1), older than `old_open_days` (30)
  and unassigned; open issues only; each list has its full `total` and the first
  5 rows.
- **`workload`** — open issues per member by open status (`statuses` is derived
  from `lib/work-items.ts`, so it follows the vocabulary), plus the unassigned
  count.
- **`recent_activity`** — the newest 15 events (comment-`created` rows skipped).
  Carries the new status/priority for `status_changed`/`priority_changed` and
  **never** free text: `meta.excerpt` is unsanitised HTML and stays out of the
  payload. `linkable` is false when the subject is deleted.

`by_assignee` and `top_active_members` now also carry `avatar_url`.

Tests: `lib/overview-periods.test.ts` (calendar bounds) and
`lib/db/queries/overview.integration.test.ts` — a hand-counted fixture with a
two-assignee issue, a soft-deleted issue, a comment's double event and a tie,
asserted to exact figures (`TEST_DATABASE_URL=… npm test --workspace=issues`).

### The entity projection (Phase 6)

Every issue, task and project is mirrored into `platform.entities` so it is
addressable by URN — `bc:issues:<workspace-slug>/<type>/<number>`, using the
`#number` like everything else here. That is what makes URN resolution and the merged `bk issues activity` possible
without any app reading another app's schema. (`bk issues search` used to read this
index and no longer does: it needs labels, people, descriptions and comments, none
of which are projected — see *Workspace search*.)

Two rules, and both are the difference between an index and a liability:

1. **Same transaction as the source write.** `projectEntity` and its siblings
   take the caller's `tx` and never open one. A projection that commits when the
   source write rolled back describes something that does not exist, and nothing
   notices until somebody clicks through to a 404.
2. **The projection may never fail the write.** Write paths format URNs through
   the fail-soft variants (`entityUrnOrNull`); an unaddressable row loses its
   projection and is reported as `missing` by the reconciler rather than turning
   a delete into a 500.

Two of the paths are re-derived from the source rather than driven by a list of
affected rows, because a cascade (binning a project with its issues, purging a
batch) has no such list and the next person to add a cascade branch will not
remember to extend one: `syncEntityDeletedState` and `purgeMissingEntities` both
ask "what does the source say now?" for the whole workspace, and only write the
rows that disagree.

The address scheme itself — entity types, dashboard paths, URN construction — is
in `lib/entity-address.ts`, deliberately free of any database import so it can be
unit-tested without one (`lib/db/queries/urn.test.ts`).

Every write path is listed in `lib/db/queries/entities.ts`'s header; the
same-transaction guarantee and the count-match property are asserted in
`lib/db/queries/entities.integration.test.ts` (needs `TEST_DATABASE_URL`).

## CLI surface

Since 1.10.0 every noun here sits behind the app name:

```
bk issues issue     list view create edit delete assign watch comment(s)
                    edit-comment delete-comment attach detach activity attachments
bk issues task      list view create edit delete comment(s)
bk issues project   list view create edit delete members updates comment(s)
bk issues move      move items to another workspace (--to)
bk issues copy      the same, leaving the source in place
bk issues analytics summary, throughput, distributions (--view workspace|project|task|member|overview)
```

The pre-1.10.0 bare spellings (`bk issue …`) still run as deprecated aliases and
are removed in 1.12.0 — see `docs/changelog/platform.md`. Command code lives in
`cli/internal/commands/issues/`, guide topics in
`cli/internal/guide/topics/issues/`.

## Workspace search

`GET /api/workspaces/{ws}/issues-search` → `bk issues search` → the web popup.
One query module (`lib/db/queries/workspace-search.ts`), one DB-free vocabulary
module (`lib/search-types.ts`: the type list, term splitting, `SearchHit`), and
the plan and its reasoning in [`workspace-search-plan.md`](./workspace-search-plan.md).

**Why a second search route.** `GET …/search` is the platform factory over
`platform.entities` — titles of issues, tasks and projects. Labels, people and
comments are not projected, and a description is not a title. This route reads the
source tables, on its own path for the reason `apps/sales` gave its `/sales-search`:
one path answering two different questions depending on which deployment you hit is
an invisible ambiguity. The old route stays mounted (and in `cli-parity`'s
`EXCLUDED_PATHS`) for binaries that predate this one.

**Matching.** `ILIKE`, no migration, no index. The query is split into words
(`searchTerms`, ≤6); **every word must match**, each in any field of the row. HTML
in rich-text columns is stripped in SQL (`plain()`), so `div` and `class` do not
find markup, and the snippet is cut from the stripped text. `%`, `_` and `\` in a
query are matched literally (`escapeLike`). A bare number also matches `seq`; an
explicit `#N` matches **only** `seq`, and only for issue/task/project.

**Ranking** (`rank()`), per type: `#N` exact 100 › title equals 95 › prefix 80 ›
word start 60 › substring 40 › all words in the title 30 › matched only in the body
10; ties by `updated_at`. Types are returned in `SEARCH_TYPES` order, each capped at
`per_type`.

**The predicates that must stay** (each one is a mutation in
`workspace-search.integration.test.ts` that turns it red): the `workspace_id` scope;
`visibleToThisApp('l')` on labels (`app IS NULL OR app = 'issues'`); `ownTypeIn`
(both the qualified and the legacy bare `comments.parent_type`) plus the parent's
own bin filter on comments; `u.deleted_at IS NULL` on members; the bin filter, lifted
only by `include_deleted=1`.

**To add a searchable type:** add it to `SEARCH_TYPES`, write its arm in
`workspace-search.ts`, add it to `vocab.go`'s `search_types` (held to the TS list by
`cli-vocabulary.test.ts`), give the popup an icon and a label
(`components/search/global-search.tsx`), and add a fixture row *and a row it must
exclude* to the integration test.
