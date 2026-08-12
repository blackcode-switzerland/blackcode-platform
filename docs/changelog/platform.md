# Changelog — platform

Breaking and notable changes to the **platform**: identity, workspaces,
membership, per-app access, labels, uploads, tokens, the inbox, trash, undo — and
the `bk` CLI itself. Newest first.

Each app has its own file beside this one. A change touching shared platform data
goes here, **not** in the app that happened to prompt it.

## 2026-08-12 — a moved hostname stops logging you out

**Fixes a live authentication failure.** If `bk` reported *"Authentication
required (401)"* on every command today, this is why, and the workaround until
you upgrade is:

```bash
bk login --server https://issues.blackcode.ch
```

**What happened.** `bk login`'s built-in default was `https://bc-issues.vercel.app`
until 2026-08-11, so anyone who logged in without `--server` stored it. Both
addresses answered, so nothing was wrong. On 2026-08-12 a redirect was put on the
old hostname pointing at the canonical one — and **Go's HTTP client deletes the
`Authorization` header when a redirect crosses to a different domain.** That is
correct, documented language behaviour, not a bug in Go.

So the request was redirected, arrived with no credentials, and the server
answered 401. Measured against production:

```
redirect #1 -> https://issues.blackcode.ch/api/me
Authorization on the FOLLOW-UP request: ""
final status: 401 Unauthorized
```

Every authenticated command failed at once — **including `bk login`**, whose
token check is an authenticated request. So the one command that repairs a stale
address could not complete, and the self-healing address book added on
2026-08-11 could never fire: the request that heals it was the one being refused.

**The fix.** The CLI now follows redirects itself and re-issues the request with
credentials across **one** cross-origin hop, then records the canonical address
so the hop happens once. A moved hostname repairs itself.

Three limits, because resending a token wherever you are told is a
credential-leak primitive:

- **Never a downgrade.** `https` → `http` is followed WITHOUT credentials.
- **One credentialed cross-origin hop.** A chain cannot walk the token onward.
- **Method and body preserved**, so a `POST` is not silently downgraded to a
  `GET`.

Nothing changes for anyone whose address was already canonical.

## 2026-08-12 — Windows is a first-class platform: the config path a message names is the one that exists

**Not breaking.** Nothing renamed, no route changed. Windows users were being
handed instructions that could not work on their machine.

### `bk` prints the config file's REAL path

`bk login --help`, `bk app use --help` and `bk meta`'s `routing.note` all spelled
the location as the literal `~/.config/bk/config.json`. On Windows the file is at
`C:\Users\<you>\.config\bk\config.json`, and `~` is not expanded by `cmd.exe` at
all — so every one of those messages named a path that does not exist for the
users they were meant to help. Under `BK_CONFIG_DIR` they were wrong on every
platform, including the one they were written on.

All three now print the absolute path this binary is actually reading, for the OS
actually running it, and following `BK_CONFIG_DIR` when it is set:

```bash
bk meta --json | jq -r .routing.note      # names the exact file
```

Nothing to adapt: a message that used to be a dead end now names a file you can
open. `config.DisplayPath()` is the single source, and a guard
(`cli/internal/config/display_path_test.go`) parses every Go file in the CLI and
fails the build if a string literal spells the path itself again.

### The npm installer says what will go wrong on Windows, before it does

`npm install -g` writes three shims — `bk`, `bk.cmd` and `bk.ps1`. PowerShell
resolves the `.ps1` first, and its default execution policy on Windows client
machines refuses to run it: *"cannot be loaded because running scripts is
disabled on this system"*. The package said nothing about this, and it is the
first of the four failures issue #20 recorded before a successful login.

The installer runs on the machine that has the problem, so it now looks and
prints. On `win32` it reads `Get-ExecutionPolicy` and, unless the policy already
permits the shim, names both ways through:

```
This machine's PowerShell execution policy is "restricted".
PowerShell runs npm's "bk.ps1" shim before "bk.cmd", and that policy blocks unsigned
scripts — so "bk" will fail with "cannot be loaded because running scripts is disabled
on this system". Two ways through, pick one:
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # allow the shim, once (PowerShell)
  cmd.exe /c bk --version                               # or bypass PowerShell entirely
```

**It detects; it does not change anything.** An installer does not get to alter a
machine's execution policy. If the policy cannot be read at all, the guidance is
printed anyway — a printed line costs nothing and a dead end costs a user.

Two more installer fixes in the same pass:

- **PATH advice is now the running shell's.** Every platform used to be told
  `export PATH="$(npm prefix -g)/bin:$PATH"`, which is not a command on Windows.
  PowerShell and `cmd.exe` get their own spellings, and `command not found`
  becomes `is not recognized`.
- **`EBUSY` on a retry says what to do.** A half-finished install still holds the
  shim, so the obvious next step — run it again — died on a raw Node error.
  It now says to close the shells that have run `bk` and retry. `EACCES` names
  `npm config set prefix` instead.

### A piped token survives a shell that re-encodes the pipeline

`echo <token> | bk login --token` is what this CLI tells everyone to run, and it
was written and tested on macOS. In PowerShell `echo` is `Write-Output`, and the
pipeline to a native binary is encoded with `$OutputEncoding` — which can prefix
a byte-order mark or send the whole thing as UTF-16. `strings.TrimSpace` does not
strip a BOM, so a correct token could arrive with three invisible bytes on the
front and be refused as invalid with nothing on screen explaining it.

`bk login --token` now strips a UTF-8 BOM, decodes UTF-16 (either endianness,
with or without a mark, including the buffer truncated mid-code-unit by reading
to the newline) and drops embedded control characters — then, if the server still
returns 401, says the pipeline reshaped the token and names the route with no
encoding in it:

```
error: token validation failed: invalid token (401)
      the token arrived with a UTF-8 byte-order mark and was decoded before use —
      if it is definitely correct, run `bk login --token` with NO pipe and paste it at the prompt
```

**This was reasoned about, not observed on Windows.** It is deliberately limited
to transformations that cannot damage a correct token anywhere: a NUL byte and a
U+FEFF are impossible inside one. No code-page guessing — that is a different
failure with a different fix (`bk guide platform/encoding`).

The encoding note fires only on a genuine **401/403**. An unreachable host or a
wrong `--server` produces the same Go error and says nothing about encoding.

### `-v` traces the whole run, not just the HTTP

**Not breaking** — stdout is untouched; every line below goes to stderr, as all
non-data output does.

`-v` / `BK_DEBUG=1` logged the request LINE and the response, and nothing else.
Three gaps, all closed:

- **What a write actually SENT was invisible.** "A 400 on `issue edit`, what did
  it send?" was the one question `-v` could not answer.
- **Routing was invisible.** Which app, which server, which workspace — each
  drawn from a different place (a command-group pin, `--app-server`, the home
  app, `--ws`, the per-app active workspace), and none of it logged. This is the
  failure class that returns 200 and real data from somewhere you did not mean.
- **A command that made no request printed nothing at all**, so `bk -v app use`
  and `bk -v guide` were silent — indistinguishable from a broken flag.

```
· bk 2.4.0 — config /Users/you/.config/bk/config.json
· command: bk issues issue edit
· app issues → https://issues.blackcode.ch  [pinned by the `bk issues …` command group]
· workspace demo-ws  [--ws, this command only]
→ PATCH https://issues.blackcode.ch/api/workspaces/demo-ws/issues/5
  body: {"title":"hello there"}
← 400 Bad Request (16 bytes, 41ms)
  {"error":"nope"}
```

The response line now carries a duration, and a transparently-followed redirect
is called out rather than left invisible.

**Headers are never printed, at any verbosity, by design.** The `Authorization`
header carries your token and this output goes into bug reports and CI logs; a
guard (`cli/internal/client/verbose_test.go`) fails the build if it ever appears.
A non-JSON request body — an upload — is described, not dumped.

The `-v` line in `bk --help`, `bk guide platform/output`, and the agent skill
file all say what it now shows.

### `bk guide platform/output` described a pagination that does not exist

**Documentation only — no command changed.** The topic said three feeds paginate
(`bk <app> activity`, `bk <app> trash list`, `bk super-admin errors list`) and
told agents to *"follow `next_cursor` until it is `null`"*. Measured: `trash
list` has **no `--limit` and no `--cursor`**, and its client method reads only
`data` and discards `next_cursor` entirely — the instruction could not be carried
out. It also missed three commands that DO paginate: `bk sales prospect list`,
`bk sales meeting list`, `bk sales comm list`.

The same paragraph claimed every list command prints
`{ "data": …, "next_cursor": … }`. Measured against a local server: `bk issues
label list`, `bk issues project list`, `bk issues workspace list` and
`bk <app> trash list` print a **bare JSON array**, while `bk issues issue list`
and `bk issues inbox list` print the envelope. Both shapes are documented now,
with the one-line `jq` that handles either:

```bash
jq 'if type == "array" then . else .data end'
```

**No output shape changed** — this is the doc catching up with the binary. A new
guard (`cli/internal/guide/pagination_claim_test.go`) derives the paginating set
from the real command tree and fails the build if the topic's list disagrees; the
inconsistency in the shapes themselves is recorded as owed work rather than fixed
on the eve of a forced release, because unwrapping is a breaking change for
anything already parsing it.

### A 401 from `bk login` no longer answers "run `bk login`"

Every 401 got the same hint, and inside `bk login` it is a loop: the server has
just refused the token this command supplied. It now names the two ways to get a
working one — mint it in the web UI at Settings → API Tokens, or run `bk login`
with no flags for the browser flow. The hint is unchanged everywhere else.

## 2026-08-12 — every app's active workspace is visible in one command, and `bk link`'s dead code is gone

**Not breaking.** Two things, both closing the same finding: what crosses an app
boundary, and where you currently are in each app.

### "Which workspace is each app on?" — answered locally, in commands you already run

The active workspace has been **per app** since 2026-08-10, and until today
nothing printed more than one of them. `bk meta`'s `active:` line is the
workspace of the app that *answered*, and no deployment can report another app's
— each app's membership lives in its own schema. So the question took one
`bk <app> workspace list` per app: N round trips to read state that sits in
`~/.config/bk/config.json`.

Two existing commands now carry it. **There is no new command**, and no new
route:

```bash
bk app list --no-probe        # zero network calls — the whole local answer
   APP     SERVER                       WORKSPACE   REACHABLE
*  issues  https://issues.blackcode.ch  acme        ok
   sales   https://sales.blackcode.ch   acme-sales  ok
   scaffold …                           (none)      —

bk meta                       # the routing block, per app
       * bk issues …  → https://issues.blackcode.ch  [ws acme]
         bk sales …   → https://sales.blackcode.ch   [ws acme-sales]
```

- `bk app list` gained a **`WORKSPACE`** column and an `active_workspace` field
  under `--json`. `(none)` / `""` means no workspace has been chosen for that
  app — a normal state, not an error.
- `bk meta`'s `routing` block gained **`active_workspaces`**, a map of app slug
  to workspace slug. An app with no chosen workspace is **absent** from the map
  rather than present with an empty string: "not chosen" and "chosen, and its
  slug is empty" are different claims and only the first is reachable.

`routing` is CLIENT state — the server cannot see it, which is why it is worth
printing and why this needs no network.

### `bk link`'s dead code is removed

The command went on 2026-08-10. What it stood on did not, and one piece of it
was **making a false claim in the shipped binary**: `bk sales prospect show`'s
`--help` promised "every cross-app LINK touching this prospect, each with an
absolute URL", and the sales route had stopped serving `links` that same day —
so the section it described could not appear.

Removed: `linksRoute` (a shared route factory mounted by no app), platform-db's
`createLink`/`deleteLink`/`listLinks`, the `LINK_RELATIONS` vocabulary
(`/api/meta` stopped serving it on 2026-08-10), and the CLI's `SalesLink` type,
`Prospect.Links` field and `LINKED` output section.

**`platform.links` — the TABLE — still exists and is unread.** Dropping it is a
migration with a rollback and its own decision, not a side effect of this
cleanup. Its schema declaration is kept for one reason: removing it would make
the next `drizzle-kit generate` emit a `DROP TABLE` nobody asked for.

**Nothing about this changes what you should do.** Cross-app references are not
a supported feature, and putting the far end's URN in the record's own text is
the design rather than a workaround — it is a fact one app holds, it cannot
drift from the thing it points at, and it survives being read by a person:

```bash
bk sales prospect show 8            # prints bc:sales:acme/prospect/8
bk issues issue create --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme/prospect/8"
```

`bk link`'s deprecation row stays, so a stale script still gets a sentence it
can act on. `bk guide platform/cross-app` now walks a full two-app session,
including what is per app **by design** (documents, labels, uploads, inboxes,
workspaces) and what is genuinely shared (the account, the password, the token).

## 2026-08-12 — the inbox narrows by type, person, time, project and task

**Not breaking.** The inbox is still **global by default** — every filter is
opt-in, and with none of them you get every workspace and every app that notifies
you, exactly as before.

```bash
bk issues inbox list --type assigned
bk issues inbox list --from someone@corp.ch      # id, email, name, or 'me'
bk issues inbox list --since 2026-08-01          # at or after
bk issues inbox list --ws acme --project 4       # the project, its tasks, its issues
bk issues inbox list --ws acme --task 9          # the task and its issues
```

`GET /api/me/inbox` gained `type` (it already read it; only the flag was
missing), `actor_id`, `since`, `project_id` and `task_id`. All applied
server-side.

Three things worth knowing:

- **`--project` and `--task` require a workspace.** They take a #number, which
  only means something inside one workspace, so without `--ws` the route answers
  `400 workspace_required` rather than picking one.
- **`--project` matches three things**, not one: notifications about the project
  itself, about its tasks, and about its issues. An inbox row records
  `entity_type` + `entity_id` and carries no project, so this is a reach through
  to the source tables — and the narrow version of it (issues only) would
  silently drop the other two and read as a quiet week.
- **`Unread:` is now scoped to the same filters as the list it sits under.** It
  used to honour only the workspace, so a filtered feed carried a count answering
  a wider question.

An empty result now distinguishes "nothing matched these filters" (and names
them) from "your inbox is empty".

## 2026-08-12 — seven flags stopped advertising a bogus argument in `--help`

**Not breaking — help text only. Every flag parsed exactly as it always did.**

pflag reads the **first backquoted word of a usage string as the flag's value
placeholder**, strips the backquotes, and prints the placeholder after the flag
name. So a usage string that used backticks as Markdown renamed its own
argument:

