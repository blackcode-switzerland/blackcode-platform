# bk — blackcode-issues CLI

The CLI for blackcode issues. Designed for both humans at a terminal and LLM
agents driving the platform end-to-end.

> **This is the only supported interface.** The HTTP routes behind it are private
> plumbing with no public contract — there is no OpenAPI spec, and calling them
> directly is unsupported. `bk` handles auth, JSON-body encoding, pagination,
> file upload+embed and stable exit codes, and it carries its own documentation.
>
> **Agents start here:**
>
> ```sh
> npm install -g @blackcode_sa/bc-issues
> bk login
> bk skill install     # writes an agent skill file that stays current
> bk guide             # the complete usage guide, embedded in this binary
> ```
>
> `bk guide` works offline and always describes the exact version you are
> running. `bk meta` supplies everything that can change without a release —
> vocabularies, limits, your workspaces. Neither can go stale.

This README is the build/quick-reference for maintainers. For the full command
reference, conventions, and internals, see [`../docs/cli.md`](../docs/cli.md).

## Build

```sh
cd cli
go build -o bk ./cmd/bk        # or: make build
```

The binary lands at `cli/bk`. Drop it on your `$PATH` if you like. `make install`
installs it to `$GOBIN` (default `~/go/bin`); `make all` / `make dist`
cross-compile into `dist/`.

## First-time login

```sh
./bk login --server http://localhost:3000
```

`bk login` opens your browser to `/cli/authorize`, captures the minted token via
a loopback HTTP server, validates it against `/api/me`, and saves
credentials to `~/.config/bk/config.json` on macOS/Linux, or
`C:\Users\<you>\.config\bk\config.json` on Windows (mode 0600 where the OS has
one). `bk meta` prints the exact path this binary uses, under `routing.note` —
`config.DisplayPath()` is the one function that answers this, and no help string
may spell the path itself. Revoke any time from **Settings → API Tokens**.

For headless / CI / agent use, paste a token from stdin instead:

```sh
echo "$MY_TOKEN" | ./bk login --server "$SERVER_URL" --token
```

There are no `BK_SERVER` / `BK_TOKEN` env vars — the servers and token live in the
config file, chosen at login time.

Login also **learns the app address book** (2.0.0): each app's server, read from
the platform's own `/api/meta`. `--server` may name any app — the token works on
all of them, and whichever one you log into becomes the *home app*.

```sh
bk app list                   # every app: enabled here, its server, does it answer
bk app use sales              # move the home app (where the bare verbs go)
bk --app-server sales meta    # …or redirect one invocation
```

`bk <app> …` always talks to that app's server, whatever the home app is. An app
with no known address fails naming `bk meta`; it is never silently sent
somewhere else.

## Active workspace

An app's records are scoped to a workspace, and **each app remembers its own** —
they are separate tables since 2026-08-10, so one app's active workspace says
nothing about another's:

```sh
./bk issues workspace list          # active row marked with *
./bk issues workspace use acme      # by slug or numeric id
./bk sales  workspace use acme      # a DIFFERENT setting, same command shape
```

Workspace-scoped groups (`label`, `member`, `invite`, `trash`, …) are app-owned
and need that app's active workspace. Paths accept the slug or the numeric id.

## Output formats

Every read command supports a global output flag, so you can pipe into `jq`,
`yq`, scripts, or feed structured output back into another LLM call.

```
-o, --output table|json|yaml|yml   (default: table)
    --json                         shortcut for -o json
    --yaml / --yml                 shortcut for -o yaml
```

```sh
./bk issues project list --json | jq '.[].name'
./bk issues issue list --project 6 --yaml > issues.yaml
```

## Exit codes

Stable across releases so scripts/agents can branch on outcome:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | generic error |
| 2 | bad usage (missing flag, invalid id, …) |
| 3 | not authenticated (401, or no config) |
| 4 | permission denied (403) |
| 5 | not found (404) |
| 6 | validation error (400/422) |
| 7 | user aborted at a confirm prompt |
| 8 | this binary is below `CLI_MIN_VERSION` — upgrade, nothing else will work |

**409 exits 2, not 6.** A conflict is the server refusing a well-formed request
on content grounds, which is a usage problem for the caller — `classify()` in
`cmd/bk/main.go` owns the table and says why.

