# Install & authenticate

## Install

```bash
npm install -g @blackcode_sa/bc-issues     # installs the `bk` binary
npm install -g @blackcode_sa/bc-issues@latest   # update later
```

A small npm launcher downloads the prebuilt binary for your platform
(macOS Intel/Apple Silicon, Linux amd64/arm64, Windows x64/arm64 as `bk.exe`).
Node 18+ required for the launcher.

## Authenticate

```bash
bk login                                   # opens a browser, captures a token
bk login --server https://your-host        # self-hosted / non-default server
echo "$MY_TOKEN" | bk login --token        # headless: read a token from stdin
```

`bk login` stores the token in `~/.config/bk/config.json` (mode 0600) and sends
it on every request. Check it with `bk whoami`; clear it with `bk logout`.

**One login covers every app.** `--server` may name ANY deployment — every app
serves the browser authorize page — and the token works on all of them. Logging
in also LEARNS the app address book: which server answers for which app, read
from the platform itself. The app you logged into becomes your **home app**, and
`bk app list` shows the rest. If a command later says it has no server for an
app, `bk meta` re-learns the book; see `bk guide platform/apps`.

**Long-lived tokens** are minted in the web UI at Settings → API Tokens. They are
shown **once** at creation — the server keeps only a hash. Token creation and
revocation are **session-only**: you cannot mint or revoke a token using a token.
That is deliberate — a leaked token can't mint more.

## Unattended runs

```bash
export BK_NO_PROMPT=1     # skip every "are you sure?" confirmation
```

Confirmation is also skipped automatically when stdin is not a TTY, and
per-command with `--yes` / `-y`.

## When auth fails

- Exit code **3** means not authenticated (401, or no config at all).
- `bk` prints a `hint:` line to stderr telling you what to run. Read it.

Related commands: `bk login`, `bk logout`, `bk whoami`, `bk token list|create|delete`, `bk app list|use`, `bk meta`
