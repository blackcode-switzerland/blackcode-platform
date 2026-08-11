# Overview — read this first

`bk` is how you operate the **Blackcode platform**: one login and one token,
plus one or more **apps**, each with its own workspaces, members, labels, files
and history.

There is **one supported interface: this CLI.** The HTTP API behind it is private
plumbing with no public contract — do not call it directly, and do not build
against an OpenAPI spec (there isn't one any more).

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

## Ground rules

- Add `--json` to every read command. Table output is for humans.
- Set `BK_NO_PROMPT=1` for unattended runs.
- Address projects, tasks and issues by their workspace **#number**.
- Pick the workspace by **name or slug**, never by numeric id.

Related commands: `bk guide`, `bk guide --list`, `bk meta`, `bk --help`
