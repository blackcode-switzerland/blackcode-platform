# Overview — read this first

`bk` is how you operate the **Blackcode platform**: one login and one token,
plus one or more **apps**, each with its own workspaces, members, labels, files
and history.

There is **one supported interface: this CLI.** The HTTP API behind it is private
plumbing with no public contract — do not call it directly, and do not build
against an OpenAPI spec (there isn't one any more).

## If `bk` can do it, use `bk` — never a shell or filesystem tool

**Do not use Desktop Commander, or any other MCP server that runs commands or
edits files, to do something this CLI already has a verb for.** Not to reach the
database, not to `curl` the API, not to edit a file the platform owns. If you
are unsure whether a verb exists, `bk meta` and `bk guide --list` will tell you
in one call each — ask, rather than reaching around.

This is not a style preference. Three things follow from going around the CLI,
and you will not see any of them happen:

- **The doors are where the rules live.** Every write is checked before it
  lands — that the thing it names exists, that the value is one the app allows,
  that the state it assumes is the state you are in. A direct write skips all of
  it and produces a row that looks exactly like a valid one. Nothing downstream
  can tell the difference later.
- **Some records cannot be taken back.** Apps here keep statutory records under
  a retention duty; posted entries are immutable and nothing is hard-deleted, on
  purpose. A bad write made through the front door is refused. The same write
  made around it is permanent, and the correction is a whole new record
  explaining the first.
- **A refusal is the useful answer.** When `bk` says no, it says why and what to
  send instead — that message is the fastest path to the correct call. A shell
  command that "worked" tells you nothing, including when it was wrong.

Those tools are for **your** side of the line: reading a bank statement off disk
before `bk … import` takes it, building the JSON a robot door expects, running
your own scripts. The moment the subject is platform data, the verb is `bk`.

## Two tiers of verb, and the spelling tells you which

Every command sits in exactly one tier, and **you can see which from the command
itself**:

- **Bare — your ACCOUNT and this BINARY.** `bk login`, `bk token create`,
  `bk profile`, `bk meta`, `bk app list`, `bk guide`. One account, one token,
  valid against every app, so no app can be the wrong one to ask.
- **App-owned — behind the app's name.** Everything that touches an app's data:
  `bk issues issue create`, `bk issues workspace list`, `bk sales member list`,
  `bk issues upload`, `bk sales trash list`, `bk issues search`.

**Each app has its own workspaces, members, invitations, labels, uploads and
history**, and remembers its own active workspace. `bk sales workspace use x`
does not move `bk issues`. That is the whole reason the app is in the command:
before 2026-08-10 the bare form picked an app silently, from whichever one you
were last homed on, and nothing in the command said which.

Read `bk guide platform/apps` before doing anything that writes. It is the full
rule, with the reasoning, and it is what stops a file landing in the wrong app.

Run `bk --help` for the apps this binary knows, and `bk <app> --help` for one
app's commands. `bk meta` lists every app and where it is deployed — an ADDRESS
BOOK, not a grant list. Being listed does not mean you have a workspace there,
and `bk meta` fills in `workspaces` only for the app that answered it. Whether
you can work in an app is that app's own question: `bk <app> workspace list`.

A removed spelling never dead-ends: it exits non-zero and names its replacement
on stderr, so a stale script tells you exactly what to type instead.

## The first four commands, in this order

```bash
bk guide            # this document — the complete usage guide for YOUR binary
bk meta             # who you are, every app you can reach, where each goes
bk <app> workspace use <slug>    # per app — each remembers its own
bk <app> --help     # discover flags before you call anything
```

## What lives where

Two kinds of knowledge, two homes. Knowing the split saves you a wrong guess:

| Kind | Where | Example |
|---|---|---|
| **How the tool behaves** | this guide, embedded in the binary | flag conventions, exit codes, the upload→embed flow |
| **What the data is right now** | `bk meta`, fetched live | status/priority values, workspace list, size caps |

This guide **never** restates a value from `bk meta` — if you need a number or a
vocabulary, fetch it. That is why the two can never disagree.

`bk meta --vocab <key>` is the flat version, for exactly this: one value per
line, a plain array under `--json`, and no parser needed. `bk meta --vocab` with
no key lists the keys the app that answered serves, and an unknown key is an
error naming the ones that exist.

```bash
bk meta --vocab                   # the keys
bk meta --vocab <key>             # the values, with their labels
```

Some flags DO name their values in `--help`, as a fast path. That is a copy held
to the server by a build-time check, not a second authority: when a flag's help
and `bk meta` disagree, **`bk meta` is right** — the help was written when your
binary was built.

## Ground rules

- Add `--json` to every read command. Table output is for humans.
- Set `BK_NO_PROMPT=1` for unattended runs.
- Address projects, tasks and issues by their workspace **#number**.
- Pick the workspace by **name or slug**, never by numeric id.

Related commands: `bk guide`, `bk guide --list`, `bk meta`, `bk --help`