## Confirmations and non-interactive use

Destructive commands prompt before acting — `bk issues project delete`,
`bk issues issue delete`, `bk sales prospect delete` and the rest. (They are
app-owned since 2026-08-10; `bk undo` was removed entirely.) Skip the prompt
with:

- `--yes` / `-y` on the command,
- the env var `BK_NO_PROMPT=1` (set this for agents/CI), or
- non-TTY stdin (the prompt is auto-skipped when not running in a terminal).

## Text input from stdin or a file

Long bodies (descriptions, comments) accept three forms so agents can pipe
markdown without quoting it (the `*-file` form wins if both are given):

- `--description "literal string"` / `--body "literal"`
- `--description -` / `--body -` (read from stdin)
- `--description-file FILE` / `--body-file FILE`

```sh
printf '## Plan\n- item\n' | ./bk issues issue create --project 6 --title "..." --description -
./bk issues issue comment 42 --body-file ./review.md
```

## Attaching files

`--file` uploads a local file and embeds it **inline** in the description/comment
body — images preview, video/audio get players, everything else gets a download
card (the same result as web drag-and-drop). It's repeatable and works on
`bk issues issue|task|project create` and `bk issues issue comment`:

```sh
./bk issues issue create --project 6 --title "Crash" --file ./screenshot.png --file ./trace.log
./bk issues issue comment 42 --body "see clip" --file ./demo.mp4
./bk issues project create --name "Q3 brief" --file ./brief.pdf
```

`--file` *appends* to the body. For a **structured** doc (files under specific
headings), reference local file paths directly in `--description` /
`--description-file` (or `--body`) and the CLI uploads + rewrites them in place:

```sh
cat > doc.md <<'MD'
## Screenshot
![](./shot.png)
## Recording
[](<~/clips/screen recording (1).mov>)
MD
./bk issues issue create --project 6 --title "Bug" --description-file doc.md
```

A path is only uploaded when it has no `http(s)://` scheme and exists on disk;
empty link text is auto-filled from the filename. **Paths with spaces or
parentheses must be angle-bracketed** — `[](</abs/my file (2).mp4>)` — because
plain Markdown stops the link destination at the first `)`.

Need just a url (e.g. for scripting)? `bk <app> upload`:

```sh
URL=$(./bk issues upload ./diagram.png --json | jq -r '.[0].url')
```

`bk <app> upload` and the local-path method create **no** sidebar attachment record.
`bk issue attach` is the opposite: it adds a file to the issue's **attachments
list** (sidebar), not the body.
## What is NOT in this file

**The command reference used to be here — about 200 lines of it — and on
2026-08-11 an audit found ~65 of its spellings had been wrong since 2026-08-10,
when ten verbs moved behind their app name.** It also carried a permissions
table, a pagination note and an attachment MIME list, each of which had drifted
from the thing it described.

It was not corrected. It was **deleted**, because a second copy of a reference is
a copy that goes stale, and this repo already has two that cannot:

| You want | Read |
|---|---|
| what the commands are, right now | **`bk guide`** — embedded in the binary, so it describes the exact version you are running |
| vocabularies, limits, your workspaces | **`bk meta`** — served live; changes without a release |
| CLI internals, conventions, release | [`../docs/cli.md`](../docs/cli.md) |
| what changed, and when | `bk changelog`, or `docs/changelog/` |

**Do not reintroduce a command list here.** If a maintainer needs one, it belongs
in `bk guide`, where a test already fails the build if a topic hardcodes a value
that `bk meta` should serve.

## Environment

- `BK_CONFIG_DIR` — override the config directory (default `~/.config/bk`, or
  `%USERPROFILE%\.config\bk` on Windows).
  **Set this in any automated context**: the default points at whatever server
  the developer last logged into, which is usually production.
- `BK_NO_PROMPT=1` — skip every interactive confirmation prompt. Note that this
  makes `Confirm()` auto-approve, which is why irreversible commands require the
  target repeated back (`--confirm <slug>`) rather than a yes/no.
- `BK_CLI_LATEST` / `BK_CLI_MIN` — override the advertised and minimum versions
  without a redeploy.
