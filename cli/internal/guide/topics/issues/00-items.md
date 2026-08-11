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

## Clearing a nullable field

On `edit`, pass the literal `none` (also `null`, `unset`, `clear`;
case-insensitive) to null a field. **Omit** the flag to leave it unchanged.

```bash
bk issues issue edit 42 --task none --due-date 2026-06-30
```

Applies to `--assignee`, `--task`, `--start-date`, `--due-date`.

## Labels on an issue that already exists

Labels are a **sub-resource**, not a field on the issue, so they are not on
`issue edit`. Attaching one after the fact is its own verb, and takes two
POSITIONAL arguments — the issue and the label, no flags:

```bash
bk issues label list                  # find the label id
bk issues label attach 189 58         # <issue_id> <label_id>
bk issues label detach 189 58
bk issues issue view 189              # confirm — the Labels line is always shown
```

At creation time the flag form exists, and takes a NAME rather than an id
(unknown names are created):

```bash
bk issues issue create --title "…" --label urgent --label client-facing
```

`bk issues issue edit --label` does not exist, and neither does a `labels` or
`label_ids` field on the PATCH route — that field is **rejected** with a
suggestion rather than accepted and ignored, so a caller who guesses it gets
told where to go instead of a 200 that changed nothing.

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