```
      --app-server bk <app> …   Send this invocation's BARE (identity) verbs …
      --token echo <token> | bk login --token   Read a pre-existing token …
      --type bk meta   Filter by entity type …
      --body issue comment   Alias for --description …
```

A caller reading that sees a flag taking two or more words, and one following
the shape types `--body issue comment`. The placeholder *is* the type as far as
`--help` is concerned, and it was the only type information these flags carried.

Seven flags across five packages were affected, including **`--app-server`,
which is a persistent root flag** — so every `--help` screen in the binary
rendered it wrong. They now show `string` (or nothing, for switches).

This was found and fixed by hand in `bk sales` on 2026-08-12 and recurred in
`bk issues` the next day, because that fix was manual, package-local, and
nothing held it. It is now guarded binary-wide:
`cli/internal/commands/flag_placeholder_test.go` walks every command's flags and
fails on any placeholder containing whitespace. It was watched failing on all
seven before they were fixed.

## 2026-08-12 — `bk <app> inbox list --ws` scopes the inbox to one workspace

**Not breaking. The default is unchanged and stays GLOBAL.**

`inbox list` returned every notification from every workspace, going back weeks,
with no way to narrow it. `GET /api/me/inbox` has always read `?workspace_id=`
and the CLI never sent it.

The persistent `--ws` flag — "target workspace for this command only" — now
means that here too, instead of being accepted and silently ignored:

```
bk issues inbox list --unread --ws my-workspace
```

It takes a slug or a workspace id. A slug that does not exist is an **error**,
not a fall back to the unfiltered list: a caller who named a workspace and got
150 messages from every workspace has no way to see that the filter was dropped.

**With no `--ws` the inbox is still every workspace and every app that notifies
you**, deliberately — an inbox that quietly scoped itself to whatever
`workspace use` last set would hide the invitation that arrived from somewhere
else. Filtering by project, task and member is not implemented yet.

## 2026-08-12 — `bk --version`, and errors that name the flag you meant

**Not breaking.** Nothing was renamed or removed. Five changes, all of which
exist because a first-contact agent ran a full session across both apps and
never found capabilities this binary already had.

**`bk --version` now works.** It printed `error: unknown flag: --version` and
exited 2 — the spelling git, docker, npm, curl and python all accept, and the
one a script probes first. It prints exactly what `bk version` prints, from one
implementation, so the two cannot drift. `-v` is unchanged and still means
`--verbose`.

**An unknown flag names the near miss.** The binary knows its own flag set at
the moment it refuses, and it now uses it:

```
$ bk issues project updates add 12 --health on_track
error: unknown flag: --health
hint: did you mean `--status`? `bk issues project updates add --help` lists every flag

$ bk issues project updates add --project 12
error: unknown flag: --project
hint: `--project` is not a flag here — <project-id> is a positional argument:
      bk issues project updates add <project-id> [flags]
```

One suggestion or none: it answers only when it can name a flag that exists on
that command, so an unrecognisable flag still gets the generic recovery advice.
This is the same `hint:` line as before, not a second mechanism.

**`bk skill sync` and `bk changelog` say when to run them.** Both were already
listed in `bk --help`; what was missing was the trigger. `bk --help` now carries
a "when something that used to work stops working" block, `bk skill --help`
states the loop (`install` once, `sync` after an upgrade or a failure, `check`
to ask without writing), and a **410 Gone** now names `bk skill sync` — it was
the only 4xx that did not, despite being the strongest drift signal there is.
It is still **not** run automatically: it is an HTTP call and a file write, and
paying that on every command to solve a discovery problem is the wrong trade.

**Group help counts what it lists** — `Available Commands (17):`. A reader
hunting for flag lines slides past a block headed `Available Commands:`; one
headed `(17)` says how much was skipped. The report missed six commands on one
noun this way.

**Install troubleshooting.** `bk guide platform/install-auth` now covers
`bk: command not found` after a successful `npm install -g`: the path the
installer prints is inside `node_modules` and is not the one you run — npm's
global bin directory has to be on your PATH. The postinstall message says so
too, and tells you to verify with `bk --version`.

## 2026-08-12 — `bk <app> invite send` says whether the email actually went

**Not breaking. Same route, same arguments, same exit code.** What changed is
what it prints, and it stopped making a claim it had never checked.

It printed `Invitation sent to x@y.ch.` unconditionally, and — when the invitee
already had an account — `They'll see it in their inbox immediately`. Both are
statements about delivery, and neither read the `email_sent` field the route has
been returning since email landed on 2026-08-11. Sending is **best-effort by
design**: the invitation row is written and valid whether or not the mail
arrives, so a bounce does not fail the request and the caller was never told.

Now:

```
Invitation created for colleague@blackcode.ch.
The invitation email was sent.
  https://sales.blackcode.ch/invitations/<token>
```

or, when it did not:

```
Invitation created for colleague@blackcode.ch.
The invitation email was NOT sent — deliver this link yourself:
  https://sales.blackcode.ch/invitations/<token>
```

- **The link is printed in BOTH cases now.** It used to appear only when the
  invitee had no account; it is the thing you paste into a chat either way.
- **The exit code stays 0 when the email fails.** The invitation exists — a
  non-zero exit would make a caller retry and issue a second one.
- The link now prefers the server's own `accept_url`, which knows the
  deployment's public origin; the locally-built URL remains the fallback.
- A server too old to return `email_sent` decodes as `false`, so it produces
  "not sent, here is the link" rather than a promise nothing verified.

The same change reached the **web app's** invite toast, which said
`Invitation created for x@y.ch` in every case and now reports delivery — as a
warning, not a green tick, when the email did not go.

## 2026-08-12 — `bk meta --vocab <key>`: one vocabulary, as a flat list

**Not breaking. `bk meta` with no flag is unchanged**, byte for byte, in every
output format.

`bk meta` prints prose and a workspace table; `bk meta --json` is a deeply nested
document. Neither answered "what are the valid stages?" without a parser — so an
agent that wanted the values read `--help` instead, and `--help` is a document
inside the binary, which is the one thing that can be a release behind the
server.

```bash
bk meta --vocab                   # the keys the app that answered serves
bk meta --vocab stages            # the values, one per line, with their labels
bk meta --vocab stages --json     # a plain array — it pipes
```

- An **unknown key is an error naming the keys that exist**. The command exists
  to stop a caller guessing, and "unknown key" full stop is one guess earlier in
  the same problem.
- `--json` prints the **server's** array verbatim, so a field added server-side
  (today: `color`) reaches you with no CLI release.
- It reads `apps.<current>.vocabulary` from `GET /api/meta`, falling back to the
  deprecated top-level `vocabulary` key, so it works against both apps and
  against a server older than the nested block.

**It is the authority.** Some `bk <app>` flags now name their values in `--help`
as a fast path; those are copies held to their app's source by a build-time
check, not a second source of truth. Where a flag's help and this command
disagree, this command is right.

**`meta` stays a BARE verb.** Vocabularies are per app, so `bk sales meta` looks
like the natural spelling and is not: `meta` is your account and this binary, it
reports the HOME app's vocabulary, and `bk --app-server sales meta` targets
another deployment. No app tier was added to `meta`.

One tightening worth knowing if you script it: **`bk meta <anything>` used to
accept and silently ignore a positional argument** and now errors, pointing at
`bk meta --vocab <key>`. Both `--vocab <key>` and `--vocab=<key>` are accepted.

## 2026-08-11 — `bk login --token` explains itself, and a usage mistake exits 2

**Not breaking.** `echo <token> | bk login --token` is unchanged and still the
only way to hand `bk` a token you already have. What changed is what happens when
you guess one of the other two spellings.

`--token` is a **switch, not a value**: it reads the token from stdin so the
secret never lands in your shell history, your process list, or a CI log of the
command line. That was never stated anywhere, and both natural guesses failed
describing something other than the mistake:

| You type | You used to get | You now get |
|---|---|---|
| `bk login --token=<tok>` | `invalid argument … strconv.ParseBool: parsing "bk_live_…"` | the same parse error, plus a `hint:` naming `echo <token> \| bk login --token` |
| `bk login --token <tok>` | `Server: …` then `read token: EOF` | `--token takes no value …` and the piped form |
| `bk login --token` with no pipe | `read token: EOF` | `no token on stdin …`, the piped form, and `bk login` with no flags as the way to mint one |

All three now exit **2** (usage) rather than **1** (runtime fault), which is what
the exit-code table in `bk guide platform/output-and-exit-codes` has always
promised for a flag mistake. If you branch on `$?`, a mistyped `--token` moves
from 1 to 2.

`bk guide platform/install-auth` also gained a **Windows** section: PowerShell's
default execution policy blocks the `bk.ps1` and npm shims, and the way through
is `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` or running the `.cmd`
shim via `cmd.exe`. Reported from a real first run; the fix is documentation, not
code, and it is untested on Windows.

From `Todo/issues-app-feedback.md` item 5.

## 2026-08-11 — a stale server address could not be cleared, and nothing said so

**Not breaking. Fixes links that carried `bc-issues.vercel.app` instead of `issues.blackcode.ch`.**

**If you see that hostname anywhere — in a link, in `bk app list`, in agent
output — run `bk login --server https://issues.blackcode.ch` once.**

Two things combined into a state no documented command could fix:

1. `bk login`'s default server was `https://bc-issues.vercel.app` (Vercel's
   generated hostname for the issues project). Anyone who logged in without
   `--server` pinned it. Fixed separately, below.
2. **The address book takes the host that answered over the one the platform
   publishes.** That rule is correct and is unchanged — otherwise a preview
   deployment or a self-hosted instance would redirect itself to production, a
   host you never authenticated against.

Together they made the stale address permanent and invisible: **`bk meta`, the
command whose job is to refresh the address book, re-applied the reached host
on every run** and discarded the published one without a word. The one command a
user would reach for was the one re-applying the problem.

It showed up as agents emitting links like
`https://bc-issues.vercel.app/<workspace>/issue/18` — a base URL from the config
glued to a URN tail. Nothing in the platform builds that string; an agent built
it from the two things it had, and one of them was wrong.

**It now repairs itself where it can.** If the host you asked REDIRECTS, that is
the deployment naming its own canonical address — arriving on the same
connection that served your token — and `bk login` / `bk meta` adopt it with no
notice and nothing to type. A preview deployment or a self-hosted instance does
not redirect, so it keeps the address you authenticated against; adopting the
registry's value instead would move a preview to production.

So: **put a redirect on the old hostname and every client heals on its next
`bk meta`.**

**Where nothing redirects, the disagreement is reported** — `bk login` and
`bk meta` print the published address plus the command that switches to it. The notice fires on *every* run
while the addresses differ, not only when something changed — a stale address is
stable, so a change-triggered notice would never fire again. When the addresses
agree there is no notice.

Nothing about precedence changed, and no existing setup stops working.

## 2026-08-11 — a guessed verb now resolves, and every dead end names a command you can run

**Not breaking.** Four changes to how `bk` answers a caller who typed something
it did not expect. Nothing that worked before works differently.

**1. Verb synonyms resolve.** The two apps never shared one vocabulary —
`bk issues issue view` and `bk sales prospect show` are the same operation, as are
`create`/`add` and `delete`/`rm`, and each app disagrees with itself in places.
An agent that learned one app dead-ended in the other. Every verb now also accepts
the other spellings of its own operation:

| Operation | Spellings that all work |
|---|---|
| read one | `view`, `show`, `get` |
| list many | `list`, `ls` |
| make one | `create`, `add`, `new` |
| change one | `edit`, `update` |
| destroy one | `delete`, `rm`, `remove` |

`--help` still shows exactly one canonical spelling per command, and that is the
one to write down — the rest are a landing pad for a guess, not a second
documented way in. **The app tier is unaffected**: dropping the app name is still
an error, and a spelling that a sibling command already owns is never reassigned
(where a group has both `rm` and `show`, each keeps its meaning).

**2. The generic recovery hint named nothing.** It printed a literal
`` run `bk <group> --help` `` — the placeholder never substituted, so the only
step it offered could not be executed. It now names the actual command, taken
from the error for an unknown command and from cobra's resolved command for an
unknown flag, which names nothing in its own message.

**3. A tier hint typed at an app now says what you typed.** `bk sales inbox list`
answered `` `bk inbox …` is now `bk issues inbox …` `` — correct advice opening
with a spelling the caller never wrote. It is now prefixed with
`` `bk sales inbox` does not exist. ``

**4. `bk login` and `bk changelog` default to `https://issues.blackcode.ch`**,
not the `bc-issues.vercel.app` project hostname. Both addresses work; the new one
is what every doc says and does not name the platform after an npm package.
Declared once now, in `cli/internal/config/config.go`. **`--server` is unchanged**,
and one login still covers every app.

`bk guide platform/apps` documents the vocabulary rule, and that topic now sorts
second of the platform topics instead of thirteenth — four hints and three help
screens point at it as *the* rule to read.

For how the CLI **works** (rather than what changed), run **`bk guide`** — the
complete usage guide, embedded in the binary, so it always describes the version
you are running. For live values (vocabularies, limits, your workspaces), run
**`bk meta`**.

Surfaced at: `GET /api/changelog` (JSON or `?format=markdown`) and `bk changelog`,
which merge every file in this directory into one feed by date, each entry tagged
with its app. `bk changelog --app platform` filters to this file.

> **Process rule:** every change to a route or user-facing feature must add a
> dated entry to the right file. Timestamp it and describe what changed and how
> to adapt.

> **2026-08-04 — this file was created when `docs/api-changelog.md` was split.**
> Phase 5 of the platform migration replaced the single log with one file per app
> plus this one. **The pre-split record lives in `docs/changelog/issues.md`** —
> all of it, moved verbatim, including entries that describe platform concerns.
> Sorting history into a taxonomy invented afterwards is rewriting it. Anything
> dated before 2026-08-04 is in that file regardless of what it touched; read the
> unfiltered feed (`bk changelog`) when looking back.

---

## 2026-08-11 — `bk meta` and `bk app list` are an ADDRESS BOOK, not a grant list — the help said otherwise

**No behaviour change. Correcting what the binary CLAIMS, in three places agents
read before doing anything else.** If you built logic on the old wording, it was
wrong on 2026-08-10 and this is the notice.

