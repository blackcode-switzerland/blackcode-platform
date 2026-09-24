# Standalone deployment: a separate, rebranded product

**Goal:** a second company gets b/billing as its own product, under its own
name, in its own repository, on its own database and domain, with its own
command-line binary, and with nothing shared with Blackcode at runtime, in git
history, or in what a person or an agent can read. This is decision **D-B6**
in the [README](README.md). It is an **extraction**, and the repo has rehearsed
the database half of one ([`extracting-an-app.md`](../extracting-an-app.md));
the code half and the brand half are new, and this doc is where they are
planned.

- **The problem** — "totally separate" is five separate things, and a copy of
  this repo gives none of them cleanly. At runtime a fresh database cannot be
  brought up by `apps/billing` alone, because the shared `platform.*` schema is
  created only by `apps/issues`' migrations and one of them registers `issues`
  pointing at our production. In git a copy carries every other app's source
  and all of its history. In brand the word Blackcode, the domain, the npm
  package name and the binary name appear in 74 user-visible places across the
  code the customer would run, plus 219 Go import paths, and eleven of the
  thirteen platform guide topics show `bk issues …` or `bk sales …` as
  examples. In data, the rehearsed extraction dumps `platform.users`, every
  user of every app. And in maintenance, a copy stops receiving fixes on the
  first commit after it is made, because the platform packages have no
  published versions.
- **What this milestone does** — gives `platform.*` its own migrations so a
  fresh database can be bootstrapped with no app in it; declares every
  brandable fact in one file so a rebrand is data, not archaeology; writes an
  extraction script that produces the customer's repository from a tag of this
  one with the brand applied, the other apps gone, the lists that name them
  shrunk to one entry, and a fresh git history; puts a brand-leak guard in the
  artifact that fails on any trace of ours; and rehearses the whole thing on
  the local Docker instance from the artifact, not from this repo.
- **Expected result** — running one script on a tag yields a repository in
  which `grep -ri blackcode` returns nothing, every gate the platform has is
  green with one app, the renamed binary lists one command group and logs in
  to one server, and a fresh database plus one deploy from that repository
  serves a working, branded invoicing product; and doing it again on the next
  tag yields the next version, so the customer's product is a build artifact of
  this repo rather than a fork of it.

## In one look

| | |
|---|---|
| **Data** | `packages/platform-db/migrations/` with its own ledger. A `brand.json`. No new table anywhere. |
| **Logic** | `devops/extract-billing.sh`: copy, delete, rewrite, guard, `git init`. One brand-leak test in the artifact. Two migrators run in order by the postbuild script. |
| **UI** | The same screens with the customer's name, logo, colour and domain. Nothing else changes for a person. |

## "Totally separate", stated so it can be checked

| Axis | What separate means | How it is checked |
|---|---|---|
| **Runtime** | Their deployment talks to their database and their Resend account; no request ever reaches a Blackcode host | `grep` for our hostnames in the artifact returns nothing; `bk app list` from their binary shows one app with their URL |
| **Git** | Their repository has no other app's source and no history before the extraction | `git log --oneline \| wc -l` in the artifact is 1; `ls apps/` is `billing` |
| **Brand** | Their name, domain, logo, colour, binary name, npm package | the brand-leak guard (§4), which fails the artifact's own test run |
| **Data** | Their users, their tokens, their invoices, from an empty database | no dump is ever taken; the database is bootstrapped, so the data-protection question in `extracting-an-app.md` does not arise |
| **Release** | Their Vercel project, their npm package, their version numbers | their `release.sh` registry has one line and their npm scope is theirs |

## The one decision this doc does not make

Who maintains the customer's repository after the first extraction decides its
shape. Two answers, and they are not compatible:

