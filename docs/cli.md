# CLI (`bk`) — maintainer doc

> **2026-08-10 — the command tree has TWO verb tiers** (multiAppFinalRefactor
> Phase 4; supersedes the 2026-08-06 three-tier note, which superseded the
> 2026-08-04 "platform verbs stay bare"). Package layout, and the boundary the
> tests enforce:
>
> ```
> cli/internal/commands/            root.go, aliases.go, deprecations.go, routes.go
>   commands/platform/              tier 1 — login, logout, whoami, token, profile,
>                                   meta, app, guide, skill, changelog, version,
>                                   super-admin. Nothing else.
>   commands/issues/                that app's nouns — bk issues issue|task|project|…
>                                   …plus what it adds to tier 2 (appverbs.go)
> cli/internal/appverbs/            tier 2 — workspace, member, invite, user, upload,
>                                   trash, label, search, activity, inbox, storage,
>                                   built PER APP from a per-app Config
> cli/internal/cmdutil/             what both need: client construction, --ws/-v, flags, formatting
> cli/internal/guide/topics/{platform,issues,sales,scaffold}/
> ```
>
> | Tier | Verbs | Spelling | Server |
> |---|---|---|---|
> | **Bare** | `login` `logout` `whoami` `token` `profile` `meta` `app` `guide` `skill` `changelog` `version` `super-admin` | bare | home |
> | **App-owned** | app nouns, **plus** `workspace` `member` `invite` `user` `upload` `trash` `label` `search` `activity` `inbox` `storage` | `bk <app> <verb>` | that app's |
>
> `bk link` was **removed** — see `docs/changelog/platform.md`.
>
> The test is unchanged and is still **"would two deployments answer
> differently?"**, not "is it shared code?" (D-28). What changed is the answers.
> D-11's NEUTRAL tier rested on one `platform.workspaces`; its CROSS-APP tier
> rested on one entity index and one upload ledger. Phases 2 and 3 gave
> `apps/sales` its own workspaces, members, invitations, labels, uploads ledger
> and event feed, and stopped it projecting into the shared index. **D-28's
> pairing — "you upload into one app; you list across all of them" — no longer
> describes anything**, because the ledger moved with the upload.
>
> **`appverbs.Config` declares what each app SERVES**, verb by verb. That is
> D-36's rule one level down: a permanent subset is legitimate, an accidental one
> is a bug. `apps/sales` gets `workspace` without `create/edit/delete` (D-3),
> `member` without `leave`, and no `inbox`, `storage` or `user` at all — because
> it mounts no route for them, and a command that could only 404 is a dead end
> with a help page. Both directions are checked by each app's
> `lib/cli-parity.test.ts` against the filesystem.
>
> **The active workspace is PER APP** (`config.ActiveWorkspaces`, keyed by slug).
> One field was correct while every app read one workspace table; since Phase 2
> there are two with overlapping ids, and one field meant
> `bk sales workspace use x` silently retargeted `bk issues …` — measured, not
> reasoned about. A 3.x config's single active workspace is adopted for the HOME
> app and for no other. There are two readers and both matter:
> `ResolveWorkspaceRef` (the path a scoped command asks for) and
> `ClientWorkspaceSlug` (sent as `?workspace=` on `GET /api/upload`, which
> decides the blob folder). Injecting a regression into one and not the other is
> how that second reader was found to be unguarded.
>
> Anything naming an app's entities (`bk issues label attach <issue>`) is built in
> that app's package and added to the group — otherwise every app would claim an
> issues route in the parity test. The same rule retired `bk issues storage attachments`:
> it listed only issue attachments, so it became the noun
> `bk issues attachment list`. One noun must not straddle two tiers.
>
> **Command packages must not import each other**, and the platform must not
> import any app (`commands/boundaries_test.go`). Anything two of them need goes
> in `cmdutil` or `appverbs`, both outside `internal/commands/`. Pre-namespace
> spellings are gone; `deprecations.go` names the replacement for each, and
> `cmd/bk/main_test.go` proves the binary actually prints it.

> **Scope.** This is the **maintainer** doc: how `bk` is built, released,
> versioned and structured internally.
>
> It is **not** the agent-facing usage guide. That is **`bk guide`**, whose
> topics live in [`cli/internal/guide/topics/`](../cli/internal/guide/topics) and
> are `//go:embed`-ed into the binary. If you are documenting *how to use a
> command*, it belongs there or in the command's own `--help`, not here.
>
> The reason for the split: a guide that ships with the binary always describes
> the binary being run. A guide in a doc (or on a server) can describe a `--flag`
> the user does not have — which is worse than being out of date. The rules that
> used to live in this file's "conventions" sections have moved to guide topics
> for exactly that reason.

The `bk` command-line tool is a Go binary and **the only supported interface** to
blackcode issues for scripts and agents. The HTTP routes it calls are private
plumbing with no public contract.

It lives in [`/cli`](../cli) as a standalone Go module — separate from the web app.

---

## Table of contents

