# Projects, tasks & issues

## Addressing

A project, task or issue is addressed by its **workspace #number** — the `#N`
shown in the app, unique per workspace. There is no separate global id, and the
internal database id is never exposed. A leading `#` is accepted.

```bash
bk issues issue view 42
bk issues issue view '#42'      # same thing
```

Never cache a `#number` from one workspace and use it in another.

## The core verbs

```bash
bk issues project list|view|create|edit|delete
bk issues task    list|view|create|edit|delete
bk issues issue   list|view|create|edit|delete
```

Each also has satellites — comments, members, updates, labels, attachments,
watch, activity. Run `bk <group> --help` for the current set; the help is
generated from the binary and is always right.

```bash
bk issues issue create --project 4 --title "Fix login" --priority 2
bk issues issue list --project 4 --status todo --mine --json
bk issues issue edit 42 --status in_progress --assignee me
```

## Vocabularies — always fetch, never assume

Status, priority and project-health values come from `bk meta`:

```bash
bk meta --json | jq '.vocabulary'
```

Issue priority is an integer; project priority is a `P0`–`P4` string (the CLI
also accepts the friendly words `urgent|high|medium|low|none`). Do not hardcode
either — `bk meta` is authoritative.

## Long bodies: three forms

Any `--description` / `--body` flag accepts:

```bash
--description "literal text"       # a string literal
--description -                    # read from stdin
--description-file path/to.md      # read from a file (takes precedence)
```

Prefer `--description-file` or stdin for multi-line content — it is the only way
to be sure you send **real newlines**. See `bk guide platform/rich-text`.

## Notifying someone: `@mention` takes an EMAIL

A comment body is scanned for `@<email>`, and every match that is a member of
the workspace gets an inbox notification. It is the only way to put something in
another person's inbox from a comment.

```bash
bk issues issue comment 42 --body "@ana@blackcode.ch can you confirm the fix?"
bk issues inbox list --unread          # where it lands for them
```

An `@username` — the spelling every other tracker uses — matches nothing and
notifies nobody, silently. So does an email belonging to someone who is not a
member of this workspace; `bk issues member list` is who can be reached.

Mentions are resolved when a comment is **created**. Adding one by editing an
existing comment renders fine and notifies nobody, so post a new comment
instead. The same applies to comments on tasks and projects, which share one
write path.

## Clearing a nullable field

On `edit`, pass the literal `none` (also `null`, `unset`, `clear`;
case-insensitive) to null a field. **Omit** the flag to leave it unchanged.

```bash
bk issues issue edit 42 --task none --due-date 2026-06-30
```

Applies to `--assignee`, `--task`, `--start-date`, `--due-date`.

## Labels on an issue that already exists

**Every way of labelling takes a NAME.** Unknown names are created on the fly, so
nothing needs a `label list` first:

```bash
bk issues issue create --title "…" --label urgent --label client-facing
bk issues issue edit 189 --label urgent --label-remove stale
bk issues label attach 189 urgent
bk issues label detach 189 urgent
bk issues issue view 189              # confirm — the Labels line is always shown
```

Both flags repeat, and each occurrence is taken whole — a name containing a
comma is one label, not two.

An id still works anywhere a name does: `bk issues label attach 189 58` reads a
bare integer as an id. The one consequence is that a label literally *named*
`58` cannot be reached by name.

Two shapes for one job, because they answer different questions.
`issue edit --label` is the convenient one when you are already changing the
issue. `label attach`/`detach` is the precise one — a single write, and
`detach` fails naming what the issue *does* carry rather than reporting a
removal that removed nothing.

Labels are a **sub-resource**, not a field on the issue, and that survives at the
HTTP layer: there is no `labels` or `label_ids` field on the PATCH route, and one
sent there is **rejected** with a suggestion rather than accepted and ignored.
`issue edit --label` is a CLI convenience that fans out to
`…/issues/{id}/labels` — it does not mean PATCH grew a labels field.

## User references

Anywhere a user is expected (`--assignee`, `bk issues issue assign`,
`bk issues project remove-member --user`) the CLI accepts:

- a numeric id — `42`
- an email — anything containing `@`
- a display name — `"Alice Andrews"`
- the literal `me`

Exception: `bk issues member remove` takes a numeric **user id** only.

## Dates & lengths

Dates are ISO-8601 (`YYYY-MM-DD`, or a full timestamp where a time matters).
Title/name length caps live in `bk meta` under `limits` — e.g.
`issue_title_max`, `project_name_max`, `task_name_max`, `label_name_max`.
Exceeding one returns a validation error (exit **6**) naming the cap.

Related commands: `bk issues project`, `bk issues task`, `bk issues issue`, `bk issues label`, `bk meta`