`bk meta`'s `apps` block lists **every app that exists and where it is deployed**.
It has never been filtered by access since the per-app gate was dropped on
2026-08-10 (`platform.workspace_apps` and `platform.app_access`). But
`bk guide platform/overview`, `bk guide platform/cross-app` and the installed
agent skill all still said the opposite — *"`bk meta` tells you which apps you can
actually reach; you will not be shown one you have no access to"*.

**How to adapt:**

- Do **not** treat an app's presence in `bk meta` / `bk app list` as a grant.
- Do **not** read `apps.<slug>.workspaces == []` as *"you have no workspace
  there"*. It is populated only for the app that answered; for any other app it
  means **"not known here"**. One deployment cannot answer for another — each
  app's membership lives in its own schema.
- To find out what you actually have in an app, ask that app:
  `bk <app> workspace list`.

Run **`bk skill sync`** to pick up the corrected skill file.

Also corrected in the same pass, all help text only:

- `bk login` said it authenticated against *"a blackcode-issues server"* — one
  app's name, from before there were two. One login covers every app.
- `bk <app> search`'s summary said it searched *"the shared entity index"*,
  which reads as *searches every app* — the cross-app tier that ended on
  2026-08-10. It returns that app's records only.
- `bk --help`'s app-owned tier omitted `user`, `inbox` and `storage`, and
  `bk issues --help` / `bk sales --help` both called the app-owned verbs *"the
  same three under every app"* while `issues` listed eleven. An app serves the
  subset it has routes for, and that is deliberate.
- Both apps' `invite` summaries were still missing `show`, added the day before
  — the same drift as the top-level list, in the two places that were missed.

---

## 2026-08-11 — `bk <app> invite show <token>`: preview an invitation before accepting

**New, additive. Nothing changes for existing commands.**

The web has always rendered who invited you and to which workspace before you
commit, at `/invitations/{token}`. From the CLI you could only accept blind. A
web⇄CLI parity audit found this and nothing else — it was the only real
capability gap in either direction.

```bash
bk issues invite show <token>
bk sales  invite show <token>
```

Prints the workspace, who invited you, the address it was sent to, and when it
expires — then the exact `invite accept` line to run.

**You must be signed in as the address the invitation was sent to.** Holding the
token is not enough, and a token issued to somebody else is refused *without
naming them* — whose invitation a token is for is not something the holder gets
to learn.

`GET /api/invitations/{token}` on both apps. Plain text only: the token verbs
disable flag parsing so a token beginning with `-` is not read as a flag, which
means the output flags cannot parse either. Use `bk <app> invite pending -o json`
for the structured form.

## 2026-08-11 — `--help` stopped printing examples that exit 2

**Not breaking. No route, command, flag or payload changed** — only the text
`bk` prints about itself, and one server `suggestion`.

Ten verbs moved behind their app name on 2026-08-10 (see that entry below). The
commands moved; **the hand-written prose around them did not**, and a web ⇄ CLI
parity audit resolved every ``bk …`` spelling in the repo against the built
binary to find where. Fourteen spellings in live help text named a command that
had been removed. Every one of them exited 2 for anyone who copied it.

**The `Example:` blocks were the worst of it** — the one part of `--help` a
reader is most likely to paste:

| Command | Its examples read | Now |
|---|---|---|
| `bk <app> activity` | `bk activity --since 24h` (×3) | `bk issues activity …` / `bk sales activity …`, built from the app slug |
| `bk issues search` | `bk search auth` (×3) | `bk issues search auth` |
| `bk issues analytics` | `bk analytics --view project …` (×4) | `bk issues analytics …` |

And four more, each naming a dead command at the moment it was most likely to be
followed:

- **`bk issues storage list`'s `Long` documented `--app <slug>`. That flag does
  not exist** — it was removed on 2026-08-10 with the rest of the cross-app tier.
  A documented flag that isn't there is worse than a stale example: it turns a
  command that would have worked into exit 2.
- `bk issues move`, on success, printed *"restore with `bk trash`"*. Now
  `bk issues trash restore`.
- `bk issues project|task delete`'s `Long` said *"Restore it later with
  `bk trash restore`"*. Now `bk issues trash restore`.
- `bk sales search`, **when it found nothing**, printed *"`bk search` looks
  across apps by title"*, and its `Long` told you to run `bk search` **instead
  of** the command you were reading. Both now name commands that exist.
- The `query_too_short` **suggestion** on `GET /api/workspaces/{ws}/search` read
  ``e.g. `bk search auth` ``. It is built from the mounting app's slug now, so it
  cannot go stale for the next app that mounts the route.

Three one-line summaries also stopped contradicting `deprecations.go` in the same
binary: `activity` said *"(all apps)"*, `storage` said *"across every app"*, and
`storage`'s `Long` still explained D-28's *"you upload INTO one app and list
ACROSS all of them"* — the pairing that ended when the upload **ledger** became
per app. The store, the workspace quota and the `platform.blob_references`
reference count are still shared, and the help now says which is which.

**Nothing to adapt.** Every spelling these now print already worked; the ones
they replaced already failed.

---

## 2026-08-11 — Both apps write their own name the same way: `b/issues` and `b/sales`

**Not breaking.** No route, command or payload changed. What changed is the
display name one of the two apps calls itself, and the place you meet it is the
**From line of the mail both apps send** — from one domain, through one account,
about one shared blackcode login.

    before   Blackcode Issues <admin@blackcode.ch>     b/sales <admin@blackcode.ch>
    after    b/issues <admin@blackcode.ch>             b/sales <admin@blackcode.ch>

If you filter mail on the sender's display name, that filter needs the new
spelling. The address is unchanged, and matching on the address was always the
sturdier rule.

The same name is now on each app's browser tab, its sign-in screen and its
sidebar, where the two apps had drifted into three different treatments of one
logo. **`platform.apps.name` still reads `Blackcode Issues`** — that is a row in
the address book `GET /api/meta` and `bk app list` serve, and changing it is a
data change rather than a code one. Do not key anything on it: use `slug`.

---

## 2026-08-11 — Password reset works on every app, not just one

**Not breaking.** Everything here is additive, and the one changed response
shape is browser-only.

**Every app can send email now.** `apps/issues/lib/email/` became
`packages/platform-email`. An app supplies a four-field identity — display name,
logo origin, accent colour, reply-to — and the shared templates and Resend
client do the rest. The *address* stays platform-wide (`admin@blackcode.ch`, the
apex domain, because Resend verifies one domain per account); the app identity
rides in the display name, so a b/sales code arrives from
`b/sales <admin@blackcode.ch>` and an issues code from
`Blackcode Issues <admin@blackcode.ch>`.

**A deployment that cannot deliver now refuses instead of pretending.** The
password-reset request routes answer **`503 email_not_configured`** — with a
`suggestion` naming the two variables to set — when the deployment has no Resend
key, and they answer it *before* minting a code or spending a rate-limit slot.
Previously they returned `{ ok: true }` and delivered nothing, which is
indistinguishable from a slow email to the person waiting. Outside production
the OTP still goes to the server log, so local development is unaffected.

**If you run an app deployment, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`
for it.** Without them, production password resets fail closed with the 503
above. Invitations are unaffected — they still return `accept_url`.

**The logged-out reset pair is a shared factory.**
`publicPasswordResetRequestRoute` / `publicPasswordResetConfirmRoute` in
`@blackcode/platform-api/routes`. The route files stay in each app's
`app/api/auth/`, but the OTP policy — code shape, expiry, attempt cap, which
failure maps to which code — is now written once. Behaviour and response bodies
are unchanged for `apps/issues`.

No `bk` surface changed: every route involved is browser-only and already
excluded from the CLI-parity harness with a reason. An agent proves identity
with a `bk_live_…` token, which it can only hold because a human has an account.

## 2026-08-11 — closing an account now reaches every app

**Breaking for one route. Fixes a data-stranding bug that was live.**

Your blackcode account is one login for every app, and each app keeps its own
workspaces and records. Closing the account only ever deleted **one** app's data.
Everything else survived, owned by an account that could no longer authenticate —
not lost, **stranded**, and unrecoverable by the person, because there was no
sign-in left to recover with.

**What is new**

- **`GET /api/me/footprint`** — what THIS app holds for you: the workspaces you
  solely own, the ones that block because other people are in them, and counts of
  what is inside them in the app's own nouns. Every app serves it.
- **`DELETE /api/me/footprint`** — delete your data in THIS app. **Your account is
  not touched** and you can sign in again. This is how `b/sales` deletes b/sales
  data; only that deployment can.
- **`DELETE /api/me?dry_run=true`** now returns an `apps` array: one entry per app
  in the suite, each either `{reachable: true, footprint}` or
  `{reachable: false, error}`. There is no third shape — an app that did not
  answer can never be reported as holding nothing.

**Breaking: `DELETE /api/me` now requires `?scope=all_apps`.** A bare call is a
`400 scope_required` carrying a suggestion. The route's meaning widened to reach
every app, and an irreversible operation that quietly starts doing more than the
caller asked is the wrong place for a default.

**It refuses to run on a partial picture.** `?scope=all_apps` answers
`409 incomplete_census`, naming the apps, if any app could not be reached. Deleting
your data in one app stays available throughout — that needs no census.

**The order is the recovery story.** Every other app is emptied first, one at a
time; the account row is closed last. So a failure halfway leaves you with an
account that still works and an error naming the app that failed, never a closed
account and data you can no longer reach.

**Not reachable from `bk`, and now structurally so.** Both new methods are
session-only: a `bk_live_…` token does not work on them at all. An agent must
never delete its owner's data, and `Confirm()` auto-approves under
`BK_NO_PROMPT=1`, so the guard is the credential rather than a prompt.

**What to adapt:** if you drive `DELETE /api/me` from anything other than the web
UI, add `?scope=all_apps`. Otherwise nothing — no `bk` command changes.

---

## 2026-08-11 — the account-deletion preview now states which app it covers

**Not breaking for `bk`** (the route is deliberately unreachable from the CLI),
**shape change for the web UI.**

`DELETE /api/me?dry_run=true` — "what would closing my account do?" — enumerates
`platform.workspaces`, which has been `apps/issues`' own table since 2026-08-10.
It therefore cannot see any other app's workspaces, and until today it did not
say so: the preview named one app's workspaces and presented them as the whole
picture. **The report was not empty, it was confidently incomplete** — an empty
report invites suspicion, a partial one reads as authoritative.

The response now carries the app it covers, and the deletion screen renders it:

```json
{ "app": { "slug": "issues", "name": "Blackcode Issues" },
  "blocked_by": [], "will_hard_delete": [ … ] }
