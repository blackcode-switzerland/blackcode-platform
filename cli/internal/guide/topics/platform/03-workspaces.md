# Workspaces — pick the right app AND the right one, FIRST

All tenant data lives inside a workspace, and most accounts belong to more than
one. **Writing to the wrong workspace is the single most common agent mistake.**

## Every app has its own workspaces (changed 2026-08-10)

This is the thing to absorb before anything else on this page. A workspace is not
one row that every app shares. Each app keeps its own, with its own members and
its own invitations, and **the ids and slugs can overlap without meaning the same
thing**.

So every workspace command names its app:

```bash
bk issues workspace list
bk sales workspace list
```

…and each app remembers its own active workspace:

```bash
bk issues workspace use <slug>     # sets THIS app's; touches no other
bk sales workspace use <slug>
```

Setting one does not move the other. If you upgraded from an older `bk`, the one
active workspace you had comes forward as your **home app's** and no other's —
run `bk <app> workspace use <slug>` once for each app you work in.

Being a member of one app's workspace says nothing about the other. The same
person can be in `acme` in one app and not in the other, and that is not a
misconfiguration — it is what "the apps are separate" means.

## The rule

```bash
bk meta --json      # who you are, every app you can reach, and where each goes
bk <app> workspace list
```

Match the user's intent to a workspace by its human-readable **`name`** or
**`slug`**. Do **not** pick by the numeric `id` — ids are opaque sequential
integers, trivial to confuse, and now genuinely ambiguous across apps.

The active workspace is only a **default**. It is not necessarily where the user
means to write. Confirm before you create anything.

## Setting the target

```bash
bk issues workspace use <slug>          # persisted, for this app only
bk --ws <slug> issues issue list        # ONE command; changes no active workspace
```

`--ws` is a persistent flag available on every command. Use it for reads against
another workspace so you never mutate the caller's active workspace as a side
effect. It is resolved by the app the command names, like everything else.

### `--ws` also narrows the inbox

`bk <app> inbox list` is **global**: every workspace, and every app that notifies
you. That is deliberate — an inbox scoped to your active workspace would hide the
invitation that arrived from somewhere else, and you would have no way to see
that it had.

`--ws` narrows it, and is the only thing that does:

```bash
bk issues inbox list --unread            # everything you have not read, anywhere
bk issues inbox list --unread --ws acme  # just that workspace
```

It takes a slug or a workspace id. A slug that does not resolve is an error, not
a quiet fall back to the unfiltered list.

## Membership IS access

There used to be two things here and confusing them was the second most common
mistake on this platform:

- **Membership** — you are in that app's workspace.
- **App access** — whether that app was switched on for you inside it.

The second is GONE as of 2026-08-10. A workspace belongs to exactly one app, so
being a member of an issues workspace is what using issues means, and there is no
second gate to be refused by. `bk <app> member list` is the whole answer.

```bash
bk issues workspace list          # the issues workspaces you are a member of
bk sales workspace list           # the sales ones — a different set entirely
```

Each app keeps its OWN workspaces and its own active one, so the same person can
be in one app's workspace and in none of another's. If a workspace you expected
is missing from one app, you are not a member of it THERE — ask an owner of that
app's workspace to invite you: `bk <app> invite send <email>`.

### Redeeming an invitation

```bash
bk <app> invite pending           # invitations addressed to YOUR email
bk <app> invite show <token>      # preview one: who invited you, and where
bk <app> invite accept <token>
```

`show` is for a token you were handed rather than one addressed to you — a link
pasted into a message, say. It answers only if you are signed in AS the address
the invitation was sent to; holding the token is not enough, and a token for
somebody else is refused without naming who it is for.

`bk <app> workspace list` used to take `--all`, which showed workspaces the app
was switched off in plus the apps reachable in each. Both of those described the
gate, so the flag went with it and the plain listing is the whole answer.

## The apps in the suite

```bash
bk app list                # every app, its server, and whether you can reach it
bk app use <slug>          # switch the home app (where the bare identity verbs go)
```

This is an ADDRESS BOOK, not a permission list. It answers "which apps exist and
where do they live", which is what lets `bk <app> …` route without anyone typing
a URL. It does not answer "may I open this one" — no single deployment can, since
each app's membership lives in its own schema.

So an app listed as REACHABLE that you have no workspace in is a normal state,
not an error. Ask that app: `bk <app> workspace list`.

Run `bk meta` to refresh the registry if an app is missing or has moved.

## Managing workspaces

```bash
bk issues workspace list
bk issues workspace show [slug|id]
bk issues workspace create --name "Growth"
bk issues workspace edit [slug|id] --name "…"
bk issues workspace transfer [slug|id] --to <user>    # hand over ownership
bk issues member list
bk issues member remove <user_id>                     # owner only
bk issues member leave
```

**Not every app offers all of these.** Some serve only `list`, `show` and `use`,
because opening or destroying a workspace is company-level administration and
belongs in one place. Run `bk <app> workspace --help` for that app's list; a verb
that is absent is a decision, not an outage.

Name length cap: see `limits.workspace_name_max` in `bk meta`.

## Deleting a workspace

Irreversible. Not the Trash — no app's recycle bin can bring it back. It takes
that app's records in the workspace with it.

```bash
bk issues workspace delete scratch-ws --confirm scratch-ws
```

Three things to know before you call it:

- `--confirm` must repeat the argument exactly. It is required even with `--yes`
  and even under `BK_NO_PROMPT=1` — the y/N prompt auto-approves in unattended
  mode, so repeating the slug is the only guard that actually protects you.
- The target is always an explicit argument. Unlike most commands this never
  falls back to your active workspace.
- Owner only. To hand a workspace over instead, use `bk <app> workspace transfer`.

If you delete that app's active workspace, its active selection is cleared — run
`bk <app> workspace use <slug>` before the next scoped command in that app.

Related commands: `bk meta`, `bk issues workspace list|show|create|use|edit|transfer|delete`, `bk sales workspace list|show|use`, `bk app list|use`, `bk issues member list|remove|leave`, `bk issues invite send|list|revoke|pending|show|accept`
