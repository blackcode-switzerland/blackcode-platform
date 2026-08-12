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

## Relating two apps' records: the URN goes in the record's own text

**This is the design, not a workaround.** Say it that way to yourself before you
go looking for the command that does it properly — there isn't one, and there is
not going to be one.

A relation between two apps' records lives in the text of one of them:

```bash
bk sales prospect show 8              # prints bc:sales:acme/prospect/8
bk issues issue create --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme/prospect/8"
```

Three properties, and they are why this is better than the table that used to
hold it:

- **It is a fact ONE app holds.** Nothing has to be kept in step with anything,
  so nothing can fall out of step.
- **It survives being read by a person.** A relation in a join table is invisible
  unless something renders it; a URN in a summary is visible to whoever opens the
  record, in the app, in the CLI, and in a database dump.
- **It cannot be orphaned.** Deleting the far end leaves a string that still says
  what was meant, rather than a row pointing at nothing.

What it does not give you is a **reverse lookup**: nothing lists "every issue
mentioning this prospect". Search the text instead — `bk issues search
"prospect/8"` matches titles, and each app's own listing searches descriptions.

### There is no cross-app link command, and this is why

A `link` verb existed until 2026-08-10 and recorded the relation in one index
every app wrote into. That index has had a **single writer** since. A link with
one end in one app and one in another cannot be maintained by either of them: no
app's database role can read another app's schema, so nothing can check that the
far end exists, nothing can update it when it is renamed, and nothing can clean
it up when it is deleted. A relation that can silently point at nothing is worse
than no relation at all, because it looks like one.

An old script that still calls it gets a non-zero exit and a sentence naming
this page, so a run that hits one can recover inside the same run.

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

## What is per app, and what is genuinely shared

This is the part that surprises people, so it is stated flatly rather than left
to be discovered.

**Shared — one of each, across every app:**

| | |
|---|---|
| your account | one user record, one email |
| your password | changed once, in any app, and it is changed everywhere |
| sign-in | one login; switching apps needs no re-auth and no new shell |
| your API token | one token, valid against every app you can reach |
| this binary | one `bk`, one guide, one changelog |

**Per app — one of each, PER APP, by design:**

- workspaces, and which one is active
- members and invitations
- documents and uploads
- labels
- the inbox
- history / activity
- the recycle bin
- search

One rule explains the whole right-hand column: **each app owns its own tenancy.**
A workspace belongs to exactly one app, and membership of it is the entire access
gate. So a label, an upload, an invitation or a notification is a fact *about a
workspace*, and a workspace belongs to one app — there is nowhere else for those
things to live.

Two consequences worth having in mind before you go looking for a command:

- **There is no shared document library, and there will not be one.** Documents
  hang off a workspace, and a workspace belongs to one app. A library spanning
  apps would need a tenancy that belongs to none of them — which is the thing
  every app was separated to stop depending on. Upload into the app that owns
  the work, and reference it from the other by URN.
- **The same slug in two apps is two different workspaces.** They may share an
  id as well. Setting one app's active workspace does not move another's, and
  resolving a slug only means something against the app you resolved it in.

## A session across two apps, end to end

Nothing forces you to pick one app. The connector is **you, driving this
binary** — never a shared table.

```bash
# 1. Where am I, in every app? Local state; no requests with --no-probe.
bk app list --no-probe
   APP     SERVER                       WORKSPACE   REACHABLE
*  issues  https://issues.blackcode.ch  acme        ok
   sales   https://sales.blackcode.ch   acme-sales  ok

# 2. Point each app at the workspace you mean. Once per app; they are separate.
bk issues workspace use acme
bk sales workspace use acme-sales

# 3. Work in the app that OWNS the thing, and take its address with you.
bk sales prospect show 8
#8  Helvetia AG
bc:sales:acme-sales/prospect/8        <- printed under the title

# 4. Carry the address across, in the new record's own text.
bk issues issue create --title "Export fails for Helvetia" \
  --description "Prospect: bc:sales:acme-sales/prospect/8 — blocked on SSO"
created #512

# 5. And back the other way, so either record leads to the other.
#    Not every `view`/`show` prints a URN — `bk <app> search` always does.
bk issues search "#512"
URN                          APP     TYPE   #    TITLE
bc:issues:acme/issue/512     issues  issue  512  Export fails for Helvetia

bk sales prospect edit 8 --summary "Blocked on bc:issues:acme/issue/512 — SSO"

# 6. Two apps' history is two commands. There is no merged feed.
bk issues activity --since 24h
bk sales activity --since 24h
```

Step 5 is the one people skip. A URN written into only one of the two records is
findable from one side only, and the side you will be standing on later is the
one you did not write it into.

Three reliable ways to get a URN, when a `show` does not print one: `bk <app>
search` (the `URN` column, always present), the `subject_urn` field on an
activity entry, and `bk meta` for the URN format and this app's slug. **Do not
hand-assemble one from parts you guessed** — a URN that resolves to nothing is
indistinguishable from a record that was deleted.

`bk meta` prints the same routing block as step 1, plus your identity and the
app address book, and it refreshes that address book while it is there.

## Which deployment answers

`bk app list` shows every app this binary knows and the server each answers on.
It is an address book, not a grant: an app you have no workspace in is still
listed, and you find that out from the app itself — `bk <app> workspace list`.
An app the binary does NOT know fails naming the app, rather than sending the
request somewhere else.

Related commands: `bk issues search`, `bk sales search`, `bk issues activity`, `bk sales activity`, `bk meta`, `bk app list`
