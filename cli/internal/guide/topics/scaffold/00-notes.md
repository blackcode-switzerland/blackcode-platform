# Scaffold app — notes

This is the scaffold app. It is not deployed anywhere; it exists so that
`docs/adding-an-app.md` describes something real, and so every cross-app
guardrail in the repo has a second app to check against.

If you are an agent and reached this topic by accident, run `bk guide` to list
the sections and pick the app you actually meant.

## The one entity

A **note** has a title, an optional body, and a workspace `#number` — the same
address every entity in the platform uses. Row ids are never printed.

```bash
bk scaffold note list
bk scaffold note create --title "First note" --body "…"
```

`--json` and `--yaml` work here exactly as everywhere else, and the exit codes
are the platform's: see `bk guide platform/output-and-exit-codes`.

## What a real app adds next

The scaffold stops short of three things on purpose, because each needs a
decision only the real app can make:

- **A URL scheme**, so notes become addressable as
  `bc:<app>:<workspace>/note/<n>` and can be pasted into another app's record.
- **A blob reference scanner**, if the app's content can embed uploaded files.
  Without one, deleting a file is refused platform-wide — correctly, because
  nobody can prove the file is unused. See `bk guide platform/storage`.
- **A browser session path.** The scaffold authenticates bearer tokens only,
  which is the path agents use.

Run `bk meta` for the live vocabularies, limits and workspaces — never assume a
value you read in a guide topic.

Related commands: `bk scaffold note list|create`, `bk meta`, `bk guide platform/apps`
