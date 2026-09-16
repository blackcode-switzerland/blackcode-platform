# b/billing — backend

This app only. Platform-wide contracts are in the root `docs/`: `backend.md` for
the API conventions and the `platform.*` schema, `platform-db.md` for the
database boundary, `adding-an-app.md` for how an app is registered.

The build plan is `docs/billing-app-plan/`, one document per milestone.

## What exists (phase 0)

`billing.*` holds four tables and nothing about invoicing:

| Table | What it is |
|---|---|
| `workspaces` | this app's tenants. `slug` is UNIQUE and appears in every URN this app prints |
| `workspace_members` | **the access gate.** Membership of a workspace IS permission to use this app; `platform.workspace_apps` and `platform.app_access` were dropped on 2026-08-10 |
| `invitations` | offers. Nothing redeems them yet — there is no accept route |
| `counters` | `(workspace_id, entity_type, last_value)` — the workspace `#number` allocator |

`counters` is deliberately not the scaffold's `note_counters`, which is one
column per entity type and so needs an ALTER every time the app grows a noun.
This app grows four more across phases 1, 4 and 5.

**Two numbers, and conflating them would be the worst bug this app could
ship.** `seq` from `counters` is the ADDRESS an agent and a URN use
(`bc:billing:acme/invoice/12`). The statutory invoice number is per COMPANY,
gapless, and allocated in phase 1 from `billing.company.next_seq` by a
row-locking `UPDATE … RETURNING`. Never a Postgres `SEQUENCE`: a rollback would
consume a value and leave a hole.

## The account surface, and why it is larger than the scaffold's

The scaffold mounts nine method exports. This app mounts those plus the five
b/books proved are needed:

| Route | Why it is here |
|---|---|
| `/api/cli/authorize` **and `app/cli/authorize/page.tsx`** | `bk login --server https://billing…` opens the PAGE and the page posts to the route. Mount only the route and the browser 404s while the terminal waits forever on a loopback listener, with no error at either end |
| `/api/me/footprint` GET + DELETE | without it, closing a blackcode account **strands** this app's data, owned by an account that can no longer sign in |
| the four password routes | the app has its own login, so it owes its own recovery. `apps/sales` used to send people to `apps/issues` to change a password both apps share |
| `/api/tokens`, `/api/tokens/{id}` | `bk login` authorizes at this origin, and it is how the first external customer's service account gets its credential |
| `/api/meta` | **its own route, not a factory.** Mounting it is what makes `bk login --server <billing>` work at all: the CLI learns every app's address from `apps.<slug>.base_url` in this payload, and an app serving no `apps` block writes an EMPTY registry |

`POST /api/workspaces` is served here and is **not** in the scaffold's set. The
reasoning is in the route file and in `createWorkspaceForUser`.

## Decisions this app took in phase 0

**The empty-workspace dead end (`docs/2026-08-multi-app-refactor.md` §9.1) is
closed with an explicit act.** Somebody arriving on a session cookie from another
blackcode app has a valid session here and no workspace, because
`ensureWorkspaceForUser` runs only in the sign-in callback and in
`POST /api/auth/register`. They now get a "create a workspace" action that calls
`POST /api/workspaces`, the same route `bk billing workspace create` calls.

The rejected option was bootstrapping on first authenticated request. It is
cheapest and it is wrong for this app: it would mean anyone holding a blackcode
account for any reason silently acquires tenancy in the app that sends real
payment slips.

**No one-workspace-per-person cap, unlike b/books.** A second workspace here is
a genuinely separate TENANT; a second issuing entity is a company inside one
workspace. Phase 6 also needs two workspaces owned by one person to force every
empty state.

**`APP_NAME`, `CONTACT_EMAIL` and `EMAIL_ACCENT` read the environment.** A copy
of this app runs as another company's invoicing product, so what a person reads
must move without a rebuild. `APP_SLUG` never does: it is the schema, the CLI
namespace and the guide directory.

## The boundary probe, run as `billing_app`

Local Docker (`blackcode-postgres`, port 5434, database `blackcode_issues`),
2026-09-17, on branch `feat/billing-phase-0-be`.

Provisioned in the order `docs/sql/billing-app-role.sql` states — role, register
part 1, migrate, register part 2 — because two migrations depend on things
existing and neither fails loudly.