1. [Overview](#overview)
2. [Build & install](#build--install)
3. [Project layout](#project-layout)
4. [Authentication](#authentication)
5. [Active workspace](#active-workspace)
6. [Command reference](#command-reference)
7. [Configuration & environment](#configuration--environment)
8. [Output formats](#output-formats)
9. [Exit codes](#exit-codes)
10. [Patterns for agents and scripts](#patterns-for-agents-and-scripts)
11. [Internals](#internals)
12. [The embedded guide & skill](#the-embedded-guide--skill)

---

## Overview

| Property | Value |
|---|---|
| Language | Go (see `go.mod`; currently 1.26) |
| Module | `github.com/blackcode-switzerland/bc-issues/cli` — see note below |
| Binary | `bk` |
| Framework | [cobra](https://github.com/spf13/cobra) |
| Auth | Bearer API tokens (same `api_tokens` table the web uses) |
| Default server | `http://localhost:3000` |

> **Module path vs repo name.** The GitHub repo was renamed
> `bc-issues` → `blackcode-platform` on 2026-08-04. The Go module path keeps the
> old name deliberately: GitHub redirects, the module is never fetched by path
> (it is built from the checkout), and renaming it would churn every import in
> `cli/` for no benefit. `cli/npm/install.js` and `devops/release.sh` **were**
> repointed at the new name, because they build URLs for future releases.
> Versions published before the rename still reference the old URL and keep
> working via the redirect.

The CLI mirrors the web app's capabilities: workspaces, projects, members, issues, comments, attachments, tasks, labels, invitations, an inbox, the activity feed, analytics, moving/copying items between workspaces, and — for super admins — platform-wide administration (members, access whitelist, error logs). Output defaults to a human-readable table; `--json` and `--yaml` produce machine-friendly formats with stable shapes.

A typical session:

```bash
bk login --server https://issues.example.com   # browser-based authorize flow
bk issues workspace list                               # show your workspaces
bk issues workspace use acme                           # pick the active workspace
bk issues project list                                 # show your projects
bk issues issue create --project 1 --title "Fix login" --priority 2
bk issues issue list --project 1 --mine
bk issues issue comment 42 --body "Investigating now"
```

---

## Build & install

All commands are run from the `cli/` directory.

```bash
make build            # builds ./bk for the host platform
make install          # installs to $GOBIN (default: ~/go/bin)
make all              # cross-compiles every target into dist/
make dist             # `all` plus dist/SHA256SUMS
make test             # go test ./...
make run -- <args>    # development shortcut: `go run ./cmd/bk <args>`
```

A plain `go build` works too:

```bash
cd cli
go build -o bk ./cmd/bk
```

The cross-compile matrix (`make all` / `make dist`) covers `darwin/amd64`, `darwin/arm64`, `linux/amd64`, `linux/arm64`, `windows/amd64`, and `windows/arm64`, emitting `dist/bk-<version>-<os>-<arch>[.exe]`.

Versions are stamped into the binary via `-ldflags` (into the `internal/version` package):

- `version.Version` — `git describe --tags --dirty --always` (or `"dev"`)
- `version.Commit` — short git SHA
- `version.BuildDate` — ISO-8601 UTC at build time

`bk version` prints all three.

---

## Releasing & version management

A release is cut with the repo's release script (from the repo root):

```bash
./devops/release.sh cli            # interactive — prompts for everything
./devops/release.sh cli minor      # or pass the bump to skip the first prompt
```

It is **interactive** and asks three things up front, then shows a plan and a
final "Proceed?" confirm before doing anything irreversible:

1. **Bump** — patch / minor / major / explicit `vX.Y.Z` (skipped if passed as an arg).
2. **Upgrade policy** — *normal* or *forced* (see below).
3. **Deploy web?** — whether to push the web app to production at the end.

On confirm it: preflights (gh/npm/git auth, clean tree, version unused — plus
Vercel auth if deploying web); edits `cli/npm/package.json` + `install.js`
(install.js derives its version from package.json, so they can't drift) **and**
`packages/platform-agent/src/cli-version.ts`, then makes **one** commit + push for all three; creates and
pushes the `vX.Y.Z` tag; `make dist` cross-compiles (version stamped via
`-ldflags`); publishes the GitHub Release + npm package; and finally deploys web
if you said yes. (One commit, near the start — the tag and the published binary
are built from it, so it can't be deferred to after publish.)

### Upgrade policy: normal vs forced

The "update available" notice and the hard min-version block (see
[Updates](#updates)) are driven by **server** constants in `packages/platform-agent/src/cli-version.ts`,
which the script now edits for you:

- **normal** → sets `CLI_LATEST_VERSION` to the new version (soft "a new bk version
  is available" notice).
- **forced** → also raises `CLI_MIN_VERSION`, so clients below it are hard-blocked
  with "please upgrade" and exit code `8`. Choose this when a server change is
  incompatible with older CLIs (e.g. a breaking route/field rename).

Because the gate lives in the web app, it only takes effect once the web is
deployed — so if you answer **no** to "Deploy web?", the script reminds you to run
`./devops/release.sh web` later. (`BK_CLI_LATEST` / `BK_CLI_MIN` env vars still
override at runtime without a redeploy.) This keeps the CLI and the server in
step per the agent surface contract in `CLAUDE.md` / `AGENTS.md`.

**Order matters when raising the floor:** publish the new CLI to npm and verify a
clean install *before* raising `CLI_MIN_VERSION`. Raising it first locks out every
user with no working version to move to.

---

## Project layout

```
cli/
├── cmd/bk/main.go            # Entry point; maps APIError → exit codes
├── internal/
│   ├── browser/              # Cross-platform "open URL in browser"
│   ├── client/               # HTTP client + DTO types (client.go, types.go, workspace.go)
│   ├── appverbs/             # upload/trash/label — built once per app
│   ├── commands/             # Cobra commands (root + subcommands)
│   ├── config/               # ~/.config/bk/config.json loader
│   └── output/               # table / json / yaml renderer
├── go.mod
├── Makefile
└── README.md
```

Direct dependencies are intentionally minimal: `cobra`, `golang.org/x/term` (for hidden token input), and `gopkg.in/yaml.v3`.

---

## Authentication

There is no `BK_SERVER` or `BK_TOKEN` environment variable. The server URL and token are chosen at login time and stored in the config file. To change servers, log in again with a different `--server`.

### `bk login` — browser flow

```bash
bk login --server https://issues.example.com
```

1. The CLI generates a random 32-byte hex `state` token.
2. It binds a loopback TCP listener at `127.0.0.1:<random ephemeral port>`.
3. It opens this URL in the system browser:
   ```
   {server}/cli/authorize?callback=http://127.0.0.1:{port}/callback&state={hex}&name=cli-{hostname}
   ```
4. You sign in (if needed) and approve. The web app's `/cli/authorize` route mints an API token and redirects the browser to the loopback `callback` with `?token=…&state=…` appended.
5. The CLI's listener accepts the request, validates `state` (exact compare), pulls the token from the query string, serves a small "you can close this tab" page, and shuts the listener down. It waits up to 5 minutes for approval.
6. The CLI validates the token by calling `GET /api/me` with `Authorization: Bearer …`.
7. The token + user info land in the config file (mode `0600`).

If `--server` is omitted, the default is `http://localhost:3000`.

### `bk login --token` — headless flow

For CI or environments without a browser. The CLI reads the token from stdin (hidden if a TTY, plain if piped), then validates it the same way (`GET /api/me`) before saving. Mint a token from **Settings → API Tokens** and paste it:

```bash
echo "$MY_TOKEN" | bk login --token --server https://issues.example.com
```

### `bk logout`

Deletes the local config file. The corresponding token row remains in the database — revoke it explicitly from **Settings → API Tokens** if you want it dead server-side.

### `bk whoami`

Hits `GET /api/me`. Prints the authenticated user's id, email, name, role, and how the auth was resolved (`via`: `session` vs `token`). If the token belongs to a super admin it also prints `super: yes`.

---

## Active workspace

Everything below the workspace level is partitioned by workspace: projects, tasks, issues, labels, members, invitations, activity, analytics. Pick the active workspace once, and the rest of `bk` operates within it.

```bash
bk issues workspace list                 # workspaces you can use this app in (active row marked with *)
bk issues workspace list --all           # every workspace you are a member of, + apps you can reach
bk issues workspace use acme             # set the active workspace by slug or numeric id
bk issues workspace show                 # details of the active workspace
```

The active workspace (id, slug) is stored in the config file and is also set server-side via `POST /api/me/active-workspace`. Workspace-scoped command groups (`label`, `member`, `invite`) require an active workspace and fail with a clear message if none is set. Workspace API paths accept either the **slug** or the **numeric id** — **prefer the slug**.

> **Agents: pick the workspace by name, not by number.** Most accounts belong to more than one workspace, and the numeric id is opaque (a sequential integer that says nothing about which team it is), so selecting by id is the easiest way to write to the wrong place. Run `bk issues workspace list` (or `GET /api/meta`, which returns the full `workspaces` list), match the user's intent to a workspace by its `name`/`slug`, then `bk issues workspace use <slug>` (or `--ws <slug>` per command). The active workspace is only a default — confirm it's the intended target before creating anything.

### Reading another workspace without switching (`--ws`)

`--ws <slug|id>` is a **global flag** that targets a different workspace for that one command only — it does **not** mutate the active workspace (no config write, no `POST /api/me/active-workspace`). A read should never have side effects:

```bash
bk issues issue list --ws acme --search "login bug"   # read acme; active workspace unchanged
bk issues issue view 234 --ws acme                     # view by the #seq shown in the app
```

### Global flags

| Flag | Purpose |
|---|---|
| `--ws <slug\|id>` | Target a workspace for this command only; does not change the active one. |
| `-v`, `--verbose` | Log each HTTP request/response (method, URL, status, body) to stderr. Same as `BK_DEBUG=1`. Use this instead of dropping to `curl` when the CLI's view disagrees with reality. |
| `-o`, `--json`, `--yaml` | Output format (see [Output formats](#output-formats)). |

---

## Command reference

Every read command supports `-o table|json|yaml|yml` (default `table`), plus `--json` / `--yaml` / `--yml` shortcuts. Destructive commands that prompt support `--yes` / `-y` to skip confirmation (and respect `BK_NO_PROMPT=1` and non-TTY stdin).

### Self-description

```bash
bk guide                 # the complete usage guide for THIS binary (offline, no auth)
bk guide --list          # topic slugs + one-line summaries
bk guide <topic>         # one topic; unknown slug exits 2 with the valid list
bk guide --json          # { version, topics: [{ slug, title, summary, body }] }

bk skill install         # write the agent skill file (--format agents-md for AGENTS.md)
bk skill path            # where it would go / already is
bk skill check           # exit 0 = current, exit 9 = something is behind
bk skill sync            # the one command an agent is told to run when anything drifts
bk skill uninstall
```

**The name.** The skill is `blackcode` — installed at
`.claude/skills/blackcode/SKILL.md` — since 3.0.0 (D-17). It was
`blackcode-issues`, and the rename is not cosmetic: an agent scanning the
available skills, seeing one named after the issue tracker while it has been
asked to do sales work, and concluding "not my job" is the one failure the skill
exists to prevent. `bk skill sync` migrates an existing install (see below).

**Ownership.** `bk` writes only between `<!-- BEGIN blackcode … -->` and
`<!-- END blackcode -->`; everything outside those markers survives every
install and sync. The pre-3.0.0 markers (`blackcode-issues`) are still
recognised — if they were not, every file installed by an older `bk` would
classify as hand-written, `sync` would refuse to touch it, and it would freeze at
whatever version installed it. The write path always emits the current pair, so a
file converts on its first sync. A `SKILL.md` with neither the markers nor a `bk` version stamp
was written by a human, and `bk` will not touch it: `install` fails (exit 1)
naming the options (`--dir`, `--format agents-md`, `--force`), and `sync` leaves
it alone and exits 0. Files written by 1.9.0 carry a stamp but no markers; they are
recognised as `bk`'s own and migrated to the marked format on first sync.

This matters because `bk skill sync` is the one command agents run unprompted —
a destructive write there would delete a team's rules with nobody watching.
Enforced by `cli/internal/skill/skill_test.go`.

See [The embedded guide & skill](#the-embedded-guide--skill) for how to maintain them.

### Auth / session

| Command | Purpose |
|---|---|
| `bk login [--server URL] [--token]` | Browser flow, or headless `--token` (reads token from stdin). |
| `bk logout` | Clear local config. |
| `bk whoami` | Show current user (id, email, name, role, via). |
| `bk meta` | Agent bootstrap (`GET /api/meta`): current user, active workspace, and **every workspace you belong to** (id, name, slug, role, active marker). Run it first and pick your target by name/slug, not the numeric id. `--ws <slug\|id>` previews another workspace's context without switching. |
| `bk version` | Print version, commit, build date. |
| `bk changelog [--full] [--reference] [--server URL]` | What changed + the current CLI version floor (`GET /api/changelog`). **Public — works before `bk login`.** |

`bk changelog` is public: it works without authentication. It targets the
logged-in server if there is one, else `https://bc-issues.vercel.app`;
`--server URL` overrides the host. Default output is a `DATE`/`CHANGE` table of
the dated entries; `--full` prints the platform reference plus every entry in
full; `--reference` prints only the baseline reference.

### Workspaces

| Command | Backend call | Notes |
|---|---|---|
| `bk issues workspace list [--all]` | `GET /api/workspaces[?all=1]` | Active row marked with `*`. **App-scoped by default** (Phase 4): only workspaces you can use *this* app in. `--all` shows every workspace you are a member of plus an APPS column — the apps you can reach in each. An empty APPS column means member-without-access. |
| `bk issues workspace show [slug\|id]` | `GET /api/workspaces/:ref` | Defaults to the active workspace. |
| `bk issues workspace create --name N [--use]` | `POST /api/workspaces` | `--use` (default `true`) sets it active after creation. |
| `bk issues workspace use <slug\|id>` | `GET /api/workspaces/:ref` + `POST /api/me/active-workspace` | Sets the active workspace. |
| `bk issues workspace edit [slug\|id] --name N --slug S` | `PATCH /api/workspaces/:ref` | Refreshes the stored active slug if you renamed it. |
| `bk issues workspace transfer [slug\|id] --to <user>` | `POST /api/workspaces/:ref/transfer` | Owner only; you become a regular member. |
| `bk issues workspace delete <slug\|id> --confirm <slug\|id>` | `DELETE /api/workspaces/:ref` | Owner only, irreversible. `--confirm` must repeat the argument and is required even with `--yes` / `BK_NO_PROMPT=1`. Never defaults to the active workspace. Clears the active selection if it deleted it. |

### Apps & access (workspace-scoped)

Membership puts a person in the organisation; **app access** lets them open an app
inside it. `bk app` is a PLATFORM verb, so it stays at the root when Phase 5 moves
this app's nouns behind `bk issues …` — "which apps does this org run" is the same
question from any app.

| Command | Backend call | Notes |
|---|---|---|
| `bk app list` | `GET /api/workspaces/:ws/apps` | Any member. Shows enabled state, `default_access`, and how many members hold access. |
| `bk app enable <app> [--mode M]` | `PATCH /api/workspaces/:ws/apps/:app` | Owner only. `--mode all_members` (default) grants every current member immediately; `invite_only` grants nobody. |
| `bk app disable <app> --confirm <app>` | `PATCH /api/workspaces/:ws/apps/:app` | Owner only. Revokes every grant. `--confirm` must repeat the slug, required even with `--yes`. **The server refuses to disable the app serving the request** (`cannot_disable_current_app`) — it would lock the workspace out of the product with no route back. |
| `bk app default-access <app> --mode M` | `PATCH /api/workspaces/:ws/apps/:app` | Owner only. Switching TO `all_members` grants every current member; switching to `invite_only` keeps existing grants (revoke explicitly if that is the intent). |
| `bk app access list <app>` | `GET /api/workspaces/:ws/apps/:app/access` | Any member. Lists members **without** access too — "who is missing it" is the question this gets asked. |
| `bk app access grant <app> --user <ref>` | `POST /api/workspaces/:ws/apps/:app/access` | Owner only. `<ref>` is an id, email, name, or `me`. |
| `bk app access revoke <app> --user <ref>` | `DELETE /api/workspaces/:ws/apps/:app/access/:userId` | Owner only. The workspace owner cannot be revoked (`cannot_revoke_owner`) — nobody could grant it back. |

Calling into a workspace where you are a member but hold no access exits **4**
with `app_access_denied` and a `hint:` line naming who can grant it. `bk meta`
reports `current_app` and an `apps` object — the apps your token can reach, keyed
by slug, with the workspaces you can reach each in. An app you cannot reach
anywhere is absent entirely.

### Moving / copying items between workspaces

Transfer projects, tasks, and issues from the **active** workspace into another
workspace you belong to. The whole transfer is one server-side transaction: the
items are copied into the target first, then (for `move`) the originals go to the
recycle bin. If anything fails, nothing is written to the target and the source
is left untouched — **no data can be lost**.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues move --to <ws> [--project N ...] [--task N ...] [--issue N ...]` | `POST /api/workspaces/:ws/move` (`mode=move`) | Copies the selected items into `--to`, then bins the source copies. |
| `bk issues copy --to <ws> [--project N ...] [--task N ...] [--issue N ...]` | `POST /api/workspaces/:ws/move` (`mode=copy`) | Same, but leaves the source in place — items end up in **both** workspaces. |

- `--project` / `--task` / `--issue` are the workspace **#numbers** and are each repeatable.
- `--cascade-tasks` (default `true`) also carries a transferred project's tasks; `--cascade-issues` (default `true`) also carries a project's/task's issues. Pass `--cascade-tasks=false` to move a project **without** its tasks, etc.
- Items receive **new #numbers** in the target (the source numbers are workspace-scoped and would collide). Labels are matched or created by name. Comments, attachments, watchers, assignees, project members, and project updates all come along.
- Anything the target workspace can't hold is dropped and reported under `adjustments`: a user reference (assignee / reporter / lead / owner / watcher / project member / `@mention`) is kept only if that user is a member of the target workspace. A parent link (project/task) is cleared when the parent isn't part of the same transfer.

```bash
# Move a whole project (with its tasks + issues) into the "growth" workspace
bk issues move --to growth --project 42

# Move only specific issues, leaving everything else behind
bk issues move --to growth --issue 108 --issue 106 --issue 105

# Copy a project's structure but not its issues, into another workspace
bk issues copy --to growth --project 42 --cascade-issues=false
```

> ⚠️ **Encoding when scripting a bulk move.** If you drive a transfer by piping
> text through a shell (e.g. reading titles out with `bk … --json` and feeding
> them into another command), make sure your terminal is UTF-8. See
> [Character encoding (UTF-8)](#character-encoding-utf-8) — a non-UTF-8 Windows
> console will silently corrupt accented characters and dashes (`é`→`Ã©`, `—`→`ΓÇö`).

### Projects

| Command | Backend call | Notes |
|---|---|---|
| `bk issues project list [--search TEXT]` | `GET /api/workspaces/:ws/projects` | Returns every project in one response (not paginated). `--search` is server-side (name/description, plus the #id when numeric — e.g. `123` or `#123`). |
| `bk issues project view <id>` | `GET /api/workspaces/:ws/projects/:id` | |
| `bk issues project members <id>` | `GET /api/workspaces/:ws/projects/:id/members` | |
| `bk issues project issues <id> [--status S] [--assignee REF]` | `GET /api/workspaces/:ws/issues?project_id=:id` | Status/assignee filters applied client-side. |
| `bk issues project tasks <id>` | `GET /api/workspaces/:ws/tasks?project_id=:id` | |
| `bk issues project create --name N [--description D \| --description-file F] [--file F ...]` | `POST /api/workspaces/:ws/projects` | `--file` uploads + embeds inline (repeatable). |
| `bk issues project edit <id> [--name] [--description \| --description-file] [--status]` | `PATCH /api/workspaces/:ws/projects/:id` | |
| `bk issues project delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/projects/:id?mode=…` | Moves to Trash. `--cascade` bins attached tasks/issues as a group (restores together). `--detach` (default) keeps children active, just unlinked. Prompts to confirm. |
| `bk issues project add-member <id> --email E [--role owner\|admin\|member\|viewer]` | `POST /api/workspaces/:ws/projects/:id/members` | `--role` defaults to `member`. The user must already be registered. |
| `bk issues project remove-member <id> --user REF [--yes]` | `DELETE /api/workspaces/:ws/projects/:id/members` | `REF` = id, email, or display name. Prompts to confirm. |

### Issues

> **Issue identifier — the `#number`.** Every issue has a single id: the
> per-workspace **`#number`** shown in the app (e.g. `#234`). Commands take that
> number directly, so `bk issues issue view 234` and `bk issues issue view #234` both work.
> There is no separate global id — the API addresses items by this number too.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues issue list [--project N] [--status S] [--assignee REF ...] [--mine] [--search TEXT]` | `GET /api/workspaces/:ws/issues` | Returns every matching issue in one response (not paginated). `--mine` = assigned to the current user. `--assignee` is repeatable. `--search` is server-side (title/description, plus the #id when numeric — e.g. `123` or `#123`); status/assignee filters are client-side. Footer shows `showing X of N`. |
| `bk issues issue view <id>` | `GET /api/workspaces/:ws/issues/:id` | `id` is the `#number` shown in the app (a leading `#` is accepted). |
| `bk issues issue create --project N --title T [...]` | `POST /api/workspaces/:ws/issues` | Full flag list below. |
| `bk issues issue edit <id> [...]` | `PATCH /api/workspaces/:ws/issues/:id` | Pass `none`/`null`/`unset`/`clear` to clear a field. |
| `bk issues issue assign <id> <user> [<user> ...]` | `PATCH /api/workspaces/:ws/issues/:id` | Adds one or more assignees (does not remove existing). |
| `bk issues issue unassign <id> [<user>]` | `PATCH /api/workspaces/:ws/issues/:id` | Removes a specific assignee, or clears all if no user given. |
| `bk issues issue delete <id> [--yes]` | `DELETE /api/workspaces/:ws/issues/:id` | Moves to Trash. Prompts to confirm. Restore with `bk issues trash restore issue:<#number>`. |
| `bk issues issue comment <id> --body "..." \| --body - \| --body-file F [--reply-to C] [--file F ...]` | `POST /api/workspaces/:ws/issues/:id/comments` | Body or `--file` required. `--reply-to` threads under comment id C. `--file` uploads + embeds inline. |
| `bk issues issue comments <id>` | `GET /api/workspaces/:ws/issues/:id/comments` | |
| `bk issues issue activity <id>` | `GET /api/workspaces/:ws/issues/:id/activity` | Merged comments + change log. |
| `bk issues issue attach <id> --file F` | `POST /api/upload` then `POST /api/workspaces/:ws/issues/:id/attachments` | Adds to the **attachments list** (sidebar), not the body. To embed inline use `--file` on `create`/`comment`. |
| `bk issues issue attachments <id>` | `GET /api/workspaces/:ws/issues/:id/attachments` | |
| `bk issues issue detach <id> <attachment-id> [--yes]` | `DELETE /api/workspaces/:ws/issues/:id/attachments/:attachmentId` | Prompts to confirm. |

**`issue create` flags**:

```
--project N             (required)
--title "..."           (required)
--description D | -      literal, or "-" for stdin
--description-file F     read description from file
--priority 1-5          1 = urgent
--status S              backlog | todo | in_progress | done | cancelled
--assignee REF [...]    id, email, display name, or "me" — repeatable for multiple assignees
--task N           task id
--start-date YYYY-MM-DD
--due-date YYYY-MM-DD
--label NAME            label name; repeatable — existing labels matched, unknown ones created on the fly
--attach FILE           adds FILE to the issue's attachments list (sidebar), separate from the body
--file FILE             uploads FILE and embeds it inline in the description (repeatable)
```

> `--status` is free-form on the CLI side and validated server-side. The canonical issue statuses are `backlog`, `todo`, `in_progress`, `done`, and `cancelled`.

#### Embedding files in descriptions & comments

There are three ways to put a file **inline in the body** (image preview,
video/audio player, or download card — the same result as web drag-and-drop).
All work because the server rewrites uploaded-file urls into rich-text nodes.

1. **`--file FILE` (repeatable)** — uploads and **appends** the file to the body.
   Best when placement at the end is fine. Available on `issue/task/project
   create` and `issue comment`.

2. **Reference a local file path in the body** — for a *structured* doc (files
   under specific headings), just reference local paths in `--description` /
   `--description-file` (and `--body`); the CLI uploads each and rewrites it in
   place:

   ```md
   ## Demo video
   ![](./out.png)                         <!-- image -->
   [](<~/clips/screen recording (1).mov>) <!-- see angle-bracket note below -->
   ```

   A reference is only uploaded when the target has no `http(s)://` scheme and
   resolves to a real file on disk; everything else is left untouched. Empty
   link text is auto-filled from the filename. **No sidebar record is created.**

   > **Paths with spaces or parentheses must be angle-bracketed**: `[](</abs/my
   > file (2).mp4>)`. Plain Markdown stops the destination at the first `)`, so
   > `[](/a/foo(1).mp3)` would silently truncate.

3. **`bk <app> upload FILE...`** — uploads and prints just the url(s) (no sidebar
   record), for scripting: `URL=$(bk issues upload ./x.png --json | jq -r '.[0].url')`,
   then drop `![](URL)` into the body yourself.

> Bodies are Markdown (or HTML), stored as sanitized HTML. **GFM tables**
> (`| a | b |` …) render as real tables. To embed video/audio, upload it and
> reference the url (above) — raw `<iframe>` and external media are stripped.

> **`--file` vs `bk issues issue attach`.** `--file` (and the methods above) embed in the
> **body**. `bk issues issue attach` is different — it's issue-only and adds the file to
> the separate **attachments list** (sidebar), not the body.

**`issue edit` flags**: `--title`, `--description` / `--description-file`, `--status`, `--priority`, `--assignee` (repeatable, replaces all assignees; `none` clears all), `--task`, `--start-date`, `--due-date`. Only flags you actually pass are sent; nullable fields (`--task`, `--start-date`, `--due-date`) accept the `none` sentinel to clear them. `--assignee none` sends an empty array, removing all assignees.

### Tasks

`bk tasks` is an alias for `bk issues task`.

| Command | Backend call |
|---|---|
| `bk issues task list [--project N] [--search TEXT]` | `GET /api/workspaces/:ws/tasks[?project_id=N&search=TEXT]` | `--search` is server-side (name/description, plus the #id when numeric — e.g. `123` or `#123`). |
| `bk issues task view <id> [--include-issues]` | `GET /api/workspaces/:ws/tasks/:id[?includeIssues=true]` |
| `bk issues task create --project N --name M [--description D \| --description-file F] [--due-date YYYY-MM-DD] [--file F ...]` | `POST /api/workspaces/:ws/tasks` | `--file` uploads + embeds inline (repeatable). |
| `bk issues task edit <id> [--name] [--description \| --description-file] [--due-date <YYYY-MM-DD\|none>]` | `PATCH /api/workspaces/:ws/tasks/:id` |
| `bk issues task delete <id> [--yes] [--cascade \| --detach]` | `DELETE /api/workspaces/:ws/tasks/:id?mode=…` | Moves to Trash. `--cascade` bins attached issues as a group. `--detach` (default) keeps issues active. |

### Trash (recycle bin, workspace-scoped)

All deletes (issues, projects, tasks) are soft — rows move to a per-workspace Trash rather than being destroyed. Use `bk <app> trash` to inspect and manage the bin. **App-owned since 3.0.0**: each app has its own bin, so the app names itself; there is no bare `bk trash`.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues trash list [--type issue\|project\|task]` | `GET /api/workspaces/:ws/trash` | Shows binned items grouped by deletion batch. |
| `bk issues trash restore <type:#number> [<type:#number> …]` | `POST /api/workspaces/:ws/trash/restore` | e.g. `bk issues trash restore issue:42 project:3`. Refs are **#numbers** since 1.12.0 (they were row ids before — do not reuse an old one). Detects and reports conflicts. |
| `bk issues trash restore --batch <id> [--restore-parents\|--standalone]` | same | Restore a whole cascade-delete group at once. |
| `bk issues trash purge <type:#number> [--yes]` | `DELETE /api/workspaces/:ws/trash/purge` | Permanent hard-delete. **Owner only.** Refs are **#numbers** since 1.12.0. The wire format keeps both spellings distinct (`{type,number}` vs the legacy `{type,id}`) so a pre-1.12.0 binary is never misread — see `app/api/workspaces/[ws]/trash/parse.ts`. |
| `bk issues trash purge --batch <id> [--yes]` | same | Purge a whole batch. |
| `bk issues trash empty [--yes]` | `POST /api/workspaces/:ws/trash/empty` | Hard-delete everything in the bin. **Owner only.** |

**Automatic file cleanup.** When you permanently delete a trashed item (`bk issues
trash purge` / `bk issues trash empty`), any files embedded in that content are automatically
removed from storage once nothing else in the workspace references them — so
storage is freed without owner action. (Same for `bk issues issue delete-comment`.) See
[Storage](#storage-workspace-scoped-owner-only).

Restore conflict flags: `--restore-parents` (also restore the parent when a child's parent is still binned) and `--standalone` (restore the child with the parent link cleared). If neither is passed and conflicts exist, the command reports them and exits non-zero.

### Labels (workspace-scoped, app-owned)

Operate on the active workspace; paths are `…/workspaces/{ws}/…`. **App-owned
since 3.0.0** — `bk <app> label …`. CRUD is app-agnostic and lives in
`internal/appverbs`; `attach`/`detach` name an entity in one app and are built in
that app's package.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues label list` | `GET /api/workspaces/:ws/labels` | |
| `bk issues label view <id>` | `GET /api/workspaces/:ws/labels/:id` | |
| `bk issues label create --name N [--color #rrggbb] [--description D]` | `POST /api/workspaces/:ws/labels` | `--color` defaults to `#6b7280`. |
| `bk issues label delete <id>` | `DELETE /api/workspaces/:ws/labels/:id` | Removes it from all issues. |
| `bk issues label attach <issue-id> <label-id>` | `POST /api/workspaces/:ws/issues/:issue/labels` | |
| `bk issues label detach <issue-id> <label-id>` | `DELETE /api/workspaces/:ws/issues/:issue/labels/:label` | |

### Members (workspace-scoped)

| Command | Backend call | Notes |
|---|---|---|
| `bk issues member list` | `GET /api/workspaces/:ws/members` | |
| `bk issues member remove <user-id>` | `DELETE /api/workspaces/:ws/members/:user` | Owner only. |
| `bk issues member leave` | `POST /api/workspaces/:ws/leave` | Not allowed for the owner. |

### Invitations (workspace-scoped)

| Command | Backend call | Notes |
|---|---|---|
| `bk issues invite send <email> [--app A]` | `POST /api/workspaces/:ws/invitations` | If the invitee has no account, prints a shareable invite link. `--app` invites them into one app and grants it on accept **even where that app is `invite_only`** — the invitation is the grant. Without it, accepting grants whatever the workspace's apps hand out by default. |
| `bk issues invite list [--all]` | `GET /api/workspaces/:ws/invitations[?all=true]` | Owner only. `--all` includes accepted/revoked/expired. |
| `bk issues invite revoke <id>` | `DELETE /api/workspaces/:ws/invitations/:id` | |
| `bk issues invite accept <token>` | `POST /api/invitations/accept` | Accept by token. |
| `bk issues invite decline <token>` | `POST /api/invitations/decline` | Decline by token. |
| `bk issues invite pending` | `GET /api/me/pending-invitations` | Invitations pending for your email, across workspaces. |
| `bk issues invite candidates` | `GET /api/workspaces/:ws/invite-candidates` | Owner only. People you can invite without retyping an email; status column shows `member`/`invited`/`—`. |

### Inbox

Per-user notifications (invitations, mentions, assignments, status changes).

| Command | Backend call | Notes |
|---|---|---|
| `bk issues inbox list [--unread]` | `GET /api/me/inbox` | Prints an unread count to stderr. `--unread` shows only unread messages. |
| `bk issues inbox read [id ...] \| --all` | `POST /api/me/inbox/mark-read` | Provide message ids, or `--all` to mark every unread message read. |
| `bk issues inbox archive <id> [id ...]` | `POST /api/me/inbox/archive` | At least one id is required. |

### Users

`bk users` is an alias for `bk issues user`.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues user list` | `GET /api/users` | |
| `bk issues user view <id\|email>` | `GET /api/users` + client-side filter | No single-user endpoint; the CLI filters the list. |

### Files (app-owned)

**App-owned since 3.0.0** — `bk <app> upload …`. The receiving deployment is what
`platform.uploads.app` records and what decides the storage prefix, so there is no
bare spelling and no default.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues upload <file> [<file> ...]` | `POST /api/upload` | Uploads file(s) (size cap from `bk meta`), prints the url(s). Table mode prints bare urls (pipeable); `--json` returns `[{url,filename,size,contentType}]`. Does **not** create a sidebar attachment. See [Embedding files](#embedding-files-in-descriptions--comments). |

### Storage (workspace-scoped, owner only, CROSS-APP)

**Bare, and deliberately so (D-28).** One cabinet, one workspace quota, the same
rows whichever app asks — so an app segment would imply a narrowing it does not
do. You upload INTO one app (`bk <app> upload`) and list ACROSS all of them.

`bk issues storage attachments` was retired in the same change: it listed only ISSUE
attachments while `storage list` spans every app, so it is now the issues noun
`bk issues attachment list`.

Every file uploaded into the workspace is tracked. Removing a file from a
description/comment does **not** delete the stored bytes (so undo and
trash-restore stay safe) — use these to review usage and delete unused files.

| Command | Backend call | Notes |
|---|---|---|
| `bk issues storage list [--app <slug>]` | `GET /api/workspaces/:ws/storage[?app=]` | Files with `APP` (which app uploaded it), `REFS` (how many things reference each, across every app, incl. trashed items) and total usage. `REFS 0` = orphan. `--json` includes the full reference breakdown + `usage_bytes`/`limit_bytes`. `--app` filters the file list; the usage total stays workspace-wide, because the quota is the workspace's. |
| `bk issues storage rm <id> [--yes]` | `DELETE /api/workspaces/:ws/storage/:id` | Permanently delete a file by id. **Refused (409 `file_in_use`) if anything still references it** — remove those references or empty the Trash first. Also refused if the reference answer cannot be *proven* (an enabled app with no registered scanner); read that as "could not establish this file is unused", not "it is in use". Irreversible. |
| `bk issues attachment list` | `GET /api/workspaces/:ws/attachments` | The workspace-wide attachments table (every `bk issues issue attach` row), joined to its issue + uploader. An issues noun, not a `storage` subcommand — D-28. |

### Search, and the links that are gone (2026-08-10)

Both were **bare** verbs, and that placement was the design rather than a
default: they read `platform.entities` / `platform.links`, which every app wrote
to, and a link's two ends could live in different apps.

Phase 4 of multiAppFinalRefactor ended both premises.

| Command | Backend call | Notes |
|---|---|---|
| `bk <app> search <query> [--type T] [--limit N] [--include-deleted]` | `GET /api/workspaces/:ws/search` | **One app's** entities. Matches **titles and #numbers only** — for descriptions or status/assignee/label filters, use the app's own listing. `--app` is gone: the app is the command. Mounted only where the app has the route; `apps/sales` has its own `bk sales search` over `/sales-search` instead. |
| `bk link …` | — | **REMOVED.** `deprecations.go` names the workaround: put the far end's URN in the record's own text. `platform.links` and `linksRoute` still exist and no app mounts the route; re-mounting for INTRA-app links is a five-line change if it is ever wanted (PLAN.md §4b). |

The relation vocabulary that `bk meta` served under `links.relations` is now read
by nothing in the CLI. It is left on the server rather than removed here, because
that is a route change and this was a CLI phase — flagged for Phase 5.

URN shape: `bc:<app>:<workspace-slug>/<entity-type>/<number>`, where `<number>`
is the workspace #number and never the row id. Do not hand-assemble one; take it
from `bk issues search` or from an activity entry's `subject_urn`.

### Activity / analytics

| Command | Backend call | Notes |
|---|---|---|
| `bk <app> activity [--limit N] [--cursor N] [--since 24h] [--subject URN]` | `GET /api/workspaces/:ws/activity` | **That app's** change feed (keyset-paginated). `--app` was removed with the shared feed. `--limit` defaults to 50; `--cursor` is the last event id seen, echoed as `next page: --cursor=N` on stderr. `--since` takes a relative window (`30m`/`24h`/`7d`) and is mutually exclusive with a raw `from=` (400 `since_and_from`). `--subject` gives one entity's whole history in one call. Each row carries the producing `app`. |
| `bk issues analytics [flags]` | `GET /api/workspaces/:ws/analytics` | Workspace analytics with full web-dashboard parity (see below). `--ws <slug\|id>` targets another workspace via the path. Any member; not admin-only. |

**`bk issues analytics` flags** — all optional; defaults to the active workspace,
workspace scope, last-30-days window, daily buckets:

| Flag | Meaning |
|---|---|
| `--view workspace\|project\|task\|member` | Analytics scope. |
| `--id N` | Target id — required for `project` / `task` / `member`. |
| `--ws <slug\|id>` | Target a workspace without changing the active one. |
| `--from`, `--to` | Window bounds (`YYYY-MM-DD` or ISO). Omit for all-time. |
| `--interval day\|week` | Time-series bucket width. |
| `--status`, `--priority`, `--label`, `--assignee` | Faceted filters; repeatable or comma-separated, applied to every metric. |

Default output is a readable summary (KPIs + by-status / by-priority /
by-assignee); `--json` / `--yaml` emit the **full** payload (trends, all series,
histograms, burndown). Examples:

```bash
bk issues analytics                                              # active workspace, 30d
bk issues analytics --view project --id 12 --interval week --json
bk issues analytics --status todo,in_progress --priority 1 --priority 2
bk issues analytics --ws acme --view member --id 5 --from 2026-01-01
```

### Super admin (platform-wide)

The `bk super-admin` group (alias `admin`) mirrors the web Super Admin section.
Every command requires a **super-admin token** — an account whose email is in
the server's `SUPER_ADMINS` env var. Any other token is rejected by the API with
`403` → exit code 4; there is no client-side bypass. These actions are **not**
workspace-scoped — the whitelist and error log are platform-wide.

| Command | Backend call | Notes |
|---|---|---|
| `bk super-admin users` | `GET /api/super-admin/users` | Every member on the platform with their workspace count + last login. |
| `bk super-admin whitelist list` | `GET /api/super-admin/whitelist` | Allowed domains and emails. |
| `bk super-admin whitelist add --type domain\|email --value V` | `POST /api/super-admin/whitelist` | `domain` allows everyone on it; `email` allows one address. Idempotent. |
| `bk super-admin whitelist remove <id> [--yes]` | `DELETE /api/super-admin/whitelist/{id}` | Prompts to confirm. |
| `bk super-admin errors list [flags]` | `GET /api/super-admin/errors` | Filters: `--level`, `--status open\|resolved`, `--from`/`--to`, `--limit`/`--cursor`, `--stats`. Newest first. |
| `bk super-admin errors view <id>` | `GET /api/super-admin/errors/{id}` | Full detail incl. stack + context. |
| `bk super-admin errors resolve <id>` | `PATCH /api/super-admin/errors/{id}` | Sets `resolved: true`. |
| `bk super-admin errors unresolve <id>` | `PATCH /api/super-admin/errors/{id}` | Sets `resolved: false`. |
| `bk super-admin errors delete <id> [id ...] [--yes]` | `DELETE /api/super-admin/errors/{id}` (single) or `DELETE /api/super-admin/errors` `{ids}` (bulk) | Permanent. Prompts to confirm. |
| `bk super-admin errors stats` | `GET /api/super-admin/errors?stats=1` | Total / open / resolved counts. |
| `bk super-admin entity-drift [--repair] [--workspace S]` | `GET` / `POST /api/super-admin/entity-drift` | The Phase 6 reconciliation job: re-derives `platform.entities` from each app's source tables and reports `missing` / `stale` / `orphaned`. Exits 0 either way — branch on `drift_count`, not the exit code. `--repair` switches to `POST`. **A repair that changes something is a bug report, not maintenance:** there is one writer, so anything it fixes means that writer is wrong. |
| `bk super-admin blob-drift [--repair] [--workspace S]` | `GET` / `POST /api/super-admin/blob-drift` | The Phase 8 storage reconciliation job: compares the trigger-maintained `platform.blob_references` index against a live scan. Exits 0 either way — branch on `missing_count` first: a `missing` row is a file another deployment could delete while it is still in use, an `orphaned` one is only leaked bytes. Also reports `unreconciled_count` — index rows no workspace pass could reach, which are **not** drift but were never checked, so a zero `drift_count` beside a non-zero one is not a clean bill of health. |

```bash
bk super-admin whitelist add --type domain --value blackcode.ch
bk super-admin users --json | jq '.[] | select(.workspace_count == 0)'
bk super-admin errors list --status open --limit 20
bk super-admin errors view 482
bk super-admin errors resolve 482
```

`bk whoami` prints `super: yes` when the active token has super-admin access.

### Body / description input convention

For any `--description` / `--body` flag, three forms work, and the `*-file` variant takes precedence:

```bash
--description "literal text"      # string literal
--description -                   # read from stdin
--description-file path/to.md     # read from file
```

**Format:** description/body content may be **Markdown or HTML** — the server
stores it as sanitized HTML. Send **real newlines** (use `--description-file` or
`-`/stdin for multi-line); don't hand-build a JSON body with the literal
characters `\n`, or the line breaks won't render.

### Character encoding (UTF-8)

**All text sent to and from the API is UTF-8.** The CLI reads bodies as raw
bytes and passes them straight through; it does **not** transcode. This matters
when you pipe text through a terminal or another program — most often when an AI
agent or script does a bulk import/export/move.

The classic failure is **mojibake**: correct UTF-8 gets re-decoded as a legacy
single-byte code page, and every non-ASCII character turns into garbage while
plain ASCII survives:

| You typed | What gets stored | Cause |
|---|---|---|
| `présentation` | `prÃ©sentation` or `pr├─sentation` | `é` (UTF-8 `C3 A9`) read as Latin-1 / CP437 |
| `stratégie — déploiement` | `stratÃ©gie ΓÇö dÃ©ploiement` | `—` (UTF-8 `E2 80 94`) read as CP437/CP850 |

This is almost always the **environment**, not the CLI or the database (the DB
stores exactly the bytes it's sent). The usual culprit is a **Windows console**
whose active code page isn't UTF-8.

**How to avoid it**

- **Windows PowerShell/cmd:** run `chcp 65001` and set
  `[Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.Encoding]::UTF8`
  (and `$OutputEncoding` in PowerShell) **before** invoking `bk` in a pipeline.
  For a Python wrapper, set `PYTHONUTF8=1`.
- **Prefer the API/JSON path over shell text.** A JSON request body is
  unambiguously UTF-8 on the wire — moving items with `bk issues move` / `POST
  /api/workspaces/:ws/move`, or writing bodies with `--description-file`, avoids
  round-tripping text through a console entirely.
- **Never re-feed decoded strings.** Reading text out with `--json`, mangling it
  in a non-UTF-8 shell, and writing it back is how corruption spreads. Keep the
  bytes as JSON end-to-end.

> If you already have corrupted rows, the damage is deterministic and
> reversible: re-encode the visible string to the wrong code page's bytes and
> decode as UTF-8 (e.g. Python `s.encode("cp437").decode("utf-8")`, falling back
> to `cp850`/`latin1`). Fix them in place with `bk issues issue edit`/`bk issues project edit`
> — only touch the rows the bad run actually corrupted.

### Nullable field convention

For `edit` commands on nullable fields (`--assignee`, `--task`, `--start-date`, `--due-date`; `--due-date` on tasks):

- Omit the flag → leave it unchanged.
- Pass `none`, `null`, `unset`, or `clear` (case-insensitive) → explicitly null it.

```bash
bk issues issue edit 42 --task none --due-date 2026-06-30
```

### User-reference convention

Wherever a command takes a "user reference" (`--assignee`, `bk issues issue assign`, `bk issues project remove-member --user`, etc.), the CLI accepts:

- A numeric id (`42`)
- An email (anything containing `@`, e.g. `alice@example.com`)
- A display name (`"Alice Andrews"`)
- The literal string `me`

Non-numeric refs trigger a `GET /api/users` lookup the first time they're resolved. (Workspace `member remove` takes a numeric **user id** only.)

---

## Configuration & environment

### Config file

`~/.config/bk/config.json` (mode `0600`, directory mode `0700`):

```json
{
  "server": "https://issues.blackcode.ch",
  "token":  "…",
  "home_app": "issues",
  "home_server": "https://issues.blackcode.ch",
  "app_servers": {
    "issues": "https://issues.blackcode.ch",
    "sales":  "https://sales.blackcode.ch"
  },
  "user_id": 7,
  "email":  "alice@example.com",
  "active_workspace_id": 3,
  "active_workspace_slug": "acme",
  "last_update_check": 1718668800
}
```

**`app_servers` is the address book (D-1), added in 3.0.0 and LEARNED, not
typed.** `bk login` and `bk meta` read `apps.<slug>.base_url` out of `/api/meta`
and write it here; nobody enters a URL twice, and the book cannot drift from what
the platform serves for longer than one `bk meta`.

- `home_app` / `home_server` — where the neutral and cross-app verbs go.
  `bk app use <slug>` moves them; `--app-server <slug>` redirects one invocation.
- `server` is the legacy 2.x field. It is still WRITTEN, mirroring `home_server`,
  so a user who rolls back to a 2.x binary keeps working. It is only READ when
  `home_server` is absent, which is how a 2.x config migrates forward.
- A 2.x config has no `app_servers`, and the CLI does not guess one: `bk <app> …`
  fails naming `bk meta`, which learns it. Guessing here means guessing which
  host a file is uploaded to.

`last_update_check` is a unix timestamp the CLI writes to throttle the soft update notice to once per 24h (see [Updates](#updates)).

Override the directory with `BK_CONFIG_DIR` (the file is always `config.json` inside it). The token and servers live here only — there are no `BK_SERVER` / `BK_TOKEN` environment variables.

### Environment variables

| Variable | Effect |
|---|---|
| `BK_CONFIG_DIR` | Override the config directory (default `~/.config/bk`). |
| `BK_NO_PROMPT=1` | Skip all interactive confirmations (recommended for CI / agents). |

### Server selection — one binary, several deployments (D-1)

`bk login --server https://issues.example.com` authenticates against that host,
writes it as the home server, and **learns the app address book** from its
`/api/meta`. `--server` may name any app: every deployment serves the browser
authorize page (D-21), and the token works on all of them.

Routing, from then on:

| What runs | Which server |
|---|---|
| `bk login`, `bk token`, `bk profile`, `bk meta`, `bk app`, `bk super-admin`, … (bare) | `home_server` |
| `bk <app> …` — every noun AND `workspace`, `member`, `invite`, `user`, `upload`, `trash`, `label`, `search`, `activity`, `inbox`, `storage` | `app_servers[<app>]`, always |

Since 2026-08-10 the home app decides much less than it did: it used to pick
where a dozen data commands landed, and now it picks only which deployment
answers about your account. The workspace those commands run against is per app
too (`config.ActiveWorkspaces`).

- **`bk app use <slug>`** moves the home app permanently.
- **`--app-server <slug>`** redirects one invocation's home half. It is not
  called `--app` because six commands already use `--app` as a *filter*, and
  cobra lets a local flag shadow a persistent one silently — so the two meanings
  would have been indistinguishable at the call site.
- **`bk <app> …` cannot be redirected.** The pin is applied to the whole subtree
  in `root.go` (`pinApp`), not passed to each command, so a command added later
  cannot forget it.

**There is no fallback.** An app with no entry fails naming itself and the
command that fixes it. A wrong-server 404 is indistinguishable from a deleted
record, and that is the failure this whole design exists to remove.

---

## Output formats

### Table (default)

`text/tabwriter` aligned columns. Headers vary per command; for example `bk issues project list`:

```
ID    NAME            STATUS    ROLE    ISSUES (OPEN/TOTAL)
1     Onboarding      active    owner   3/12
2     Trinity Spec    active    member  0/4
```

### JSON (`--json` or `-o json`)

Pretty-printed with 2-space indent. Paginated responses are wrapped:

```json
{
  "data":  [ … ],
  "total": 128
}
```

### YAML (`--yaml` / `--yml` / `-o yaml`)

Same shape, YAML-formatted (2-space indent).

> Conflicting format flags (e.g. `--json --yaml`) are rejected. Pick one of `--output`, `--json`, `--yaml`/`--yml`.

### Pagination

The main list commands (`bk issues issue list`, `bk issues project list`, `bk issues task list`) are **not paginated** — they return every matching item in one response (`bk issues issue list` adds a `total` count). Only the keyset-paginated feeds accept `--limit` / `--cursor`: `bk issues activity`, `bk issues trash list`, and `bk super-admin errors list`. Their wire shape is `{ "data": [...], "next_cursor": <id|null> }`, and in **table** mode the CLI prints `next page: --cursor=<id>` to stderr when more rows remain (`… --json | jq '.next_cursor'`).

---

## Exit codes

Stable for scripting. The mapping happens in `cmd/bk/main.go` by inspecting the `APIError.Status` returned from the HTTP client (and a couple of message heuristics):

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic / runtime error |
| 2 | Bad usage (missing required flag, invalid id, wrong argument count, unknown flag/command) |
| 3 | Not authenticated (401, or no config) |
| 4 | Permission denied (403) |
| 5 | Not found (404) |
| 6 | Validation error (400 / 422) |
| 7 | User aborted (declined a confirm prompt) |
| 8 | Client outdated — running version is below the API's minimum supported version; upgrade required |
| 9 | Update available — `bk skill check` / `bk skill sync` found a newer binary |

A mistyped command or subcommand is an error, not a silent success: cobra's
default is to print help and return `nil` for any command group, so
`bk issues workspace notacmd` used to exit 0. `rejectUnknownSubcommands()` in
`internal/commands/root.go` walks the tree at construction and gives every group
a `RunE` that rejects leftover args (`Args: cobra.NoArgs` does not work — cobra
returns `flag.ErrHelp` for a non-runnable command *before* it validates args).
`internal/commands/groups_test.go` asserts this for every group, including ones
added later.

---

## Updates

The API sends two headers on **every** response, and the CLI acts on them:

- `X-BK-CLI-Latest` — the newest published CLI version.
- `X-BK-CLI-Min` — the oldest version the API still supports.

**Soft notice.** When the running version is older than `X-BK-CLI-Latest`, the CLI prints `bk <current> is behind <latest> — run: bk skill sync` to **stderr** after the command finishes. It names the *fix*, not just the fact: `bk skill sync` reports the upgrade command when the binary is behind and refreshes the installed agent skill when it isn't. It's throttled to once per 24 hours via the `last_update_check` field in the config file, and never written to stdout (so it can't corrupt `--json` output).

**Hard floor.** When the running version is below `X-BK-CLI-Min`, every request fails fast — including the header-harvesting call inside `bk skill check` / `bk skill sync`, which used to swallow it and report success (fixed in 1.9.2; see `harvestVersions` in `internal/commands/skill.go`): the CLI prints the full recovery (`npm install -g …@latest`, `bk skill install`, `bk guide`) to stderr and exits with code **8**. Naming all three matters — an agent blocked here also has a stale skill, and refreshing it is what stops the block recurring. Dev / unparsable versions (`dev`, `(devel)`, etc.) are never blocked or nagged.

---

## Patterns for agents and scripts

### Non-interactive defaults

```bash
export BK_NO_PROMPT=1
bk issues issue delete 42      # no confirmation prompt
```

Confirmation is also auto-skipped when stdin is not a TTY (e.g. piped input), and per-command with `--yes`/`-y`.

### Pipe-friendly JSON

```bash
bk issues issue list --project 1 --status todo --json \
  | jq -r '.data[].id' \
  | xargs -n1 -I{} bk issues issue edit {} --status in_progress --assignee me
```

### Recover from a misstep

```bash
bk issues trash list             # REF column gives <type>:<#number>
bk issues trash restore issue:42
```

`bk undo` was removed in 1.12.0 — it never recorded anything. Deletes are soft,
so Trash is the recovery path.

### Authenticate headlessly

```bash
echo "$MY_TOKEN" | bk login --token --server https://issues.example.com
```

### Inline error inspection

```bash
bk issues issue view 999999 || echo "exit code: $?"
# exit code: 5   (not found)
```

### Move items between workspaces (the safe way)

Don't hand-roll a cross-workspace migration by reading items out and re-creating
them — that loses satellite data (comments, attachments, labels, watchers) and,
if you pipe titles/bodies through a non-UTF-8 shell, corrupts the text (see
[Character encoding (UTF-8)](#character-encoding-utf-8)). Use the built-in
transfer, which is one atomic server-side transaction:

```bash
# Move an entire project (its tasks + issues come along) into another workspace
bk issues move --to growth --project 42

# Copy specific issues into another workspace, leaving the originals in place
bk issues copy --to growth --issue 108 --issue 106

# Move a project's structure but not its issues
bk issues move --to growth --project 42 --cascade-issues=false
```

The response includes an `adjustments` list of anything that couldn't be carried
as-is (e.g. an assignee who isn't a member of the target). Nothing is lost on
failure — the source is untouched until the whole copy succeeds.

### Robust scripting checklist

- Set `BK_NO_PROMPT=1`.
- To relocate items across workspaces, use `bk issues move` / `bk issues copy` (above) — never re-create them by hand.
- Pick an active workspace first (`bk issues workspace use …`) before workspace-scoped commands.
- Always use `--json` for parsing; the table format is for humans.
- Branch on exit codes, not stderr text.
- For long-running scripts, regenerate the token periodically (the CLI doesn't refresh automatically).

---

## Internals

### HTTP client (`internal/client/`)

Built around a small `Client` struct:

- Constructor: `client.New(baseURL, token) *Client` (trailing slash on the base URL is trimmed).
- Verb helpers: `get`, `postJSON`, `patchJSON`, `deleteJSON`, plus `UploadFile` (multipart) and `AttachToIssue`.
- Common headers on every request: `Authorization: Bearer …` (when a token is set), `Accept: application/json`, `User-Agent: bk-cli/<version>` (the stamped `internal/version.Version`).
- 30-second timeout.
- Non-2xx responses decode into `APIError { Status, ErrorMsg, Suggestion, Details }`; the `main.go` translator maps `Status` to an exit code.
- Every response's `X-BK-CLI-Latest` / `X-BK-CLI-Min` headers are recorded into package vars `client.LatestSeen` / `client.MinSeen`. If the running version is below `MinSeen`, the request returns `*client.OutdatedError` (exit code 8). `main.go` reads `LatestSeen` after `Execute()` to print the throttled soft-update notice. See [Updates](#updates).

DTO types live in `internal/client/types.go` (`Me`, `User`, `Project`, `Issue`, `Task`, `Comment`, `Attachment`, `ProjectMember`, the page wrappers, etc.) and `internal/client/workspace.go` (`Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `InboxMessage`, `Label`, and their request/response shapes). Some endpoints use the legacy non-workspace paths (`/api/workspaces/:ws/projects`, `/api/workspaces/:ws/issues`, `/api/workspaces/:ws/tasks`) while the newer workspace-scoped features (labels, members, invitations) use `/api/workspaces/{slug|id}/…`.

### Auth flow (`internal/commands/login.go`)

The state machine:

1. Generate `state` (`crypto/rand`, hex-encoded).
2. Bind `127.0.0.1:0` (kernel picks the port).
3. Open the browser to `{server}/cli/authorize?callback=…&state=…&name=cli-<hostname>`.
4. The loopback server handles **one** request to `/callback`:
   - Validates `state` (exact match).
   - Reads `token` from the query string.
   - Serves a small "you can close this window" HTML page.
   - Signals completion; the listener shuts down (5-minute overall timeout).
5. Validate the token (`GET /api/me`).
6. Save config.

### Helpers (`internal/commands/util.go`)

| Function | Purpose |
|---|---|
| `Confirm(prompt, yes)` | Interactive y/N; returns true if `--yes`, `BK_NO_PROMPT=1`, or stdin is not a TTY. |
| `ReadBody(literal, fromFile)` | Resolves `--body-file FILE` / `--body -` / `--body "..."` into a string. |
| `ResolveUserRef(c, cfg, ref)` | Turns an email/name/id/"me" into a numeric user id (calls `/api/users` if needed). |
| `IntOrNullJSON(ref, c, cfg)` | Encodes a user ref to JSON `null` or an int; supports `none`/`null`/`unset`/`clear`. |
| `PlainIntOrNullJSON(ref)` | Same, but expects a plain integer (used for task ids). |
| `StringOrNullJSON(ref)` | Encodes a JSON string, `null` for the clear keywords, or omits when empty (used for dates). |

### Output (`internal/output/`)

- `RegisterFlags(cmd)` attaches `-o/--output`, `--json`, `--yaml`, `--yml`.
- `Resolve(cmd)` reads them, rejects conflicts, and returns `FormatTable | FormatJSON | FormatYAML`.
- `Render(format, data, tableFn)` dispatches: JSON via `json.MarshalIndent` (2 spaces), YAML via `yaml.Encoder` (2-space indent), or table via the command-provided `tableFn(w)`.
- `Tabwriter(w)` returns the shared `tabwriter.Writer` configuration.

---

## The embedded guide & skill

Two packages exist so `bk` can describe and repair itself without the network.

### `cli/internal/guide/`

`topics/*.md` are `//go:embed`-ed and served by `bk guide`. Filenames carry a
numeric prefix that sets reading order and is stripped to form the slug
(`05-files.md` → `files`); the `# Title` heading becomes the title, and the first
line of real prose becomes the `--list` summary.

Rules for topic files, enforced by `guide_test.go`:

- Every topic needs a `# Title` heading and a trailing `Related commands:` line.
- **Never restate a dynamic value.** Status names, size caps and the upload block
  list live on the server; write *"run `bk meta`"* instead. The test fails the
  build on a hardcoded one.
- Written for an agent: imperative, short, examples over prose.

`bk guide` must stay **offline and unauthenticated** — it is what an agent runs
when everything else is failing. Its `routes` annotation is `"none"`, and a test
asserts that.

### `cli/internal/skill/`

`template.md` is the ~30-line agent skill file written by `bk skill install`. It
must contain **no facts that can rot** — only pointers to `bk guide` and
`bk meta`. `skill_test.go` fails the build if a status value, a limit, an HTTP
route or an auth header appears in it, or if it grows past 40 lines. That
constraint is what makes the file identical for every user and safe to leave
installed indefinitely.

`bk skill sync` will not self-mutate an npm global install: when the binary is
behind it prints the exact upgrade command and exits **9**. A self-replacing
binary is fragile and often permission-blocked; a distinct exit code is something
an agent handles cleanly.

### Route annotations

Every leaf command carries `Annotations: map[string]string{"routes": "…"}` — the
API routes it calls, or the literal `"none"`. The hidden `bk __routes` dumps the
union as JSON; `make routes` writes it to `cli/routes.json` for CI images without
a Go toolchain. `apps/issues/lib/cli-parity.test.ts` diffs it against `apps/issues/app/api/**` and fails
the build if a route has no command, or a command claims a route that does not
exist.

---

## See also

- [Backend doc](./backend.md) — internal; the private HTTP routes the CLI calls.
- [Frontend doc](./frontend.md) — the web side of the same data.
- [`cli/README.md`](../cli/README.md) — the in-repo CLI quick-reference companion to this doc.
