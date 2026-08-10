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

## Membership is not access

Two different things, and confusing them is the second most common mistake here:

- **Membership** — you are in that app's workspace. `bk <app> member list` shows it.
- **App access** — whether the app is switched on for you at all.
  `bk app access list <app>` shows it.

`bk <app> workspace list` shows only the workspaces you can use **that app** in.
One where the app is switched off, or where you were never granted it, is not
somewhere you can write, so listing it would be offering a guaranteed failure.

```bash
bk issues workspace list          # workspaces you can use issues in
bk issues workspace list --all    # every workspace you are a member of, + which
                                  # apps you can reach in each
```

If a workspace you expected is missing, run `--all`. An empty APPS column means
you are a member but hold no access there.

A request into a workspace you have no access to fails with exit code 4 and a
`hint:` line naming who can grant it. That hint is the recovery path — read it
rather than retrying.

## Apps in a workspace

```bash
bk app list                                 # which apps this workspace runs
bk app access list <app>                    # who has access, and who does not
bk app access grant <app> --user <ref>      # owner only
bk app access revoke <app> --user <ref>     # owner only
bk app default-access <app> --mode …        # all_members | invite_only
bk app enable <app>                         # owner only
bk app disable <app> --confirm <app>        # owner only; revokes every grant
```

Run `bk meta` for the app slugs you can reach and `bk app list` for how each one
currently grants access — neither is baked into this binary.

You cannot disable the app you are calling from — it would lock the whole
workspace out of the product with no way back in.

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

Related commands: `bk meta`, `bk issues workspace list|show|create|use|edit|transfer|delete`, `bk sales workspace list|show|use`, `bk app list|enable|disable|default-access`, `bk app access list|grant|revoke`, `bk issues member list|remove|leave`, `bk issues invite send|list|revoke|pending`
