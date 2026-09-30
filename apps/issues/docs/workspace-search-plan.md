# Workspace search — plan (2026-09-30)

> Status: **shipped 2026-09-30.** This file records the findings and the decisions
> so the next reader does not re-derive them. Once shipped, the current behaviour
> is documented in `backend.md` / `frontend.md`; this stays as the "why".

## What was asked

A floating search button that opens a chat-like popup; type a term and get every
relevant record in the workspace — projects, issues, tasks, labels, members —
organised, fast, professional. And the same search for `bk`.

## What is already here (investigated, not assumed)

| Thing | State |
|---|---|
| `GET /api/workspaces/{ws}/search` | Exists. The **platform** factory (`searchRoute`) over `platform.entities`: **titles only**, issue/task/project only. Its own header forbids app-specific behaviour, so it is not extended. |
| `bk issues search` | Exists, mounted by `appverbs` over that route. Same limits. |
| Web UI | **None.** Only per-listing filters (`lib/listing-search.ts`, client-side, per page). |
| `apps/sales` | Hit the same wall (D-9) and built `GET …/sales-search` + its own `bk sales search`, full text over its own tables, deliberately a *different path* so "which search did I get" never depends on the deployment. |

So the gap is not "no search" — it is **no UI, and a backend that cannot see
descriptions, comments, labels or people.** The entity index cannot be widened:
labels and members are not projected, and projecting them would be a migration
plus a reconciler for a read that needs neither.

## Decisions

1. **New route `GET /api/workspaces/{ws}/issues-search`**, this app's own, reading
   `issues.*` + the `platform.*` tables issues owns (labels, comments, members).
   Same reasoning and same naming as `sales-search`. The platform `/search` stays
   mounted for binaries that predate this and is recorded in `EXCLUDED_PATHS`.
2. **Searchable types:** `project`, `task`, `issue`, `label`, `member`, `comment`.
   Matches title/name, description/summary (HTML stripped in SQL so `div` does not
   hit markup), label description, member name + email, comment body.
3. **No migration, no new index.** `ILIKE` over workspace-scoped rows, exactly what
   the listings' `?search=` already does. tsvector columns (sales) buy stemming we
   do not need and cost a migration on a live app. Revisit if a workspace ever
   makes it slow; the route's contract does not change when the engine does.
4. **Ranking is explicit and boring:** `#N` exact > title equals > title prefix >
   word-start > substring in title > match only in body. Multi-word queries are
   AND across words (each may match a different field), same as the listings.
   Results are capped **per type** (default 5, `per_type` up to 25) so one noisy
   type cannot push the rest off the screen.
5. **Server returns `path` and a `snippet`.** The client never rebuilds a URL, and
   the snippet is a window around the first match, with whitespace collapsed.
6. **Labels honour `app IS NULL OR app = 'issues'`** (`VISIBLE_TO_THIS_APP`) — every
   label read in this app must, or another app's labels leak.
7. **Comments** resolve to their parent (bare and `issues:`-qualified type forms,
   both, per `qualified-type.ts`) and are dropped when the parent is binned.
8. **Trash:** hidden by default; `include_deleted=1` (the existing flag) shows
   binned issues/tasks/projects, marked `deleted: true`.
9. **The type list is a vocabulary**, so it lives in one DB-free module
   (`lib/search-types.ts`), is served by `bk meta` as `search_types`, and the CLI's
   copy is held to it by `cli-vocabulary.test.ts`. No guide topic restates it.

## The UI

* A **floating round button, bottom-right**, opens a **chat-style popup anchored
  above it** (full-width sheet on phones). Also opened by **⌘K / Ctrl+K** and `/`,
  and by a **Search** row at the top of the sidebar (discoverability; the button
  alone is invisible on a scrolled page's far edge).
* Input on top, results below; **fixed panel height** so the input never jumps as
  results arrive. Grouped by type with counts, status/priority glyphs, `#number`,
  highlighted match, and a snippet when the hit was in the body.
* **Type chips** (All · Projects · Issues · Tasks · Labels · People · Comments):
  choosing one re-queries that type with a larger cap.
* **Keyboard first:** ↑/↓ move, Enter opens, Esc closes, ⌘K toggles. `#42` jumps
  by number. ARIA combobox/listbox with `aria-activedescendant`.
* **Empty state is useful:** recent searches (localStorage, wrapped in try/catch),
  and a two-line hint about `#42` and chips.
* Debounced (180 ms), aborts stale requests, keeps the previous results on screen
  while the next arrive (no flash), skeleton on first load, honest error state.
* Tokens, `Modal`-style surface, `motion` and lucide only — nothing new in
  `package.json`.

## The CLI

`bk issues search <query…> [--type a,b] [--limit N] [--include-deleted]` is
re-pointed at `/issues-search` (the `appverbs` `Search` flag goes off for this app,
as it is for sales, and the app registers its own). Same verb, same flags, richer
answer: TYPE, REF, TITLE, MATCH (snippet). Route → command → guide → changelog in
one change, per the surface contract.

## Explicitly not doing

* Cross-app search (retired by the multi-app refactor; each app answers for itself).
* Searching project *updates* (health posts), attachments' filenames, activity.
  Each is one more `UNION` arm later; none was asked for.
* Fuzzy/typo matching in the server. The listings do it client-side over what they
  already loaded; a global search that fuzzy-matches server-side needs `pg_trgm`,
  which is a migration.

## Verification owed (the standing rule)

* Break each guard and watch it go red: the cli-parity route claim, the
  vocabulary test, the label app-scope predicate, the binned-parent comment drop.
* A route is not a page: open the popup in a browser with real data, and report
  what was seen.
