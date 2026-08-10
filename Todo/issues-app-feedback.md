# Issues App — User Feedback (not yet actioned)

Collected 2026-08-10 from user/agent reports on `bc-issues` (issues.blackcode.ch + `bk` CLI). Not fixed yet — noted here for later triage. Duplicate reports of the same underlying problem are merged below.

---

## 1. Labels cannot be set/updated on an existing issue — CLI and REST both broken

Reported multiple times, independently, by different sessions:

- Client-meeting bug report: `bk issues issue edit` has no `--label` flag at all (confirmed via `--help`). REST `PATCH /api/workspaces/<ws>/issues/<id>` silently accepts a `labels`/`label_ids` field but does not apply it — no error, label just stays empty.
- Dogfooding session: `bk label attach --ws metaesthetics --issue 189 --label 58` → `error: unknown flag: --issue` (wrong/nonexistent flag shape).
- Same session: `bk issues issue view` output for an issue doesn't even include a `labels` field on the response shape, so there's no way to confirm a label stuck even if one could be set.
- Agent conclusion after exhausting options: labeling is effectively a **UI-only feature** right now — not exposed via CLI or REST at all. Agent had to abandon labeling and fall back to assignment + a tag convention in the title/description as a workaround.

**Why it matters:** retroactive/client-facing tagging is a common real workflow (label need becomes clear after the ticket is created, not at creation time). Currently labels can only be attached at `bk issues issue create --label` time.

**Ask:** decide the real command/flag shape (either `edit --label`/`--label-remove`, or a dedicated `bk issues issue label <id> --add/--remove`), make the REST PATCH actually apply label changes instead of silently no-opping, and include `labels` in issue view/get responses.

---

## 2. CLI verb guessing — no synonym aliasing for common command names

An agent using `bk issues` guessed at subcommand names that don't exist before landing on the right one:
- Tried `bk issues issue get` and `bk issues issue show` before finding the correct `bk issues issue view`.
- Same pattern for `update` vs. the correct `edit`.

This is a predictable failure mode: an LLM-driven agent will guess plausible verb synonyms (get/show/view, update/edit/set) rather than always checking `--help` first, and a wrong guess currently just fails outright.

**Ask:** consider aliasing common verb synonyms across the CLI (get/show/view → one command; update/edit/set → one command) so a reasonable guess succeeds instead of erroring. Would also reduce human typo friction.

---

## 3. Agents don't proactively run `bk skill sync` / check `/api/changelog` before guessing commands

A companion agent spent ~20 minutes guessing CLI commands and flags (`bk project` vs `bk issues project`, `bk issue update` vs `edit`, discovering `--description-file` by trial and error) instead of running `bk skill sync` or checking `/api/changelog` first — both of which would have surfaced the answer immediately (e.g. `/api/changelog` documents that `bk issue create` was renamed to `bk issues issue create`, legacy top-level aliases were removed, and `bk meta` top-level keys were deprecated in favor of `apps.<slug>`).

The user (Bala) had already told agents informally (in WhatsApp) to run `bk skill sync` when a command that used to work fails — but nothing prompts an agent to run it proactively, *before* guessing, and even reactively agents go straight to per-command `--help` instead.

**Ask:** consider having the CLI's "unknown command" error proactively suggest "this may be a renamed/removed command — try `bk skill sync`" on the *first* unknown-command failure, not just as general troubleshooting advice shared informally.

---

## 4. Dead links in shared/troubleshooting docs for self-updating (`/agent-updater`, `/changelog`)

Troubleshooting links shared informally (WhatsApp) for agents to self-diagnose "am I out of date" pointed at:
- `https://bc-issues.vercel.app/agent-updater` → `net::ERR_ABORTED` (doesn't resolve as a route)
- `https://bc-issues.vercel.app/changelog` → 404 Not Found

The actually-working endpoint is `https://bc-issues.vercel.app/api/changelog` (confirmed returns real changelog JSON/data). Neither dead link mentions the `/api/` prefix.

**Impact:** an agent (or human) following the shared/documented paths hits a dead end and may give up rather than find the working `/api/...` route.

**Ask:** either add redirects from `/agent-updater` and `/changelog` to their real `/api/...` counterparts, or fix the doc/shared-message text to reference the correct paths.

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
