# Issues App — User Feedback (TRIAGED 2026-08-11 — see the outcome on each item)

Collected 2026-08-10 from user/agent reports on `bc-issues` (issues.blackcode.ch + `bk` CLI). Duplicate reports of the same underlying problem are merged below.

> **Triaged and actioned 2026-08-11.** Full working, evidence and the two open
> decisions: **`Todo/report-2-issues-feedback.md`**. Each item below carries an
> `Outcome:` block — read it before acting on the item, because three of the five
> describe something that was not broken, and one was already fixed by
> `9d568c1` on the same day.
>
> | Item | Outcome |
> |---|---|
> | 1 | **Mixed.** The silent-`PATCH` half was real and is fixed (`e0e9458`). "Labeling is UI-only" was never true |
> | 2 | **Already fixed** by `9d568c1`, before this triage. Verified: 162 probes, 0 dead ends |
> | 3 | **Already fixed.** Every unknown command already names `bk skill sync` |
> | 4 | **Never broken** — `/agent-updater` is a misspelling of `/agent-updator`. Both paths now 307 (`49a980d`) |
> | 5 | **Half fixed** (`1431db6`). The Windows PowerShell half is **untested** — no Windows machine |
>
> **One thing here is still open and is a product decision, not a bug:**
> whether `bk issues issue edit` should gain `--label`. Report 2 §3 recommends
> yes, as a CLI-only change. Nothing was implemented for it.

---

## 1. Labels cannot be set/updated on an existing issue — CLI and REST both broken

Reported multiple times, independently, by different sessions:

- Client-meeting bug report: `bk issues issue edit` has no `--label` flag at all (confirmed via `--help`). REST `PATCH /api/workspaces/<ws>/issues/<id>` silently accepts a `labels`/`label_ids` field but does not apply it — no error, label just stays empty.
- Dogfooding session: `bk label attach --ws metaesthetics --issue 189 --label 58` → `error: unknown flag: --issue` (wrong/nonexistent flag shape).
- Same session: `bk issues issue view` output for an issue doesn't even include a `labels` field on the response shape, so there's no way to confirm a label stuck even if one could be set.
- Agent conclusion after exhausting options: labeling is effectively a **UI-only feature** right now — not exposed via CLI or REST at all. Agent had to abandon labeling and fall back to assignment + a tag convention in the title/description as a workaround.

**Why it matters:** retroactive/client-facing tagging is a common real workflow (label need becomes clear after the ticket is created, not at creation time). Currently labels can only be attached at `bk issues issue create --label` time.

**Ask:** decide the real command/flag shape (either `edit --label`/`--label-remove`, or a dedicated `bk issues issue label <id> --add/--remove`), make the REST PATCH actually apply label changes instead of silently no-opping, and include `labels` in issue view/get responses.

> **Outcome 2026-08-11 — three of the four claims are false; the fourth is the
> real defect.** Commit `e0e9458`.
>
> - *"labeling is effectively a UI-only feature"* — **never true.**
>   `bk issues label attach <issue_id> <label_id>` and `detach` exist and were
>   watched working end to end. The reporter typed `bk label attach --ws …
>   --issue … --label …`: the bare tier (moved 2026-08-10) **and** flags where
>   the command takes two positionals.
> - *"PATCH silently accepts and ignores `labels`/`label_ids`"* — **TRUE, and
>   FIXED.** It now answers **400 `labels_not_patchable`** with a suggestion
>   naming the working command. It is not made to apply labels: they are a
>   sub-resource with its own create-by-name behaviour, and that stays the one
>   write path.
> - *"`issue view` doesn't include a `labels` field"* — **never true.** The route
>   has always returned `labels`. The CLI printed its `Labels:` line only when
>   the list was non-empty, so an unlabeled issue looked like a response with no
>   such field. It now always prints, showing `—`. **This is why the reporter
>   could not confirm anything had worked.**
> - *"`issue edit` has no `--label` flag"* — **TRUE, and STILL OPEN.** A product
>   decision, not a bug. Report 2 §3 recommends adding `--label` /
>   `--label-remove` over the existing sub-resource routes, accepting names like
>   `create --label` does. **Not implemented.**
>
> Discoverability — which report 2 judges the bigger finding, since two people
> concluded "this does not exist" while the command was one `--help` away —
> is addressed in `bk guide issues/items`, new section *"Labels on an issue that
> already exists"*.

