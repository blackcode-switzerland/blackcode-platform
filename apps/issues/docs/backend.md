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
| `tasks` | `workspace_id`, `seq` (workspace-scoped #number, unique per workspace — mirrors `issues.seq`), optional `project_id` (ON DELETE SET NULL — tasks can be standalone), `due_date`, `status`, `lead_id` (task lead, ON DELETE SET NULL — mirrors `projects.owner_id`) |
| `issues` | `workspace_id`, `seq` (unique per workspace), optional `project_id`/`task_id`, `title`, `status`, `priority` (int 1–5, checked), `reporter_id`, `start_date`/`due_date`, `estimated_hours`, `completed_at`/`cancelled_at`. **No `assignee_id` — see `issue_assignees`** |
| `issue_assignees` | many-to-many junction: `(issue_id, user_id)` composite PK; `assigned_at`. Replaces the old single `assignee_id` column so issues can have multiple assignees. Both FKs cascade on delete |
| `attachments` | `issue_id`, `filename`, `file_url`, `file_size`, `mime_type`, `uploaded_by`. Issues-only; written via API/CLI (`bk issues issue attach`) |
| `issue_labels` / `project_labels` | join tables (composite PKs) linking workspace labels to issues / projects |
| `project_members` | the project's "people working on it" list (not access control); `(project_id, user_id)` unique |
| `issue_watchers` | `(issue_id, user_id)` PK; `reason` ∈ `manual`/`assigned`/`reporter`. Auto-watchers are pruned when their reason no longer applies (unless `manual`) |

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
GET    /api/workspaces/{ws}/issues              list (filters) / POST create
                                               (filters: project_id, task_id (workspace #numbers),
                                                assignee_id(s) (user ids), status, priority, search.
                                                search = case-insensitive substring on title/description,
                                                and the #id when the query is numeric (e.g. "123"/"#123");
                                                same for tasks (name/description) and projects (name/description)
                                                via lib/db/queries/search.ts.
                                                Returns { data, total } — every match, no pagination.
                                                create accepts project_id/task_id as #numbers; label_ids
                                                (existing) and labels: string[] — names matched
                                                case-insensitively, unknown ones created on the fly)
GET    /api/workspaces/{ws}/issues/{id}         detail / PATCH
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
| `analytics.ts` | `computeAnalytics` — snapshot counts, throughput, cycle time, distributions, burndown |
| `move.ts` | cross-workspace move/copy in one transaction |
| `entities.ts` | this app's half of the cross-app projection: project/mark-deleted/purge into `platform.entities`, plus `reconcileEntities` |

### The entity projection (Phase 6)

Every issue, task and project is mirrored into `platform.entities` so it is
addressable by URN — `bc:issues:<workspace-slug>/<type>/<number>`, using the
`#number` like everything else here. That is what makes `bk issues search`, `bk link`
and the merged `bk issues activity` possible without any app reading another app's
schema.

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
bk issues analytics summary, throughput, distributions
```

The pre-1.10.0 bare spellings (`bk issue …`) still run as deprecated aliases and
are removed in 1.12.0 — see `docs/changelog/platform.md`. Command code lives in
`cli/internal/commands/issues/`, guide topics in
`cli/internal/guide/topics/issues/`.
