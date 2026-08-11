# Staying current

The product evolves. When a command that used to work now fails, the cause is
almost always drift — your skill, or your binary, is behind.

## The one command

```bash
bk skill sync
```

It does both halves of the job:

1. Checks whether a newer binary exists. If so it prints the exact upgrade
   command and exits **9** — it will not self-mutate an npm global install.
2. If the binary is current, it rewrites your agent skill file from the template
   embedded in this binary and exits **0**.

So: run it, and if you get exit 9, run the command it printed, then run it again.

```bash
bk skill check      # exit 0 = current, exit 9 = update available
bk skill path       # where the skill file lives
```

## Your own additions are safe

`bk` writes only between these two markers in the skill file:

```
<!-- BEGIN blackcode (managed by bk skill install) -->
...bk's content...
<!-- END blackcode -->
```

Anything outside them — an edited description, your team's own rules below — is
preserved by every `install` and every `sync`.

## The skill was renamed

It used to be called `blackcode-issues`. It is called `blackcode`, because it
describes the CLI and the CLI drives every app — a skill named after one app is
one an agent working in another app skips.

`bk skill sync` does the move: it carries your additions across, deletes the old
copy, and leaves anything else in that directory where it is. Running it twice
changes nothing the second time. A skill file you wrote yourself is reported and
left exactly where it is, under the old name — `bk` does not move what it does
not own. Markers from before the rename are still recognised, so an older file
keeps updating normally until you sync it.

If a `SKILL.md` already exists that `bk` did not write, `bk` **refuses to touch
it**. `install` stops and tells you the options; `sync` leaves it alone and
carries on, because the binary and this guide are what actually carry current
behaviour. To let `bk` manage part of a hand-written file, paste those two marker
lines into it and re-run.

## The signals that tell you to run it

- An **"update available"** notice on stderr, naming `bk skill sync`.
- A **`hint:`** line after a failure.
- Exit code **8** — this binary is below the server's minimum supported version
  and every request is refused until you upgrade.

Every API response also carries breadcrumb headers (`X-BK-Help`,
`X-BK-Changelog`, `X-BK-CLI-Latest`, `X-BK-CLI-Min`). You never need to read them
directly — the CLI acts on them for you.

## Version floor

`bk meta` reports `cli.latest_version` and `cli.min_version`. Below the minimum,
`bk` refuses to run at all rather than failing with cryptic 404s. Upgrade:

```bash
npm install -g @blackcode_sa/bc-issues@latest
bk skill install
bk guide
```

## The dated record

```bash
bk changelog             # what changed, newest first
bk changelog --full      # every entry in full
```

`bk changelog` is public and works before `bk login`. Use it to understand *what*
changed; use `bk guide` (this document) to learn *how the tool works now*. The
guide ships inside the binary, so it always describes the binary you are running
— it can never tell you about a flag you don't have.

Related commands: `bk skill sync|check|install|path`, `bk changelog`, `bk meta`, `bk version`