---

## 2. CLI verb guessing — no synonym aliasing for common command names

An agent using `bk issues` guessed at subcommand names that don't exist before landing on the right one:
- Tried `bk issues issue get` and `bk issues issue show` before finding the correct `bk issues issue view`.
- Same pattern for `update` vs. the correct `edit`.

This is a predictable failure mode: an LLM-driven agent will guess plausible verb synonyms (get/show/view, update/edit/set) rather than always checking `--help` first, and a wrong guess currently just fails outright.

**Ask:** consider aliasing common verb synonyms across the CLI (get/show/view → one command; update/edit/set → one command) so a reasonable guess succeeds instead of erroring. Would also reduce human typo friction.

> **Outcome 2026-08-11 — ALREADY FIXED**, by `9d568c1`, hours before this triage
> and independently of this file. `cli/internal/commands/synonyms.go` attaches
> cobra `Aliases` by a tree walk: `view`/`show`/`get`, `list`/`ls`,
> `create`/`add`/`new`, `edit`/`update`, `delete`/`rm`/`remove`. A spelling a
> sibling already owns is never reassigned, and the app tier is still mandatory
> — `bk issue view` remains an error with a deprecation hint.
>
> **Verified against a built binary, not by reading:** a walk of the whole tree
> ran **162 synonym probes across 45 groups and 208 leaves — 0 dead ends**, with
> a control (`bk issues issue frobnicate`) confirming the sweep could see one.
> All three reported spellings (`issue get`, `issue show`, `issue update`)
> resolve.

---

## 3. Agents don't proactively run `bk skill sync` / check `/api/changelog` before guessing commands

A companion agent spent ~20 minutes guessing CLI commands and flags (`bk project` vs `bk issues project`, `bk issue update` vs `edit`, discovering `--description-file` by trial and error) instead of running `bk skill sync` or checking `/api/changelog` first — both of which would have surfaced the answer immediately (e.g. `/api/changelog` documents that `bk issue create` was renamed to `bk issues issue create`, legacy top-level aliases were removed, and `bk meta` top-level keys were deprecated in favor of `apps.<slug>`).

The user (Bala) had already told agents informally (in WhatsApp) to run `bk skill sync` when a command that used to work fails — but nothing prompts an agent to run it proactively, *before* guessing, and even reactively agents go straight to per-command `--help` instead.

**Ask:** consider having the CLI's "unknown command" error proactively suggest "this may be a renamed/removed command — try `bk skill sync`" on the *first* unknown-command failure, not just as general troubleshooting advice shared informally.

> **Outcome 2026-08-11 — ALREADY FIXED.** `hintFor()` in `cmd/bk/main.go` does
> exactly this, statelessly, so it fires on the **first** failure. Watched at
> three depths:
>
> ```
> $ bk issues issue frobnicate
> error: unknown command "frobnicate" for "bk issues issue" (have: activity, assign, …)
> hint: that command or flag may have been renamed or removed — run `bk issues issue --help`
>       to see the current ones, `bk guide` for usage, or `bk skill sync` to update your agent skill
> ```
>
> It also names the **real group** rather than a placeholder. A known-moved
> spelling gets the specific replacement instead, plus the same `bk skill sync`
> line. **No second hint mechanism was added** — the repo has a rule about that.

---

## 4. Dead links in shared/troubleshooting docs for self-updating (`/agent-updater`, `/changelog`)

