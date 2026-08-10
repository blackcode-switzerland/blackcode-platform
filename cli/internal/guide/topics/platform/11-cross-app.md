# Cross-app: URNs, search and links

Every addressable thing in every app has one name that works everywhere. The URN
is the durable part of this page and it works from anywhere.

## WHICH DEPLOYMENT ANSWERS — read this before the rest (changed 2026-08-10)

`bk search`, `bk link` and the merged `bk activity` were built on ONE shared
index that every deployment could read. Apps have stopped sharing their records,
so:

- an app that never wrote the shared index **does not serve these commands**. You
  get exit 5 and a hint naming a server that does. That is deliberate — an empty
  page would read like "no matches".
- an app that owns its own activity answers `bk activity` about **itself**. Each
  entry still carries the `app` that produced it, so you can tell.
- **`bk link` is being retired.** Nothing new should depend on it. Put the far
  end's URN in the record's own text instead; that is a fact both apps keep and
  neither can drift from.

`bk app list` shows the servers your token reaches, and `--app-server <slug>`
sends one invocation to a named one. Cross-app search is coming back as a
client-side fan-out over those servers — the binary asking each app and merging
the answers — which needs no shared table.

## The URN

```
bc:<app>:<workspace-slug>/<entity-type>/<number>
bc:issues:kali-sa/issue/482
```

Three things about it, and each one matters when you construct or compare one:

- **`<number>` is the workspace #number** — the `#N` shown in the app and printed
  by every list command. It is never the internal database id. This is the same
  rule the rest of the CLI follows.
- **`<workspace-slug>` is the slug, not the id.** So a URN is readable, and so
  the tenant it belongs to is visible without a lookup.
- **`<app>` comes first**, which is what tells you — and the server — which app
  owns the thing without having to go and find out.

Do not hand-assemble a URN from parts you guessed. Get one from `bk search`, or
from the `subject_urn` field on an activity entry. Run `bk meta` for the app
slugs you can reach and the entity types each one publishes.

## Search, where it is served

```bash
bk search auth                       # titles matching "auth", any app
bk search "#482"                     # by workspace #number
bk search acme --type issue,project  # narrow by entity type
bk search acme --app issues --json   # narrow by app
bk search draft --include-deleted    # include items in the recycle bin
```

Output carries the URN, which is what `bk link` takes.

This searches **titles and #numbers only**, and only across the apps that write
the shared index — see the section at the top of this page. To search
descriptions, or to filter by status, assignee or label, use that app's own
listing or its own search instead.

## Linking two things (retiring — see the top of this page)

Links are **directed** and stored once. `A blocks B` is a single relation: it
shows up as an outgoing link on A and an incoming one on B. There is no separate
inverse row to keep in step.

```bash
bk link create bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
bk link list bc:issues:acme/issue/12
bk link rm bc:issues:acme/issue/12 bc:issues:acme/project/3 --rel part_of
```

Run `bk meta` for the relation names this server accepts — they are served under
`links.relations` and can change without a new binary, so they are deliberately
not listed here.

Four rules the server enforces, each with a distinct error you can branch on:

- **Both ends must exist.** Linking to something that is not there fails with
  exit 5 and names which end was missing. If you just created the target, you
  already have its #number — build the URN from that.
- **Both ends must be in the same workspace.** A link is the one thing that names
  two records at once, so crossing a tenant boundary is refused, not merged.
- **Nothing links to itself.**
- **Creating the same link twice succeeds.** It reports `created: false` the
  second time. Retrying after a timeout is safe and is not an error.

`bk link rm` needs all three parts — from, to *and* rel — because direction is
part of the identity. Check it with `bk link list` first rather than guessing.

## What happens to links when things are deleted

- **Binned** (an app's recycle bin): the link survives, and `bk link list` shows the far
  end flagged as in the trash. Restoring brings it back intact.
- **Purged** (permanently deleted): the link goes with it. A relation to
  something that no longer exists anywhere is a dangling pointer, not a fact.
- **Workspace renamed**: every URN in it is rewritten and the links follow
  automatically. A URN you cached before a rename will stop resolving — get a
  fresh one from `bk search` rather than storing them long-term.

## The activity feed

```bash
bk activity --since 24h
bk activity --since 7d --app issues
bk activity --subject bc:issues:kali-sa/issue/482
bk activity --ws kali-sa --since 30m --json
```

`--since` takes a relative window: `30m`, `24h`, `7d`. Each entry carries the
`app` that produced it and, where its subject is an addressable entity, that
entity's `subject_urn` — so `--subject` gives you the full history of one thing
in one call. **How many apps a single call covers depends on which server you
ask** (top of this page); the `app` field is what tells you what you got.

Entries about members, invitations, labels and comments have no `subject_urn`.
That is an answer, not a gap: those are real events about things that have no
cross-app address.

Related commands: `bk search`, `bk link create|list|rm`, `bk activity`, `bk meta`
