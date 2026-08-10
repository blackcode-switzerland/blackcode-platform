# Marketing content

Source-of-truth content for the **issues app's** landing page and other marketing surfaces.
Paths below are relative to `apps/issues/`. Lists every feature, who it's for, what tone to write in, and which claims are real today vs. on the roadmap. The live page is `components/landing-page.tsx`; keep this brief and that page in agreement.

> **Honesty rule.** Every feature listed below carries a status tag:
> - **Live** — shipped, working in production today.
> - **In preview** — exists but with caveats; the caveats are spelled out.
> - **Coming soon** — not yet built; marketing may reference but must label clearly.
>
> Nothing on the page may be aspirational-presented-as-factual. If a claim isn't true today, it's either removed or tagged.

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Positioning](#positioning)
3. [Audiences](#audiences)
4. [Headline & sub-headline options](#headline--sub-headline-options)
5. [Feature catalog](#feature-catalog)
6. [Surface areas](#surface-areas)
7. [Architecture summary (for the "How it works" section)](#architecture-summary-for-the-how-it-works-section)
8. [Use cases](#use-cases)
9. [Roadmap (Coming soon, grouped)](#roadmap-coming-soon-grouped)
10. [Brand assets](#brand-assets)
11. [Voice & tone](#voice--tone)
12. [Landing-page outline (as built)](#landing-page-outline-as-built)
13. [FAQ seed](#faq-seed)
14. [Status quick-reference](#status-quick-reference)

---

## At a glance

- **Product name**: **blackcode issues**
- **Tagline (current)**: *AI-Native Issue Tracking*
- **One-line pitch**: An issue tracker designed for AI agents and the humans who direct them — clean integer IDs, a self-describing CLI that ships its own guide, and a polished web UI, over one data model.
- **Category**: Project / issue management. Adjacent to Linear, Jira, GitHub Issues.
- **License**: Internal (see repo for definitive terms).
- **Status**: Working alpha — usable end-to-end, with documented gaps the roadmap is closing.

---

## Positioning

Most issue trackers were built for humans clicking through forms. blackcode issues was built so an AI agent (or a power user at a terminal) can do the same work without losing context: integer IDs you can remember, a Go CLI that documents itself (`bk guide` ships inside the binary), predictable exit codes and machine-readable output, and a web UI for everyone else.

It's the **memory layer** of an AI-augmented workflow. The agent does the work; this is where the work lives.

### Three things that make it different

1. **Integer IDs everywhere.** No UUID hell. Agents (and humans) can refer to "issue 42" instead of `c47ad9b3-…`.
2. **Two interfaces, no gap between them.** A web UI for humans and a Go CLI for agents — same auth model, same data, kept honest by an automated parity test that fails the build if any capability exists in one and not the other.
3. **Reversible & recoverable.** Issue edits are journaled to a transaction log and reversible with one command; deletes soft-delete to a recoverable Trash.

---

## Audiences

### Primary

- **Solo developers and small teams** who want issue tracking without Jira-grade ceremony.
- **AI/agent builders** who need a place for the agent to read, write, and remember work — with an interface that's actually scriptable and self-describing.
- **Terminal-first developers** who'd rather type `bk issues issue create --title "..."` than open a tab.

### Secondary

- **Indie product teams** that want one tool covering Kanban + timeline + lists.
- **Operations / lightweight project owners** who need tasks and member roles without enterprise overhead.

---

## Headline & sub-headline options

Pick one set; vary tone to match the chosen design direction.

### Option A — confident technical (in use on the page)
- **H1**: Issue tracking for humans and the AI working alongside them.
- **Sub**: Integer IDs. A Go CLI that documents itself. A web UI built like Linear. One data model behind both.

### Option B — agent-forward
- **H1**: An issue tracker your agents can actually use.
- **Sub**: Memorable IDs, a self-documenting Go CLI with stable exit codes, and an undo button for the times your agent (or you) gets it wrong.

### Option C — pragmatic
- **H1**: A focused issue tracker. One for you, one for your agent.
- **Sub**: A web UI for humans, a CLI for agents. Same auth, same data, same workflows. Built for teams that move fast and the agents that help them.

---

## Feature catalog

The feature set the landing page can credibly draw from. Each card picks from this list and labels the status honestly.

### 🟢 Live — Identity & access

**Sign in your way**
Email + password (bcrypt-hashed, 8+ chars) or Google OAuth. The OAuth button only appears if you've configured the credentials, so self-hosters aren't pushed into Google.

**API tokens for scripts and agents**
Mint a `bk_live_…` token from settings (`/dashboard/settings/tokens`) or via `bk login`. Stored as a SHA-256 hash with a short visible prefix so you can see "which token did what" without ever exposing the secret again. Optional expiry; one-click revoke.

**Workspaces, teams & roles**
Everything lives under a workspace. Invite members by email; workspaces have **owners** and **members**, with owner-only gates on destructive actions (delete, transfer, etc.). Projects additionally carry their own member roles — **owner, admin, member, viewer**.

**Super admin (self-host)**
Platform administration is opt-in via the `SUPER_ADMINS` environment variable (comma-separated emails) plus an email-whitelist table — no "promote yourself" button, no database surgery. Super admins get platform-wide user/whitelist/error views.

### 🟢 Live — Project management

**Projects with rich metadata**
Name, summary, description, status, priority, color, icon, lead, start/end dates — all server-validated. Each project gets its own member roster, its own Kanban, and posted **health updates** (on track / at risk / off track).

**Tasks**
Group issues into tasks with optional due dates. A task can stand alone or belong to a project, and surfaces its issue counts and its own comment thread.

**Labels**
Workspace-wide labels with colors, attachable to issues — managed from a dedicated labels view.

**Move & copy across workspaces**
Reorganize as you grow: move or copy projects, tasks, and issues between any two workspaces you belong to. It's a single atomic transfer — items get fresh per-workspace numbers, and their labels, comments, attachments, watchers, and members come along. Nothing is lost if it fails, and anything the destination can't hold (like a member who isn't on the other team) is reported back rather than silently changing your data. Available from the `bk` CLI (`bk issues move` / `bk issues copy`) and the API.

### 🟢 Live — Issue workflows

**Issues with the fields that matter**
Title, rich-text description, status (`backlog` / `todo` / `in_progress` / `done` / `cancelled`), priority (1 Urgent … 4 Low, 5 None), one or more assignees, reporter, project, task, start date, due date, estimated hours, labels, watchers.

**Three views, one dataset**
- **Kanban board** — drag-and-drop columns per status, with optimistic, persisted moves.
- **Gantt / timeline** — issues and projects placed on a date axis from their start/due dates.
- **List** — dense, filterable rows across projects (status, priority, assignee, project filters).

**Rich-text descriptions and comments**
A TipTap editor with a slash menu, a selection bubble toolbar, headings, lists, checklists, code blocks, links, `@mentions`, and inline media (paste / drag / attach). HTML is sanitized before save. Comments work the same way on issues, projects, and tasks.

**File attachments**
Paste, drag, or attach **any file type except SVG** (blocked for XSS safety), up to **100 MB**. Stored on Vercel Blob in production; served from `public/uploads/` in local development so you can iterate offline.

**Activity feed & inbox**
Every mutation is recorded on an append-only **event spine**. That powers a per-issue history, a workspace-wide activity feed, and a per-user **inbox** of mentions, assignments, and changes.

### 🟢 Live — For agents & automation

**Integer IDs**
Every record — projects, issues, tasks, comments, attachments, members, tokens — uses a plain integer primary key. "Issue 42" is easier to dictate, grep, and keep in a model's working memory than a UUID.

**Two interfaces, no gap between them**
- **Web UI** at `/dashboard` — for humans.
- **Go CLI** `bk` — for agents and scripts. Table/JSON/YAML output, stable exit codes, and `bk guide` for usage. The HTTP routes underneath are private plumbing with no public contract.

Both share the same auth and data model. Anything you can do in one, an agent can do with the other — and a parity test fails the build if a capability exists in one and not the other.

**Self-describing CLI**
The full surface is `bk guide` — the complete usage guide, **embedded in the binary**, so it always describes the version the agent is running and works offline. `bk meta` returns the caller's context — active workspace, the valid status/priority **vocabulary**, and every server-enforced limit — so an agent never has to guess a value.

**Predictable failures**
Stable exit codes to branch on (auth→3, permission→4, not-found→5, validation→6, client-too-old→8, update-available→9), plus a `hint:` line on stderr that names the fix — a renamed flag, an upgrade, `bk skill sync` — so a stuck run can recover itself instead of stopping.

### 🟢 Live — Recovery

**Trash & restore**
Deleting an issue, project, or task moves it to a recoverable Trash. Items deleted together restore as a group; owners can purge selected items or empty the bin.

### 🟢 Live — Analytics

**Workspace analytics**
Snapshot counts, completion rate, cycle time, velocity, and aging — sliced by status, priority, assignee, label, and project, with per-task burndown. Available for workspace / project / task / member views with date-range and faceted filters, and reachable from the CLI (`bk issues analytics`).

### 🟡 In preview — Reliability

**Instant rollback (undo)**
Issue updates are journaled to a transaction log with full `old_data`/`new_data` snapshots. `POST /api/undo` or `bk undo --count N` reverses your most recent operations (up to 10 per call) and marks them rolled back.

**Caveats** (be transparent on the page):
- Coverage today is **issue updates** (creates can be undone by deleting the row). Deletes are recovered via **Trash** instead; comments, attachments, and project/member/task mutations are not yet journaled for undo.
- Broader coverage is on the roadmap.

### 🟢 Live — Polish

**Dark mode, by default**
Theme controlled by `next-themes` (class strategy, dark default). Color tokens live in `app/globals.css` and use OKLCH for perceptually uniform neutrals.

**Designed around a single brand color**
Re-theming the whole app — buttons, gradients, focus rings, hover states — is one edit: change `--primary` in `app/globals.css`.

**Built on Tailwind v4 + shadcn/ui**
Polished defaults, accessible Radix primitives, and full ownership of every component file in `components/ui/`.

---

## Surface areas

The landing page should make it obvious there are **two** ways in, matched to who is using it. Do not present the HTTP routes as a third — they are private plumbing, and saying otherwise invites integrations we will not support.

### Web (`/dashboard`)
For humans. Kanban, Gantt/timeline, list, issue detail with rich text, comments, attachments, analytics.

### CLI (`bk`)
A single Go binary distributed on npm as `@blackcode_sa/bc-issues`. `bk login` opens a browser to authenticate and drops the token in `~/.config/bk/config.json`. Commands for everything the web does. Output as table / JSON / YAML, with stable exit codes for scripts and agents.

```bash
npm install -g @blackcode_sa/bc-issues
bk login --server https://your-deployment.app
bk issues workspace use my-team
bk issues issue list --status todo --json
```

---

## Architecture summary (for the "How it works" section)

For the "How it works" landing-page section. Show that this isn't a black box.

```
┌──────────────┐        ┌────────────────────────┐
│   Web (you)  │        │  Agent / script → bk   │
└──────┬───────┘        └───────────┬────────────┘
       │ session cookie             │ Bearer token
       │                            │
       └─────────────┬──────────────┘
                     ▼
        ┌─────────────────────────────────┐
        │   Next.js — /api/*              │
        │   private plumbing, no contract │
        │   resolveAuth() unifies auth    │
        └─────────────────┬───────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │   Postgres + Drizzle    │
            │   Integer PKs, indexed  │
            │   Event spine · Trash   │
            └─────────────────────────┘
```

Three call-out facts the page can use:

- **Same auth everywhere.** Bearer token or session cookie — pick one per request. The backend resolves the user the same way.
- **One data model.** Every interface reads and writes the same Postgres tables, all workspace-scoped.
- **Reversible by design.** Issue updates are journaled; deletes recover from Trash. Broader undo is coming.

---

## Use cases

Concrete scenarios to ground the abstract claims:

### "I'm a solo developer with three side-projects"
Spin it up locally with Docker, sign in with a password, organize work into projects, use Kanban when triaging and the list view when executing.

### "My agent should manage issues for me"
Run `bk login`, then `bk skill install` — your coding agent gets a ~30-line skill file pointing it at `bk guide` and `bk meta`. It now reads, writes, and comments using the same data you see in the web UI.

### "I scripted a release process"
`bk issues issue list --status in_progress --json | jq '.data[].id' | xargs -I{} bk issues issue edit {} --status done` — and use stable exit codes to fail-fast in CI.

### "I made a mistake during an update"
`bk undo --count 5` restores your last five issue edits; an accidental delete comes back from `bk trash restore`.

### "I'm comparing this to Linear/Jira"
You won't find sprint planning, custom fields, or advanced permissions yet. You will find a clean, documented API, an honest data model, integer IDs you can dictate, and a CLI that doesn't suck.

---

## Roadmap (Coming soon, grouped)

For a public "What's next" section. Groupings, not specific dates.

### Reliability & safety
- Broader undo (creates, deletes, non-issue resources)
- Batch operations + batched undo
- Per-scope API tokens (read-only / per-project)
- Rate limiting for the public API

### Realtime & integration
- Webhooks / event stream over the existing event spine
- Saved filters and views
- Ranked full-text search (relevance + typo tolerance) — substring + #id search across lists, API and CLI already ships

### Product polish
- Notifications beyond the in-app inbox
- Mobile-friendly layouts
- Published performance benchmarks

> Note: contract testing partially shipped — a CLI↔routes parity test runs in `npm test`.

---

## Brand assets

### Color
- **Primary**: `#007bd3` (a blue), defined as `--primary` in `app/globals.css`.
  - Used for: primary buttons, focus rings, gradients, accent strokes, brand mark.
  - Identical in light and dark mode.
- **Neutrals**: OKLCH-based, defined in `app/globals.css`.
- **Destructive**: red (OKLCH).
- **Charts**: OKLCH values designed to read in both light and dark.

### Typography
- **Family**: Google Sans (`--font-sans`), served via Google's CSS API.
  - Note: Google Sans isn't in the public Google Fonts directory; for a commercial deployment that may attract licensing scrutiny, swap to Inter or DM Sans (open-licensed, visually similar) — see the root `docs/frontend.md` and `app/layout.tsx`.
- **Mono**: `ui-monospace, "SF Mono", "JetBrains Mono", Menlo`.

### Logo
- File: `public/logo.png`. Used in the header and as favicon.

### Voice marks
- `blackcode issues` — lowercase. Avoid title-case unless required by a parent context.
- `bk` — the CLI's binary name. Lowercase, mono font.
- `bk_live_…` — token prefix, mono font.

---

## Voice & tone

### What we sound like

- **Direct.** "We log every issue update so you can undo it" beats "leverage advanced audit trails."
- **Specific.** Numbers, formats, examples. `bk login` over "easy CLI authentication."
- **Confident without overclaim.** If a feature is in preview, say so. Honesty about gaps earns more trust than pretending they don't exist.
- **A little dry-witty.** "No more UUID chaos. Just speed." is fine. "Revolutionary AI-powered" is not.

### What we don't sound like

- ❌ Buzzword soup ("synergistic," "next-generation," "leverage")
- ❌ Vague superlatives ("the best," "world-class") with nothing behind them
- ❌ Aspirational copy presented as factual

### Phrases we like

- "One door: the CLI."
- "Integer IDs. No UUID hell."
- "A self-describing CLI."
- "Built for terminals, agents, and people."

---

## Landing-page outline (as built)

The live page (`components/landing-page.tsx`) is structured as:

1. **Hero** — H1/sub (Option A), CTAs: "Get started" (→ `/login?tab=signup`) and "Try the CLI" (→ `#cli`), product screenshot.
2. **Two surfaces** — Web · CLI, one card each, with a real example on each.
3. **Feature catalog** — status-pilled cards drawn from the Live/In-preview features above.
4. **Command line** — one-line install, a copy-paste quickstart, and how the CLI works.
5. **How it works** — the architecture diagram + four bullets (same auth, one data model, reversible, predictable failures).
6. **For agents** — a CLI snippet plus the four-command bootstrap, and the self-describing-CLI callout (`bk guide`, `bk meta`).
7. **FAQ** — from the seed below.
8. **Final CTA** — sign up / sign in.

> The page does **not** currently render a Roadmap section. The [Roadmap](#roadmap-coming-soon-grouped) section above is an internal planning reference only; don't describe it as live page content.

---

## FAQ seed

The seed mirrors the live page's FAQ (focused on the CLI and automation).

### How do agents discover and call the API?
An agent runs `bk guide` — the complete usage guide, embedded in the binary, so it always matches the version being run and works offline. Then `bk meta` for the live data: workspaces, the valid status/priority/health values, and every limit. Flags come from `bk <group> <command> --help`. Nothing has to be guessed or cached.

### How do I install and use the CLI?
`npm install -g @blackcode_sa/bc-issues`, then `bk login` (opens a browser, stores a token in `~/.config/bk/config.json`), `bk issues workspace use <slug>`, and you're working: `bk issues issue list`, `bk issues issue create --project 1 --title "…"`. Run `bk --help` for the full command tree.

### How do agents and scripts authenticate?
`bk login` opens a browser, captures a token and stores it in `~/.config/bk/config.json` — that is the whole flow. For headless runs, mint a token at `/dashboard/settings/tokens` and pipe it in: `echo "$TOKEN" | bk login --token`. Tokens carry optional expiry and can be revoked from the same page.

### Is the CLI scriptable for automation and CI?
Yes. Add `--json` or `-o yaml` for machine-readable output, pipe through `jq`, and branch on stable exit codes (0 ok, 3 unauthenticated, 4 forbidden, 5 not found, 6 validation, 7 aborted). Set `BK_NO_PROMPT=1` to skip confirmations in unattended runs.

### How does pagination work?
Most lists (issues, projects, tasks) come back in one response. The keyset feeds — activity, trash, super-admin errors — page with `--limit` / `--cursor`, and the CLI prints the next cursor on stderr so a script can follow it without parsing stdout.

### What happens when I delete something?
Issues, projects and tasks soft-delete into a recoverable Trash. Items deleted together restore as a group; workspace owners can purge selected items or empty the bin. 

### Can a team and its agents share a workspace?
Yes. Everything is workspace-scoped with members and roles; every change lands on a shared activity feed and a per-user inbox of mentions and assignments, so humans and agents on the same board stay in sync.

### What languages and stacks does the project use?
Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui, NextAuth, TanStack Query, and Framer Motion on the front; Postgres + Drizzle ORM on the server; Go for the CLI. See the root `docs/frontend.md`, `docs/backend.md`, `docs/cli.md`, and this app's own `docs/frontend.md` / `docs/backend.md`.

---

## Status quick-reference

A compact table for laying out a feature grid.

| Feature | Card title | Status pill |
|---|---|---|
| Integer IDs | "Integer IDs" | Live |
| Web + CLI parity (enforced by a build-failing test) | "Two surfaces" | Live |
| Google OAuth + email | "Sign in your way" | Live |
| API tokens | "API tokens for scripts" | Live |
| Workspace + project roles | "Teams & roles" | Live |
| Project CRUD + health updates | "Project management" | Live |
| Tasks | "Labels & tasks" | Live |
| Labels | "Labels & tasks" | Live |
| Issue CRUD + workflows | "Issue workflows" | Live |
| Kanban | "Kanban board" | Live |
| Gantt / timeline + list | "Timeline & list views" | Live |
| Rich-text issues & comments | "Rich-text issues & comments" | Live |
| File attachments (100 MB) | "File attachments" | Live |
| Activity feed & inbox | "Activity feed & inbox" | Live |
| Search (lists, API & CLI; by name or #id) | "Search everything" | Live |
| Self-describing CLI (`bk guide` / `bk meta`) | "Self-describing CLI" | Live |
| Trash & restore | "Trash & restore" | Live |
| Workspace analytics | "Workspace analytics" | Live |
| Dark mode | "Dark mode by default" | Live |
| Undo / rollback (issue updates) | "Reversible edits" | **In preview** |
| Batch operations | "Batch operations" | **Coming soon** |
| Webhooks / event stream | "Webhooks" | **Coming soon** |
| Per-scope API tokens | "Scoped tokens" | **Coming soon** |
| Notifications | "Notifications" | **Coming soon** |
| Saved filters | "Saved views" | **Coming soon** |
| Mobile UI | "Mobile" | **Coming soon** |

---

## See also

- [Frontend documentation](./frontend.md) — for build-time facts when wiring the page.
- [Backend documentation](./backend.md) — for accurate technical claims.
- [CLI documentation](./cli.md) — for CLI commands and snippets.
