# Trash — recovering from a mistake

Deletes are **soft**. `bk issues project delete`, `bk issues task delete` and
`bk issues issue delete` move the item to the workspace Trash rather than
destroying it, and Trash is what brings it back.

> **`bk undo` was removed in 1.12.0.** It never recorded anything — the table
> behind it had no writer, so it reported zero operations every time it ran.
> Trash is the recovery path and always was. If you have a script that calls
> `bk undo` and treats success as "the write was rolled back", that script has
> never been rolled back and should use Trash instead.

## The commands

**The bin belongs to ONE app**, so the app names itself — `bk <app> trash …`.
There is no bare spelling: two apps have two bins, and a command that picked
one by default would eventually empty the wrong one. Run
`bk guide platform/apps` for the tier rule, and `bk --help` for the apps this
binary knows.

```bash
bk issues trash list --json           # paginated: --limit / --cursor
bk issues trash restore issue:42      # <type>:<#number>, repeatable
bk issues trash purge issue:42        # permanently destroy specific items
bk issues trash empty                 # permanently destroy everything in the bin
```

## Refs are #numbers

`trash list` prints a **REF** column, and a ref is `<type>:<#number>` — the
same `#number` you use everywhere else, so `issue:42` in Trash is the same issue
as `bk issues issue view 42`.

**This changed in 1.12.0.** Before that, the REF column printed an internal row
id, which was the one place the platform exposed one. If you are holding a ref
from an older run, **do not reuse it** — re-run `trash list` and take the
current REF. An old row id is usually a valid `#number` for a *different* item,
and on `purge` that is not recoverable.

Passing a ref that is not in this workspace's Trash fails with exit 5 and names
the ref. A rejected restore is atomic: pass one bad ref alongside good ones and
nothing is restored. The count reports what was actually brought back —
restoring something that was never binned is a no-op and counts zero, not an
error.

## Terminal actions

`purge` and `empty` are terminal. They also free the files that the content
referenced (see `bk guide platform/storage`). Nothing brings them back.

Both **echo what they destroyed** — type, `#number` and title, one line each,
followed by the count:

```
destroyed issue:42  Crash on upload
destroyed issue:57  Duplicate of #42
permanently deleted 2 item(s)
```

Read those lines. They are the only chance to notice that a ref named something
other than what you meant, and there is no undo behind them. `--json` carries the
same list as `items`. `trash empty` caps the list and reports the remainder as
`items_truncated`; the count is always exact.

## Cascade vs detach

Deleting a project or task decides what happens to its children:

```bash
bk issues project delete 42 --cascade     # bin the attached tasks and issues too
bk issues project delete 42 --detach      # keep them, unlinked (the default)
```

Related commands: `bk issues trash list|restore|purge|empty`, `bk issues project delete`, `bk issues task delete`, `bk issues issue delete`