```

**This is honesty about scope, not the fix.** Closing an account still leaves
another app's data in place — owned by an account that can no longer sign in —
because the account close is an `UPDATE` and the other app's
`owner_id … ON DELETE RESTRICT` never fires. Until that lands, **do not close an
account that has data in more than one app.**

---

## 2026-08-11 — two dead columns dropped from `platform.*`

**Not breaking.** Neither column had a reader, and both writers wrote a
constant. Nothing you can observe through `bk` or through a route changes.

- **`platform.workspace_invitations.app`** — the app an invitee was invited
  *into*. It existed to drive a per-app grant, and 2026-08-10's Phase 5 removed
  per-app grants entirely (`app_access`, `workspace_apps`): an invitation is
  into one workspace, that workspace belongs to exactly one app, and accepting
  it makes you a member of that app. Since that day the only writer passed a
  hardcoded NULL.
- **`platform.error_events.workspace_id`** — never written, by anything, ever:
  0 of 328 production rows. Its stated purpose was to be disambiguated by the
  `app` column added beside it in Phase 1; the ambiguity was hypothetical
  because the column was always NULL.

**`error_events.app` stays and is unaffected** — it answers "what has app X been
throwing lately?", which is what the super-admin Errors tab asks.

**What to adapt:** nothing, unless you read `platform.*` directly, which is not
a supported interface. `bk <app> invite send` has refused an `--app` flag with a
naming error since 2026-08-10 and still does; that refusal is unchanged.

Migration `0046_drop_dead_platform_columns` (issues ledger — `platform.*` is
always migrated from there). Rollback: `docs/sql/0046-drop-dead-columns-rollback.sql`,
which restores the **structure**; the invitation column's historical values are
not recoverable from it.

---

## 2026-08-11 — the web copy caught up with the CLI's verb re-tiering

**No route changed and no command changed.** This entry exists because the
product's own pages were telling people to run commands the binary no longer has,
four days after 2026-08-10's re-tiering, and one of them was step 3 of the
public getting-started path.

If you are scripting `bk`, nothing here affects you — but if you learned a
spelling from a page rather than from `bk guide`, this is why it did not work:

- `bk workspace use <slug>` → **`bk issues workspace use <slug>`** (the issues
  quickstart and its FAQ)
- `bk issue create …` → **`bk issues issue create …`** (the issues login page)
- `bk activity`, `bk trash list` → **`bk issues activity`, `bk issues trash
  list`** (the issues pagination FAQ)
- `bk search` for cross-app search → **there is none.** Each app is searched on
  its own (`bk sales search`, `bk issues search`). The sales search page promised
  the cross-app version; PLAN.md §3 records that loss as deliberate
- `bk activity --app sales` → **`bk sales activity`**. `--app` was removed in the
  same release; the app is the command now

Three server `suggestion` strings — the `hint:` line the CLI prints on an error —
also named retired spellings, which matters more than the page copy because an
agent acts on a hint: `bk workspace list --all` (a flag that was itself removed),
`bk member list`, `bk invite revoke <id>`. All three now name the app.

**`bk undo` was removed from the product's feature list.** It was advertised on
the landing page as reversing your last few changes over a journal of
before/after snapshots. There was never such a journal:
`platform.transaction_log` had no writer, which is why the command went in CLI
1.12.0 and `/api/undo` has been a 410 since — and the table was dropped on
2026-08-10. Trash and restore is the real version of that promise and is
unchanged.

A guard now derives the retired spellings from `deprecations.go` and fails the
build if a page names one
(`packages/platform-testing/test/retired-cli-spellings.test.ts`).

---

## 2026-08-11 — `appverbs.Config` can declare half of `invite`

For anyone adding an app. `bk <app> invite` used to be one flag mounting seven
subcommands; it is now three flags:

- `Invites` — the OWNER's half: `send`, `list`, `revoke`. Three workspace-scoped
  routes, served by whichever app owns the workspace.
- `InviteCandidates` — adds `candidates`.
- `InviteAccept` — adds `accept`, `decline`, `pending`. The INVITEE's half, whose
  three routes are deliberately not workspace-scoped: somebody redeeming a link
  is not yet a member of anything.

**`bk issues invite` and `bk sales invite` are unchanged** — both apps set all
three flags. The split exists because `apps/_scaffold` serves the owner's half
and not the invitee's, and a single flag claimed four routes it has no file for.

## 2026-08-10 — BREAKING: per-app access is gone; `bk app` becomes the address book

Membership is now the whole gate. `platform.workspace_apps` and
`platform.app_access` are **dropped**, with the routes, commands and screens that
served them.

They answered "is this app switched on inside this workspace, and may this person
open it?" — a question that needs one workspace shared by several apps. Since
2026-08-10 each app owns its workspaces, so **a workspace belongs to exactly one
app and its members are that app's users**. There is no second gate left to be
refused by.

### Removed

| Gone | Use instead |
|---|---|
| `bk app enable <app>` | `bk <app> invite send <email>` — invite them to a workspace in that app |
| `bk app disable <app>` | `bk <app> member remove <user>` |
| `bk app default-access <app> --mode …` | nothing; membership is the grant |
| `bk app access list\|grant\|revoke <app>` | `bk <app> member list`, `bk <app> invite send`, `bk <app> member remove` |
| `bk <app> workspace list --all` | `bk <app> workspace list` — it returns the same rows now |
| `bk <app> invite send --app <app>` | invite from the app you mean |
| `GET\|PATCH /api/workspaces/{ws}/apps`, `…/apps/{app}/access…` | — |
| `GET /api/workspaces?all=1`'s widened list and per-row `apps` array | `GET /api/workspaces` |
| `PLATFORM_ENFORCE_APP_ACCESS` | — |

Every removed command exits non-zero and names its replacement on stderr, so a
run that hits one can recover inside the same run. `POST …/invitations` **rejects**
a body still carrying `app` with a 400 and a suggestion, rather than ignoring it:
silently dropping it would tell a client its invitation granted access it did not.

### `/api/meta`'s `apps` block changed meaning — read this if you parse it

It was the apps you held a GRANT for, each with the workspaces you could reach it
in. It is now the **address book**: every enabled app in the suite, with its
`base_url`.

- **`workspaces` is populated only for the app answering the request.** For any
  other app it is `[]`, and that means *"not known here"*, **not** *"you have none
  there"*. Ask that app's own `/api/meta` — that is what `base_url` is for.
- **More apps may appear than before.** The list is no longer filtered by what you
  can reach, because no deployment can determine that any more: each app's
  membership lives in its own schema.
- `links.relations` is **removed** (`bk link` went on 2026-08-10 and no app writes
  the table). `links.urn_format` and `links.urn_example` are unchanged — putting
  the other end's URN in a record's own text is the documented replacement.

The old shape was not merely about to become wrong, it already was: a brand-new
issues signup was told `apps.sales.workspaces` contained their platform
workspace — a workspace `apps/sales` itself answers 404 for.

### `bk app` narrows

`bk app list` and `bk app use` remain. `list` no longer reports ENABLED, DEFAULT
ACCESS or ACCESS — those described the dropped tables — and prints APP, SERVER,
REACHABLE. **It also no longer needs an active workspace**, which fixes it
404ing from a CLI homed on an app that never served `/api/workspaces/{ws}/apps`.

An app listed as REACHABLE that you have no workspace in is a normal state. Ask
it: `bk <app> workspace list`.

### Also dropped: `platform.transaction_log`

No writer since before the monorepo, and `/api/undo` has been a 410 since
2026-08-05. The migration refuses to drop it if any row is newer than 30 days —
a recent row would mean a writer nobody has found.

---

## 2026-08-10 — BREAKING: ten `bk` verbs move behind the app name, and `bk link` is removed

**This breaks every script and every agent that uses a bare data verb.** Each old
spelling exits non-zero and names its replacement on stderr, so a run that hits
one can recover inside the same run — but it does not keep working.

### What moved

| Old | New |
|---|---|
| `bk workspace …` | `bk <app> workspace …` |
| `bk member …` | `bk <app> member …` |
| `bk invite …` | `bk <app> invite …` |
| `bk user …` | `bk issues user …` |
| `bk inbox …` | `bk issues inbox …` |
| `bk storage …` | `bk <app> storage …` |
| `bk search …` | `bk <app> search …` |
| `bk activity …` | `bk <app> activity …` |
| `bk link …` | **removed** — see below |

`upload`, `trash` and `label` already moved in 3.0.0 and are unchanged.

### Why

The verbs were bare because the apps shared a database: one `platform.workspaces`
to list, one entity index to search, one upload ledger to report. The 2026-08-10
refactor ended all three — `apps/sales` has its own workspaces, members,
invitations, labels, uploads ledger and event feed, and no longer projects into
the shared index at all.

A bare spelling therefore had no correct answer, only a **default** taken from
whichever app you were last homed on, with nothing in the command saying which.
`bk trash purge` destroyed things in an app the command never named.

### What still stays bare

Your account and this binary: `login`, `logout`, `whoami`, `token`, `profile`,
`meta`, `app`, `guide`, `skill`, `changelog`, `version`, `super-admin`. One
account and one token remain valid against every app — that has not changed and
is not going to.

### Each app now remembers its own active workspace

`bk sales workspace use acme` no longer moves `bk issues`. They are different
rows in different tables that can share an id and a slug, so a slug only means
something against the app it was resolved in.

**On upgrade**, the single active workspace in your config is adopted as your
**home app's** and no other's. Run `bk <app> workspace use <slug>` once for each
other app you work in; until you do, commands in those apps fail with an error
naming the app and the fix rather than a 404.

### `--app` is gone from `search`, `activity` and `storage list`

It selected among the apps writing one shared index. With one index per app its
only legal value is the app already named on the command, and its only other
value returns an empty result that reads as "nothing here". It is unchanged on
`bk changelog --app` and `bk guide --app`.

### `bk link` is removed, with no replacement command

It recorded a relation between two apps' records in an index every app wrote
into. There is no such index now. Put the far end's URN in the record's own text
instead — `bk sales prospect show 8` prints one, and it is a string a human or an
agent can act on:

```bash
bk issues issue create --project 1 --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme/prospect/8"
```

What you lose is the reverse lookup; there is no list of "every issue mentioning
this prospect". Search the text.

### Apps serve subsets, and the CLI says so

A verb an app does not serve is now **absent from `bk <app> --help`** rather than
present and 404ing. `bk sales workspace` has `list`, `show` and `use` and no
`create`, because a workspace is the company and sales has no create-workspace
flow. Run `bk <app> --help` for what a given app offers.

Three routes were also removed, each a shared handler whose premise had gone:
`GET /api/users` on the sales deployment (it answered from the platform
membership table, so it listed people who are in no sales workspace),
`GET /api/workspaces/{ws}/links` on issues (no command and no page called it),
and the same two plus `…/search` in the scaffold.

### Adapting

```bash
bk guide platform/apps        # the rule, with the reasoning
bk --help                     # the apps this binary knows
bk <app> --help               # what that app offers
bk meta                       # where each command will go
```

---

## 2026-08-10 — an app can own its upload ledger and its event feed

Two more `AppContext` fields, and one contribution, for the same reason
`workspaces` arrived earlier today: shared code can no longer assume every app's
data is in the same table.

- **`AppContext.uploads`** — an `UploadLedger`: attribute a file to a workspace,
  and write the ledger row. `apps/issues` supplies
  `platformUploadLedger(db, APP_SLUG)`, which is the pair of calls
  `/api/upload` already made. **Required, with no default**: the cross-app
  delete gate asks an app whether a file is still in use, and an app writing
  into another app's ledger would be asked the wrong question.
- **`ActivityContribution.events`** — an `EventSource`. On the activity route's
  contribution rather than on `AppContext`, because exactly one route reads it
  and an app that does not mount the feed should not have to answer. Required
  within the contribution: a default would serve another app's feed.
- **`platform.labels.app` is now historical.** Every row is `issues`; nothing
  else writes the table.

**The Blob store did not split.** One store, one bill, one quota, and
`platform.blob_references` — the gate that stops one app deleting a file another
still uses — is untouched and stays shared. What split is the LEDGER: which of
an app's files exist.

**For clients:** `GET /api/upload` and the blob handshake are unchanged, and so
is every response shape. `bk storage list` now only sees the files of apps that
still use the platform ledger.

## 2026-08-10 — an app can own its own workspaces (`AppContext.workspaces`)

**Not breaking for `apps/issues` — nothing about its behaviour changed.** This is
the platform-side half of b/sales getting its own tenancy; see
`docs/changelog/sales.md` for what a sales client should adapt.

The shared request layer no longer names a table when it resolves a workspace.
Every app supplies a `WorkspaceSource` saying where its workspaces live, and
`apiHandler`, `resolveWorkspace`, `GET /api/workspaces`, `GET /api/workspaces/{ws}`,
`GET …/members`, `POST /api/me/active-workspace` and `GET /api/meta` all go
through it. `apps/issues` supplies the `platform.workspaces`-backed one, which is
the same set of queries it already made.

**One thing worth knowing even though it does not break a client:**
`platform.users.active_workspace_id` is ONE column shared by every deployment. It
worked while there was one set of workspaces; with two, the same number means a
different team depending on who wrote it. An app that owns its workspaces no
longer writes that column and no longer reads its own default out of it. The
issues deployment is unchanged: it still writes it, and `bk workspace use`
against issues still sets what the issues dashboard opens.

`GET /api/meta` now always lists the app SERVING the request under `apps`, with
its `base_url`. Previously that list came only from `platform.app_access` grants,
so a user of an app that keeps its own tenancy saw an empty object — including no
entry for the app they were talking to. Other apps are still grant-derived: an
agent must not discover an app its user cannot reach.

---

## 2026-08-10 — `apps/sales` is live, and two shared accounts were made generic

**Not breaking. Nothing to adapt** — this is a record of what changed underneath.

`sales.blackcode.ch` went to production, the platform's second app. One database,
one login, one CLI: a token minted against either app authenticates against both,
and `bk search` / `bk activity` / `bk link` span them. Nothing about the existing
`issues` surface changed.

Two shared accounts were named after the first app and are now platform-wide:

| | Was | Is |
|---|---|---|
| Google OAuth | project `Blackcode-issues`, one client per app | project `blackcode-platform`, **one client for every app** |
| Email sender | `admin@issues.blackcode.ch` | **`admin@blackcode.ch`** — the apex domain |

**If you filter our transactional email by sender address, update it.**
Invitations and password-reset codes now come from `admin@blackcode.ch`. The
reason is structural: Resend's free plan verifies one domain per account, so a
per-app subdomain meant the second app needing email would take the slot from
the first.

Existing accounts were not affected by the OAuth change — sign-in matches on
email address, not on the Google account identifier.

---

## 2026-08-07 — A 409 conflict now exits 2, not 1

**Behaviour change to `bk`'s exit codes. Read this if you branch on them.**

`classify()` had no branch for HTTP 409, so every conflict fell through to exit 1
(generic). That is wrong in itself — 1 tells an agent nothing — but the reason it
matters is that it disagreed with the binary.

`bk sales prospect delete --confirm <wrong name>` is pre-checked locally: the
binary fetches the record, compares, and fails with an error that exits **2**. If
that pre-check is raced or skipped, the server answers 409 `confirm_mismatch` and
the same user mistake exited **1**. One condition, two exit codes, decided by a
race the caller cannot see — and an agent cannot write one recovery for that.

409 now exits **2** (bad usage). Chosen over 6 because 2 is what every local
`--confirm` guard already returns, and changing those would break scripts that
check for it.

Affected responses: `confirm_mismatch`, `label_exists`, `invitation_expired`,
`invitation_revoked`, `invitation_already_accepted`, `invitation_declined`. All
of them describe a well-formed request the current state refuses; retrying
unchanged will not help.

**Action:** if you branch on `1` to catch conflicts, branch on `2`. The general
rule, now asserted by a test: **a pre-check in the binary must exit the same code
the server would.**

`bk guide platform/output-and-exit-codes` carries the table.

---

## 2026-08-07 — A CLI release now needs a web deploy **per app**, not one

**Nothing in the CLI changed. What changed is how you ship it.**

Every deployment answers the "what `bk` version is current" question: the shared
`apiHandler` stamps `X-BK-CLI-Latest` and `X-BK-CLI-Min` on every response, from
one constant in `packages/platform-agent`. `bk` reads them from whichever host it
is pointed at — which, since CLI 3.0.0, is the user's **home app**.

So the three-step release order (web → npm → web **again**) is now three steps
with a per-app fan-out at each end. Deploy only one app and everyone whose home
app is the other is never told an update exists; on a `forced` release, one host
blocks them and the other does not.

`devops/release.sh` was changed to say so rather than to name `issues`: its help
text and its end-of-release notice both enumerate `app_registry()`, so the list
stays right when a third app is added. `./devops/release.sh apps` is the
authoritative list.

**No action for anyone using `bk`.** This is a release-procedure change.

---

## 2026-08-07 — Provisioning a new app: the SQL order changed, and the old one failed silently

Rehearsed against a copy of a real database, which is how it was found.

**`docs/sql/app-role.sql` (and its filled-in `sales-app-role.sql`) never created
the app's schema, and every grant in it names that schema.** Run at the
documented point — before the app's first migration — five of its ten statements
fail with `schema "sales" does not exist`, **and `psql` exits 0**. The app role
comes out with no grants at all, and the provisioning step reports success. It
had never bitten `issues`, whose schema was created by migration 0033 long before
anyone wrote a role script for it.

Changed:

- Both role scripts now open with `\set ON_ERROR_STOP on` and create the schema
  themselves (`CREATE SCHEMA IF NOT EXISTS … AUTHORIZATION neondb_owner`), before
  the grants. The app's own migration opens with the same `IF NOT EXISTS`
  statement, so order between the two no longer matters.
- **The provisioning order is now: register (disabled) → role → deploy/migrate →
  probe → enable.** The `platform.apps` row must exist *first*: the migration's
  `maintains_blob_index` update is guarded on it, and re-running the migration
  will not repair a missed flag because Drizzle records it as applied.
- `docs/sql/app-boundary-probe.sql` must run **after** the migrations, and its
  header now says why: its check (1) reads a table from the app's schema. It also
  documents a way it can mislead — **a role granted nothing at all denies
  everything with 42501 and passes six of its eight denial checks.** The lines
  that distinguish the two states are the positive ones, `(1)`, `(4a)`, `(4e)`,
  plus whether `(4d)` names `blob_refs_purge` or merely denies the schema. The
  script's closing lines say this now, instead of "every deny must be 42501".
- `docs/sql/sales-app-register.sql` documents that the whole file is safe to run
  twice — before the migrations it prints `UPDATE 0` and leaves the app disabled
  — rather than asking anyone to hand-split a file mid-deploy.

**Action:** if you are provisioning an app, use the order above.
`docs/adding-an-app.md` §2 carries it as a table.

---

## 2026-08-07 — `NEXTAUTH_SECRET` is a platform-wide value; `docs/env.md` said otherwise

`docs/env.md`'s rotation procedure was written when there was one app and told
you to generate a new secret and redeploy *the* app. Since D-16 the session
cookie is one credential shared across every deployment on `.blackcode.ch`, and
it is **encrypted** with this secret — so an app holding a different one cannot
read the others' sessions. The symptom is a person being asked to sign in twice,
with two green deploys and nothing in any log.

`docs/env.md` now states the scope on the variable, gives the copy-don't-generate
procedure for a new app, and makes rotation an all-apps-at-once operation. Its
`./devops/release.sh web` invocations were also stale — that command has required
an app argument since the registry landed, so every code block in the file named
a command that exits 1.

**Action:** none for an existing deployment. Read it before provisioning an app,
and before rotating that secret.

---

## 2026-08-07 — `bk activity` no longer prints another app's internal row id

**Breaking if you parsed the `id` column of a cross-app activity row.** It was
wrong; it is now right or absent.

`platform.events` is a merged feed and every deployment serves the whole thing —
but only the app that OWNS a row can turn its `entity_id` (an internal serial)
into the workspace #number, because that means reading its own tables. Rows
belonging to another app fell through with the serial intact, and `bk activity`
prints a `#` in front of it. So the same feed, from two hosts:

