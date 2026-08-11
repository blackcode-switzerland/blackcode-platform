# Plan 2 — triage `Todo/issues-app-feedback.md`

**A direct plan. One agent. Triage first, fix second.**

Status: not started. Written 2026-08-11.

---

## 0. Read this before you read the feedback

Five items were reported by real users and agents **between 2026-08-01 and
2026-08-10**, which is exactly the window in which this platform was rebuilt: a
second app arrived, ten phases separated the two, ten CLI verbs moved behind
their app name, and the database was re-partitioned.

**So each item is one of four things, and you cannot tell which by reading it:**

| | |
|---|---|
| **Still broken** | fix it |
| **Already fixed** | by the refactor, incidentally. Confirm and close |
| **Collateral damage** | the refactor broke it; the report is the symptom |
| **Never broken** | the reporter guessed a shape that does not exist. The bug is DISCOVERABILITY, and the fix is different |

**Establish which, per item, before proposing anything.** A fix for the wrong
category is worse than no fix: it adds a command nobody needed, or "repairs"
something that already works.

**Reproduce against a built binary and a local database.** Every report is from a
version that is now several releases old.

```sh
cd cli && go build -o /tmp/bk-tri ./cmd/bk
export BK_CONFIG_DIR=/tmp/bk-tri-cfg     # NEVER the default — it points at production
docker compose up -d                      # local Postgres; port 5432 INSIDE the container
```

## 1. Item-by-item, with what is already known

### Item 1 — "labels cannot be set on an existing issue; CLI and REST both broken"

**Partly wrong, and the wrong part matters.** Checked 2026-08-11:

```
bk issues label attach <issue_id> <label_id>     EXISTS
bk issues label detach <issue_id> <label_id>     EXISTS
```

The reporter tried `bk label attach --ws … --issue 189 --label 58` — bare verb
(moved), and **flags where the command takes positional arguments**. So "labeling
is a UI-only feature" is false, and the agent's workaround was unnecessary.

**That leaves three claims still to verify, and they may each be real:**

- `bk issues issue edit` has **no** `--label` flag — confirmed still true. Is
  that a gap, or is `label attach` the intended shape? A decision, not a bug.
- `PATCH /api/workspaces/{ws}/issues/{id}` **silently accepts and ignores**
  `labels`/`label_ids`. If true this is the real defect: silent acceptance is
  worse than rejection. **Check what the route does with an unknown field.**
- `bk issues issue view` does not show `labels`. Verify; if true it explains why
  the reporter could not tell whether anything had worked.

**The discoverability half is the bigger finding.** Two people reached "this
feature does not exist" while the command was one `--help` away. Ask what would
have shown them: the error on `--issue`, the label topic in `bk guide`, or
`issue view` showing labels so the loop closes.

### Item 2 — verb guessing (`get`/`show` → `view`, `update` → `edit`)

**Context you must have: `cli/internal/commands/aliases.go` was DELETED on
2026-08-11.** It was dead code — `registerAppAliases` had no caller — and its
header still claimed "every old spelling still RUNS" while
`alias_removal_test.go` asserts the opposite. Do not restore it without reading
both.

So the question is live and undecided: **should `bk` accept synonyms?**

- **For:** an LLM guesses `get`/`show`/`view` and a wrong guess costs a round trip
- **Against:** cobra prints "unknown command" plus suggestions already — check
  what it actually prints for `bk issues issue get` before assuming it is a dead
  end. `groups_test.go` guards that a mistyped subcommand errors rather than
  silently helping
- **The middle:** cobra's `Aliases:` field on the existing command is one line and
  does not create a second command tree, which is what the deleted file did

Report the choice with reasoning. Only implement if the answer is obviously the
one-line form.

### Item 3 — agents don't run `bk skill sync` before guessing

The ask is that the **first** unknown-command failure suggests it.

`deprecations.go` already turns known-moved spellings into a hint. This asks for
the *unknown* case. Check `hintFor()` in `cmd/bk/main.go` — it may already do
some of this. **Do not add a second hint mechanism beside the existing one**; the
repo has a rule about that, and the audit found hints that pointed at nothing.

### Item 4 — dead links `/agent-updater` and `/changelog`

**Mostly already answered, and one part must NOT be "fixed".**

`CLAUDE.md` records that the `/changelog` **page** was removed on 2026-08-03 and
says **do not reintroduce it**. `/api/changelog` is the surface, plus
`bk changelog`. So:

- **Do not add a `/changelog` page.**
- `/agent-updater` — find out whether it ever existed. If not, the fix is the
  message that was shared, not the app.
- A redirect from `/changelog` → `/api/changelog` is a legitimate small fix **if**
  it does not resurrect the page. There is precedent: `/api/openapi.json`
  answers 410 with a `suggestion` rather than 404, because "a 410 with a
  suggestion is something an agent on stale context can act on."
- The URLs in the report are `bc-issues.vercel.app`. The app has been on
  `issues.blackcode.ch` since before then — note whether the shared advice is
  simply pointing at the wrong host.

### Item 5 — Windows: npm install, and `bk login --token`

Two separable problems.

**`--token` is a BOOLEAN flag** — it means "read the token from stdin", not
"here is the token". So `--token <value>` and `--token=<value>` both fail, and
both are the natural guess. Confirmed in its help: *"Paste a pre-existing token
from stdin instead of opening a browser."*

**This is the most fixable item in the file.** The flag's own help and its error
should show the working invocation:

```
echo <token> | bk login --token
```

Make the failure message name the fix. That is a small change with a clear test.

**The PowerShell execution-policy half is real and harder** — you cannot test it
without Windows. Do not guess a fix. Options worth reporting: the npm package's
`install.js` detecting the shim problem, documenting `bk.cmd`, or a note in the
install docs. **Say plainly that you could not test it.**

## 2. Deliverable

`Todo/report-2-issues-feedback.md`:

1. **The triage table first** — one row per item: still broken / already fixed /
   collateral / never broken, with the evidence
2. What you fixed, and how you watched it work
3. What needs a decision, with the options and your recommendation
4. What you could not reproduce, and what would settle it
5. What in this plan was wrong

Then **update `Todo/issues-app-feedback.md` in place** — mark each item with its
outcome and a date. It says "not yet actioned" at the top; that must stop being
true or the next reader re-triages everything.

## 3. Rules

- **Three places for any behaviour change**: route → `bk` command + its `routes`
  annotation → a dated `docs/changelog/*.md` entry. Plus a guide topic if
  agent-visible behaviour changed.
- Never restore `aliases.go` without reading `alias_removal_test.go` first.
- `BK_CONFIG_DIR` always.
- Full gate before finishing; `make routes` if annotations changed.
- Commit as you go; do not push. Do not deploy.
- **If an item turns out to be a decision rather than a bug, stop and say so.**
  Four of these five are at least partly that.
