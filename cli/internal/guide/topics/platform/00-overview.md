# Overview — read this first

`bk` is how you operate the **Blackcode platform**: workspaces, members, labels,
files, tokens and inbox — plus one or more **apps** built on top of them.

There is **one supported interface: this CLI.** The HTTP API behind it is private
plumbing with no public contract — do not call it directly, and do not build
against an OpenAPI spec (there isn't one any more).

## Three tiers of verb, and the spelling tells you which

A workspace is the company; an app is a capability inside it. Every command sits
in exactly one tier, and **you can see which from the command itself**:

- **Neutral — bare.** `bk workspace list`, `bk member list`, `bk token create`,
  `bk meta`. Identity and org data: the answer is the same whichever app you ask,
  so no app can be the wrong one.
- **Cross-app — bare, and CHANGING.** `bk search`, `bk activity`, `bk link`,
  `bk storage list`. These were built on one shared index that every deployment
  could answer from. An app that owns its own records answers only for itself,
  and one that never wrote the shared index does not serve the bare command at
  all: you get exit 5 and a hint naming the server that does. `bk activity` is
  the case to watch — from such an app it is that app's feed, not everyone's.
  Check with `bk app list` rather than assuming; the tier is being reworked.
- **App-owned — behind the app's name.** `bk issues issue create`, and also
  `bk issues upload`, `bk issues trash list`, `bk issues label list`. A file's
  ownership, a recycle bin and a label each belong to ONE app, so the app says
  so.

You **upload into** one app and **list across** all of them: `bk issues upload`
files a document under issues, `bk storage list` shows every app's files against
the one workspace quota.

Read `bk guide platform/apps` before doing anything that writes. It is the full
rule, with the reasoning, and it is what stops a file landing in the wrong app.

Run `bk --help` for the apps this binary knows, and `bk <app> --help` for one
app's commands. `bk meta` tells you which apps you can actually reach; you will
not be shown one you have no access to.

A removed spelling never dead-ends: it exits non-zero and names its replacement
on stderr, so a stale script tells you exactly what to type instead.

## The first four commands, in this order

```bash
bk guide            # this document — the complete usage guide for YOUR binary
bk meta             # who you are, every workspace you can write to, live limits
bk workspace use <slug>
bk <group> --help   # discover flags before you call anything
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