```
via issues host    sales   created  prospect  29     ← sales' row id
via sales  host    sales   created  prospect  9      ← the #number
via sales  host    issues  created  issue     #727   ← issues' row id
via issues host    issues  created  issue     #4     ← the #number
```

Each host got its own app right and every other app wrong, and presented the
serial **as** a #number — worse than omitting it, because an agent that copies
it acts on the wrong row. "The serial `id` is never exposed" is one of the
platform's oldest rules.

**Fixed.** A foreign row's number now comes from `platform.events.subject_urn`,
written by the producing app in the same transaction as the event, so no
cross-schema read is involved. Both hosts now report the same number for the
same row, and it is the #number.

**Where a foreign row has no `subject_urn`** — an entity type its app does not
project — the field is `null` and there is no fallback. Nothing is better than a
plausible wrong number.

**How to adapt.** If you stored ids read from a cross-app activity row, they were
that app's internal serials and are not addressable. Re-read them, or use
`subject_urn`, which was always correct. Rows for the app you are pointed at are
unchanged, byte for byte.

## 2026-08-07 — The sales host now answers 20 more platform routes, including `bk search` and `bk link`

**If you are homed on the sales deployment, most bare verbs used to 404.** They
work now.

`bk login --server <sales>` makes sales your home app, and neutral and cross-app
verbs go to the home app's server. The sales deployment mounted 7 of the 54
platform routes `bk` claims, so from a sales login these answered with an HTML
404 page:

`bk search` · `bk link create|list|rm` · `bk workspace list|use` · `bk app list|enable|access` ·
`bk member list|remove` · `bk invite list|send|revoke|candidates|pending` · `bk user view` ·
`bk changelog` · `bk skill sync`

Two of those — `bk search` and `bk link create` — are steps in the acceptance
test this platform exists for, so the failure was not cosmetic: an agent working
in sales could not find anything outside sales, or record a relationship to it.
`bk workspace use` could not set an active workspace at all, which meant nothing
after it ran either.

The route implementations were already shared factories in
`@blackcode/platform-api/routes`; sales simply did not mount them. Nothing about
what these routes DO has changed, and no client needs to adapt — a call that
used to fail now succeeds.

**Still not served by the sales host, and each for a reason:**

| Verb | Why |
|---|---|
| `bk super-admin …` | Platform administration lives in one app. The data is platform-wide, so any host gives the same answer, and the issues host gives it. |
| `bk inbox …` | No shared factory exists yet. |
| `bk storage list \| rm` | Not yet a factory, and the delete path reaches blob deletion — not something to duplicate casually. D-28 still holds: one ledger, same rows from the issues host. |
| `bk workspace show \| edit \| delete \| transfer`, `bk member leave`, `bk invite accept \| decline` | Not yet factories — the queries still live in the issues app. |
| `bk workspace create` | D-3: a workspace is the company, and sales has no create-workspace flow. A capability decision, not a gap. |

**Reaching one of those from a sales-homed CLI now tells you so**, instead of
printing a page of HTML: the error names the app that did not serve it and the
`--app-server` flag that will.

## 2026-08-07 — `bk super-admin entity-drift` answers for ONE app: the one you are pointed at

No behaviour change — a **correction to what the command claims**, which was
wrong in the direction that reads as good news.

Its help said it checked "the cross-app entity index against each app's source
tables". It never did. The route is served by whichever deployment mounts it,
and re-derives only that deployment's own half of `platform.entities`. That is
not an omission anybody can close in one place: an app's Postgres role has no
grant on another app's schema (`docs/platform-architecture.md` §4.3), so a
single host literally cannot write the comparison for both.

The visible cost: run against a database where a second app had fifty-one
unprojected rows, it printed no drift and exited 0.

**How to adapt.** Treat a clean report as clean *for that app only*. Run it
against each app's server in turn — `bk app list` shows them — and note that an
app which has not mounted the route answers 404, not "no drift". Today only the
issues deployment mounts it; the sales deployment does not, and repairs there go
through `npm run db:reproject` (see `sales.md`).

## 2026-08-07 — Four platform routes are now answered by the sales host too

Nothing changed about what these routes DO. What changed is who serves them: an
app on its own domain has to serve its own copies, because every fetch a browser
makes goes to the origin it is on. `apps/sales` now mounts

| Route | Command |
|---|---|
| `GET \| PATCH /api/me` | `bk whoami`, `bk profile edit` |
| `GET \| POST /api/tokens`, `DELETE /api/tokens/{id}` | `bk token list \| create \| delete` |
| `GET /api/workspaces/{ws}/activity` | `bk activity` |
| `POST /api/cli/authorize` | the browser half of `bk login` |

**`bk login --server https://sales.blackcode.ch` therefore works**, which it did
not before — it opened a 404 and the terminal waited for a callback that never
arrived. The token minted there is the ordinary platform-wide `bk_live_…`
credential in the same `platform.api_tokens`: authorizing through one app does
not produce a token scoped to it, and revoking from any app revokes everywhere.

**`DELETE /api/me` is deliberately NOT served by the sales host.** Closing a
blackcode account is irreversible and reaches every app — it revokes every
token and hard-deletes workspaces you solely own — so it stays in one place,
behind a typed confirmation, rather than being offered by each deployment that
happens to be open. Same for the in-app password change, which needs to send an
email and b/sales has no mail configured; b/sales says where both are done.

Serving a subset of the platform surface is a normal, permanent state for an
app. `bk inbox`, `bk super-admin errors` and `bk storage list` are answered by
`apps/issues` and always will be — they are per-user, platform-wide, or return
the same rows from any deployment.

## 2026-08-06 — **You will be signed out once.** One sign-in now covers every app

> **PUBLISHED BEFORE THE DEPLOY.** Read this before it happens, not after.

The session cookie moves to `.blackcode.ch`, so signing in to one app signs you
in to all of them. **The next deploy of this change signs everyone out exactly
once.** Sign in again and it will not happen a second time.

**API tokens are unaffected.** `bk_live_` tokens are not cookies; nothing an
agent does needs re-authenticating, and `bk` needs no action at all. If you drive
this product through `bk`, this entry does not concern you.

### Why you are signed out rather than carried across

A cookie's identity in your browser is its **name plus its domain**. Re-issuing
the existing name with a wider domain does not replace the cookie you have — it
creates a second one beside it. Both would then be sent on every request, in an
order nothing guarantees, and the app would read one while refreshing the other:
an intermittently stale session that no one could reason about.

So the cookie is **renamed**, which makes the old one inert — no deployment reads
that name any more. It stays in your browser until it expires and does nothing.
The cost is one sign-in. It was taken now, deliberately, while there is one app:
the same change after two apps ship costs twice as many people, and after four,
four times.

### What did not change

- **The CSRF cookie stays per-host** (`__Host-` prefixed, no domain). It is
  supposed to be per-host; widening it would be a security regression.
- Sessions still expire on the same schedule.
- Nothing about how you sign in — same providers, same password, same page.

### For anyone running a deployment

`AUTH_COOKIE_DOMAIN` is new and is **production only**. Unset, the cookie is
host-only and behaves exactly as it did. Set to a domain the deployment's own
host is not under, the browser would silently refuse the cookie — so the value is
validated against `NEXTAUTH_URL` at startup and the deployment **refuses to
boot** rather than fail invisibly. Previews and local development leave it unset.
See `docs/env.md`.

**So a bouncing sign-in is not this variable.** A wrong domain cannot reach you:
it stops the deployment at startup, loudly. If sign-in succeeds and then bounces
back to the login page, look for this pair instead —

    GET /api/auth/session   returns a user
    GET /dashboard          redirects to /login

A live session beside a refused dashboard means the app and whatever guards the
dashboard disagree about the **name** of the cookie, and nothing else in this
stack produces that combination. Every request is a 200 and nothing appears in
the logs, which is why the pair is worth memorising.

---

## 2026-08-06 — The agent skill is called `blackcode`, not `blackcode-issues`

**Run `bk skill sync` once.** It moves the file, keeps anything you added, and
deletes the old copy. Running it again does nothing.

    ~/.claude/skills/blackcode-issues/SKILL.md   ->   ~/.claude/skills/blackcode/SKILL.md

**Why it is not cosmetic.** The skill describes the `bk` CLI, and the CLI drives
every app. An agent scanning the available skills, seeing one called
"blackcode-issues" while it has been asked to do sales work, and concluding *"not
my job"* is the single failure the skill exists to prevent. The template no
longer names one app either: it points at `bk app list` and says plainly that
there is more than one.

### What `sync` does, exactly

- Carries across everything you wrote **around** bk's block — an edited
  description, your team's rules below it.
- Rewrites `name: blackcode-issues` in the front matter to `name: blackcode`.
  Nothing else in the front matter is touched, and a name **you** chose is left
  alone — bk renames only the name bk picked.
- Removes the old `SKILL.md`, and its directory only if that leaves it empty.
  Anything else you keep in there stays, and so does the directory.
- **A `SKILL.md` you wrote yourself is not moved and not deleted.** It is
  reported, left under the old name, and no second skill is installed beside it:
  two skills claiming the same tool is worse than one with a stale name.

### If you never sync

Nothing breaks. The old file keeps working and keeps updating — the pre-3.0.0
block markers (`<!-- BEGIN blackcode-issues … -->`) are still recognised, so
`bk` still owns and refreshes its own region. You keep the old name until you
sync.

`bk skill check` now says *"the skill is installed under its old name at …"*
rather than *"no skill installed"*, which was true of the new path and
misleading about the situation.

---

## 2026-08-06 — Labels belong to an app, and two shared columns became `<app>:<noun>`

Three changes to tables **every** app shares (`platform.labels`,
`platform.comments`, `platform.deletion_batches`), so that a second deployment
can use them without colliding with this one. All three are the **expand** half
of expand → migrate → contract; nothing is removed yet.

### `platform.labels.app` — labels are app-scoped

A label is now either **scoped to one app** or **shared across every app** in the
workspace.

- `app = '<slug>'` — only that app lists it, attaches it, renames it or deletes it.
- `app IS NULL` — **shared** with every app in the workspace.

**Every label that existed before today is now scoped to `issues`.** That records
a fact rather than changing one — all of them were created in the issues app, for
issues work — and nothing changes for you today, because issues is the only app
serving them. It matters the moment a second app opens: its label picker starts
empty rather than inheriting a taxonomy that was never meant for it.

**To share a label, set `app` back to NULL** — there is no command for it, by
design. Sharing is a decision somebody makes about one label.

`bk issues label list` now genuinely means *issues'* labels: every read on the
issues deployment is filtered to `app IS NULL OR app = 'issues'`, and that
includes the ones that are not a list — resolving a label by name while creating
an issue, attaching one, renaming one, deleting one. **Another app's label cannot
be attached to an issue.**

**Adapt:** a label object now carries `"app"` (a slug, or `null` for shared).
`bk <app> label list` and `label view` print it as a `SCOPE` column. Labels you
create through `bk issues label create` or through `--label` on an issue are
scoped to `issues`. Nothing about label ids, colours or attachment changed, and
no label became invisible to anyone.

### `platform.comments.parent_type` and `platform.deletion_batches.root_type`

Both stored one app's bare noun (`'issue'`, `'task'`, `'project'`) in a column
every app writes, which meant the database rejected a comment on anything a
second app owns, and that two apps inventing the same word would have collided
silently. Both columns are now `<app>:<noun>` — `issues:issue`, `sales:prospect`
— and both CHECK constraints accept that shape from **any** app.

Existing rows were rewritten to the qualified form in the same migration.

**Adapt: nothing, for HTTP clients.** These are storage-level changes. Every
route that returns one of these values still returns the bare noun
(`parent_type: "issue"`, `batch_root_type: "project"`), because the route is
already scoped to one app by its path. No response field changed shape.

**Not breaking.** Both constraints still accept the three bare legacy values, and
every read matches both forms, so a request in flight during the deploy is fine
either way. Dropping the bare form is a later release.

> **Operationally:** the backfill is invisible to the build that ships with it
> and to any other app, but a build from *before* it still looks for the bare
> form. Migration and promote must be chained, not run hours apart.

---

## 2026-08-06 — **CLI 3.0.0:** `bk` learned every app's address, and routes by tier

