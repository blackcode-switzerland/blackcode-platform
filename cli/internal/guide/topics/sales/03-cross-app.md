# Crossing app boundaries: URNs, and what carries a record across

Work in this app regularly turns into work somewhere else — a client asks for
something that is an engineering problem, and the two records need to point at
each other. This page is that round trip, end to end, and **it changed on
2026-08-10**: what crosses the boundary now is you and the binary, not a shared
database table.

Related commands: `bk sales prospect show`, `bk sales search`, `bk activity`,
`bk app list`, `bk meta`.

## Everything addressable has a URN

A record with a #number also has a cross-app address:

```
bc:sales:<workspace>/prospect/<n>
bc:sales:<workspace>/meeting/<n>
```

Run `bk meta` for the full list of addressable types in this app — it grows, so
this page does not enumerate it. Records without a #number (contacts, journey
steps, objections, matches) have no URN, because an address nothing can resolve
is worse than not being addressable.

`bk sales prospect show <n>` prints the prospect's URN at the top, and every
activity entry about an addressable record carries it as `subject_urn`. **The
URN is still true and still resolvable** — it is built from this app's own
workspace slug and #number, so nothing about it depended on the shared index.

## Searching

```bash
bk sales search "roches"      # inside THIS app's text. Returns records.
```

This deployment serves this search and no other. It reads this app's full-text
columns, so it finds a phrase in a call summary — and it only ever answers about
this app's records.

The bare `bk search` reads a shared title index that this app no longer writes
to. Asked of this deployment it fails with exit 5 and a hint naming the server
that does answer it; run `bk app list` to see which servers your token reaches.

## Recording that two records are related

**There is no longer a command that stores this.** The relation used to live in a
shared table, and that table was the single biggest reason two apps had to share
a database. It went with the split.

Put the address in the text instead — it is a string an agent can act on:

```bash
bk sales prospect edit 12 --summary "Blocked on bc:issues:acme/issue/512 — SSO"
```

A URN in a summary, a note or an issue description is findable by whoever reads
either record, survives both apps' backups, and cannot drift out of step with
the thing it points at. Run `bk meta` for this app's addressable types when you
need to build one from the other direction.

## Activity is this app's

```bash
bk activity --since 7d
bk activity --subject bc:sales:<ws>/prospect/12
```

Bare, but it answers about **this app** when you are homed here: every entry it
returns was produced by this deployment. `--subject` gives you the full history
of one record in one call, which is the question it is best at.

## One login, one binary

You do not authenticate twice. One token reaches every app you have been granted,
and each app's commands go to that app's own deployment automatically — you never
pass a URL. `bk app list` shows which apps your token can reach, `--app-server`
sends one invocation elsewhere, and `bk guide platform/apps` explains which
commands go where and why the spelling tells you.
