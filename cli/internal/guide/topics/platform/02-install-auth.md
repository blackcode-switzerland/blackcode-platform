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

**`--token` is a switch, not a value.** It reads the token from **stdin**, so
the secret never enters your shell history, your process list or a CI log.
`--token=<value>` and `--token <value>` both fail on purpose, and both print the
piped form above.

### Windows

The npm shims are `bk.ps1` (PowerShell) and `bk.cmd` (cmd.exe). PowerShell's
default execution policy blocks unsigned `.ps1` scripts, which stops both
`npm install -g` and `bk` itself with *"cannot be loaded because running scripts
is disabled on this system"*. Two ways through:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned    # allow the shims, once
```

```cmd
cmd.exe /c npm install -g @blackcode_sa/bc-issues      # or bypass PowerShell
cmd.exe /c bk whoami
```

If an install aborts partway, a second attempt can fail with `EBUSY` on the bin
shim — the first attempt still holds it. Close the shell and retry.

**One login covers every app.** `--server` may name ANY deployment — every app
serves the browser authorize page — and the token works on all of them. Logging
in also LEARNS the app address book: which server answers for which app, read
from the platform itself. The app you logged into becomes your **home app**, and
`bk app list` shows the rest. If a command later says it has no server for an
app, `bk meta` re-learns the book; see `bk guide platform/apps`.

**The host you reached WINS for the app you reached it at**, over the address
the platform publishes. That is what keeps a preview deployment or a
self-hosted instance from redirecting itself somewhere you never authenticated.
The cost is that a non-canonical address is *sticky*: it is what every
subsequent request uses, and it is what any link you build from your session
carries.

**A redirect settles it automatically.** If the host you asked redirects
somewhere else, that host has named its own canonical address, and `bk login`
and `bk meta` adopt it — nothing to type, no notice. That is why the rule is
safe: a preview deployment does not redirect, so it keeps the address you
authenticated against.

When the two disagree and nothing redirects, `bk login` and `bk meta` say so and
print the published address. Switching is one command:

```bash
bk login --server <the address the notice printed>
```

Other apps are always taken from the registry — only the one you logged into
can disagree.

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