> **UPGRADING FROM 2.x: run `bk meta` once.** Your login still works and you do
> not re-authenticate — but a 2.x config has no address book, and `bk` will not
> invent one, so `bk <app> …` fails until it has been learned. One command, once.
> Why it is not inferred: inferring a routing address means inferring which
> deployment receives a write, and `bk issues upload` filing a contract against
> the wrong app has no undo.

The companion to the verb tiers below, and the reason they can exist: with more
than one deployment, "which app" is also "which server".

`bk` now carries an **app address book**, learned from the platform rather than
configured. `bk login` and `bk meta` read each app's `base_url` out of
`/api/meta` and store it locally, so nobody types a URL twice and the book cannot
drift from what the platform serves for longer than one `bk meta`.

### Where each command goes

| Tier | Server |
|---|---|
| **Neutral** (`workspace`, `member`, `token`, `meta`, …) | the home app's |
| **Cross-app** (`search`, `activity`, `link`, `storage`) | the home app's — they read shared data, so any app answers alike |
| **App-owned** (`bk <app> …`, including that app's own nouns) | **that app's, always** |

```bash
bk meta                       # refresh the address book; print where each tier goes
bk app list                   # every app: enabled here, its server, and whether it answers
bk app use sales              # move the home app — the bare verbs follow
bk --app-server sales meta    # …or redirect ONE invocation, changing nothing
```

`bk <app> …` ignores all of it. Its app is written on the command, so no mode,
default, override or previous command can move it. That is the property a
namespace has and a flag does not.

### `bk meta` gained a `routing` block

`bk meta --json` now carries a local `routing` object — home app, home server,
the full `app_servers` map, and which server each tier reaches. **An agent can
answer "where will this command go?" without running one and finding out.** It is
client state, which is exactly why the server could never have told you.

### New: `bk app use <slug>`, and `bk app list` grew two columns

`bk app list` now shows **SERVER** and **REACHABLE** beside each app. Three
different things have to be true before `bk <app> …` works — the workspace runs
the app, this binary knows its address, and that address answers for your token —
and from inside a failing command all three look like a 404.

### New global flag: `--app-server <slug>`

Redirects one invocation's neutral and cross-app verbs. **Not** spelled `--app`:
that already means "filter by app" on `bk search`, `bk activity`,
`bk storage list`, `bk changelog` and `bk guide`, and a persistent flag of the
same name shadows a local one silently — `bk storage list --app issues` would
have quietly stopped filtering and started routing.

### There is no fallback, and that is the point

An app with no address is an error that names the app and the command that fixes
it. It is never a request sent to a different server:

```
error: no server known for app "sales" (registry has: issues)
hint: run `bk meta` to learn each app's server from the platform, `bk app list`
      to see what your config has now, or `bk login --server <url>`
```

A known-but-dead address says that instead, naming the app and the URL, so a
stale book and a down deployment are distinguishable. A wrong-server 404 is
indistinguishable from a deleted record, a mistyped number or a permissions
problem — which is why the CLI refuses to produce one.

### Upgrading from 2.x

Your existing config keeps working and **you do not log in again**: `server`
becomes `home_server`, and `bk` keeps writing `server` too, so rolling back to a
2.x binary still works.

**Run `bk meta` once.** A 2.x config has no address book, and `bk` will not
invent one — `bk <app> …` fails with the hint above until it has been learned.
Guessing there means guessing which host a file gets uploaded to.

---

## 2026-08-06 — **BREAKING (CLI 3.0.0):** every verb now belongs to one of three tiers, and three of them moved

**The idea first, because it is what the rest of this file will assume.** A `bk`
verb sits in exactly one of three tiers, and **the tier is visible in the
spelling**, so you can tell which app a command talks to by reading it:

| Tier | Verbs | Spelling | Why |
|---|---|---|---|
| **Neutral** | `login` `logout` `meta` `guide` `changelog` `skill` `version` `app` `workspace` `member` `invite` `token` `profile` `inbox` `super-admin` | **bare** | Identity and org data. No app owns a person, a membership or an invitation, so no app can be the wrong one to ask |
| **Cross-app** | `search` `activity` `link` `storage` | **bare** | They span every app *by design* and tag each result with the app it came from. Scoping them would remove the reason they exist |
| **App-owned** | every app noun, **plus `upload` `trash` `label`** | **`bk <app> <verb>`** | The data is app-attributed. An implicit default here is how a contract raised in one app gets filed under another |

The test is **"would two deployments answer differently?"** — never "is it shared
code?". Which is why files split across two tiers: **you upload INTO one app, and
you list ACROSS all of them.**

```bash
bk issues upload contract.pdf   # app-owned: the file is filed under issues
bk storage list                 # cross-app: every app's files, each tagged
bk storage list --app issues    # …filtered, when you want one app's
```

The full statement, with worked examples, is **`bk guide platform/apps`** — a new
topic, and the first thing to read before writing anything from now on.

### What breaks

Four spellings stop working. Each names its replacement on failure:

| Was | Now |
|---|---|
| `bk upload <file>` | `bk issues upload <file>` |
| `bk trash list\|restore\|purge\|empty` | `bk issues trash list\|restore\|purge\|empty` |
| `bk label list\|view\|create\|edit\|delete\|attach\|detach` | `bk issues label …` |
| `bk storage attachments` | `bk issues attachment list` |

**`bk storage list` and `bk storage rm` are UNCHANGED** — storage is cross-app and
stays bare. Only its issues-only subcommand moved, and it moved to a noun of that
app rather than to `bk issues storage attachments`, because one noun must not
straddle two tiers.

Nothing else changed: same flags, same output, same routes, same behaviour. Only
the first segment is new.

```
$ bk upload contract.pdf
error: unknown command "upload" for "bk"
hint: the bare spelling is now `bk <app> upload …` — a file is stored against one
      app, so the app names itself: `bk issues upload contract.pdf`.
```

Exit code **2** (usage), one line on stderr, stdout untouched. If you branch on
exit codes, this is a usage error, not a runtime one.

### Why there is no working alias this time

The 1.10.0 rename (`bk issue` → `bk issues issue`) kept every old spelling alive
for two releases, printing a deprecation line. That was the right call then and
is the wrong one here: an alias for `bk upload` would have to **choose an app
silently**, and choosing silently is precisely the accident being removed. A file
uploaded through the wrong app is recorded as that app's file, and nothing
downstream can tell it was a mistake.

So the bare spellings fail loudly and immediately, and the
`deprecations.go` rows that name their replacements stay for **two minor
releases** (through 3.2.0). A stale script gets a recovery path, not a dead end.

### What to change in your scripts and agents

1. Prefix the three moved verbs with the app: `bk issues trash list`, not
   `bk trash list`. Leave `bk storage list` alone.
2. Re-read `bk guide platform/apps`, or run `bk skill sync` to refresh an installed
   agent skill.
3. If you hardcoded `bk upload` in a wrapper, note that the app segment is now the
   thing that decides where the file is filed — it is a real argument, not
   punctuation.

### Notes on each

- **`storage` stayed bare, and that was a late call.** It shipped app-owned for
  one commit. Uploads are one shared cabinet with one workspace quota, so
  `bk issues storage list` and `bk sales storage list` would have returned the
  SAME rows — an app segment that implies a narrowing it does not do teaches the
  wrong rule in the one place an agent goes to check it. It is cross-app, beside
  `bk search`, which is also the shape it already had: every row tagged with its
  app, `--app` to filter.
- **`trash` is genuinely per-app.** Each app bins its own entities. `--type` is
  validated against the app's own vocabulary, and the error names the app so a ref
  aimed at the wrong bin is distinguishable from a typo.
- **`label attach`/`detach` name an entity**, so they are that app's own
  subcommands: `bk issues label attach <issue-id> <label-id>`. Label CRUD is
  shared and identical everywhere.
- **`bk issues attachment list`** is the issues app's own view of its attachment
  rows, workspace-wide. It was `bk storage attachments`, which only ever listed
  issue attachments while sitting on a verb that spans every app. The per-issue
  commands are unchanged: `bk issues issue attach|attachments|detach`.

---

## 2026-08-06 — Every route the web UI and `bk` need can now be served by any app

**Nothing you can observe changed today.** Same routes, same origin, same
statuses, same bodies. This entry exists because it is the thing that stops being
true the moment a second app is deployed, and an agent hitting that change should
find it written down beforehand rather than after.

The last routes that only the issues deployment could serve are now mounted from
one shared implementation:

- `DELETE /api/workspaces/{ws}/members/{userId}`
- `GET`/`POST /api/workspaces/{ws}/invitations`, `DELETE .../invitations/{id}`
- `PATCH /api/workspaces/{ws}/apps/{app}`
- `POST`/`DELETE /api/workspaces/{ws}/apps/{app}/access(/{userId})`
- `/api/upload`, `/api/upload/blob`, `/api/cli/authorize`, `/api/me/password/*`

**What this will mean in practice.** Each of these records who did it, and "who"
now includes WHICH APP. `bk activity --app sales` will show a member removed from
the sales deployment as a sales event, even though membership belongs to no app —
the question that filter answers is *which app did this happen in*. Same for a
workspace enabled, an invitation sent, an access grant.

**And the thing to actually change your habits about:** `bk login --server`,
`bk upload` and `bk invite` should name the deployment you are working in. They
have always been per-origin operations; until now there was only one origin, so
it never mattered. A file uploaded through the wrong one is filed under the wrong
app permanently (see the upload entry below).

**Two routes deliberately stay per-app** and are not coming: `POST
/api/workspaces` (no app but issues offers a create-workspace flow) and
`/api/auth/*` (an app's own sign-in pages and providers).


## 2026-08-06 — **SECURITY:** `bk login` no longer completes from an invalidated session

**The same gap as the `/api/tokens` entry below, in the other route that mints a
token.** `POST /api/cli/authorize` — the browser step of `bk login` — now rejects
a session issued **before** the account's last password reset, and one belonging
to a deleted account. It previously accepted both.

**Why it matters.** That route hands back a `bk_live_…` CLI credential. Until
today it checked only that a session existed and resolved to a real user, so **a
session captured before a password reset could still be walked through
`bk login` and come out holding a permanent token — and revoking the session did
not revoke the token.** A password reset is what somebody does when they believe
their account is compromised.

**How to adapt.** Nothing, unless your browser session predates a password change
on the same account: `bk login` will then fail at the authorize step and you sign
in again. **Tokens already issued are unaffected** — this changes who may create
one, not what an existing one can do. Revoke any you no longer recognise with
`bk token list` and `bk token revoke`.

Both token-minting routes now use the same session check. Nothing else about the
`bk login` handshake changed: same callback validation (loopback only), same
response fields, same token naming.


## 2026-08-06 — A file belongs to the app you uploaded it THROUGH

**Nothing changed about how you upload.** `POST /api/upload` and the
client-direct `/api/upload/blob` handshake take the same inputs, enforce the same
100MB cap and the same blocked content types, and return the same bodies.

**What is now guaranteed rather than incidental:** an upload is attributed to the
app whose origin served the request — in *both* places that record it.

| | what it is | set from |
|---|---|---|
| `platform.uploads.app` | who owns the file. The cross-app delete gate reads this to decide whose reference scan must answer for it | the serving app |
| the blob pathname prefix | `<app>/<workspace>/<file>` — where the bytes physically are | the serving app |

**If you are looking at a document filed under the wrong app, this is why.** A
sales file uploaded through `issues.blackcode.ch` is an issues file, in the
issues folder, permanently — nothing moves a blob afterwards, and `pathname` is a
historical fact rather than something derived from `app`. Upload through the
origin that owns the content: `bk upload --server https://sales.blackcode.ch`,
or just the deployment you are working in.

Both upload routes are now served from one shared implementation that takes its
identity from the app mounting it, which is what lets a second deployment serve
its own `/api/upload` instead of 404ing on it. Until a second app is deployed,
the only origin serving these is the issues one, exactly as before.

**One wording change, non-breaking:** the client-direct handshake rejected SVG
with `SVG files are not allowed for security reasons`; it now names the type it
refused (`image/svg+xml files are not allowed for security reasons`) and reads
the blocked list from the same place `GET /api/meta` serves it as
`media.blocked_mime_types`. The multipart route's `file_type_not_allowed` error
code and status are unchanged, and the set of refused types is identical. It had
been a second, hand-typed copy of that list; adding a type to the blocklist would
previously have taken effect on one of the two upload paths and not the other.


## 2026-08-06 — **SECURITY:** a password reset now invalidates token creation too

**What changed.** `GET/POST /api/tokens` and `DELETE /api/tokens/{id}` now reject
a browser session that was issued **before** the account's last password reset,
and one belonging to a deleted account. They previously accepted both.

**Why it matters.** Token management has always been session-only — minting a
`bk_live_…` token with a `bk_live_…` token would be privilege escalation. But the
session check it used was weaker than the one every other session-authenticated
route in the product uses: it confirmed a session existed and resolved the email,
and stopped there. So **a session captured before a password reset could still
mint a long-lived API token afterwards, and revoking that session did not revoke
what it minted.** A password reset is what somebody does when they believe their
account is compromised; one that leaves the attacker able to create a permanent
credential has not done its job.

**How to adapt.** Almost certainly nothing. If you are signed in on a browser and
your password was changed since that sign-in, `/api/tokens` will answer `401`
where it used to work — sign in again. Tokens already minted are unaffected;
this changes who may create and revoke them, not what existing ones can do.

**`bk` users are unaffected.** The CLI authenticates with a token and has never
been able to reach these routes.


## 2026-08-06 — The shared request layer and the first platform route factories

**Nothing about how you call the API changed.** Every route below returns the
same status codes, the same bodies and the same headers as it did yesterday. If
you notice this entry at all, it should be for the one new capability at the end.

**What moved.** The `apiHandler` wrapper and the `resolveWorkspace` gate — auth,
workspace resolution and the per-app access check that every workspace-scoped
route runs — moved out of the issues app into `@blackcode/platform-api`,
parameterised by an `AppContext`. A first set of shared routes moved with them
and are now mounted by each app from one implementation:

`/api/changelog`, `/api/me` (+ `/active-workspace`, `/pending-invitations`),
`/api/tokens` (+ `/{id}`), `/api/users`, `/api/errors/client`, `/api/status`,
`GET /api/workspaces`, and under `/api/workspaces/{ws}`: `search`, `links`,
`members`, `invite-candidates`, `apps`, `activity`.

`/api/meta` did NOT become shared, deliberately: its whole job is telling you
what THIS app's vocabulary is. Its platform half (you, your workspaces, the apps
you can reach, the link relations, the CLI versions) now comes from one place, so
those fields will be identical on every app's origin, but the document stays
per-app and `apps.<slug>.vocabulary` remains the only place an app's enums live.

**Why it matters to a client:** it is what lets a second app serve these on its
own domain. Until now they existed only on the issues host, so an app deployed
elsewhere would 404 on its own `/api/me`, a file uploaded through the wrong host
would be recorded as belonging to the wrong app, and a user granted one app but
not another would get 403 from `bk search`.

**Still served only by the issues deployment**, unchanged: trash, storage,
labels, comments, the inbox, super-admin, `POST /api/workspaces`, `/api/auth/*`,
and `/api/status/errors`. Nothing to adapt — they are where they were.

> *Amended later the same day.* This list originally also named `/api/upload`,
> `/api/cli/authorize`, `/api/me/password/*` and the workspace / member /
> invitation / app-access WRITE routes. Those landed too — see the Tier 1 entry
> at the top of this file. Corrected here rather than contradicted below, so
> there is one list and it is the true one.

**New: per-app redaction of error context.** An app can now declare that request
payload must never be written to `platform.error_events.context`. The issues app
does not set it and its behaviour is unchanged; the sales app will.

Its ceiling is stated deliberately, because a privacy control that is believed to
do more than it does is worse than none: **it covers the `context` column, not
the error `message` or `stack`.** A database driver will happily put a rejected
value inside an error message, and scrubbing messages would leave error rows
nobody can act on. The guarantee that does cover everything is retention, which
is a separate, dated commitment.

**Also:** `requireAppAccess` — the 403-with-a-hint you get when you are a member
of a workspace but have not been granted an app in it — is now exported from
`@blackcode/platform-api` rather than `@blackcode/platform-auth`. The check, the
status, the code and the suggestion text are identical. This is an internal
import path; no HTTP client is affected.


## 2026-08-06 — **FIX:** `bk issues --help` said the removed 1.12.0 spellings still worked

Three strings shipped inside the 1.12.0 binary described a world that 1.12.0
itself had changed. No behaviour was wrong — only what the binary said about
itself, which for an agent is the same thing.

**If you read `bk issues --help` on 1.12.0, one line was actively misleading:**

> ~~"Every command below also answers to its old un-namespaced spelling
> (`bk issue list`), which still works and prints one deprecation line."~~

That was true in 1.10.x and 1.11.x. It is **false in 1.12.0** — the aliases were
pruned on schedule, and `bk issue list` exits **2**. Nothing to adapt if you
already use the namespaced form; if you were relying on that sentence, the old
spellings are gone and the error names its replacement.

Also corrected:

- The same help text listed **`undo`** as a platform verb. `bk undo` was removed
  in 1.12.0.
- `bk meta` printed "(the top-level vocabulary/limits/media keys are deprecated
  and **go away in 1.12.0**)". 1.12.0 shipped and the keys are **still served** —
  correctly, since `CLI_MIN_VERSION` is 1.9.1 and every binary from 1.9.1 up
  reads them. The notice no longer names a version: a removal date baked into a
  string cannot be corrected once it is wrong on the copies already installed.
  **The top-level keys remain deprecated. Read `apps.<slug>` instead.**

