# Cross-app: what it is now, and how to address another app's records

There is no cross-app tier any more. This topic keeps its name so that a stale
`bk guide platform/cross-app` lands somewhere that tells you what replaced it,
rather than 404ing.

## What changed on 2026-08-10

The bare `search` and `link` verbs, and the merged `activity` feed, were built on ONE shared
index that every deployment wrote into and could read. The apps stopped sharing
their records, so that index has one writer and the commands built on it had no
honest cross-app answer left.

| Bare verb, until 2026-08-10 | Now |
|---|---|
| `search "acme"` — every app at once | `bk <app> search "acme"` — that app |
| `activity` — one merged feed | `bk <app> activity` — that app's history |
| `storage list` — every app's files | `bk <app> storage list` — that app's |
| `link create A blocks B` | **removed.** See below |

Each old spelling exits non-zero and names its replacement, so a run that hits
one can recover inside the same run.

## The URN — the part that did not change

Every addressable thing in every app still has one name that works everywhere,
and it is now the main way to point at another app's record:

```
bc:<app>:<workspace-slug>/<entity-type>/<number>
bc:issues:kali-sa/issue/482
```

Three things about it, and each matters when you construct or compare one:

- **`<number>` is the workspace #number** — the `#N` shown in the app and printed
  by every list command. Never the internal database id.
- **`<workspace-slug>` is the slug, not the id**, so the tenant is visible without
  a lookup.
- **`<app>` comes first**, which is what tells you which app owns the thing.

A URN is built entirely from facts the owning app holds, so **every app can print
one for its own records** — and that is still true now that nothing is shared.
Get one from `bk <app> search`, from a `show` command, or from the `subject_urn`
field on an activity entry. Do not hand-assemble one from parts you guessed. Run
`bk meta` for the app slugs you can reach and the entity types each publishes.

## Relating two apps' records, now that `link` is gone

The removed `link` verb recorded the relation in a table both apps read. There is no such table
now, so the relation lives where a human and an agent will both find it — in the
record's own text:

```bash
bk sales prospect show 8              # prints bc:sales:acme/prospect/8
bk issues issue create --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme/prospect/8"
```

That is a fact one app holds and neither can drift from, and it survives being
read by a person. What it does not give you is a reverse lookup: nothing lists
"every issue mentioning this prospect". Search the text instead —
`bk issues search "prospect/8"` matches titles, and the app's own listing
searches descriptions.

## Searching, per app

```bash
bk issues search auth                        # titles matching "auth"
bk issues search "#482"                      # by workspace #number
bk issues search acme --type issue,project   # narrow by entity type
bk issues search draft --include-deleted     # include items in the recycle bin
```

`bk issues search` matches **titles and #numbers**. To search descriptions, or to
filter by status, assignee or label, use that app's own listing
(`bk issues issue list --search`).

Other apps answer the same verb about themselves, and not always the same way:
`bk sales search` is a full-text search INSIDE that app's records and returns the
matching text. Run `bk <app> search --help` before the first call.

There is no `--app` flag on any of these any more. The app is the command.

## History, per app

```bash
bk issues activity --since 24h
bk issues activity --subject bc:issues:kali-sa/issue/482
bk issues activity --ws kali-sa --since 30m --json
```

`--since` takes a relative window: `30m`, `24h`, `7d`. Each entry carries the app
that produced it and, where its subject is an addressable entity, that entity's
`subject_urn` — so `--subject` gives you the full history of one thing in one
call.

Entries about members, invitations and labels have no `subject_urn`. That is an
answer, not a gap: those are real events about things that have no address.

To see two apps' history, ask both. The binary is the connector:

```bash
bk issues activity --since 24h
bk sales activity --since 24h
```

## Which deployment answers

`bk app list` shows every app this binary knows and the server each answers on.
It is an address book, not a grant: an app you have no workspace in is still
listed, and you find that out from the app itself — `bk <app> workspace list`.
An app the binary does NOT know fails naming the app, rather than sending the
request somewhere else.

Related commands: `bk issues search`, `bk sales search`, `bk issues activity`, `bk sales activity`, `bk meta`, `bk app list`