**The positive checks, read first.** A role granted nothing denies everything
with `42501` and passes six of the probe's eight denial checks, so the denials
are the weaker half (CLAUDE.md finding #16).

| Check | Result |
|---|---|
| **(1) own schema readable** | ok — `billing.workspaces` readable |
| **(4a) blob index readable** | ok — count returned |
| **(4e) purging its OWN references** | ok — succeeded, 0 rows |
| (2) `issues.issues` | refused, `42501` |
| (3) `CREATE TABLE platform.…` | refused, permission denied for schema platform |
| (4b) forging a foreign reference | refused, permission denied for table blob_references |
| (4c) erasing a foreign reference | refused, same |
| **(4d) purging ANOTHER app's references** | refused by **`blob_refs_purge`'s own guard**: "role billing_app may not purge references held by app not-this-app" — not a schema denial, which is what would mean the grants never landed |
| (5) `drizzle.__drizzle_migrations` | refused, permission denied for schema drizzle |

**And the grants that prove the role is provisioned rather than empty** — this
is the query that returned 0 rows for `books_app` on 2026-08-17 while its probe
passed:

| | |
|---|---|
| tables in `billing` with DML for `billing_app` | 4 of 4 (`counters`, `invitations`, `workspace_members`, `workspaces`) |
| default ACL entries for future tables | 2 |
| `EXECUTE` on `platform.blob_refs_purge` | true |
| `maintains_blob_index` | true |
| tables owned by `billing_app` | **0** |
| privileges outside SELECT/INSERT/UPDATE/DELETE | **0** |
| schemas reachable | `platform`, `billing` (and `public`, which is empty and has no CREATE) |

Migrations landed as three rows in `drizzle.__drizzle_migrations_billing` — this
app's own ledger. A shared ledger silently skips an app's migrations, because
drizzle takes one high-water mark over the whole table.

## The guards, watched failing

A check nobody has watched fail is not a check (CLAUDE.md's standing rule).
Every guard this phase added or relies on was broken, observed red, and
restored, on 2026-09-17:

| Guard | The mutation | What it said |
|---|---|---|
| `lib/cli-parity.test.ts` | `cli/internal/guide/topics/billing/` renamed away, `make routes` re-run | "no bk command is ATTRIBUTED to billing" — route attribution comes from the guide section list |
| `lib/app-isolation.test.ts` third case | `import { listMyWorkspaces } from '@blackcode/platform-db'` added to `app/dashboard/page.tsx` | named the file and the helper |
| the same, namespace form | `import * as pdb` plus `pdb.listMyWorkspaces(…)` — the spelling the named scan cannot see | named the call |
| `lib/db/queries/holds-covers-entities.test.ts` | a `probe` table added to the schema with no `holds` line | "billing.probe … an app that under-reports its footprint is silently SKIPPED" |
| the same, vacuous-pass case | the declaration regex changed so it matches nothing | "has been passing without a subject" |
| `lib/no-brand-literal.test.ts` | `b/billing` in JSX text; then in a string literal; then an empty file list | each reported, including "scanned 0 files" |
| `migration-journal.test.ts` | one journal entry deleted | "these migrations … will never apply … this is exactly what shipped on 2026-08-17" |
| `migration-ledger.test.ts` | the ledger table name reverted to drizzle's default | "two apps would migrate into the SAME drizzle ledger … SILENTLY SKIPPED" |
| `guide_test.go` `vocabularySources` | a topic restating three invitation statuses | `--- FAIL: …/billing` — the app-specific section that b/books never had |
| the same, source path | `vocabularySources["billing"]` pointed at a missing file | `TestVocabularySourcesAreReal` |
| `help_app_roster_test.go` (new) | the billing row deleted from the root help tour; then a row naming an app the binary lacks | both directions reported |
| `devops/release.sh` | `release.sh web billing` with the placeholder project id | refused, naming the step that fixes it |

## Still owed at the end of phase 0

- **The Vercel project.** `bc-billing` does not exist. `devops/release.sh`
  carries billing's registry line with a placeholder project id and **refuses to
  deploy it**, naming the step that fixes it — a real-looking id would deploy to
  whichever project the working copy was last linked to.
- **The production probe.** The transcript above is local, against the owner
  credential for the app and the real role for the probe. Production has a
  separate migrator, which the local container does not model.
- **`bk login` through a browser.** The loopback round-trip needs a real
  browser session and is a human step.
- **`/api/me/footprint`'s `holds` array is empty**, correctly: this app has no
  entities. Phase 1 must add `company` and `invoice` to it, and
  `lib/db/queries/holds-covers-entities.test.ts` fails the build if it does not.

## Frontend

`apps/billing/docs/frontend.md`.
