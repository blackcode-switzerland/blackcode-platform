# Pitfalls — the mistakes that actually happen

Ordered by how often they bite. Each links to the topic that explains it.

**1. Writing to the wrong workspace.** The #1 mistake by a wide margin. Pick by
`name`/`slug`, never by numeric id; `active_workspace` is only a default.
→ `bk guide platform/workspaces`

**2. Literal `\n` in a body.** Rich-text fields want real newlines. Sending the
two characters backslash-n stores them verbatim. Use `--description-file` or
stdin for anything multi-line. → `bk guide platform/rich-text`

**3. Assuming a vocabulary or a limit.** Status, priority, health values, size
caps and the upload block list all come from `bk meta`. Hardcoding them is how an
integration silently rots. → `bk guide platform/overview`

**4. Non-UTF-8 console corrupting text.** Silent, and it gets stored. Most likely
on Windows without `chcp 65001`, most damaging during a bulk move.
→ `bk guide platform/encoding`

**5. Expecting external media to embed.** Only files uploaded through `bk <app> upload`
render inline. External urls stay plain links and raw `<iframe>` is stripped.
→ `bk guide platform/files`

**6. Paths with spaces or parentheses.** Angle-bracket them —
`[](</abs/my file (2).mp4>)` — or Markdown stops the link at the first `)`.
→ `bk guide platform/files`

**7. Expecting an edit to free storage.** Editing a file out of a body never
deletes the bytes. Only a hard comment delete or a Trash purge does.
→ `bk guide platform/storage`

**8. Parsing table output.** It is for humans and its layout is not a contract.
Use `--json`. → `bk guide platform/output-and-exit-codes`

**9. Blocking on a confirmation prompt.** Unattended runs must set
`BK_NO_PROMPT=1`, or they hang. → `bk guide platform/install-auth`

**10. Retrying a failure without reading the hint.** `bk` prints a `hint:` line
on stderr naming the exact fix — a renamed flag, an upgrade, `bk skill sync`.
Read it first. → `bk guide platform/staying-current`

**11. Using a pre-1.10.0 command spelling.** App verbs moved behind their app
name: `bk issues issue list`, not `bk issues issue list`. The old spellings still run
and print `deprecated:` on stderr, but they are removed two minor releases from
now. → `bk changelog`

Each app has its own pitfalls topic for the mistakes specific to it — run
`bk guide --list` to see them.

Related commands: `bk guide <topic>`, `bk meta`, `bk skill sync`