| | **Generated artifact** (recommended) | **One-time snapshot** |
|---|---|---|
| What the customer's repo is | The output of `extract-billing.sh` on a tag of this repo, regenerated on each release we ship them | A copy made once, then edited by hand, by whoever owns it |
| How a fix reaches them | Fix here, tag, re-extract, deploy from the new artifact | Cherry-pick by hand, forever, across a rename |
| Who may commit to their repo | Nobody. It is a build output. Hand edits are overwritten by the next extraction | Anyone they say |
| Brand | Data in `brand.json`, applied by the script | Applied once, by hand, then maintained by hand |
| What it costs us | The script, kept working by its own tests, and a rehearsal per release | Nothing up front, and a second product to maintain by hand from the second week |
| When it is right | We build and maintain the product for them | They take over engineering, or the contract forbids our access after handover |

**This doc plans the generated artifact**, because the customer wants a product
and we are the ones building it, and because a hand-maintained copy of a
codebase is a hand-maintained copy of a fact, which is what every row of
CLAUDE.md's table warns about. If the answer is a snapshot, the script still
produces the first one; only §8 changes, and the brand-leak guard stays.

## Two things from the first draft of this doc that are still true

1. **The address book is the only roster of apps at runtime.**
   [`app-registry.ts:52`](../../packages/platform-db/src/app-registry.ts#L52)
   calls `enabled` *"the one filter"*, `/api/meta` serves it, and `bk` refuses
   an app not in it ([`client.go:122`](../../cli/internal/cmdutil/client.go#L122)).
   In the customer's database that table has one row. Nothing is disabled;
   the other apps are absent. No edition flag, no `enabled_apps` env.
2. **The bootstrap is required.** [`platform-db.md:347`](../platform-db.md#L347)
   says the platform migrations live in `apps/issues`, and
   [`0034:72`](../../apps/issues/lib/db/migrations/0034_app_registry_and_access.sql#L72)
   inserts the `issues` row. A fresh database for the customer needs
   `platform.*` from somewhere that is not the issues app.

## Build

### 1. The platform bootstrap: `packages/platform-db/migrations/`

A migrations directory and a ledger, `__drizzle_migrations_platform`, in the
package that owns the schema, with a `drizzle.config.ts` of the same shape as
[`apps/books/drizzle.config.ts:49`](../../apps/books/drizzle.config.ts#L49).
`0001_platform_init.sql` is hand-written and creates exactly what the shared
code touches:

| What | Created today by | Why |
|---|---|---|
| `platform` schema, `users` | issues `0033`, `0048` | identity |
| `apps` | issues `0034`, **without its `INSERT`** | the address book, empty |
| `api_tokens`, `password_reset_otps`, `email_whitelist` | issues `0033` | tokens, the four password routes, the signup gate |
| `error_events` | issues `0002`, `0024` | written by the shared handler on every 5xx ([`handler.ts:117`](../../packages/platform-api/src/handler.ts#L117)); CLAUDE.md's list of shared tables omits it, the code does not |
| `blob_references` and the `blob_refs_*` functions | issues `0037`, `0038` | every app's `0002` grants on `blob_refs_purge` and sets the flag; both fail without them |

**The trap.** `workspaces`, `workspace_members` and `workspace_invitations` in
`platform.*` are the issues app's own tenancy, and the shared account code
reads them: [`account.ts:71`](../../packages/platform-db/src/account.ts#L71)
says so in its comment, line 111 selects from it, line 149 deletes from it,
and [`account-footprint.ts:7`](../../packages/platform-api/src/account-footprint.ts#L7)
is the `DELETE /api/me` path phase 0 mounts. On a database without those
tables that route is a 500. Either the bootstrap carries the three empty, or
`account.ts` stops reading one app's table. **The rehearsal in §7 decides,
not this doc.** Write the answer here when it is known.

**Running it.** `migrate-if-enabled.mjs` spawns `drizzle-kit migrate` twice
with `--config`: the package's, then the app's. The deploy log says "applying"
twice.

**Baselining our production.** Insert the ledger row for `0001` by hand and
never run it there. Then prove the squash is the catalog, finding #20's
lesson: `pg_dump --schema-only --schema=platform` of production, restricted to
the tables above, diffed against a fresh database that ran only the bootstrap.
Empty diff, recorded with its command in `docs/changelog/platform.md`. From
then on `platform.*` DDL lands in the package and nowhere else; rewrite
`platform-db.md:347-350`, and guard it with a scan of every app's migrations
newer than the baseline for `CREATE TABLE platform.` and `ALTER TABLE
platform.`, asserted non-vacuous on a fixture.

This is platform work, owed to every app: `apps/sales` and `apps/books` cannot
be brought up alone today either. It can run beside phases 1 to 5.

### 2. The brand file: every brandable fact, and where it lives today

`brand.json`, kept **outside** this repo's committed tree or in a
customer-specific path the extraction reads, never in `apps/billing`. One
entry per fact. The table is the survey of 2026-09-16; each row is a place
the script rewrites, and the brand-leak guard is what catches a row this
table missed.

| Fact | Where it is today | Rewritten to |
|---|---|---|
| Product name | `APP_NAME` in `lib/app.ts` (books: [`app.ts:40`](../../apps/books/lib/app.ts#L40)), `layout.tsx` title, the login page | `brand.product_name` |
| Contact email, sender name | `contactEmail` in `lib/email/send.ts` (books: [`send.ts:60`](../../apps/books/lib/email/send.ts#L60)); the display half of the From line comes from `APP_NAME` | `brand.contact_email`; `RESEND_FROM_EMAIL` is their env |
| Accent colour | `EMAIL_ACCENT` ([`app.ts:61`](../../apps/books/lib/app.ts#L61)) and `--primary` in `globals.css` | `brand.accent`, with the 4.5:1 contrast rule checked by the script |
| Logo, favicon | `public/logo.png` (books has one; the scaffold has no `public/`) | `brand.logo_path`, copied in |
| Domain | `NEXTAUTH_URL`, `AUTH_COOKIE_DOMAIN` (env), and the `base_url` in the register script | `brand.domain` |
| Binary name | `"bk"` in [`cli/npm/package.json:11`](../../cli/npm/package.json#L11), `cmd/bk/`, and the word `bk` in every help string, guide topic and `Example:` | `brand.cli_name`. **This is the largest rewrite** and the one the guard must be pointed at hardest: `bk` is three letters and appears inside other words |
| npm package | `@blackcode_sa/bc-issues` in [`cli/npm/package.json:2`](../../cli/npm/package.json#L2), hardcoded in [`main.go:66`](../../cli/cmd/bk/main.go#L66), `skill.go:40`, and **served by the API** at [`meta.ts:196`](../../packages/platform-api/src/meta.ts#L196) | `brand.npm_package` |
| Go module path | `github.com/blackcode-switzerland/bc-issues` in [`main.go:12`](../../cli/cmd/bk/main.go#L12) and 218 other import lines | `brand.go_module`, by `go mod edit -module` plus one `sed` |
| Config directory | `~/.config/bk` ([`config.go:198`](../../cli/internal/config/config.go#L198)) and `BK_CONFIG_DIR` | `~/.config/<cli_name>`, `<CLI_NAME>_CONFIG_DIR` |
| Default server | [`config.go:29`](../../cli/internal/config/config.go#L29) `https://issues.blackcode.ch` | `https://<brand.domain>`; their binary logs in to their product without `--server` |
| Token prefix | `bk_live_` at [`tokens.ts:27`](../../packages/platform-auth/src/tokens.ts#L27), checked server-side and generated CLI-side | `brand.token_prefix`; both sides in one commit of the script, and with a fresh database there are no old tokens to strand |
| URN prefix | `bc:` in `packages/platform-db/src/urn.ts` | `brand.urn_prefix`. URNs are built, not stored, so nothing in the database carries the old one |
| Version source | [`cli-version.ts`](../../packages/platform-agent/src/cli-version.ts) `CLI_NPM_PACKAGE` (whose npm dist-tags `latest`/`min` are read live), the `FALLBACK_*` constants, and the `BK_CLI_*` env names | `CLI_NPM_PACKAGE` → their npm package, fallbacks reset to `1.0.0`; their own dist-tags from then on |
| Prose | "Blackcode" in [`login.go:33`](../../cli/internal/commands/platform/login.go#L33), [`app.go:52`](../../cli/internal/commands/platform/app.go#L52), [`changelog.go:103`](../../cli/internal/commands/platform/changelog.go#L103), and the rest of the 74 | `brand.company_name`; then the guard finds what the list missed |
| Example domains in help | `blackcode.ch` in `superadmin.go:341,373` | `brand.domain` |
| Guide topics | 11 of 13 `topics/platform/*.md` show a sibling app's command as an example | the script rewrites `bk issues`, `bk sales`, `bk books` examples to `<cli> billing` equivalents where one exists and deletes the paragraph where none does; the artifact's `guide_test.go` then runs with one `vocabularySources` line |
| Changelogs | `docs/changelog/{platform,issues,sales,books,billing}.md` | `platform.md` restarted with one entry naming the upstream tag; `billing.md` kept; the other three dropped |
| `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/` | this repo's history and the other apps, everywhere | regenerated from short templates in `devops/extract/`; `docs/` reduced to what the artifact needs, brand applied |

### 3. The extraction script: `devops/extract-billing.sh <tag> <brand.json> <out-dir>`

Deterministic, and tested by running it. In order:

1. **Export the tag.** `git archive <tag>` into `<out-dir>`. Never the working
   tree.
2. **Delete.** `apps/issues`, `apps/sales`, `apps/books`, `apps/_scaffold`;
   `cli/internal/commands/{issues,sales,books,scaffold}`;
   `cli/internal/client/{issues,sales,books,scaffold}.go`;
   `cli/internal/guide/topics/{issues,sales,books,scaffold}`; the three
   changelogs; `docs/sql/{issues,sales,books}-*`; every `docs/*` file the
   template set does not name.
3. **Shrink the lists that name apps to one entry.** The table in
   [phase 0 §8](phase-0-register-the-app.md) is the inventory: the group loop
   at [`root.go:231`](../../cli/internal/commands/root.go#L231) becomes
   `billing.NewGroup()` alone; `OTHER_SCHEMAS` becomes `[]`;
   `vocabularySources`, `helpAppPlaceholders`, `SCAN_ROOTS`,
   `TRACKED_SCHEMAS` and `app_registry()` each keep their billing line. Every
   one of those guards must still assert its inputs are non-empty with one
   app; a guard that goes vacuous at one app is finding #10's shape.
4. **Rebrand.** Apply `brand.json` per the table in §2, module path first,
   then package names, then the binary name, then prose. Order matters
   because the binary name is a substring of the others.
5. **Bootstrap wiring.** The artifact's `migrate-if-enabled.mjs` already runs
   both migrators; nothing to do here beyond confirming the package's
   migrations directory survived step 2.
6. **Run every gate in the artifact.** `npm run typecheck && npm test &&
   npm run lint && npm run build`; `go build ./... && go vet ./... && go test ./... && make routes`;
   then the brand-leak guard (§4). **Any failure aborts the extraction with
   no output directory.** A script that emits a broken artifact and exits 0 is
   finding #7.
7. **`git init`, one commit.** Its message names the upstream tag and the
   brand file's hash. A file `UPSTREAM` at the root carries the same two facts
   for a reader who does not open the log.

**What the script does not do:** touch a database, deploy anything, publish
anything. It produces a directory. The rehearsal (§7) and the recipe (§5) do
the rest, from that directory.

**How the script is tested:** by running it on the current tag with a fixture
brand file into a temp dir, in CI, and asserting the gates it runs inside are
the ones that fail when they should: delete one line from the brand file and
watch the leak guard go red; put `bk sales` back into a guide topic and watch
`guide_test.go` go red.

### 4. The brand-leak guard, inside the artifact

`packages/platform-testing/test/brand-leak.test.ts`, shipped **in the
artifact**, not here. It scans every text file under `apps/`, `cli/`,
`packages/`, `docs/`, `devops/` and the repo root for:

| Pattern | What it catches |
|---|---|
| `[Bb]lackcode` | the company, the domain, the npm scope, the Go module |
| `\bbc-issues\b`, `\bbc:` | the old package and URN prefix |
| `\bbk\b` outside the string `brand.cli_name` | the old binary name; the word boundary is what stops it matching `bk_live_` if that prefix was deliberately kept |
| `\bbk (issues\|sales\|books\|scaffold)\b`, `apps/(issues\|sales\|books\|_scaffold)`, `\b(issues\|sales\|books\|scaffold)_app\b`, `\b(issues\|sales\|books\|scaffold)\.\w+` in SQL | the other apps, by their command, directory, role and schema spellings. **Not the bare word `issues`**, which is English |

It says what it matched and where. It asserts it scanned more than zero files.
It is watched failing on a fixture that contains each pattern once, in the
script's own test, before the first real extraction.

### 5. The customer recipe, from the artifact

Every step below is run from the extracted repository, not this one, with the
customer's credentials, by whoever holds them.

1. **Database.** A new Neon project. Empty.
2. **Role.** `docs/sql/billing-app-role.sql` as the migrator.
3. **Register, part 1.** `docs/sql/billing-app-register.sql`, already carrying
   the brand's product name, description and `base_url`, `enabled = false`.
   One row.
4. **Vercel project.** Root `apps/billing`, the artifact's `.vercelignore`,
   and the environment below. `NEXTAUTH_SECRET` generated for this project.
5. **First deploy.** The log says "applying" twice.
6. **Probe** as `billing_app`, positive checks first; transcript into the
   artifact's `apps/billing/docs/backend.md`.
7. **Register, part 2.** `enabled = true`.
8. **First person.** Their administrator, whitelisted and in `SUPER_ADMINS`,
   signs up, gets a workspace, invites staff.
9. **Integration token.** Service account, invited, token minted in the
   browser at `/settings/tokens`
   ([`integration-surface.md`](integration-surface.md) §7).
10. **Their system calls.** `/integration` on their domain is their
    documentation, and it names their binary and their package.

| Environment variable | Value |
|---|---|
| `DATABASE_URL`, `MIGRATE_DATABASE_URL`, `RUN_MIGRATIONS=1` | theirs; Production only for the flag |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AUTH_COOKIE_DOMAIN` | theirs, set in that order |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | their own Resend account and verified domain ([`identity.ts`](../../packages/platform-email/src/identity.ts) explains why the address is one per account) |
| `SUPER_ADMINS` | their administrator |
| `<CLI_NAME>_CLI_LATEST`, `<CLI_NAME>_CLI_MIN` | unset; the constants in the artifact are theirs |
| `BLOB_READ_WRITE_TOKEN` | unset; v1 has no uploads. Whether the app boots without it is answered by §7 |

### 6. The customer's CLI

Their binary is built from the artifact's `cli/`, published to their npm
package, and:

- has **one app group** and the bare account verbs, because step 3 of the
  script left one line in the group loop;
- **logs in to their product without `--server`**, because `DefaultServer`
  is theirs;
- keeps its config under `~/.config/<cli_name>`, so it cannot read or clobber
  a Blackcode `bk` config on the same machine;
- mints and checks tokens with their prefix;
- advertises **their** version from **their** `/api/meta`, and their
  `release.sh` bumps it. The "publish before raising the floor" rule is now
  theirs to keep, and their `docs/changelog/platform.md` is how their agents
  hear about it;
- prints a `--help` that names one app. There is no trace of the others to
  annotate, which is what the first draft of this doc could not offer.

### 7. The rehearsal, from the artifact, on Docker

The proof that "they just want billing" holds is that the artifact works with
nothing else present. **Do not `docker compose down -v`**; that is the shared
local database. Create a second one:

```bash
docker exec blackcode-postgres psql -U blackcode -d blackcode_issues \
  -c 'CREATE DATABASE billing_extracted'
```

From `<out-dir>`, against that database only, in the recipe's order: role,
register, deploy simulated by `RUN_MIGRATIONS=1 npm run build --workspace=billing`,
probe. Point the artifact's `apps/billing/.env.local` at it and boot.

| Surface | What must be true |
|---|---|
| `\dn` | `platform`, `billing`, `drizzle`. Nothing else. State the query. |
| `SELECT slug, name FROM platform.apps` | one row, the brand's name |
| `/login`, signup through the whitelist | works, in the brand's name; a workspace is minted |
| the dashboard, FR and EN | opens, empty, no "Blackcode" anywhere on screen |
| `/settings/tokens` | mints a token with the brand's prefix |
| `/cli/authorize` and `<cli> login` with no `--server` | round-trips to `localhost:3300`; `<cli> app list` shows one app |
| `<cli> --help` | one app group |
| `GET /api/meta` with the token | one entry in `apps`; `cli.package` is their npm package; the integration block is present |
| `GET /api/me/footprint`, `DELETE /api/me` on a throwaway user | **decides §1's open question.** A 500 means `account.ts` reached a table the bootstrap did not create |
| `/integration` | renders, names their binary and package |
| the artifact's own gates | green, run from `<out-dir>` |

Transcript, with the upstream tag and the brand hash, into the artifact's
`apps/billing/docs/backend.md`; a one-line pointer with the same two facts
into this repo's `docs/changelog/billing.md`.

### 8. Ongoing: how the second version reaches them

- **Fix here, in `apps/billing` and `packages/*`, with the gates this repo
  has.** The customer's repo is never edited.
- **Tag, extract, rehearse, hand over.** The artifact's migrations directories
  are byte-identical to ours, so their ledgers advance in step with ours; the
  brand touches no migration. A migration that would name another app cannot
  exist, by the isolation rule.
- **Their release is theirs.** The artifact's `release.sh` has one registry
  line and one npm package; who runs it is a contract question.
- **A brand change is a brand-file change** and the next extraction.
- **If the decision above becomes "snapshot"**, this section is replaced by
  "they own it now, and this repo records the tag they left from."

## Routes and CLI

No new route. No new command. The artifact carries the same routes and the
same commands as `apps/billing` here, under another name.

## Done when

- [ ] The bootstrap exists, our production is baselined against it with an
      empty catalog diff recorded, and the "no `platform.*` DDL in an app"
      guard was watched failing on a fixture
- [ ] `brand.json`'s schema is documented, every row of the §2 table has a
      rewrite in the script, and the script refuses a brand file with a
      missing key
- [ ] `extract-billing.sh` on the current tag with the fixture brand produces
      an artifact whose own gates are green, whose `apps/` holds one directory,
      whose `git log` has one commit, and whose `UPSTREAM` file names the tag
- [ ] The brand-leak guard was watched failing on a fixture containing each
      pattern once, and on the real artifact with one line of the brand file
      removed
- [ ] The §7 rehearsal was walked from the artifact, every row answered, and
      §1's open question answered in this doc
- [ ] `<cli> issues issue list` against the artifact's server is
      `unknown command`, because the group does not exist, and that was
      **run**, not read
- [ ] `grep -ri blackcode <out-dir>` returns nothing, and so does a grep for
      the customer's name in this repo

## Notes

- **The token prefix is the one brand fact worth not changing.** It is
  checked on both sides and appears in every token a person ever copies. If
  the customer does not care, keep `bk_live_` and exclude it from the guard's
  `\bbk\b` pattern, which the word boundary already does. Decide before the
  first extraction; a fresh database makes it free then and costly later.
- **Hosting.** Whether their Vercel project and Neon project sit in our
  accounts or theirs is a contract question this doc does not answer. The
  recipe is the same either way.
- **The first draft of this doc planned a second deploy target of this repo.**
  That was rejected on 2026-09-16 because the customer needs a product that
  is theirs, not a tenant of ours with a different name. What survived from
  it is the bootstrap and the fact that the address book is the only roster.
  What did not survive is written nowhere else, on the rule that a doc
  prescribing a rejected design is worse than no doc.
