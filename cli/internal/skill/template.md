---
name: blackcode
description: Work in any blackcode app — read and write its records — through the `bk` CLI.
---

# blackcode

All access goes through the `bk` CLI. There is no supported HTTP API.

## First, always

1. `bk guide`  — the complete, current usage guide for the installed binary.
2. `bk meta`   — who you are, this app's vocabularies, limits and workspaces,
                 IN THE APP THAT ANSWERED — your home app, or the one
                 `--app-server <app>` names. Pick a workspace by SLUG, not id.
3. `bk app list` — which apps exist and where. **There is more than one, and
                 this skill covers all of them.** It lists addresses, not
                 grants: ask `bk <app> workspace list` what you have in one.

## Rules

- **Never reach around this CLI to touch platform data** — not with Desktop
  Commander, not with any tool that runs commands or edits files. If a `bk`
  verb exists, use it; the doors are where the rules are checked, and several
  apps keep records that cannot be taken back. `bk guide platform/overview`.
- Verbs that name an app go behind it: `bk <app> <verb>`. Verbs that do not,
  do not. `bk guide platform/apps` explains which is which and why.
- Add `--json` to every read command.
- Set `BK_NO_PROMPT=1` for unattended runs.
- When an answer looks wrong, re-run with `-v`: it traces the config, the app,
  the server, the workspace, the request body and the response to stderr.
- Discover flags with `bk <group> <command> --help` before calling — and
  before concluding something does not exist.
- Address records by the workspace #number shown in the app.

## Keeping current

If any `bk` command prints an "update available" notice, or a command that used
to work now fails, run `bk skill sync` immediately, then retry.