**Two guardrails were repaired in the same change**, both found by the wrap-up
verification and both of the kind this repo keeps finding — green while checking
less than they claimed:

- `guide_test.go`'s dynamic-value guard was a substring match over six
  hand-written strings. A topic containing the entire issue status vocabulary,
  the entire priority vocabulary and a **stale** `50 MB` limit passed. It now
  matches size limits by *shape* (so a wrong number is caught, not just the right
  one) and counts vocabulary enumerations, while still allowing a worked example
  to name a value.
- The `apps/<a>` → `apps/<b>` **ESLint rule was deleted**. It had been identified
  as inert during the migration and was still passing the real escape shape at
  exit 0. The boundary is enforced by `lib/app-isolation.test.ts`, which resolves
  imports instead of globbing strings — verified by watching it fail. Do not
  re-add the lint rule; a glob cannot express "resolves into a sibling app".

No route changed. No CLI flag, command or exit code changed.

---

## 2026-08-05 — CLI 1.12.0: three breaking changes

**All three are in the CLI. Read all three before upgrading — the trash one can
destroy the wrong item if you reuse an old ref.**

1. **The pre-1.10.0 command spellings stop working.** `bk issue …`, `bk task …`,
   `bk project …`, `bk move`, `bk copy`, `bk analytics` have been deprecated
   aliases since 1.10.0 (two minors, as promised) and are now removed. Use
   `bk issues issue …` and friends. A removed spelling still prints the new one
   rather than "unknown command", so a stale script recovers instead of dying.
2. **`bk trash` refs are `#number`s, not row ids.**
3. **`bk undo` is removed.** It never worked.

Each is detailed below.

### 1. The pre-1.10.0 aliases are gone

On schedule. `cli/internal/commands/deprecations.go` keeps a row for each, so:

```
$ bk issue create --title x
error: unknown command "issue" for "bk"
hint: `bk issue …` is now `bk issues issue …` — app verbs sit behind their app
      name. Same flags, same output.
```

If you pinned to 1.11.x you are unaffected until you upgrade. Agents that read
`bk guide` or ran `bk skill sync` since 1.10.0 already use the new spellings.

### 2. `bk trash` refs are `#number`s, not row ids

`bk trash list`'s **REF** column used to print an internal database row id — the
one place the platform exposed a serial instead of the `#number` used by URNs,
`bk issues issue view`, `bk search` and everything else. It now prints the
`#number`, so `issue:42` in Trash is the same issue as `bk issues issue view 42`.

```bash
bk trash restore issue:42        # 42 is now the #number
bk trash purge   issue:42
```

**⚠️ Do not reuse a ref captured before upgrading.** An old row id is usually a
valid `#number` for a *different* item, and `purge` is not recoverable. Re-run
`bk trash list` and take the current REF. If you have a stored script or an agent
holding refs across this release, that is the one thing to check.

**`bk trash purge` and `bk trash empty` now echo what they destroyed** — type,
`#number` and title, one line per item, followed by the count (`items` in JSON).
Purge is the product's only irreversible action, and the titles exist only up to
the moment the row is deleted. This is also the last defence against a stale ref:
if a pasted ref names something other than what you meant, the title says so
immediately rather than a month later.

The wire format keeps the two unambiguous rather than redefining one:
`{"type":"issue","number":42}` means the #number, `{"type":"issue","id":905}`
still means the row id. **Every pre-1.12.0 binary therefore keeps working
unchanged** — it sends `id`, and the server reads it as a row id exactly as
before. An item carrying both is rejected as ambiguous rather than guessed at.

**Why the field changed shape instead of meaning.** Both spellings were driven
against the same server before this shipped. A 1.11.0 binary printed `issue:953`
and restored the right item; the 1.12.0 binary printed `issue:16` and restored the
right item. **Had `id` simply been redefined to mean the #number, that first call
would have acted on a completely different issue — and on `purge`, destroyed it**,
silently, on every installed binary at once. That counterfactual is the entire
reason for the two-field design.

Also fixed: `bk trash list` reported a `#number` for issues but `null` for
projects and tasks, even though both have had one since migration 0030. All three
now report it. A row with no `#number` shows `—` and a stderr warning rather than
falling back to a row id — such a row can only be restored with `--batch`.

### 3. `bk undo` is removed

It never worked. `platform.transaction_log` had no writer, so the table was empty
in production and `bk undo` reported zero operations every time it has ever been
run. A documented agent-facing command that does nothing is worse than a missing
one: an agent that believes it can undo takes risks it otherwise would not.

**Use Trash instead** — it is the working recovery path and always was:

```bash
bk trash list
bk trash restore issue:42
```

**If your binary is older than 1.12.0 it still HAS `bk undo`**, and running it now
gets this — not a crash, and not a wall of HTML:

```
$ bk undo --count 1 --yes
error: `bk undo` was removed in 1.12.0. It never recorded anything and could not
       undo — the transaction log it read was never written. (410)
hint:  deletes are restorable: `bk trash list`, then `bk trash restore <type>:<#number>`
```

`GET`/`POST /api/undo` return **410 Gone with a `suggestion`** rather than
disappearing. Deleting the route outright handed installed binaries Next's HTML
404 page — roughly 2KB of markup on stderr, no code, no hint, nothing an agent
could act on. That was caught by running the published 1.11.0 binary against the
new build before promoting it, and it is the same treatment `/api/openapi.json`
has had since 2026-08-03. Upgrading is still the right move; you are not stuck
either way.

On 1.12.0 itself, `bk undo` is gone from the command tree and
`limits.undo_max_count` no longer appears in `bk meta`. The empty
`platform.transaction_log` table is left in place for now; dropping it is a
separate change.

The per-issue activity view lost its "changes" half, which read the same empty
table and has returned nothing for its entire existence. Real history is
`platform.events`, which the activity feed and inbox already read.

### Not breaking: `platform.events.app` and `platform.uploads.app` are now `NOT NULL`

The contract half of the expand → migrate → contract started in migrations 0035
and 0036. No client-visible change: all current code sets `app`, which is exactly
the precondition that was verified before tightening (0 NULLs across 3,630 event
rows and 105 upload rows, and neither `recordEvent` nor `recordUpload` lets a
call site omit it). It only matters if you roll the deployment back to a
pre-Phase-6 build — see `docs/sql/phase8-app-not-null-rollback.sql`.

---

## 2026-08-05 — Blob cleanup works across deployments: a shared, database-maintained reference index

**Not breaking.** Nothing you run changes shape. One new super-admin command,
one behaviour that stops being a dead end before it ever becomes one.

**The problem this fixes.** The previous entry made blob deletion ask *every*
enabled app whether it still references a file, and refuse if any app could not
answer. That is the right safety property and it was, as shipped, unsatisfiable:
each app's deployment connects as its own Postgres role and cannot read another
app's tables, so it could never obtain the proof. The moment a second app had
been registered, **blob deletion would have stopped working entirely** — correctly
and uselessly. It never bit anyone only because exactly one app exists.

**What changed.**

- **`platform.blob_references`** — a shared index of `(url, app, source_type,
  source_id, workspace_id)`. Any deployment can read the whole picture without
  reading any app's tables, so "does anything still point at this file?" is now
  answerable across deployments.
- **It is maintained by Postgres triggers, not by application code.** Every
  content table that can hold a file URL carries a trigger that recomputes that
  row's references on insert, update and delete. This is the important detail: an
  index maintained by application writes can be forgotten by a new write path,
  and a *missing* row means a file still in use is reported as an orphan and
  deleted. Triggers move the obligation from every writer to the schema.
- **`platform.apps.maintains_blob_index`** — set by an app's own migration, in
  the same file that installs its triggers. An enabled app is answerable either
  because its scanner runs in this process (scanned live, and still preferred) or
  because it has declared the index. Neither is still an **error**, never a
  "no references": the gate did not loosen, it gained a second admissible proof.
- **`bk super-admin blob-drift`** (`GET`/`POST /api/super-admin/blob-drift`) —
  re-derives the index from a live scan and reports the difference, the sibling of
  `bk super-admin entity-drift`. `--repair` fixes it; `--workspace` narrows it.
  Read a repair that changes something as a bug report. Two counts are kept apart
  deliberately: `missing` is a file another deployment could delete while it is in
  use, `orphaned` is only leaked bytes.
- **App roles hold `SELECT` on the index and nothing more.** The triggers are
  `SECURITY DEFINER`, so no app can forge or erase another app's references. If
  you add an app role, `docs/sql/app-role.sql` step 5b is not optional.

**Also fixed along the way.** `issues.attachments.workspace_id` had been NULL on
every row since the column was added, which meant the Storage page and
`bk storage list` never attributed attachment references to a workspace. It is
backfilled from the parent issue. The delete gate was never affected — it matches
on URL alone — but the reconciler would have had a silent blind spot over a fifth
of the index, so `blob-drift` now also counts rows no workspace pass can reach and
reports them separately from drift.

**How to adapt.** Nothing, unless you are adding an app: then run its migration's
trigger installation and set `maintains_blob_index`, or blob deletion in every
other deployment will refuse (safely) until you do. `docs/adding-an-app.md` has
the ordered steps.

---

## 2026-08-05 — Uploads are attributed to an app, and cleanup asks every app before deleting

**What changed.**

- **Every stored file now records which app uploaded it.** `platform.uploads`
  gained an `app` column, backfilled to `issues` for everything that already
  existed. `bk storage list` shows it in a new **APP** column, and
  `--app <slug>` (`?app=` on `GET /api/workspaces/{ws}/storage`) narrows the list
  to one app's files.
- **New uploads are written under an app prefix:** `<app>/<workspace>/<file>` —
  e.g. `issues/acme/1712-report.pdf`. **Existing files were not moved**, and never
  will be: every url is absolute and the ledger records where each file actually
  lives, so a path is a historical fact, not something to derive.
- **Reference counting is app-aware.** Whether a file may be deleted used to be
  answered by scanning this app's tables. It is now answered by every app that
  has registered a reference scanner, and a file is deletable only when **no
  app** references it.

**Why it matters to you.** Deleting is the operation that got safer, and in one
direction only: the checks that refuse a delete were added to, never relaxed.
`bk storage rm` and the automatic sweep behind a comment hard-delete or a Trash
purge now refuse whenever the answer cannot be *proven* — including when an app
is registered but its scanner is unreachable. A refusal you did not expect means
"could not prove this file is unused", not "the file is in use".

**How to adapt.**

- Nothing is required. `bk storage list` gains a column; existing JSON fields are
  unchanged and additive (`app` on each file, `app` on each entry of
  `references`).
- If you parse the table output of `bk storage list` by column position, the new
  APP column sits between ID and FILENAME. Use `--json` if that matters.
- `bk storage list --app issues` is the filtered form. Usage totals stay
  workspace-wide whichever filter is applied — storage is shared, and a total
  that shrank with a filter would read as free space.
- Files uploaded before this release keep their flat pathnames and are attributed
  by the ledger, so `--app issues` includes them.
- **Older `bk` binaries keep uploading normally.** The CLI uploads client-direct
  too, and a client that predates the prefix convention sends a bare filename;
  the server accepts it and the file lands flat at the store root, still
  attributed to `issues` in the ledger. Nothing about uploading requires an
  upgrade. From the next CLI release, `bk` reads `app` and `workspace` from
  `GET /api/upload` and sends the prefixed path itself.

---

## 2026-08-05 — **FIX:** `bk trash restore` reported success for a ref that did not exist

**What changed.** `POST /api/workspaces/{ws}/trash/restore` now answers **404
`not_in_trash`** when a requested ref is not in that workspace's Trash. It used to
answer `200 { count: 1 }` — so `bk trash restore` printed `restored 1 item(s)` and
exited **0** while restoring nothing.

**Why it mattered more than it looks.** The ref you pass is the one `bk trash
list` prints in its REF column, which is *not* the `#number` used everywhere else.
Pass the `#number` by mistake — the natural thing to do — and you got a
confident success for a no-op. An id belonging to a **different workspace** got
the same answer. An agent branching on exit code and count was told the item was
back while it was still binned, and nothing anywhere reported otherwise. Found
against production while verifying Phase 6.