Troubleshooting links shared informally (WhatsApp) for agents to self-diagnose "am I out of date" pointed at:
- `https://bc-issues.vercel.app/agent-updater` → `net::ERR_ABORTED` (doesn't resolve as a route)
- `https://bc-issues.vercel.app/changelog` → 404 Not Found

The actually-working endpoint is `https://bc-issues.vercel.app/api/changelog` (confirmed returns real changelog JSON/data). Neither dead link mentions the `/api/` prefix.

**Impact:** an agent (or human) following the shared/documented paths hits a dead end and may give up rather than find the working `/api/...` route.

**Ask:** either add redirects from `/agent-updater` and `/changelog` to their real `/api/...` counterparts, or fix the doc/shared-message text to reference the correct paths.

> **Outcome 2026-08-11 — neither path was broken; both now redirect anyway.**
> Commit `49a980d`.
>
> - **`/agent-updater` is a misspelling.** The page is `/agent-updator` and has
>   been since it shipped — `updater` is the correct English spelling, which is
>   why anyone writing the link from memory reaches for it. The typo is
>   load-bearing (`X-BK-Help`, `/api/docs` and the changelog all name it), so the
>   guess is redirected rather than the page renamed.
> - **`/changelog` 404s by design.** The page was deliberately removed
>   2026-08-03 and **must not** be reintroduced. It now 307s to `/api/changelog`,
>   which is a signpost to the replacement surface, not a reinstatement — a
>   config guard asserts the destination starts with `/api/`.
>
> Both **307**, not 308: a permanent redirect is cached past our ability to fix
> it, and both point at spellings we may yet want to change.
>
> **The host was fine.** The report's `bc-issues.vercel.app` answers — the
> reporter confirmed `/api/changelog` returned real data there. Only the paths
> were wrong.

---

## 5. `npm install -g` of the `bk` CLI fails/hangs on default Windows PowerShell execution policy; `bk login --token` flag is ambiguous

On a fresh Windows machine:
- `npm install -g @blackcode_sa/bc-issues` via PowerShell fails: `npm : File ...\npm.ps1 cannot be loaded because running scripts is disabled on this system` (default PowerShell execution policy blocks npm's `.ps1` shim).
- Retrying via `cmd.exe /c npm install -g ...` then hit `EBUSY: resource busy or locked` on the package's bin shim (likely a leftover lock from the aborted PowerShell attempt).
- `bk --version` worked anyway (binary was actually present/functional despite the noisy install failure).
- `bk login --token <value>` failed two different ways before succeeding:
  - `bk login --token bk_live_...` (space-separated) → "empty token" error
  - `bk login --token="bk_live_..."` → "invalid argument for --token flag; strconv.ParseBool error" (flag appears to be boolean/stdin-triggered, not value-holding)
  - Correct form: `echo <token> | bk login --token` (stdin pipe) — and even this only worked once routed through `bk.cmd` explicitly via `cmd.exe` (failed under PowerShell's script-execution block on `bk.ps1`).

**Impact:** a brand-new agent or human on a default Windows setup hits 4 distinct failure modes before a successful login, none of which point at "use cmd.exe / bk.cmd instead of the PowerShell shim" or the exact stdin-pipe syntax for `--token`.

**Ask:**
1. Installer/first-run should detect the PowerShell execution-policy block and either work around it or print an explicit fix (`Set-ExecutionPolicy` guidance, or "use bk.cmd via cmd.exe").
2. `bk login --token` help text / error messages should show the exact working invocation (`echo <token> | bk login --token`) instead of failing ambiguously on the two natural-guess forms (space-separated value, `--token=value`).

> **Outcome 2026-08-11 — ask 2 FIXED; ask 1 documented but UNTESTED.**
> Commit `1431db6`.
>
> **`--token` (fixed).** The flag stays a **switch**, and that is a security
> property rather than an oversight: a flag value puts the token in the shell
> history, the process list and any CI log of the command line; stdin puts it in
> none of them. So every wrong guess now names the working line instead:
>
> | Spelling | Now |
> |---|---|
> | `--token=<v>` | the pflag error **plus** a `hint:` naming `echo <token> \| bk login --token` |
> | `--token <v>` | `--token takes no value …` + the piped form |
> | `--token`, no pipe | `no token on stdin …` + the piped form + how to mint one |
>
> All three now exit **2** (usage) rather than **1** — the exit-code table always
> promised 2 for a flag mistake, and these fell through to 1 silently. If you
> branch on `$?`, a mistyped `--token` moved from 1 to 2.
>
> **PowerShell (NOT tested).** `bk guide platform/install-auth` gained a Windows
> section naming `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, the
> `cmd.exe` / `bk.cmd` route around the block, and the `EBUSY`-on-retry symptom.
> **I have no Windows machine and none of it was run.** The installer-side
> detection in ask 1 was deliberately NOT built: a detector for a failure nobody
> has observed is a guard that has never been watched fail. What would settle it
> is one run on a fresh Windows box — report 2 §4.
