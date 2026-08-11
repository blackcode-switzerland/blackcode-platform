# Storage — what deleting actually frees

Uploaded files are tracked per workspace with a reference count.

## The rule that surprises people

**Editing a file out of a body does NOT delete the bytes.** That is deliberate —
undo and restore have to stay safe, so the file survives until nothing can bring
the content back.

**Terminal deletes DO free storage**, automatically:

- hard-deleting a comment or reply, and
- purging an item from Trash

release the files that content referenced, once nothing else references them.

So an edit leaves an orphan. Clearing orphans is an explicit owner action.

## Owner review & cleanup

`storage` is **app-owned**, like `upload`: each app keeps its own record of what
it stored. Run `bk guide platform/apps` for the tiers.

```bash
bk issues storage list --json  # this app's files + what references them + usage
bk issues storage rm <id>      # permanently delete an orphan
```

There is no `--app` filter any more — the app is the command. Not every app
serves this verb; `bk <app> --help` is the list.

`bk <app> storage rm` is refused with a **409 `file_in_use`** conflict if anything
still references the file — **including a trashed item**. Empty or purge the
Trash first if you mean to reclaim the space.

## The store is shared; the ledger is not

One Vercel Blob store and one workspace quota, with files kept under a per-app
prefix — but since 2026-08-10 **each app keeps its own record of what it
uploaded**. So this listing is one app's files, while the usage total it prints
is the whole workspace's, across every app. That is not an inconsistency: the
quota belongs to the workspace and the ledger belongs to the app.

That split is why the verb moved. It was bare until 2026-08-10 on the grounds
that one ledger meant every app returned the same rows; that stopped being
true.

The per-app views of files live with their app — `bk issues attachment list` is
the workspace's issue attachments, and `bk issues issue attachments <n>` is one
issue's.

Reference counting spans **every** app, and a delete needs a proven negative: a
file is removable only when no app references it. An app the deployment can read
directly is scanned live; every other app is answered for out of a shared index
that app's own database keeps up to date. If neither is available for some app,
the delete is **refused** rather than allowed. Read an unexpected refusal as
*"could not prove this file is unused"*, not as *"the file is in use"*; retrying
later is the right response, and no amount of `--yes` overrides it.

These commands require workspace **owner** role; anything else gets exit **4**.

Related commands: `bk issues storage list|rm`, `bk issues upload`, `bk issues attachment list`, `bk issues trash purge|empty`, `bk guide platform/apps`