**Cause,** for anyone reading the diff: one `Set` was doing three jobs — recursion
guard, "this parent is active so children may re-link", and the report of what
came back — and the does-not-exist branch added to all three. It is now two sets,
and only the one holding rows actually taken out of the bin is reported.

**How to adapt.**

- A bad ref is now **exit 5** with the ref named and a `hint:` pointing at
  `bk trash list`. If you were treating a non-zero count as proof, you can now
  treat the exit code as proof.
- **A rejected restore is atomic** — pass one bad ref alongside good ones and
  nothing is restored, rather than a partial restore reported as complete.
- **The count is now what was actually restored.** Restoring something that was
  never binned is a no-op that counts **zero** and still succeeds; previously it
  counted one.
- `purge` and `empty` were never affected: `purgeOne` already reported only what
  it removed.

Not fixed here, and carried forward: `bk trash` refs are internal database ids
(`issue:905`), which is the one place the platform exposes a work-item serial
instead of its `#number`. That is a design decision — map them, or document Trash
as a deliberate exception — not a one-function fix.

---

## 2026-08-05 — Cross-app entities: URNs, `bk search`, `bk link`, and a merged `bk activity`

**What changed.** Everything in every app is now addressable by one string, and
three new capabilities fall out of that. This is additive — nothing that worked
before behaves differently.

### URNs

```
bc:<app>:<workspace-slug>/<entity-type>/<number>
bc:issues:kali-sa/issue/482
```

`<number>` is the **workspace #number** — the `#N` shown in the app — never the
internal database id, consistent with every other surface. `<workspace-slug>` is
the slug, so a URN is readable and its tenant is visible without a lookup.

Do not assemble a URN from guessed parts. Get one from `bk search`, or from the
new `subject_urn` field on an activity entry.

### `bk search <query>` — federated search

```bash
bk search auth                       # titles matching "auth", any app
bk search "#482"                     # by workspace #number
bk search acme --type issue,project --json
bk search draft --include-deleted    # include the recycle bin
```

Searches **titles and #numbers**, across every app, in the active workspace
(`--ws` targets another). It reads the shared entity index, not each app's own
tables — which is what makes it a single query rather than a fan-out. To search
descriptions or filter by status/assignee/label, keep using the app's own listing
(`bk issues issue list --search`).

Route: `GET /api/workspaces/{ws}/search`.

### `bk link` — typed relations between two URNs

```bash
bk link create bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
bk link list bc:issues:acme/issue/12
bk link rm bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
```

Links are **directed and stored once**: `A blocks B` shows as an outgoing link on
A and an incoming one on B, with no inverse row to keep in step. Run `bk meta`
for the accepted relation names — they are served under `links.relations` and can
change without a CLI release, so they are not baked into the binary or the guide.

Behaviour worth knowing before you script against it:

- Both ends must exist and must be in the **same workspace**. A cross-workspace
  link is refused (400 `cross_workspace_link`); an unknown end is 404
  `entity_not_found` and names which end was missing.
- Creating the same link twice **succeeds** and reports `created: false`.
  Retrying after a timeout is safe.
- `bk link rm` needs from, to *and* `--rel`: direction is part of the identity.
- **Binned** items keep their links (flagged as in the trash) and restore with
  them. **Purged** items take their links with them. A **workspace rename**
  rewrites every URN and the links follow — but a URN you cached before the
  rename stops resolving, so re-fetch rather than storing them long-term.

Routes: `POST`, `GET`, `DELETE /api/workspaces/{ws}/links`.

### `bk activity` is now a cross-app feed

Every event carries the **app that produced it** and, where its subject is an
addressable entity, that entity's **`subject_urn`**. Three new flags:

```bash
bk activity --since 24h                              # 30m | 24h | 7d
bk activity --app issues
bk activity --subject bc:issues:kali-sa/issue/482    # one thing's full history
```

`--since` and `from=` are mutually exclusive (400 `since_and_from`). Entries about
members, invitations, labels and comments carry no `subject_urn` — those are real
events about things with no cross-app address.

Also fixed here: `?entity_type=workspace_app` and the five `app_*` actions added
in Phase 4 were never added to the activity filter's allow-list, and an
unrecognised value **dropped the filter silently** rather than rejecting it — so
`?action=app_access_granted` returned the whole feed. Both lists are now complete.

### `bk meta` additions

- `links.relations` — the relation names the server accepts, plus `urn_format`
  and a worked `urn_example`.
- `apps.issues.entity_types` — the entity types this app publishes, i.e. what
  `bk search --type` and the `<entity-type>` URN segment accept here.

Nothing was removed or renamed.

### `bk super-admin entity-drift` — the reconciliation job

The entity index is a **projection**: each app's own tables are the truth, and
every write updates both in one transaction. This command re-derives the whole
projection and reports the difference — `missing` (a source row with no entry),
`stale` (title, url or trashed state disagree), `orphaned` (an entry with no
source row). `--repair` fixes all three; `--workspace <slug>` narrows the scope.

Read a repair that changes something as a **bug report**, not as maintenance.

Routes: `GET` / `POST /api/super-admin/entity-drift` (super admin only).

### Schema

Migration `0035` — purely additive. New `platform.entities` and `platform.links`;
`platform.events` gains nullable `app` and `subject_urn`, both backfilled.
`events.app` is nullable rather than `NOT NULL DEFAULT 'issues'` on purpose: the
migration lands before the deploy that writes it, so old code is still inserting
rows during that window, and defaulting a platform table to one app's name is the
coupling this work exists to remove. It tightens to `NOT NULL` in a later release
once no deployed code can write a NULL.

**How to adapt.** Nothing is required. If you have been pasting dashboard URLs
into descriptions to express "this relates to that", `bk link` is the replacement
that survives renames and is queryable.

---

## 2026-08-04 — **BREAKING (CLI):** app commands moved behind their app name

**What changed.** Every command that belongs to an *app* now sits behind that
app's name. Platform commands — the ones that mean the same thing whichever app
you are working in — stay exactly where they were.

| Before | Now |
|---|---|
| `bk issue …` | `bk issues issue …` |
| `bk task …` | `bk issues task …` |
| `bk project …` | `bk issues project …` |
| `bk move …` / `bk copy …` | `bk issues move …` / `bk issues copy …` |
| `bk analytics …` | `bk issues analytics …` |

Unchanged and still bare: `login`, `meta`, `guide`, `changelog`, `workspace`,
`app`, `label`, `member`, `invite`, `token`, `profile`, `inbox`, `upload`,
`storage`, `trash`, `undo`, `activity`, `user`, `super-admin`, `skill`,
`version`.

**Nothing breaks today.** Every old spelling still runs, takes the same flags and
prints the same output. It writes one extra line to **stderr** naming the
replacement:

```
$ bk issue list --json
deprecated: use 'bk issues issue list'
{ "data": [ … ] }
```

stdout is untouched, so piping into `jq` keeps working. **These aliases are
removed two minor releases from now (1.12.0).** After that the old spelling exits
non-zero and the error names the new one.

**How to adapt.** Insert `issues` after `bk` for the five nouns in the table.
That is the whole migration. `bk --help` lists platform verbs first, then one
line per app; `bk issues --help` lists just that app's nouns.

**Why now, with one app.** Every app eventually wants a `report`, a `note`, a
`status`. `bk sales deal create` says which app it is and `bk deal create` does
not. Doing this with one app is a rename; doing it with three is a migration with
a collision to resolve first.

**`CLI_MIN_VERSION` was not raised.** Older binaries keep working — the floor
moves a release later, once adoption is visible, so nobody is locked out with
nothing to upgrade to.

---

## 2026-08-04 — `bk guide` topics are now section-qualified, and `--app` scopes them

**What changed.** Guide topics are grouped one directory per section:
`platform/…` for what is true in every app, `<app>/…` for one app's behaviour.
Slugs carry the section:

```
platform/overview   platform/install-auth   platform/workspaces
platform/rich-text  platform/files          platform/storage
platform/output-and-exit-codes              platform/undo-and-trash
platform/encoding   platform/pitfalls       platform/staying-current
issues/items        issues/move-copy        issues/pitfalls
```

`bk guide` prints platform first, then each app under its own heading.
`bk guide --app issues` prints one app; `bk guide --app platform` prints the
shared half. `bk guide --list` and `--json` gain a `section` field per topic.

**Not breaking.** A bare slug still resolves while it is unambiguous, so
`bk guide files` and `bk guide items` keep working — every skill written before
today says exactly that, and breaking those in the same release that renames the
commands would leave an agent unable to read the topic explaining the rename.
`pitfalls` now exists in two sections, so the bare form there reports the
ambiguity and names both candidates (`platform/pitfalls`, `issues/pitfalls`)
rather than guessing. It exits 2.

**Also:** `issues/pitfalls` is new — the mistakes specific to this app, split out
of the general list, which keeps the ones that bite everywhere.

---

## 2026-08-04 — The changelog is one file per app, merged into one feed

**What changed.** `docs/api-changelog.md` became `docs/changelog/platform.md` +
`docs/changelog/issues.md`. `bk changelog` and `GET /api/changelog` merge every
file by date into a single newest-first feed, and each entry now carries which
app it belongs to.

**Response shape — additive, nothing removed.** Each entry gains `app`:

```jsonc
{ "date": "2026-08-04", "app": "platform", "title": "…", "markdown": "…", "html": "…" }
```

New: `bk changelog --app issues` (or `platform`) filters, and
`GET /api/changelog?app=issues` does the same. `?format=markdown` returns the
merged document with an app tag per entry.

**History was moved, not rewritten.** Every pre-split entry is in `issues.md`,
verbatim and un-re-dated, including the many that describe platform concerns.
Read the unfiltered feed for anything before today.

**Fixed while splitting:** the parser treated a `## ` line *inside a fenced code
block* as the start of a new entry, so `bk changelog` had been serving a phantom
undated entry titled "Our team's rules            <- yours; preserved forever"
— lifted out of a SKILL.md example in the 2026-08-03 entry. Entry splitting is
now fence-aware, and a test asserts every entry has a real date.

---

## 2026-08-04 — `bk meta` now carries each app's vocabulary under `apps.<slug>`

**What changed.** The vocabulary, limits and media rules `bk meta` returns are
now also published *inside* the app they belong to:

```jsonc
{
  "user": …, "workspaces": […], "cli": …,
  "current_app": "issues",
  "apps": {
    "issues": {
      "slug": "issues", "name": "Blackcode Issues", "is_current": true,
      "base_url": "https://issues.blackcode.ch",
      "workspaces": ["kali-sa", …],
      "vocabulary": { "issue_statuses": […], "issue_priorities": […],
                      "project_statuses": […], "project_priorities": […],
                      "project_update_health": […] },
      "limits": { … },
      "media":  { … }
    }
  },

  // deprecated — identical values, removed in 1.12.0
  "vocabulary": { … }, "limits": { … }, "media": { … }
}
```

**The old top-level keys are still there and still correct.** `vocabulary`,
`limits` and `media` remain at the root for **two minor releases**, then go
away. They are served from the same objects as the nested copies, so the two
cannot disagree during the overlap. Move your reads to `apps.issues.*` now.

**Only the current app's entry carries a vocabulary,** and that is deliberate.
This server is the issues app; it knows its own enums and has no business
publishing another app's. Read a different app's vocabulary from its own
`/api/meta` — that is what `base_url` is for. A merged registry here would be a
hand-maintained copy of facts owned elsewhere, which is the thing that drifted
and got deleted on 2026-08-03.

**Why.** Two apps must never share one top-level enum list — an agent has to be
structurally unable to send a sales stage to the issue tracker. `apps` is an
object keyed by slug, so this was additive: a second app appears as a new key,
and nothing an agent already parses changes shape.

`bk meta`'s table view gains a COMMANDS column naming each app's command prefix,
and points at `apps.<slug>` on stderr; `bk meta --json` prints the server's
response verbatim, so the nested block is visible without a CLI upgrade.

---

## 2026-08-04 — Invitation tokens starting with `-` are now accepted (and no longer minted)

**The bug.** Invitation tokens are base64url, whose alphabet includes `-`. Any
token that began with one could not be redeemed: `bk invite accept -Jx7…` made
the CLI read the token as a flag and fail with `unknown shorthand flag: 'J'`
before the request was ever sent. Roughly **1 invitation in 32** was affected,
and the failure looked like a bad token rather than a CLI bug.

**Fixed at both ends.** `bk invite accept` and `bk invite decline` now read their
argument literally — no `--` separator or quoting needed — and the server no
longer generates a token starting with `-`. Both were necessary: the CLI fix
serves tokens already sitting in inboxes, and the server fix protects the
binaries already installed, which cannot be upgraded retroactively.

**No action needed.** Existing pending invitations are unaffected and remain
valid; a token that failed before will now work with `bk` 1.10.0 or later.

---

## 2026-08-04 — A server `suggestion` is no longer printed twice

**What changed.** When a request failed, the CLI printed the server's
`suggestion` on both the `error:` line and the `hint:` line:

```
error: you do not have access to the issues app here (403) — ask a workspace owner…
hint: ask a workspace owner…
```

Now `error:` states what failed and `hint:` states what to do about it — one
fact, one line. Nothing was removed: every suggestion still reaches stderr,
once. `details` (a field-level validation reason) stays on the `error:` line,
because it is part of what failed rather than advice about it.

**If you parse stderr,** match the `hint:` prefix for recovery advice. This
became routine traffic when per-app access shipped on 2026-08-04, which is what
surfaced it.

---
