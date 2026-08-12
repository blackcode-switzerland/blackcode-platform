# Output, exit codes & scripting

## Always ask for JSON

```bash
bk issues issue list --json
bk issues issue list -o json      # same
bk issues issue list --yaml       # or -o yaml / --yml
```

Table output is for humans and its layout is not a contract. Parse `--json`.

Global flags, available on every command:

| Flag | Effect |
|---|---|
| `--json` / `--yaml` / `--yml` / `-o FORMAT` | output format (default `table`) |
| `--ws <slug\|id>` | target one command at another workspace |
| `-v` / `--verbose` | trace the whole run to stderr (or `BK_DEBUG=1`) |

## `-v` — what it shows

```
· bk <version> — config <path>          which config file this run is reading
· command: bk issues issue edit         the command cobra resolved
· app issues → https://…  [pinned by the `bk issues …` command group]
· workspace demo-ws  [--ws, this command only]
→ PATCH https://…/api/workspaces/demo-ws/issues/5
  body: {"title":"hello there"}         what was actually sent
← 400 Bad Request (16 bytes, 41ms)
  {"error":"nope"}
```

The first four lines print for **every** command, including the ones that make no
request at all — so `bk -v app use`, `bk -v guide` and a command that fails before
it reaches the network still say which config and which routing they used.

Reach for it when an answer is *wrong* rather than absent: the routing lines name
which app, which server and which workspace, and where each came from. A command
run against a workspace you did not mean returns 200 and real data.

**Headers are never printed, at any verbosity.** The `Authorization` header
carries your token and this output goes into bug reports. A non-JSON request body
(an upload) is described rather than dumped.

## Shapes

A **single-item** command prints the bare object.

A **list** command prints one of two shapes, and you should not assume which:

- a **bare JSON array** — the common case. The CLI unwraps the server's envelope
  when there is nothing else in it. `bk issues label list`,
  `bk issues project list`, `bk issues workspace list`, `bk <app> trash list`.
- **`{ "data": [ … ], "next_cursor": <id|null> }`** — when the command carries
  something alongside the rows. `bk issues issue list` (which also adds
  `"total"`) and `bk issues inbox list`.

Handle both: `jq 'if type == "array" then . else .data end'`. Run the command
once with `--json` to see which you are getting; it does not change under you.

**These commands paginate**, and no others: `bk <app> activity`,
`bk super-admin errors list`, `bk sales prospect list`, `bk sales meeting list`,
`bk sales comm list`. They are exactly the commands with `--limit` / `--cursor`
— everything else returns the whole list in one response. Page size defaults and
caps are in `bk meta` under `limits.page_size_default` / `limits.page_size_max`.

In table mode those two print `next page: --cursor=<id>` to **stderr** when more
rows remain, so `--json` stdout stays clean.

## Exit codes — branch on these, not on stderr text

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | generic / runtime error |
| 2 | bad usage (missing required flag, invalid id, wrong number of arguments, unknown flag or command, **and a 409 conflict**) |
| 3 | not authenticated (401, or no config) |
| 4 | permission denied (403) |
| 5 | not found (404) |
| 6 | validation error (400 / 422) |
| 7 | user aborted (declined a confirmation prompt) |
| 8 | this `bk` is below the server's minimum supported version — upgrade required |
| 9 | update available (`bk skill check` / `bk skill sync` found something behind) |

A mistyped command or subcommand is always an error, never a silent success —
`bk issues workspace notacmd` exits 2, it does not print help and exit 0.

**A conflict exits 2, and the same condition always exits the same code.** When
you pass a `--confirm` value that does not name the record, some commands catch
it in the binary before sending anything and some let the server answer 409.
Both exit 2, so one recovery branch covers both. The same applies to a label
name already taken and an invitation already accepted or expired: the request
was well formed, the state disagrees, and retrying it unchanged will not help.

## stdout vs stderr

Data goes to **stdout**. Everything else — errors, `hint:` lines, update
notices, pagination breadcrumbs — goes to **stderr**. `--json` stdout is always
parseable, whatever else the command printed.

## When something fails

`bk` prints `error: …` and, when the failure is recoverable, a `hint:` line
naming the exact fix. Read the hint before retrying — for a renamed flag it tells
you the new spelling; for drift it tells you to run `bk skill sync`.

## Scripting checklist

- `export BK_NO_PROMPT=1`
- Pick the workspace first (`bk <app> workspace use …` or `--ws`)
- `--json` for everything you parse
- Branch on exit codes
- Use `bk issues move` / `bk issues copy` to relocate items — never re-create by hand
- Discover flags with `bk <group> <cmd> --help` before calling

```bash
bk issues issue list --project 1 --status todo --json \
  | jq -r '.data[].id' \
  | xargs -n1 -I{} bk issues issue edit {} --status in_progress --assignee me
```

Related commands: every command; see `bk issues activity` and `bk super-admin errors list` for pagination
