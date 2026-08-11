# The sales app — master plan

> # ⚠️ SUPERSEDED — 2026-08-07. DO NOT FOLLOW THIS AS INSTRUCTIONS.
>
> **`apps/sales` is built. This plan has shipped, and a shipped plan is a
> document prescribing a finished design** — which this repo's own rule
> (`CLAUDE.md`, Docs sync) says is worse than no doc.
>
> ## If you are adding an app, read [`adding-an-app.md`](adding-an-app.md)
>
> That document was rewritten on 2026-08-07 from what building this app actually
> found, and it is now self-contained. Its "what you no longer have to do"
> section is the half of this plan that was one-time platform work; you do not
> pay it again.
>
> ## Sales is deployed. 2026-08-10.
>
> `sales.blackcode.ch` is live. The runbook that got it there was walked end to
> end and then archived out of the repo, to
> `~/Documents/BAK/blackcode-platform-backups/salesImplementation/DEPLOY-TODO.txt`.
>
> **Do not follow this plan's database order.** It was rehearsed on 2026-08-07
> and it fails silently (CLAUDE.md guardrails #15, #16). The order that works is
> in [`adding-an-app.md`](adding-an-app.md), which also now carries what the real
> deployment found that no plan predicted.
>
> ## ⚠️ AND THREE OF ITS DECISIONS ARE SUPERSEDED — 2026-08-11
>
> The `multiAppFinalRefactor` (2026-08-10 → 2026-08-11) separated the apps: each
> owns its workspaces, members, invitations, labels, uploads ledger and event
> feed, and `platform.*` is identity plus an address book. Three decisions below
> described the world before that and are quotable enough that somebody will
> re-derive them. **The decisions are kept — the record of why an alternative was
> rejected is the point of this file — but do not implement them.**
>
> | Decision | What replaced it |
> |---|---|
> | **D-11** — the three CLI verb tiers (neutral / cross-app / app-owned) | **TWO tiers.** The middle one existed *because the apps shared a database*: `bk search` had one entity index, `bk storage` one upload ledger. Phases 2 and 3 ended that, so a bare data verb had no answer — only a default taken from whichever app the config was last homed on. D-11's TEST is unchanged and still right (*"would two deployments answer differently?"*); what changed is the facts it was applied to. Ten verbs moved behind the app name on 2026-08-10 and `bk link` was removed |
> | **D-28** — `storage` is cross-app, "you upload INTO one app and list ACROSS all of them" | **Expired on its own terms.** It kept `storage` bare because "uploads are ONE LEDGER against one workspace quota, so every app returns the SAME ROWS" — and `AppContext.uploads` made the ledger per app. Two deployments now answer differently, which is the test D-28 itself specifies. The STORE, the QUOTA and `platform.blob_references` are still shared; that is a different fact and it does not make the verb bare. **The pairing no longer describes anything that exists** |
> | **D-36** — a permanent platform-route subset is legitimate; an accidental one is a bug | **Still true, and now applied one level down.** `appverbs.Config` declares what an app serves VERB BY VERB, and as of 2026-08-11 subcommand by subcommand (`Invites` vs `InviteCandidates` / `InviteAccept`) — because `apps/_scaffold` serves the owner's half of invitations and not the invitee's |
>
> Two more sentences from this file that are now false, listed because they are
> short enough to be quoted out of context: per-app access is not a concept
> (`platform.workspace_apps`, `platform.app_access` and `requireAppAccess` were
> dropped on 2026-08-10 — membership is the whole gate), and there is no
> cross-app entity index for a second app to project into.
>
> The full record is `multiAppFinalRefactor/PLAN.md` and the seven agent reports
> beside it.
>
> ## What this file is still good for
>
> **The 44 numbered decisions, D-1 to D-44, and only those.** They are the record
> of what was chosen and *why the alternative was rejected*, and several were
> re-litigated during the build and held. Where a decision was later amended the
> amendment is in `adding-an-app.md` or `platform-architecture.md`, not here:
>
> | Decision | Amended by |
> |---|---|
> | D-36 (platform route subsets) | *a permanent subset is legitimate, an accidental one is a bug, and the test is whether every bare verb has a host from THIS app's login* — `adding-an-app.md` §11, `platform-architecture.md` §7.6 |
> | D-38 (the scaffold's slug) | done: `template` → `scaffold` |
> | D-39 (`NEXTAUTH_SECRET`) | `docs/env.md`, which said the opposite |
>
> **Everything else in this file — the phase plan, the checklists, the test
> plan, the timings — describes work that is finished.** The ~30 findings its
> phases accumulated have been moved into `adding-an-app.md`; that is where they
> are maintained now.
>
> **Do NOT delete this file, and do not move it.** That line used to say "delete
> it once the decisions have somewhere better to live", which was wrong in a way
> nobody checked: **about 50 source files cite `docs/sales-app-plan.md` by full
> path** — `app-context.ts`, `handler.ts`, `root.go`, `platform.go`, half of
> `packages/platform-db`, and so on — each anchoring a D-number to the reasoning
> behind it. Deleting or moving this file turns every one of those into a
> citation of nothing, and this repo's own rule (CLAUDE.md finding #18) is that a
> citation is a claim about what the repo protects.
>
> If the decisions ever do get a better home, the move is: relocate the file,
> then `grep -rl 'sales-app-plan' ` and update every citation in the same commit.
> Checked 2026-08-10, when this file was a candidate for archiving and the
> citations are what stopped it.

---

**Status: SHIPPED 2026-08-07. Historical.**
Written 2026-08-06. Decisions settled 2026-08-06. Built 2026-08-06/07.

This is the phase-by-phase plan for adding **`apps/sales`** — blackcode's own
internal sales / business-development tracker — as the platform's **second real
app**.

> ## Read this box before anything else
>
> **Sales is the first app added after the platform migration. Half of this plan
> is not about sales at all.**
>
> The migration built a platform for N apps and then proved it with one. Six
> things only become visible when a second app is genuinely deployed on its own
> domain, and every one of them would otherwise be paid again by app three, four
> and five.
>
> **So Phase 1 fixes them once, properly, for every future app.** After sales
> ships, adding an app must be: copy the scaffold, write the domain, deploy. Not
> this document again.
>
> The measure of success is not "sales works". It is **Phase 13** — the scaffold
> and `docs/adding-an-app.md` updated so the next app never reads this file.
>
> *(2026-08-07: Phase 13 landed. This box's own test is therefore that you are
> not reading this file — see the superseded note above.)*

### The north star

Everything in this plan serves one behaviour:

```bash
# An agent is working in sales, and learns something that is an engineering problem.
bk sales comm log --prospect 3 --channel call --dir in \
     --body "Julien needs SSO before signing. Blocker for Q4."

bk issues issue create --title "SSO for StaffUp — blocks CHF 24k deal" --priority 1
# → created issue #512

bk link create bc:issues:blackcode/issue/512 bc:sales:blackcode/prospect/3 --rel blocks

bk sales prospect show 3        # the linked issue is right there on the prospect
```

**One login. One token. One binary. No re-auth, no server switch, no confusion
about which app anything landed in.** If a step in this plan does not serve that,
it is scope creep.

| I want to… | Go to |
|---|---|
| Know what we're building | [§1 The product](#1-the-product) |
| Know what we're deliberately not building | [§2 Non-goals](#2-non-goals) |
| Understand why this isn't just "copy the scaffold" | [§3 What the research found](#3-what-the-research-found) |
| See every decision and its reason | [§4 Decisions](#4-decisions-all-settled) |
| Understand the app boundary rules | [§4.1 D-11](#d-11-the-cli-verb-tiers--the-boundary-an-agent-can-see) |
| See the schema | [§5 Domain model](#5-domain-model) |
| See the agent surface | [§6 CLI](#6-the-cli-surface) · [§7 HTTP](#7-the-http-surface) |
| See the screens | [§8 Web](#8-the-web-surface) |
| **Start working** | [§9 The phases](#9-the-phases) |
| Prove it works | [§10 Test plan](#10-test-plan) |
| Ship it | [§11 Provisioning and release runbook](#11-provisioning-and-release-runbook) |
| Make the next app easy | [Phase 13](#phase-13--make-the-next-app-easy) |

---

## 1. The product

### 1.1 One paragraph

**b/sales is blackcode SA's internal record of its own sales pipeline.** It
tracks prospects, the deal on each one, the people at each one, every
communication with them, every meeting, every objection raised, and the catalog
of what we sell (products), how we say it (templates) and what we attach
(documents). It exists so the question *"what do we tell this client, what do we
sell them, and how"* stops being reinvented every time.

**It is agent-first to a degree the issue tracker is not.** In `apps/issues`, the
web UI and the CLI are peers. In sales, **the CLI is the writer and the web is
the window.** An AI agent operating `bk sales …` records essentially everything;
a human opens the web app to read, filter, search and judge.

### 1.2 The doctrine, inherited from the mockup

Four rules from `bsales-mockup` that must survive into the real app, because they
are the product, not the styling:

1. **The app is a ledger, not a control surface.** There is no chat box, no
   "approve" button, no AI running inside the web page. Everything the app shows
   is a record of something that already happened, written by the agent through
   its own tools. (`INSTRUCTIONS.md` UPDATE 2 — the one idea the mockup got wrong
   and then corrected.)
2. **Triangulation is the reason it exists.** Client × Product × Message. The
   three corners are `prospects`, `products`, `templates`; the *result* of
   matching them is stored data displayed on the prospect page. **The matching
   itself runs in the agent, never in the browser or the server.**
   (`UPDATE-7.md` item 8.)
3. **Multi-channel is first class.** A prospect shows "3 emails, 2 WhatsApp, 1
   call" at a glance. Communications are not an email log with extras.
   (`INSTRUCTIONS.md` UPDATE 2, point 3.)
4. **Meetings are their own record, not a calendar.** A ledger of what was
   discussed and what is scheduled — no month grid, no drag-to-reschedule.
   (`INSTRUCTIONS.md` UPDATE 3.)

### 1.3 The pages the mockup validated

Reference: `bsales-mockup/README.md`, `_screenshots/*.png`, and
`assets/js/data.js` (the mockup's single source of truth — **read it before
writing the schema**; §5 is derived from it).

| Mockup file | Becomes |
|---|---|
| `app-1-today.html` | `/dashboard/{ws}` — Today |
| `app-dashboard.html` | `/dashboard/{ws}/metrics` — analytics |
| `app-prospects-list.html` | `/dashboard/{ws}/prospects` — table + board |
| `app-2-prospect-detail.html` | `/dashboard/{ws}/prospects/{n}` — 4 tabs |
| `app-meetings.html` | `/dashboard/{ws}/meetings` |
| `app-communications.html` | `/dashboard/{ws}/communications` |
| `app-activity-log.html` | `/dashboard/{ws}/activity` |
| `app-products.html` | `/dashboard/{ws}/products` |
| `app-templates.html` | `/dashboard/{ws}/templates` |
| `app-documents.html` | `/dashboard/{ws}/documents` |
| `app-settings.html` | `/dashboard/settings/*` |

---

## 2. Non-goals

Explicit, so nobody re-litigates them mid-build. Each is *excluded from v1*, not
rejected forever.

| Excluded | Why |
|---|---|
| **Gmail / Drive / Calendar integration** (`UPDATE-8.md`) | The mockup's later direction was to back comms/documents/meetings with Google Workspace via Composio MCP. **Out of scope.** Sales stores its own records; the agent writes them with `bk`. Where the agent got the fact is the agent's business. The schema keeps `external_ref` columns so this can be added later without a migration of meaning. |
| **Any "connect an account" UI** | Follows from the above. No OAuth flows, no connection status page. |
| **A live recommendation / matching engine** | Triangulation results are *stored*, computed by the agent. Building a matcher in the app contradicts the doctrine and doubles the surface. |
| **FR/EN bilingual** | English only. The mockup's `lang.js` does not port. |
| **Workspace switching UI** | See [D-3](#d-3-workspaces-stay-in-the-data-model-and-out-of-the-ui). |
| **Voice/audio capture in the browser** | `platform-ui` has a voice recorder; sales has no browser writer to attach it to in v1. |
| **Kanban drag-to-reorder** | The board is a *view*, and the web is read-mostly. Stage changes happen via `bk sales prospect stage`. |
| **Separate Company / Contact / Deal objects** | v1 keeps the mockup's shape: one `prospect` carries the deal. See [D-5](#d-5-a-prospect-is-the-deal-in-v1). |
| **Platform comments on sales records** | See [D-13](#d-13-sales-has-no-platform-comments-in-v1). |
| **Email sending, WhatsApp sending** | The app records that a message was sent. It never sends one. |
| **The Metaesthetics JV campaign panel** | See [D-15](#d-15-no-single-client-campaign-panel). |

---

## 3. What the research found

I read the platform (`apps/issues`, `apps/_template`, all seven `packages/platform-*`,
the whole `cli/` tree, and every file in `docs/`) and the mockup
(`bsales-mockup`, all 12 pages, `data.js`, and the full `UPDATE-1..10` paper
trail).

**`docs/adding-an-app.md` is accurate and its steps 1–6 will work.** But it was
walked with a *throwaway* app that was never deployed and never had a web UI. Six
things only appear when a second app is deployed for real. **They are the reason
Phase 1 exists, and every one of them is a one-time cost for the whole platform,
not a sales cost.**

### 3.1 The six

#### B-1 — `bk` has exactly one server, and no way to reach a second app 🔴

`cli/internal/config/config.go` stores a single `Server` string. Every request in
`cli/internal/client/client.go` is built against it. So a `bk` logged in to
`issues.blackcode.ch` sends `bk sales prospect list` to the **issues** server,
which has no such route → 404.

The platform already anticipated this and left the hook in place:
`platform.apps.base_url` exists (`packages/platform-db/src/schema.ts:143`) and
`GET /api/meta` already serves it per app
(`apps/issues/app/api/meta/route.ts:161`), with a comment that says exactly what
it is for:

> *"An agent reads a different app's vocabulary from that app's own /api/meta,
> which is what `base_url` is for."*

Nothing consumes it. → [D-1](#d-1-the-cli-carries-an-app-address-book).

#### B-2 — every "platform verb" route physically lives in `apps/issues` 🔴

`bk workspace`, `bk label`, `bk upload`, `bk trash`, `bk search`, `bk activity`,
`bk link`, `bk token`, `bk member`, `bk invite`, `bk inbox`, `bk storage`,
`bk profile`, `bk super-admin` are all *bare* verbs by design — but every one of
their route handlers is a file under `apps/issues/app/api/**`.
`sales.blackcode.ch` would serve none of them.

Three concrete failures:

- **The sales web UI cannot fetch its own platform data.** A page on
  `sales.blackcode.ch` calling `/api/me` gets a 404 from its own origin.
- **`bk upload` would attribute sales files to issues.** `platform.uploads.app`
  is set by the *serving* app, so a file uploaded through the issues host is
  recorded as an issues file and lands under the `issues/` path prefix.
- **A sales-only user is locked out of the shared verbs.** `resolveWorkspace`
  requires app access *to the serving app*, so someone granted `sales` and not
  `issues` gets 403 on `bk search`.

The migration wrote down the trigger and named the owner
(`docs/2026-08-platform-migration.md`, *What is still owed*):

> **`apiHandler` / `resolveWorkspace` are duplicated in the scaffold** — *"The
> second **real** app — at which point two production apps need them unchanged,
> which is the test."*

→ [D-2](#d-2-platform-routes-become-shared-factories-mounted-by-every-app).

#### B-3 — shared tables have CHECK rules that only know the issues app 🔴

```
comments_parent_type_check         IN ('issue','task','project')   schema.ts:798
deletion_batches_root_type_check   IN ('project','task','issue')   schema.ts:725
```

A comment on a prospect is rejected by the database. A deleted prospect cannot be
recorded in the recycle bin. Second on the *still owed* list, with the second app
named as its owner. → [D-14](#d-14-shared-tables-become-app-qualified).

#### B-4 — `platform.app_access.role` cannot express "viewer" 🟠

```
app_access_role_check   IN ('owner', 'member')   schema.ts:219
```
Both can write. There is currently no look-but-don't-touch level in either app.
→ [D-7](#d-7-read-only-mode-is-an-affordance-switch-not-a-permission).

#### B-5 — the session cookie is per-host, so two web apps = two logins 🟠

`platform-architecture.md` §8, deferred since Phase 4: production sets
`__Host-`-prefixed cookies, and the `__Host-` prefix **cannot carry a `Domain`
attribute**. Moving to `.blackcode.ch` is a cookie **rename**, not a widening,
and it signs everyone out once. → [D-16](#d-16-one-login-across-every-app).

#### B-6 — the agent skill is named `blackcode-issues` 🟡

`cli/internal/skill/skill.go:34`. One binary, one skill, now two apps. The
content is already app-agnostic, so this is a rename with a migration path. The
real cost of leaving it: an agent doing sales work sees a skill named "issues"
and skips it. → [D-17](#d-17-the-skill-is-renamed-to-blackcode).

### 3.2 Things that already work and need nothing

Good news, and it is most of the hard part:

- **URNs, `platform.entities`, `bk search`, `bk link`** are app-generic today.
  `entity_type` is a free varchar and platform "deliberately does not enumerate"
  it (`schema.ts:272`). `bc:sales:blackcode/prospect/12` works the day we project.
- **`platform.events`** carries a NOT NULL `app` column and `bk activity --app sales`
  already filters on it. The mockup's Activity Log **is** this feed.
- **`platform.api_tokens` are already platform-wide.** A token minted in sales
  authenticates against issues and vice versa — same database, same identity.
  This is exactly the shared-login behaviour we want and it needs no work.
- **The blob delete gate** already has the two-proof design (registered scanner
  *or* `maintains_blob_index`) precisely so a second deployment does not break it.
- **`devops/release.sh`** is already app-agnostic: adding an app is one line.
- **`bk __routes`** is already per-app (fixed *by* the throwaway sales walk).
- **`docs/changelog/*.md`** is directory-discovered.

---

## 4. Decisions (all settled)

Numbered so they can be cited in code comments and overruled explicitly.
**All were confirmed on 2026-08-06. There are no open questions.**

### D-1 — the CLI carries an app address book

`bk` gains **per-app base URLs**, learned rather than configured.

- `config.json` grows `home_app`, `home_server` and `app_servers: {slug: base_url}`.
- `bk login` and `bk meta` refresh `app_servers` from `/api/meta` →
  `apps.<slug>.base_url` (already served today).
- **An app command group pins its own app.** `bk sales …` always resolves to
  `app_servers["sales"]`. It is not affected by any mode, default or previous
  command.
- Unknown app → non-zero exit and a hint:
  `hint: no server known for app "sales" — run 'bk meta' to refresh the app registry`.
  **Never silently fall back to the home server.** A wrong-server 404 has no
  visible cause; a named failure is recoverable inside the same agent run.
- `bk app list` shows every app, its server, and whether the token can reach it.
  `bk app use <slug>` switches the **home** app (what neutral verbs talk to and
  which app's lens `bk workspace list` uses).

**AMENDED 2026-08-06, from building it:**

- **The one-invocation override is `--app-server <slug>`, NOT `--app`.** Six
  commands already define a local `--app` **filter** (`search`, `activity`,
  `storage`, `changelog`, `guide`, `invite send`), and cobra resolves a collision
  between a persistent root flag and a local one **silently in favour of the
  local flag**. A root `--app` would have produced two invisible wrong
  behaviours: `bk --app sales storage list` filtered by sales but routed home,
  and `bk storage list --app issues` routed to issues but **not filtered** — an
  unfiltered list looks exactly like a filtered one, and no passing suite shows
  either. One token must not mean two things; that is the ambiguity D-11 removes
  from the verbs, and it does not go back in via the flags.
  `TestNoCommandShadowsTheRoutingFlag` guards it. *(Found because the routing
  table asserts on which server RECEIVED the request, not on the command
  succeeding.)*
- **The pin outranks the override.** `bk --app-server sales issues label list`
  goes to **issues**. A group that names its app cannot be talked out of it.
- **The server you reached wins for its own app.** Where a registered `base_url`
  disagrees with the host that just answered — vanity domain, preview,
  self-hosted — the host that answered is the one *proven* to serve this token. A
  registry column is a declaration; a successful auth is a proof.
- **No inference, ever.** A 2.x config with no registry fails loudly and names
  `bk meta` as the fix. Inferring a routing address means inferring which
  deployment receives a **write**, and for `bk <app> upload` a wrong guess
  misfiles a file permanently — `platform.uploads.app` has no undo. A 2.x user
  runs `bk meta` once; the changelog and `bk guide platform/apps` both say so.
- **`bk meta`'s side effect is load-bearing and must be tested as one.** Every
  recovery hint in the routing layer resolves to *run `bk meta`*. It shipped
  once during Phase 1d writing nothing — a patch that aborted after its first
  hunk — so all three hints pointed at a command that did not fix anything, and
  the suite stayed green because nothing covered what `bk meta` WRITES.

One login, one token, one binary, one version floor. Unchanged.

### D-11 — the CLI verb tiers — the boundary an agent can see

> **This is the decision that makes the whole thing legible to an agent, and it
> supersedes `CLAUDE.md`'s current line that "platform verbs stay bare".** That
> line was written when there was one app, and with one app it was correct.

Every `bk` verb falls into exactly one of three tiers, and **the tier is visible
in the command itself.**

| Tier | Verbs | Spelling | Server | Rule |
|---|---|---|---|---|
| **Neutral** — identical answer from any deployment | `login` `logout` `meta` `guide` `changelog` `skill` `version` `app` `workspace` `member` `invite` `token` `profile` `inbox` `super-admin` | bare | home | These touch identity and org data. No app owns them, so no app can be the wrong one |
| **Cross-app** — spans every app *by design* | `search` `activity` `link` | bare | home (reads shared tables) | Their whole purpose is to cross the boundary. Results are **tagged with the app they came from**. Making these app-scoped would destroy the north star |
| **App-owned** — the answer depends on the app | `upload` `trash` `storage` `label` | **`bk <app> <verb>`** | that app's server | The data is app-attributed. An implicit default here is precisely how a sales contract gets filed under issues |

So:

```bash
bk sales upload contract.pdf      # → sales. Written on the command. Unmissable
bk issues trash list              # → the issues recycle bin
bk search "acme"                  # → hits in BOTH apps, each tagged with its app
bk workspace list                 # → identity-level, any server, same answer
```

**Why move `upload`/`trash`/`storage`/`label` rather than add a `--app` flag:**
a flag can be forgotten and has a default; a namespace cannot. `bk sales upload`
reads the same way as `bk sales prospect create`, so an agent that has learned one
has learned the other. And it matches the shape the architecture already chose for
app nouns and for the same reason (`platform-architecture.md` §7.1: *"redundant-looking
on purpose"*).

**Migration:** the bare spellings become deprecation rows in
`cli/internal/commands/deprecations.go`, kept for two minor releases, each naming
its replacement. A stale script fails loudly with the new spelling on stderr —
which is the recovery path that table exists for.

**Guide:** a new `topics/platform/12-apps.md` states these three tiers, in this
order, as the first thing an agent reads about multi-app work.

### D-2 — platform routes become shared factories mounted by every app

Extract the shared route handlers out of `apps/issues/app/api/**` into
`packages/platform-api/src/routes/*` as **factories** taking an `AppContext`.
Each app mounts them in three lines:

```ts
// apps/sales/app/api/workspaces/[ws]/search/route.ts
import { searchRoute } from '@blackcode/platform-api/routes'
import { appContext } from '@/lib/api'
export const GET = searchRoute(appContext)
```

This is the extraction the migration doc pre-authorised, and the same trade the
scaffold's `lib/api.ts` header describes: *"if you have to add a parameter to make
it generic, leave it in the app"* — we now have two real apps needing it
unchanged, which is the stated test.

**Two tiers of work:**

| Tier | Routes | Why this tier |
|---|---|---|
| **1 — before sales ships** | `/api/meta` *(per-app, D-20)*, `/api/me`, `/api/me/active-workspace`, `/api/me/pending-invitations`, `/api/me/password/*`, `/api/tokens(/[id])`, `/api/users`, `/api/cli/authorize` *(D-21)*, `/api/workspaces` **GET only**, `/api/workspaces/[ws]`, `.../members(/*)`, `.../invitations(/*)`, `.../invite-candidates`, `.../apps/*`, `.../search`, `.../activity`, `.../links`, `/api/upload(/blob)`, `/api/changelog`, `/api/auth/*` *(per-app by design)*, `/api/errors/client`, `/api/status` | The web UI and `bk` cannot function without them, and `/api/upload` served elsewhere mis-attributes every sales file |
| **2 — after launch** | `.../trash(/*)`, `.../storage(/*)`, `.../labels(/*)`, `.../comments(/*)`, `.../leave`, `.../transfer`, `/api/me/inbox/*`, `/api/status/errors(/*)`, `/api/super-admin/*`, `/api/invitations/{accept,decline}` | Sales can launch without a web trash page. **`.../trash` and `.../labels` move to Tier 1 if D-11's `bk sales trash` / `bk sales label` ship in the same release as the app** — decide at Phase 5 |

**Route-list traps, found by walking the tree (agent1, 2026-08-06):**

- `/api/me/*` **spans both tiers.** `/api/me/inbox/*` is Tier 2; writing the set
  as one wildcard line mounts the inbox by accident.
- `/api/workspaces/[ws]/invitations` (Tier 1) and top-level
  `/api/invitations/{accept,decline}` (Tier 2) are different routes one word
  apart.
- `/api/status` is Tier 1 — a deployment that cannot be probed cannot be
  monitored — but `/api/status/errors` exists to feed the public `/status` web
  page and is deferred to Phase 6 with it.
- `.../move` and `.../attachments` **look** platform-shaped from their paths and
  are app-specific: both join to issues/tasks/projects.
- **`POST /api/workspaces` is deliberately not mounted.** D-3 gives sales no
  create-workspace flow, and `bk workspace` is a neutral verb reaching the home
  server. This keeps the `createWorkspace → recordEvent → fanout` coupling off
  the launch path entirely.

**`AppContext`, as built (agent1, 2026-08-06)** — this supersedes the
`{ db, schema, appSlug }` sketch this decision originally carried:

```ts
interface AppContext {
  appSlug: string
  db: Executor                    // supply as a GETTER if the app's client is lazy
  resolveUser(req): Promise<User | null>
  resolveSessionUser?(req): Promise<User | null>   // session-only routes; see below
  manifest?: { help: string; changelog: string }
  redactBody?: boolean            // D-19
}
```

- **No `schema` field.** Shared code cannot type against an app's schema, and
  every table these routes touch is `platform.*`, importable from `platform-db`
  directly. A `schema` field would be an untyped bag every app supplies and no
  shared route reads — a field that exists to look general.
- **Two user resolvers, deliberately.** `/api/tokens` authenticates with a
  browser session only, because a bearer token minting another bearer token is
  privilege escalation. A factory falling through to `resolveUser` would delete
  that guard silently, so the tokens factory **fails loudly at mount time** when
  `resolveSessionUser` is absent. Two auth modes is a real difference, not a
  parameter added to make something generic.
- **`requireAppAccess` moved from `platform-auth` to `platform-api`.** It was the
  only file in `platform-auth` importing `platform-api` (`Errors`), and the
  shared `resolveWorkspace` must call it — an unbreakable dependency cycle that
  Turbo hard-fails on. It builds a 403 with a suggestion, so it belongs beside
  the error model. Resulting split: `platform-db` queries · `platform-api`
  enforcement + errors · `platform-auth` identity only, no HTTP.

`apiHandler` and `resolveWorkspace` move too, parameterised by `AppContext`.
**Keep the `platform.error_events` logging** from `apps/issues/lib/api/handler.ts`
in the shared version — that is what gives every future app
`bk super-admin errors` coverage for free, instead of it being something
`docs/adding-an-app.md` §11 tells each app to remember.

> **The parity guard changes meaning.** `hostsPlatformRoutes` today means *"the
> shared routes physically live in my tree"* and exactly one app sets it. After
> D-2 it means *"I mount the platform route factories"* and **both** apps set it.
> Update `packages/platform-testing/src/cli-parity.ts` and both apps'
> `cli-parity.test.ts` comments in the same change, or the flag becomes a lie that
> still passes.

### D-3 — workspaces stay in the data model and out of the UI

**The data model keeps them; the UI hides them.** Non-negotiable on the data
side: every route is `/api/workspaces/{ws}/…` by contract, `platform.entities` is
keyed on `workspace_id`, URNs embed the workspace slug, and `app_access` is
per-workspace. Removing it means leaving the platform.

What we actually do:

- Sales renders **no workspace switcher and no create-workspace flow**.
- `/dashboard` resolves the user's single sales workspace and redirects to
  `/dashboard/{ws}`. URLs stay workspace-scoped so links, URNs and the issues app
  agree.
- More than one sales workspace → a minimal picker rather than a guess.
- `bk sales …` uses the active workspace exactly like `bk issues …`.

Net effect for a human: sales looks single-tenant. Net effect for the platform:
nothing changes.

### D-4 — sales is its own visual identity inside one design system

Same skeleton as issues (fixed left sidebar, content right, Google Sans, Tailwind
v4 tokens in `app/globals.css`, `@blackcode/platform-ui` primitives, lucide
icons, sonner, TanStack Query). **Different skin.**

| Axis | issues | sales |
|---|---|---|
| Primary | `#007bd3` (blue) | **`#10a37f`** (calm emerald-teal) |
| Neutrals | cool blue-grey (OKLCH hue ~264) | **warm neutral** (hue ~85, chroma ≤0.008) |
| Radius | `0.5rem` | **`0.75rem`** |
| Density | dense, `h-11` header, tight rows | **roomier** — `h-12` header, `py-3` rows |
| Charts | brand-blue lead | emerald → teal → amber → violet → rose |
| Mood | monochrome, Linear | calm, friendly, a little warmer |

Carried over unchanged: light **and** dark (`next-themes`, class strategy,
`defaultTheme="dark"`), **never hardcode a colour in a component**, token
utilities only. The sales analog of `lib/work-items.ts` is
**`apps/sales/lib/pipeline.ts`** — stage, channel and objection colours are
canonical there and nowhere else.

### D-12 — the chart kit is promoted to `packages/platform-ui` (NARROWED)

> **NARROWED 2026-08-06.** The kit is shared and token-driven, and **sales is not
> obliged to use it.** See D-31 for the rule this produced. Sharing a chart kit
> is a convenience, not an architectural commitment — if sales' metrics page needs
> something the kit does not do, sales builds its own in
> `apps/sales/components/`, with no shared change and nobody's permission.


`apps/issues/components/analytics/charts.tsx` is a hand-rolled themed SVG chart
kit (no chart library). Sales needs four of its six charts, and sales' metrics
page is a headline feature.

**Move it to `packages/platform-ui/src/charts/`**, themed from CSS variables so
each app's palette drives it. Issues imports it from there.

Copying it into `apps/sales` would be a cross-app duplicate that drifts within
months, and importing it directly is a cross-app import that
`app-isolation.test.ts` correctly fails. This is the third app-agnostic thing
this project promotes, and each one makes app four cheaper.

### D-5 — a prospect *is* the deal in v1

The mockup merges company and deal into one record and the stakeholder validated
that shape.

**Honest caveat:** the mockup's own data already contains the multi-deal case —
StaffUp has "Phase 1 shipped" and "Phase 2 in negotiation", handled with tags.
So the merged model is a simplification we are choosing, not a fit that is
obviously right.

We choose it because it is app-internal (no other app sees it), it matches what
was validated, and the split is cheap later. **Design for the split without doing
it:** `sales.prospects` holds the deal fields, and every child table FKs to
`prospect_id` only. Adding `sales.deals` later means adding a nullable `deal_id`
beside each `prospect_id` — additive, no rewrite.

### D-6 — the activity log is `platform.events`, not a sales table

The mockup's `ACTIVITY` array becomes rows in `platform.events` with
`app = 'sales'`, written by `recordEvent` inside every write transaction, exactly
as issues does. `bk activity --app sales` and the web Activity page read the same
feed. **No `sales.activity` table.** A second history is a second thing that can
disagree with the first.

### D-7 — read-only mode is an affordance switch, **not** a permission

- Stored in `sales.user_preferences (user_id, workspace_id, ui_mode)`,
  default **`read_only`**.
- `read_only` → the web renders **no mutation affordances at all**.
- `full` → standard CRUD in the web app.
- **The server does not consult `ui_mode`.** Authorisation is
  `platform.app_access` and workspace role, unchanged.

> **THIS WOULD BE AN INERT GUARDRAIL IF MISREAD.** A toggle that looks like a
> permission and is enforced only in React is a control nobody has watched fail —
> the exact pattern the standing rule in `CLAUDE.md` exists for. Three mandatory
> mitigations:
> 1. The Settings copy says so plainly: *"Read-only hides editing in this
>    browser. It is not a permission — anyone who can open this app can still
>    write through `bk`."*
> 2. `apps/sales/lib/ui-mode.test.ts` asserts **no server module CONSULTS
>    `ui_mode`.**
>
>    > **AMENDED 2026-08-07.** This originally said "imports `ui-mode`", which
>    > guards the wrong thing. A route can consult the mode with `ui-mode`
>    > nowhere in its import graph — the value arrives from the query layer,
>    > where it has to live:
>    > ```ts
>    > const prefs = await getPreferences(ctx.workspace.id, ctx.user.id)
>    > if (prefs.ui_mode !== 'full') throw Errors.forbidden('read-only mode')
>    > ```
>    > That was injected into a real write route and **the suite passed 4/4 with
>    > `ui_mode` acting as a permission.** The check is therefore on the **query
>    > module** as well as the hook: `lib/db/queries/preferences.ts` is reachable
>    > only from the preferences route, with a named allowance and a staleness
>    > check on it. Implemented as a graph walk from every server entry point,
>    > stopping at each `'use client'` boundary — a grep catches the direct
>    > import and misses the realistic one.
>    >
>    > **Stated residual:** it still passes against a route querying
>    > `sales.user_preferences` with its own SQL. That is a more deliberate act
>    > than importing the helper, so it is a named limit rather than a third
>    > layer.
> 3. Default is `read_only`, so the honest behaviour is also the normal one.

A real permission is a `viewer` role in `platform.app_access` (B-4) and a shared
CHECK widening. **Deferred until there is a person who must not write** — an
intern, an external accountant, an investor. Building it now would be guessing at
rules for people who do not exist.

### D-8 — documents are `platform.uploads` plus sales metadata

A document is either an **uploaded file** (through `/api/upload` on the sales
host, so it lands in `platform.uploads` with `app = 'sales'` and the
`sales/{ws}/` path prefix) **or** an **external link** (a Drive URL, a Loom URL —
the mockup has both).

`sales.documents` carries the library metadata; the many-to-many tables
(`document_prospects`, `document_products`, `template_documents`) are what make
the per-prospect Documents tab a *filtered view into one library* rather than a
silo — the fix `UPDATE-6.md` was written to make.

**Every column that can hold an uploaded URL gets a `platform.blob_references`
trigger in the same migration** (§5.4). Sales has **twenty-two** such columns — more than issues.

### D-9 — search is a first-class module, and its two layers are named

Sales gets a ⌘K palette, a full search page, and `bk sales search`.

**Two layers, and the distinction goes in the guide verbatim:**

| Layer | Reads | Answers |
|---|---|---|
| `bk search` (cross-app, bare) | `platform.entities` | *"where is the thing called X, in **any** app"* — returns URNs, tagged by app |
| `bk sales search` (app-owned) | `sales.*` full-text | *"find X inside prospect notes, meeting outcomes, comm bodies, template copy"* |

Sales' own search must reach **inside** records — a phrase in a call summary, a
name in an attendee list. `platform.entities` holds only titles, so the projection
alone is not enough. Postgres `tsvector` generated columns + GIN indexes per
searchable table, unioned by one query helper.

### D-10 — the sales web app talks only to its own origin

Every fetch from `sales.blackcode.ch` goes to `sales.blackcode.ch`. No CORS, no
cross-origin cookies, no proxying. This is what makes D-2 mandatory rather than
nice.

### D-13 — sales has no platform comments in v1

The mockup has **no comment feature anywhere**. What it has is *communications*,
*objections* and *journey notes* — each a sales-specific record with its own
table. An internal note about a prospect is `bk sales comm log --channel note`.

So sales does not need `platform.comments`. We widen the rule anyway (D-14),
because doing it later costs a second migration and a second release cycle for a
ten-minute change.

### D-14 — shared tables become app-qualified

Two CHECK constraints, both widened **and** app-qualified, as
expand → migrate → contract across two releases:

| Table | Today | Becomes |
|---|---|---|
| `platform.comments.parent_type` | `'issue' \| 'task' \| 'project'` | `'<app>:<noun>'` — `issues:issue`, `sales:prospect` |
| `platform.deletion_batches.root_type` | `'project' \| 'task' \| 'issue'` | `'<app>:<noun>'` |

Qualification is the part that is genuinely hard to retrofit: without it, the
first time two apps both invent `note` or `report`, they collide silently.

Plus one new column:

| Table | Column | Meaning |
|---|---|---|
| `platform.labels` | `app varchar(40) NULL` | `NULL` = shared across every app in the workspace (all existing rows). Set = scoped to that app |

**Why do `labels.app` now rather than give sales its own tag list:** the mockup's
prospect tags ("Phase 1 shipped", "Active client", "Referral · Metaesthetics")
are labels. Using `platform.labels` reuses proven machinery — colours, attach,
detach, filtering, `bk label` — instead of building a parallel tag system that
every future app then also builds. Without the `app` column, issues' labels
pollute sales' picker and vice versa, which is the "data should not mix" rule
breaking in the most visible possible place. It is the third item on the *still
owed* list, with the second app named as owner.

**Sequencing (identical for all three):**
1. **Expand** — accept both old and new forms; add the column nullable.
2. **Migrate** — backfill existing rows; deploy all apps writing the new form.
3. **Contract** — a later release, only once no deployed build writes the old
   form. *Verify that in the code, not just in the data.*

All three go in `docs/changelog/platform.md`, never in `sales.md`.

### D-15 — no single-client campaign panel

The mockup's dashboard carries a "clinics contacted 87/250, Pro upsell 34%/40%"
block. That is one client's campaign metrics hardcoded into a product surface.
**Dropped from v1.** If campaign tracking is wanted later, model it generically
(`sales.campaigns`: name, target count, current count, target rate) — do not
special-case a client.

### D-16 — one login across every app

Move the session cookie to `.blackcode.ch`. It is a **rename**, not a widening,
and **it signs everyone out once**.

> **CORRECTED 2026-08-06 — the reason was wrong, the conclusion stands.** This
> decision originally said the rename was forced by the `__Host-` prefix. Checked
> against the installed next-auth 4.24.13 (`core/lib/cookie.js:21`), the
> **session** cookie is `__Secure-next-auth.session-token`, where a `Domain` **is**
> allowed; `__Host-` is on the **CSRF** cookie, which must stay per-host and which
> this change does not touch. On the prefix alone it could simply have gained a
> domain.
>
> **It is still a rename, for a better reason:** a cookie's identity in the
> browser jar is **(name, domain, path)**. Re-issuing the same name with
> `Domain=.blackcode.ch` does not replace the host-only cookie — it creates a
> **second** one beside it. Both are sent on every request to the original host,
> in an order the spec does not pin down, and Next's parser keeps the first. The
> app would refresh one and read the other: an intermittently stale session with
> no way to reason about it from outside. A new name makes the old cookie inert.
>
> *A right conclusion held for a wrong reason stops being right when the reason
> changes.*

**The rename is unconditional** (`BASE_NAME = 'blackcode.session-token'`), so
**deploying the code IS the sign-out event** — whether or not
`AUTH_COOKIE_DOMAIN` is set. Code and env var must land in the **same** release;
splitting them causes two disruptions, the second being a domain-scoped cookie
appearing beside the host-only one.

`AUTH_COOKIE_DOMAIN` is **production-only**; unset means host-only, which is what
keeps localhost and every `*.vercel.app` preview working. Set to a domain the
host is not under, the browser **silently refuses** the cookie — no session,
every sign-in bounces, green deploy, empty logs — so it is validated against
`NEXTAUTH_URL` and **throws at construction**. A boot failure is loud and
obviously about this; a rejected cookie is neither.

Done **now**, before sales launches, as a **standalone release with nothing else
in it**, at a quiet hour, with the changelog entry published first. The cost only
grows: today it is a handful of issues sessions; after launch it is both apps;
next year it is four.

The AI agent is unaffected either way — it authenticates with a token, and
`platform.api_tokens` already works across every deployment.

### D-17 — the skill is renamed to `blackcode`

`cli/internal/skill/skill.go` `Name` → `blackcode`. `bk skill sync` migrates an
installed `blackcode-issues` directory and leaves things working.

Not cosmetic: an agent scanning available skills, seeing `blackcode-issues`, and
concluding *"not my job, I'm doing sales"* is the one failure the skill exists to
prevent. Bundled into the Phase 1 CLI release — no extra release, no extra risk.
`skill_test.go` must still pass (under 40 lines, names no route, enum or auth
header).

### D-22 — a factory needing app-specific behaviour takes a second argument

Settled 2026-08-06, after agent1 hit the same shape twice
(`/api/workspaces/{ws}/activity`, `/api/meta`).

**`AppContext` does not grow callbacks.** A factory that needs something
app-specific takes a **second, typed argument**:

```ts
export const GET = activityRoute(appContext, { resolveEntitySeqs })
```

`AppContext` is what *every* app supplies for *every* route; a field two routes
read is a tax every future app pays to mount neither of them. A second argument
is explicit, local to the route that needs it, and free for an app that does not
mount it.

This gives the route classification its vocabulary:

| Class | Shape | Meaning |
|---|---|---|
| **A** | `factory(ctx)` | nothing app-specific |
| **B** | `factory(ctx, contribution)` | a named, typed app contribution |
| **C** | the app writes the route | the app-specific part *is* the route |

`/api/meta` is **Class C**, not B (D-20): its vocabulary is not a contribution to
a shared route, it is the point of the route.

> **Classify by TRANSITIVE reach, not by the import block.** The original A/B/C
> split was derived from each route's own imports and was wrong about
> `/api/workspaces/{ws}/activity`, which looked shared and calls
> `resolveEventEntitySeqs` — a function that reads `issues`, `tasks` and
> `projects` to turn an `entity_id` into a #number. **The coupling is one level
> deeper than the imports.** This will be true again for app three; it belongs in
> `adding-an-app.md` at Phase 13.

### D-23 — the platform/app event seam

Settled 2026-08-06. `recordEvent` is app-coupled, which blocks every shared route
that writes an event. The cut, verified against the code rather than assumed:

- **`recordPlatformEvent(tx, { app, ... })` in `platform-db`**, handling only the
  platform entity types, with `subject_urn` always null — justified because
  `resolveSubjectUrn` (`entities.ts:233`) returns null for everything except
  issue/task/project *before touching a table*.
- **The five platform fanout handlers move with it** (invitation created, member
  added, member removed, ownership transferred, invitation accepted), plus
  `createInboxMessage`. `fanOutEvent`'s switch splits at a line that already
  exists — inside those five handler bodies there are **zero** app-table
  references; all 18 are below it.
- **`createWorkspace` does NOT move.** Each app keeps its own, because each has an
  app-specific post-create step (issues inserts `issues.workspace_counters`).
  `ensureDefaultWorkspace` stays app-local for the same reason.

Net: "split one switch statement at a line that already exists", not "extract the
query layer".

> **The risk to test, not to assume:** `platform.events.app` is the **producing**
> app. A workspace created from the sales host must record a *sales* event. It
> falls out of passing `app` in — assert it.

### D-24 — `/api/tokens` uses the validated session resolver

Settled 2026-08-06. `/api/tokens` inlined `getServerSession` + `getUserByEmail`,
bypassing `getValidatedSessionUser`, which every other session path uses and
which also rejects soft-deleted users and sessions issued before a password
reset.

**Consequence:** a session invalidated by a password reset could still mint a
long-lived API token, and revoking that session did not revoke what it minted.

A password reset is what someone does when they believe their account is
compromised; a reset that leaves a permanent credential mintable does not do the
thing it exists to do. Fixed as its own commit with its own changelog entry —
**not** folded into the refactor that found it.

### D-25 — `packages/platform-*` gets its own cross-schema guard

Settled 2026-08-06, after agent10 found the gap while cutting the event seam.

`lib/app-isolation.test.ts` runs `findCrossSchemaQueries(APP_ROOT, …)` where
`APP_ROOT` is an app directory. **It never looks inside `packages/`.** And no
package has a `test` script at all — `npm test` runs `issues` and `template`
only. So the most shared code in the repo is the only code with no boundary check
on it.

What that permits today: raw SQL in a package reaching `issues.*` compiles, lints
and tests clean. In production it **works in the issues deployment** (whose role
can read `issues.*`) and **42501s in sales**. It works where you wrote it and
fails where you did not — precisely the failure the boundary exists to make
impossible. Not hypothetical: `fanout-platform.ts:196` already uses raw
`tx.execute(sql…)`, so the technique is present in the file a future handler
would be added to.

The guard lives in **`packages/platform-testing`** — app-agnostic, and no app
should own a check about shared code. Two rules that decide whether it is real:

- **Derive the schema list from `apps/*/lib/app.ts`'s `APP_SLUG`.** A
  hand-maintained `['issues','template','sales']` is wrong the day app three
  lands, and its failure is silence. `apps/_template` (directory `_template`,
  slug `template`) is exactly why the directory name will not do.
- **Assert the inputs.** Empty schema list or zero files scanned must FAIL. A
  guard that finds nothing otherwise passes — the corollary in `CLAUDE.md`, and
  how finding #5 was caught.

### D-26 — the prove-it-fires rule is three steps, not two

Settled 2026-08-06. Agent1 improved on the standing rule by asking, of a passing
test, *"what would this still pass on?"* Agent10 then demonstrated that the
question is a **filter, not a proof**: it asked it, answered it wrongly, and
wrote a comment in the fixture *congratulating* the property that made five
assertions incapable of failing. It found the truth only by injecting the
regression and watching the suite pass 13/13.

> 1. Watch the check fail.
> 2. Ask what it would still pass on.
> 3. **Inject that regression and watch it again.** Step 2 is reasoning, and you
>    can be wrong in writing while feeling right.

This is CLAUDE.md finding #8's shape — the inert guard written by someone who
knew the rule — reproduced twice on this project by two different agents. Assume
the third instance exists. Goes into `adding-an-app.md` at Phase 13.

### D-27 — traps and rules that came out of Phase 1b

Four things found while building, each of which would have cost someone a bad
afternoon later. Recorded because they generalise past this project.

**1. `ctx.appSlug` does two different jobs in `workspace-writes.ts` — never merge
them.** It is the producing app on every event row, *and* the app you are
forbidden to disable (`cannot_disable_current_app`). Merging the two reads looks
like a simplification and would silently protect the wrong app while letting
another disable itself. The file carries a DO-NOT-MERGE header; keep it.

**2. Hand-maintained duplicate lists are this codebase's recurring silent-drift
bug.** Phase 1b found three: two copies of the platform event vocabulary (one
governing what may be *written*, one what may be *filtered* — and `parseList`
drops unknown filters silently, which is how Phase 4's `app_*` actions returned
the whole feed for months); and two copies of the upload MIME blocklist, so a
newly blocked type would have taken effect on the multipart path and not the
client-direct one. **When you see a list, ask where the second copy is.**

**3. Platform-wide credentials must not let each app set its own policy.**
Agent10's formulation, which generalises well beyond OTPs:

> *"One login serves every app, so it is one password, and letting each app pick
> its own length, expiry, attempt cap and rate limit against ONE credential means
> the weakest app sets the real floor."*

The app's legitimate contribution is presentation — the email's name, sender and
branding — and nothing else.

**4. Applying an existing written ruling is not the same as making a decision.**
The standing rule is *a finding is a QUESTION file, not a fix*. Phase 1b produced
one correct exception, and it needed all three of: the ruling already existed in
writing with reasoning that applied verbatim; no behaviour-preserving option was
available; and the fix was isolated into its own commit, tested, revertable, and
led with in the report. Miss any one and it is a question.

> **Follow-up, low severity, unowned:** four *pages* still authenticate with the
> weak `getServerSession` + `getUserByEmail` pair — `app/page.tsx`,
> `app/cli/authorize/page.tsx`, `app/status/errors/[id]/page.tsx`,
> `app/invitations/[token]/page.tsx`. Rendering, not credential minting, so the
> severity is far lower. The credential class **is** closed: `mintToken` has
> exactly two call sites and both use the validated resolver. Whoever takes this
> should decide whether pages share one gate at all, rather than patching four
> files — that is a design question.

### D-28 — `storage` is cross-app, not app-owned (D-11 amended)

Settled 2026-08-06. D-11 originally listed `storage` alongside `upload`, `trash`
and `label` as app-owned. Agent2 implemented it as written and then reported that
it does not fit — correctly.

D-11's test is one question: **does the answer depend on the app?**

| Verb | Depends on the app? | Tier |
|---|---|---|
| `upload` | **yes** — the file is permanently attributed and path-prefixed | app-owned |
| `trash` | **yes** — each app has its own bin | app-owned |
| `label` | **yes** — labels are app-scoped after D-14 | app-owned |
| `storage` | **no** — one ledger, one workspace quota, same rows either way | **cross-app** |

`platform.uploads` is one shared table; `?app=` is an optional *filter*, so
`bk sales storage list` and `bk issues storage list` return the same files. Keeping
it app-owned would make the tier boundary a lie in exactly the place an agent goes
to check it — it would teach that the app segment scopes the answer, then be
wrong. **A dishonest consistency is worse than an honest asymmetry.**

Structurally `storage list` already tags every row with its app and takes `--app`
to filter — the same shape as `search`. It belongs next to it.

- `bk storage list` / `bk storage rm` -> bare, cross-app tier.
- `storage attachments` was issues-only all along -> **`bk issues attachment list`**,
  a new noun in the issues group. One noun must not straddle two tiers.
- The guide must state the pairing in words: **you upload into one app; you list
  across all of them.** An agent made to infer that will infer something else.

> **The general lesson:** the tier is decided by where the *answer* comes from,
> not by where the *command* feels like it belongs. `label attach` was the mirror
> case — it takes an issue id and calls an `/issues/` route, so it was always
> app-specific, and being a bare "platform verb" hid that.

### D-29 — shape, not vocabulary; and the wire stays bare

Settled 2026-08-06 while building D-14.

**The CHECK validates SHAPE (`^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$`),
not membership.** `'nonsense:thing'` is accepted; `'prospect'` — a new *bare*
noun — is rejected. Validating the app half against `platform.apps` would need a
generated column carrying an FK, and:

- `platform.blob_references` **already refuses that exact FK, in writing**, on
  the same table family: deregistering an app must not silently drop its rows.
- It would make `'sales:prospect'` illegal **until the sales app row exists**,
  inverting the registration order and breaking Phase 1's own exit criterion.
- Nothing types the string. It comes from `ctx.appSlug`; a well-formed-but-wrong
  slug is not a realistic bug. A new bare noun is.

Regex over an enumeration for the same reason `platform.entities.entity_type`
uses none: a hand-maintained list of other apps' nouns living in `platform` is
D-27 trap 2, and would mean a shared-table migration every time any app invents a
noun. **The constraint owns the shape; the app owns the vocabulary.**

**The columns are qualified; the HTTP wire stays bare.** One helper converts at
the query boundary. Found by looking for consumers rather than reasoning about
honesty — `components/trash-view.tsx:452` compares `batch_root_type` against the
item's own bare `type` and falls back to `items[0]`, so a qualified value would
have silently picked an arbitrary row as the batch root, *with no error, no test
failure, and no symptom anyone would attribute to the migration*. The route is
already scoped to one app by its path, so the app segment adds nothing a caller
could act on.

**`platform.labels` is backfilled to `app = 'issues'`.** Leaving every existing
row NULL would ship the column without its stated purpose — issues' labels would
still fill sales' picker on day one. Backfilling records a fact (every existing
label was made in the issues UI for issues work), makes sharing **opt-in**, and is
reversible per label; the alternative means bulk-classifying under time pressure
after launch. To share a label, set `app` to NULL.

> **Deploy-order trap, for the human.** The CHECK widening is inert to old code.
> **The backfill is not** — the previous build matches `parent_type = 'issue'`
> exactly, so between the migration and the promote the old build renders every
> comment thread **empty**. Nothing is lost and it self-heals on promote, but the
> product looks broken for that window. Leave `RUN_MIGRATIONS=1` set so
> `postbuild` applies it during the build being promoted; do **not** apply it by
> hand hours ahead.

### D-30 — a shared UI package needs `@source`, not just `transpilePackages`

Found 2026-08-06 while moving the chart kit, and it was a **live production bug**,
not a migration risk.

**Tailwind v4 had never scanned `packages/platform-ui`.** It auto-detects sources
from the project root and skips `node_modules` — and a workspace package reaches
an app through a symlink in exactly there. With no `@source` directive, **151
utility classes that live only in the shared package had never been generated.**

Not obscure ones: the login page's tab switcher had no active state, its inputs
no focus ring, the landing page's FAQ accordion no animation, and the rich-text
lightbox and voice recorder were missing theirs.

It survived because most of the package's classes were *also* used somewhere in
`apps/issues`, so they were generated by coincidence. The rest degrade into
"styled, but not quite right" — never an error, never a failed build, nothing
`tsc` or ESLint can see. **And it gets worse as the design system consolidates:**
every component moved into the package brings classes the app no longer uses
itself. The severity grows with exactly the work this project is doing.

> **The pairing, for `adding-an-app.md`:** `transpilePackages` makes the
> TypeScript compile; **`@source` makes the CSS exist.** Neither implies the
> other, and only one of them fails loudly.

Guarded in `packages/platform-testing` — an app listing the package in
`transpilePackages` must point an `@source` at it, and the path must **resolve**
against the real directory rather than merely match a string. It lives in the
shared test package so a new app inherits it rather than copying it.

### D-31 — where the line sits for shared UI

Raised 2026-08-06: *should UI be shared at all, when personalisation is the point
of having separate apps?* Largely yes, and the answer is a distinction rather
than a single rule.

**Two kinds of UI, and only one of them belongs in `platform-ui`:**

| Kind | Examples | Shared? | Why |
|---|---|---|---|
| **Mechanism** — behaviour, accessibility, and integration with platform features | `components/ui/` primitives, the rich-text editor, file attachment, the image lightbox | **Yes** | A divergent rich-text editor would break the `platform.blob_references` contract. These are plumbing wearing a UI costume |
| **Expression** — what the app looks and feels like | page layouts, dashboards, listings, charts | **No, by default** | This is the axis apps most want to differ on. Sharing it constrains exactly the thing that should vary |

**Charts sit near the expression end**, which is why D-12 is narrowed rather than
kept as written. Sales starts with the shared kit because it is free, themed by
tokens, and covers four of the six charts it needs — **not** because analytics
must be shared. The moment sales' metrics page wants something else, it builds
it locally.

**The promotion rule, restated:** a component moves to `platform-ui` when a
second app needs it **unchanged** — not because it might be useful. "Unchanged"
excludes colour, since colour is tokenised.

> **The cost is real and already documented.** `platform-architecture.md` §9
> lists "a `platform-ui` change touches every app at once" as an accepted cost.
> Phase 1 then found a live production bug caused purely by the package's
> existence — Tailwind never scanned it (D-30). **More shared UI means more of
> that class of problem.** That is an argument for keeping the shared surface
> small and mechanical, and it is the reason this decision exists rather than
> defaulting to "share it".

### D-32 — the blob-trigger rule, and the asymmetry that decides it

Settled 2026-08-07. §5.4 originally named a hand-counted list (and miscounted it:
prose said fourteen, the table listed thirteen). The list is not the rule.

Read what `platform.blob_refs_sync` does first: `scan` runs a URL regex over the
value and keeps only our-origin uploads; `exact` treats the whole value as a URL
and keeps it if it is ours. **Both filter through `is_uploaded_asset`, so a column
that never holds an upload contributes zero rows.** That gives the asymmetry:

> A wrongly-**included** column costs one no-op function call per write.
> A wrongly-**excluded** column costs a file somebody is still using, **with no
> undo.**

**The rule:** a column needs a trigger if a legitimate write can put an
uploaded-file URL in it — authored prose (`scan`) or a column that *is* a URL
(`exact`). Not "which columns does the plan name."

Applied to sales that is **22 columns across 10 tables**, including four
length-capped labels (`meetings.title`, `communications.subject`,
`templates.subject`, `documents.title`). "Label, not body" is a line about how
people are expected to behave; a URL fits in 200 characters.

**The case worth remembering: `documents.external_url`.** The column is *for*
external links, so most rows contribute nothing — but nothing stops a caller
putting a blob URL there, and the table's CHECK (exactly one of the two URLs)
then **forbids using the correct column**. A hole the schema's own constraint
creates. `exact` mode filters non-uploads for free.

Also established: a `text[]` column IS scannable (the trigger reads
`v_row ->> TG_ARGV[i]`, yielding the JSON array form), so tag/attendee arrays are
*coverable* — excluded here only because none is a place a URL gets written.

### D-33 — aggregates are computed; the doctrine forbids deciding, not reading

Settled 2026-08-07. The mockup's dashboard numbers are stored, with a comment
saying so deliberately, so this needed answering rather than assuming.

**The doctrine forbids the app DECIDING things, not READING them.**

- **Triangulation stays agent-computed and stored** (`sales.matches`). Which
  product suits this client, and which message to send, is judgement. The mockup
  is emphatic that the browser must never do it, and it is right.
- **`SUM(value) GROUP BY stage` is arithmetic over rows the app already holds** —
  the same class as counting prospects in a stage, which nobody would propose
  storing. A stored copy is a second number that can disagree with the first
  (D-6), and a stale pipeline total is worse than a slow one at a scale where
  nothing is slow.

The mockup stored them because a static HTML file has no other option. That is a
constraint of the artefact, not a design position.

### D-34 — one drizzle migration ledger per app

Found 2026-08-07, reproduced rather than inferred. **The worst failure shape this
platform can produce**, and it was one migration away from happening.

Every app shares one database, and drizzle's migrator keeps **a single
high-water mark over the whole ledger** (`pg-core/dialect.js:57-62`):

```
select id, hash, created_at from <ledger> order by created_at desc limit 1
if (!last || Number(last.created_at) < migration.folderMillis) apply(migration)
```

No app dimension. So whichever app migrates last raises the mark, and **the other
app's next migration is silently skipped** — no error, no ledger row, **exit 0**,
and the same comparison skips it again on every subsequent run. It manifests as
missing tables in production, not as a red build.

Reproduced with two throwaway migration folders against one shared ledger: the
earlier-stamped app ran, reported success, exited 0, and its table did not exist.

**Each app declares its own ledger table** (`migrations.table` in
`drizzle.config.ts`). `apps/issues` must keep the default `__drizzle_migrations`
— renaming it would make drizzle believe nothing had ever run and re-apply all
forty-three migrations. Guarded in `platform-testing`: every app must resolve to a
**distinct** (schema, table) pair, with issues grandfathered by a written
allowance.

> `docs/adding-an-app.md` says "point it at the EXISTING Neon project" and never
> mentions that the migration ledger comes with it.

### D-35 — a cache is part of a check

The transferable half of GUARDRAIL #10 (see Phase 13's list): **a guard is only as
honest as the key that decides whether to run it**, and nothing in this repo had
ever reviewed one. `npm test` reported PASS to four consecutive agents by
replaying a cached result keyed on files the tests never read.

When adding or moving a check, ask what invalidates it — not just what it
asserts. A check whose cache key cannot see its subject runs once and is never
run again.

### D-36 — a platform route is answered by the apps that mount it

Settled 2026-08-07, reversing the Phase-1b ruling that Tier-2 routes would carry
documented `EXCLUDED_PATHS` entries. That ruling did not survive contact, and the
reason it failed is worth more than the fix:

**It assumed the subset was temporary.** It is not. Does sales need
`bk super-admin errors` served from its own host? A super admin can use the issues
host; the data is platform-wide either way. `bk inbox`? Per-user and
cross-workspace — one host serving it is correct. `bk storage list`? D-28 already
established it returns the same rows from any deployment.

So *"this app mounts some of the platform surface and not the rest"* is a
**permanent, legitimate state**. Both mechanisms failed because of that mismodel:
`EXCLUDED_PATHS` moves **coverage** while an unmounted route is a **drift**
failure (`cli-parity.ts:183,210` — exclusions are dropped from `real`, and
`ownClaims` is untouched); and a boolean `hostsPlatformRoutes` cannot express a
subset, so mounting `/api/meta` alone forces the flag true and pulls in every
platform command's claim (`cli-parity.ts:202`).

**The property, stated honestly:**

> A platform **route** is answered by the apps that mount it.
> A platform **command** must be answerable by **at least one** app.

> **AMENDED 2026-08-07 — a permanent subset is legitimate; an ACCIDENTAL one is
> a bug.** D-36 was read as licence for sales to serve almost nothing. It served
> **7 of the 54** platform routes `bk` claims, so `bk search`, `bk link create`
> and `bk workspace use` — two of them north-star steps, the third a
> prerequisite for the script's first command — all 404'd from a sales login,
> printing 30 lines of HTML to stderr.
>
> **The factories already existed.** Nobody had mounted them. The root cause was
> the original Tier-1 scoping, which asked *"what does the sales web UI need?"*
> instead of ***"what does a sales-homed `bk` user need?"*** — a strictly larger
> set, because the CLI is the interface this platform exists for.
>
> **The test is: does every BARE verb have a host from this app's login?** Where
> a route genuinely cannot be mounted — `bk super-admin` (platform administration
> lives in one app, D-28) and `bk inbox` (factories unbuilt) — the CLI must fail
> with **one line naming the app and a recovery**, never a raw HTML 404. A
> permanent absence is a routing fact to be stated; an accidental one is a
> promise the deployment does not keep.

Per-app drift for a platform claim is scoped to what that app mounts; a
cross-app assertion then requires every platform claim to be mounted *somewhere*.
Without the second half, "nobody mounts it" and "somebody else mounts it" are
indistinguishable — which is the hole the fix would otherwise open.

> **Related, found in the same pass:** `export const { GET } = handlers()` is a
> live route `next build` serves and the parity guard cannot see — its method
> regex matches only direct exports. The harness now **rejects the destructured
> form loudly** rather than trying to parse it: an invisible hole becomes a stated
> rule.

### D-37 — a guard must not fail on correct writing

Settled 2026-08-07. `guide_test.go` forbade an app topic containing
`<other-app>/`, to catch references to another app's guide topics. Sales has a
**`template` entity**, whose URN is `bc:sales:{ws}/template/{n}` — containing the
literal `template/` — and the scaffold app's guide section is `template`. Correct
writing would have been reported as a cross-app reference.

The needle is narrowed to the shapes it actually means (`topics/<other>/`,
`bk guide <other>/`), and the change is proved **both ways**: a legitimate URN
stays green, a real cross-app topic reference still goes red.

> This is CLAUDE.md finding #9's history repeating — that guard was already once
> calibrated for exactly this reason. **A guard that fails on correct writing gets
> weakened or deleted, and then it protects nothing at all.** Narrowing a guard is
> only safe when the narrowing is proved in both directions.

### D-38 — a guard matches a slug in a context that means it, never bare

Settled 2026-08-07 after the `template` slug bit three separate guards.

An app slug is an ordinary word. `template`, `note`, `report` — every app will use
one as an entity name, a local variable or a directory. A guard that matches a
bare slug therefore fires on correct code, and **a guard that fails on correct
writing gets weakened or deleted** (D-37).

The worked examples, both from this project:

| Guard | Bare needle | What it means |
|---|---|---|
| cross-app guide topics | `<other>/` | `topics/<other>/`, `bk guide <other>/`, `bk <other> ` |
| cross-schema queries | `<schema>.<ident>` | the same preceded by a SQL keyword, or the broad form minus hostnames and paths |

**And derive, do not enumerate.** `guide_test.go`'s dynamic-value check counted
membership of two **hand-written** vocabularies belonging to one app, so a sales
topic could restate the entire pipeline vocabulary and stay green. That is the
**third** failure of that one guard (CLAUDE.md finding #9 is the second), and the
root cause each time is the same: **a guard keyed on a hand-written list of one
app's values cannot see app #2, and never could.** The words are now derived from
the modules that own them, with an assertion that the extraction found something.

> The repair nearly checked less than the thing it replaced: issue priorities are
> numeric (`value: 1`), so their restatable form is the **label** set — which is
> what the hand-written list contained. Measure a guard before and after widening
> it; an improvement is not automatically an improvement.

**Related, and its own species:** `entities.ts`'s header cited
`entities.projection.test.ts` as asserting a property. **The file did not exist.**
Not an inert guard — a *cited* guard, which reads as protection to every future
reader and which nothing in the repo would contradict. Phase 13 should grep
comments for `*.test.ts` references and assert the files exist.

### D-39 — every app must hold the SAME `NEXTAUTH_SECRET`

Found 2026-08-07, by accident on localhost, and it would otherwise have been
found on launch day.

D-16 makes the session cookie **one credential** shared across deployments. Its
payload is **encrypted**, with the key derived from `NEXTAUTH_SECRET`
(`next-auth/jwt/index.js` → `getDerivedEncryptionKey(secret, salt)`). So two apps
that agree on the cookie's **name** and **domain** but hold **different secrets**
do not share a session — each can decrypt only its own.

**Single sign-on is silently inoperative unless the secrets match**, and the
symptom is the one D-16 exists to prevent: a session that works in one place and
not the other. Server-side you get `[next-auth][error][NO_SECRET]` /
`JWEDecryptionFailed`; the browser just sees `/login?error=Configuration`.

Nothing in the repo said so. `adding-an-app.md:352` lists the variable with no
note; `env.md`'s "how to regenerate" rotates **one** project and redeploys, which
after D-16 breaks cross-app sign-in until the other is rotated too; and
`session-cookie.ts` reasons carefully about the cookie's name and domain and
never mentions the key that seals it.

> **For provisioning:** `sales.blackcode.ch` must be given **issues'**
> `NEXTAUTH_SECRET`, not a freshly generated one. Rotating it is a **platform**
> operation across every app at once, never a per-project one.

> **The pattern behind all three of Phase 6/7's production traps** — this, the
> `withAuth({ cookies })` omission, and the `@source` orphan: **D-16 and D-30 each
> changed a shared assumption, and the places that depended on the old one were
> never enumerated.** When a shared assumption changes, the deliverable is the
> list of its dependants, not just the change.

### D-40 — share a UI component only where it lets the app render its own values

Settled 2026-08-07 from a measurement, not a preference. Sales' metrics page uses
the shared `KpiCard` (it takes `value: number | string`, so a pre-formatted Swiss
string bypasses its formatter) and **does not** use `HorizontalBars`, which
applies `Intl.NumberFormat('en-US')` with compact notation above 10,000 — turning
`105000` into **`105K`**, which is wrong twice over for a funnel whose content is
CHF amounts and whose validated figure is `CHF 105'000`. It exposes no formatter
prop.

Widening the shared component was **rejected**: "widening a shared component to
fit one app's rendering is how a two-app package becomes a four-app liability"
(D-31). The local bar is twenty lines and reads `lib/pipeline.ts` for its colours.

> **The rule:** *use the kit or not* is the wrong question. The line is **whether
> the component lets this app render its own numbers.** Where it does, share it;
> where it does not, build locally rather than adding a prop.

### D-41 — a guard can check correctly and too late

Found 2026-08-07. `CLAUDE.md`'s nine entries are all guards that **check
nothing**. This is a tenth shape: one that checks **correctly, after the damage**.

```ts
const row = await deleteObjection(…)        // destroyed
if (confirm !== row.type) throw conflict    // 409 about a row that is gone
```

`sales.objections` has no `deleted_at` and no recycle bin — the app's **one** hard
delete — so the confirmation was inert in the only place it was the sole
protection. The route's own comment said the branch *"cannot happen"*, which is
true for every caller passing the **correct** value, i.e. exactly the caller a
confirmation is not for.

> **A guard whose justification only holds for the case it is not guarding.**

Two things the fix needed beyond reordering: a **re-check inside the transaction
under `FOR UPDATE`** (two statements outside a transaction can be separated by a
concurrent edit, and a confirmation that was true a moment ago is not one), and a
**required** rather than optional confirm parameter — an optional one is what a
future call site forgets silently.

**And the test lesson, now seen twice on two different delete guards:** restoring
the broken order left every **status** assertion green. Only the *"was anything
actually deleted"* assertion caught it. A guard test that asserts on responses
passes against the defect it was written for.

### D-42 — a guard that matches text will match the text that explains it

Four instances in one week, by four different agents: a scanner allowance whose
own `match` string tripped the scanner; a destructured-export detector that
flagged three files whose only offence was a comment explaining the rule; a cookie
guard that caught the comment written to explain the cookie rename; and a
read-only guard that failed on its own header.

> **And the rule belongs in the guard, not here.** The one instance caught
> *before* committing was caught because the previous write-up sat in the file
> that agent happened to open that morning — not because anyone had read a
> decision list. **A lesson lands where the next person will be standing, not
> where it is catalogued.** Phase 13 should put this paragraph in the header of
> every guard that matches text; this entry's job is to make that happen, not to
> be the place it is read.

The escapes that work, in order of preference: strip comments before matching;
anchor to a syntactic position a comment cannot occupy (start of line, an actual
declaration); or write the explanation so it does not contain the needle. **An
allowance covering the guard's own explanation is the wrong fix** — it creates an
entry that keeps itself alive and can therefore never go stale.

Related, and the third instance this week of `CLAUDE.md` finding #9: an input
assertion written as `toContain('export function useSalesSearch')` matched
`useSalesSearchRENAMED`. Anchor input assertions too — they are checks like any
other, and they were found by running the regression rather than by reading it.

### D-43 — a correct change can silently retarget an existing assertion

Found 2026-08-07 by re-running a guardrail the master had specifically flagged.

`cli-parity.test.ts`'s *"no bk command belongs to this app"* assertion — the one
`CLAUDE.md` finding #5 was caught by — **stopped firing.** Deleting
`topics/sales/` dropped sales' route attribution from 68 to 0 and the suite
stayed green.

Nothing was written wrong. **D-36's own fix widened `ownClaims` into a union**
including every mounted platform route, so the set the assertion tests can never
empty. A correct change, made for a good reason, left an existing assertion
pointing at a wider set than it was phrased for.

> This is not an inert guard, a cited guard, or a guard that runs too late. It is
> a guard that **was** correct and was retargeted by a change elsewhere. **When
> you widen a set, grep for what asserts on it.**

The repair splits `appOwnClaims` from the union and was proved in both
directions — remove `topics/sales/` → sales red; remove `topics/template/` →
`_template` red; restore → green.

### D-44 — where a value can arrive after the check, the cure is total, not detective

Settled 2026-08-07. Three bugs shipped past typecheck, lint and tests by
rendering a vocabulary the app does not own (`check_in` raw, "1 deals",
"3 whatsapps"). The obvious response is a scanner over the call sites.

**It was refused, and the refusal is the ruling.** The vocabularies are served
live by `bk meta` and **can gain a value without a deploy**, so the value that
breaks the page does not exist when any static check runs. A scanner would prove
every call site correct and say nothing about the case that fails.

The actual defect was a fallback that returned the raw value; it now humanises
whatever arrives, so the page stops needing to know the vocabulary — which is
what `bk meta` was supposed to buy in the first place.

> **A guard for a class of bug that a total fix eliminates is a guard for
> nothing.** Ask whether the failing input can exist at check time. If it cannot,
> build the cure, not the detector.

### D-20 — `/api/meta` stays per-app; only its platform half is shared

Settled 2026-08-06 after agent1 found `/api/meta` cannot be a factory over
`AppContext` — it imports `publicProject`, `listProjectsInWorkspace`,
`listLabelsInWorkspace`, `ENTITY_TYPES` and `META_LIMITS` from the app.

A `meta?: () => Promise<…>` callback on `AppContext` was **rejected**: it is an
app-shaped injection in the one route the architecture explicitly wants to be
app-specific. `platform-architecture.md` §7.4 forbids merging two apps'
vocabularies, and the route's own comment says *"this server is the issues app;
it knows its own vocabulary and has no business inventing another app's."*

So: `platformMetaBlock(ctx)` in `platform-api` supplies user, active workspace,
workspaces, the apps registry, links, cli and conventions. **Each app's
`/api/meta` route composes that with its own vocabulary, limits, media and entity
types.** The deprecated top-level `vocabulary`/`limits`/`media` keys in issues
stay untouched — they have a stated removal condition that has not been met.

### D-21 — `bk login --server` may name any app, so every app serves `/api/cli/authorize`

Settled 2026-08-06. A user may legitimately run
`bk login --server https://sales.blackcode.ch`. If that app does not serve the
browser-side authorize page, the command dead-ends on a 404 — the exact
invisible failure D-1 exists to eliminate. `/api/cli/authorize` is therefore
**Tier 1 for every deployed app**.

### D-18 — cross-app links are a first-class sales feature

The north star requires the link to be *visible*, not just storable.

- **`bk sales prospect show <n>`** prints linked entities from other apps, by URN
  and title.
- **The prospect detail page** has a "Related" block listing cross-app links,
  each a clickable absolute URL built from the other app's `base_url`.
- Same on `bk issues issue show` for links pointing back into sales — that half
  already works once sales projects entities; verify it rather than assume it.

Relation vocabulary is `platform.links` (`blocks`, `relates_to`, `billed_as`, …)
and is served by `bk meta`, never restated in a guide topic.

---

## 5. Domain model

Postgres schema **`sales`**. Derived from `bsales-mockup/assets/js/data.js`.

### 5.1 Conventions (all inherited, none negotiable)

- Every addressable row has a workspace-scoped **`seq`** (#number). **The serial
  `id` is never exposed** — not in a route, not in CLI output, not in a URL.
- The counter lives in **our own schema**, one row per (workspace, entity type).
  `platform.workspace_counters` no longer exists and must not be recreated
  (`platform-architecture.md` §4.6). Allocate with `UPDATE … RETURNING` **inside
  the insert's transaction** — never read-then-write.
- Soft delete via `deleted_at`; hard delete only through trash purge.
- Money: `numeric(14,2)` + `currency char(3) DEFAULT 'CHF'`. Swiss formatting
  (`CHF 105'000`) in one helper, `lib/format.ts` — never inline.
- Timestamps `timestamptz`. The mockup's relative strings ("2 days ago") are a
  *rendering*, never storage.
- Every write happens in a transaction that also calls `recordEvent` and
  `projectEntity`.

### 5.2 Tables

```
sales.prospects            the core object — company + deal in one (D-5)
sales.contacts             decision makers at a prospect
sales.stage_entries        the "deal journey" — one row per stage transition, with a note
sales.meetings             the meetings ledger (past + upcoming)
sales.communications       the multi-channel comms log
sales.objections           what they pushed back on, and our counter
sales.products             what we sell
sales.templates            how we say it (email / whatsapp / call script)
sales.documents            the one shared library (D-8)
sales.matches              triangulation: prospect × product (+ template)
sales.match_documents      M:N — the attachments a match recommends
sales.document_prospects   M:N
sales.document_products    M:N
sales.template_documents   M:N — a template's attachments reference the library
sales.prospect_labels      M:N into platform.labels (app-scoped, D-14)
sales.counters             (workspace_id, entity_type, last_seq)
sales.user_preferences     ui_mode, default filters
```

#### `prospects`

| Column | Type | Notes |
|---|---|---|
| `id` | serial pk | never exposed |
| `workspace_id` | int NOT NULL → `platform.workspaces` | |
| `seq` | int NOT NULL | the #number; unique per workspace |
| `name` | varchar(120) NOT NULL | "StaffUp" |
| `city` | varchar(80) | |
| `sector` | varchar(120) | "SaaS · staffing" |
| `stage` | varchar(24) NOT NULL | vocabulary in `lib/pipeline.ts` |
| `value` | numeric(14,2) | deal value |
| `currency` | char(3) DEFAULT 'CHF' | |
| `owner_user_id` | int → `platform.users` | **our** deal owner (UPDATE-9 item 2) |
| `source` | varchar(60) | "referral", "maps", "word of mouth" |
| `summary` | text | **blob-ref trigger** |
| `next_action_type` / `_due` / `_note` / `_owner_user_id` | | the mockup's `nextAction`; `_note` **blob-ref trigger** |
| `closed_at`, `closed_reason` | | set on won/lost |
| `external_ref` | jsonb | reserved for a future CRM/Google id |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | | |

Indexes: `(workspace_id, seq)` unique; `(workspace_id, stage)`;
`(workspace_id, owner_user_id)`; `(workspace_id, updated_at)`; GIN on the search
tsvector.

#### `contacts`
`prospect_id`, `name`, `role`, `email`, `phone`, `is_primary`, `notes`
(**blob-ref trigger**), timestamps. No `seq` — not independently addressable.

#### `stage_entries` — the deal journey
`prospect_id`, `stage`, `status` (`done|current|upcoming`), `occurred_at`,
`actor_user_id`, `actor_label`, `note` (**blob-ref trigger**).

> The mockup's "by Andrea / by Companion" attribution is a validated feature.
> Populate `actor_label` from the token's name when the write comes from a token,
> and from the user's name otherwise — so agent-written history stays visibly
> agent-written.

#### `meetings`
`seq`, `prospect_id`, `starts_at`, `duration_min`, `type` (`video|call|in_person`),
`status` (`upcoming|done|cancelled`), `title`, `attendees` text[], `agenda`
(**trigger**), `outcome` (**trigger**), `external_ref`, timestamps, `deleted_at`.

#### `communications`
`seq`, `prospect_id`, `channel` (`email|whatsapp|call|note|discovery|system`),
`direction` (`in|out`), `occurred_at`, `subject`, `body` (**trigger**),
`contact_id`, `logged_by_user_id`, `logged_by_label`, `external_ref`, timestamps,
`deleted_at`.

#### `objections`
`prospect_id`, `type`, `raised_by`, `raised_at`, `status`
(`open|countered|resolved`), `spoken` (**trigger**), `real_fear` (**trigger**),
`counter` (**trigger**), timestamps.

#### `products`
`seq`, `category` (`module|service|licence`), `name`, `price_label`,
`price_from`/`price_to`, `description` (**trigger**), `fit` text[], `pitch`,
`status_label`, `refs` text[], timestamps, `deleted_at`.

#### `templates`
`seq`, `channel` (`email|whatsapp|call`), `category`, `stage`, `name`, `subject`,
`body` (**trigger**), `variables` text[] (parsed from `{{…}}` on write so
`bk sales template render` can validate), timestamps, `deleted_at`.

#### `documents`
`seq`, `title`, `kind` (`pdf|deck|image|video|link`), `upload_url`
(**trigger**), `external_url`, `size_bytes`, `mime_type`, `description`, `tags`
text[], `added_by_user_id`, timestamps, `deleted_at`.
CHECK: exactly one of `upload_url` / `external_url` is non-null.

#### `matches` — the triangulation result
`prospect_id`, `product_id`, `fit` smallint (0–100), `template_id` nullable,
`why` text, `computed_at`, `computed_by_label`.
**File header must say: this table is written by the agent, never computed by the
app.**

### 5.3 Entity projection (URNs)

Projected into `platform.entities` **in the same transaction as the source
write**, per `apps/issues/lib/db/queries/entities.ts` (read its header first):

```
bc:sales:{ws}/prospect/{n}
bc:sales:{ws}/meeting/{n}
bc:sales:{ws}/communication/{n}
bc:sales:{ws}/product/{n}
bc:sales:{ws}/template/{n}
bc:sales:{ws}/document/{n}
```

`ENTITY_TYPES` lives in `apps/sales/lib/entity-address.ts` and is served by
`/api/meta` under `apps.sales.entity_types`. **Contacts, objections, stage entries
and matches are not projected** — no independent identity, no #number.

This is what buys the north star: `bk search acme` finding a sales prospect from
an issues context, and `bk link create bc:sales:…/prospect/12
bc:issues:…/issue/512 --rel blocks`.

### 5.4 Blob-reference triggers — the highest-risk step

**Twenty-two** columns can hold an uploaded file URL. *(Corrected 2026-08-07: this section's prose said fourteen while its own table listed thirteen. The count is derived from what `blob_refs_sync` actually does, not from a list — see below.)* **Every one needs a trigger, in
the first migration, with the flag flip after the backfill.** Copy the shape from
`apps/issues/lib/db/migrations/0037_blob_reference_index.sql`.

| Table | Columns |
|---|---|
| `prospects` | `summary`, `next_action_note` |
| `contacts` | `notes` |
| `stage_entries` | `note` |
| `meetings` | `agenda`, `outcome` |
| `communications` | `body` |
| `objections` | `spoken`, `real_fear`, `counter` |
| `products` | `description` |
| `templates` | `body` |
| `documents` | `upload_url` |

```sql
CREATE TRIGGER trg_blob_refs_comm
  AFTER INSERT OR DELETE OR UPDATE OF body ON sales.communications
  FOR EACH ROW EXECUTE FUNCTION
    platform.blob_refs_sync('sales', 'communication', 'workspace_id', 'scan', 'body');
```

…then, **at the very bottom of the same file, after the backfill**:

```sql
UPDATE sales.communications SET body = body WHERE body IS NOT NULL;  -- re-trigger
-- … one per table …
UPDATE platform.apps SET maintains_blob_index = true WHERE slug = 'sales';
```

> Order matters and the failure is unrecoverable. Setting the flag before the
> backfill advertises an empty index as authoritative, and a file still in use
> gets deleted.

**Also register the in-process scanner** (`apps/sales/lib/storage.ts`, imported by
anything that can reach a delete path), so the sales deployment answers
authoritatively for itself. Both proofs, not one.

### 5.5 Vocabularies

Canonical in **`apps/sales/lib/pipeline.ts`**, served live by `/api/meta` under
`apps.sales.vocabulary`, and **never restated in a guide topic**.

```
STAGES         new_lead · contacted · meeting · negotiation · won · lost
CHANNELS       email · whatsapp · call · note · discovery · system
MEETING_TYPES  video · call · in_person
MEETING_STATUS upcoming · done · cancelled
OBJECTIONS     pricing · complexity · existing_solution · timing · decision_pending
PRODUCT_CATS   module · service · licence
TEMPLATE_CATS  intro · follow_up · objection · meeting · kickoff
NEXT_ACTIONS   email · call · demo · follow_up · check_in · wait
```

Colours live here too. Nothing else in the app names a hex for them.

### 5.6 Limits

`apps/sales/lib/limits.ts` — declared once, imported by the route that enforces
it, served by `/api/meta`. Re-export the platform half from
`@blackcode/platform-api`, as `apps/issues/lib/limits.ts` does.

```
PROSPECT_NAME_MAX 120 · CONTACT_NAME_MAX 120 · MEETING_TITLE_MAX 200
COMM_SUBJECT_MAX 300 · PRODUCT_NAME_MAX 120 · TEMPLATE_NAME_MAX 120
DOCUMENT_TITLE_MAX 200 · LABELS_PER_PROSPECT_MAX 20
```

---

## 6. The CLI surface

`bk sales <noun> <verb>`. Package `cli/internal/commands/sales/`, client
`cli/internal/client/sales.go`, one registration line in
`cli/internal/commands/root.go`.

**Every leaf command carries a `routes` annotation** or the literal `"none"` —
`routes_test.go` fails the build otherwise. Command packages must not import each
other (`boundaries_test.go`); shared helpers go in `cmdutil`.

### 6.1 Sales commands

| Command | Route |
|---|---|
| `bk sales today` | `GET …/today` |
| `bk sales pipeline` | `GET …/pipeline` |
| `bk sales metrics [--period 30d\|90d]` | `GET …/metrics` |
| `bk sales search <q> [--type]` | `GET …/sales-search` |
| `bk sales prospect list [--stage --owner --label --q --limit]` | `GET …/prospects` |
| `bk sales prospect show <n>` | `GET …/prospects/{n}` |
| `bk sales prospect create --name [--city --sector --value --owner --stage --source]` | `POST …/prospects` |
| `bk sales prospect edit <n> [...]` | `PATCH …/prospects/{n}` |
| `bk sales prospect stage <n> <stage> [--note]` | `POST …/prospects/{n}/stage` |
| `bk sales prospect assign <n> --owner <email>` | `PATCH …/prospects/{n}` |
| `bk sales prospect next <n> --type --due [--note --owner]` | `PATCH …/prospects/{n}/next-action` |
| `bk sales prospect delete <n> --confirm <name>` | `DELETE …/prospects/{n}` |
| `bk sales contact list\|add\|edit\|rm` | `…/prospects/{n}/contacts(/{cid})` |
| `bk sales journey list <n>` · `add <n> --stage --note` | `…/prospects/{n}/journey` |
| `bk sales meeting list [--prospect --status --from --to]` | `GET …/meetings` |
| `bk sales meeting show <n>` | `GET …/meetings/{n}` |
| `bk sales meeting schedule --prospect --at --type --title [--agenda --attendee]` | `POST …/meetings` |
| `bk sales meeting log --prospect --at --type --title --outcome [--attendee]` | `POST …/meetings` |
| `bk sales meeting outcome <n> --outcome` · `cancel <n>` | `PATCH …/meetings/{n}` |
| `bk sales meeting rm <n> --confirm <n>` | `DELETE …/meetings/{n}` |
| `bk sales comm list [--prospect --channel --dir --from --to]` | `GET …/communications` |
| `bk sales comm log --prospect --channel --dir --at [--subject --body --contact]` | `POST …/communications` |
| `bk sales comm show <n>` · `rm <n>` | `…/communications/{n}` |
| `bk sales objection list\|raise\|counter\|resolve\|rm` | `…/prospects/{n}/objections(/{oid})` |
| `bk sales product list\|show\|create\|edit\|delete` | `…/products(/{n})` |
| `bk sales template list\|show\|create\|edit\|delete` | `…/templates(/{n})` |
| `bk sales template render <n> --var k=v …` | `POST …/templates/{n}/render` |
| `bk sales doc list\|show\|add\|edit\|rm` | `…/documents(/{n})` |
| `bk sales doc link <n> --prospect/--product/--template` · `unlink` | `…/documents/{n}/links` |
| `bk sales match list <prospect>` · `set` · `clear` | `…/prospects/{n}/matches` |
| **`bk sales upload <file>`** *(D-11)* | `POST /api/upload` on the sales host |
| **`bk sales trash list\|restore\|purge\|empty`** *(D-11)* | `…/trash(/*)` |
| **`bk sales label list\|create\|attach\|detach\|delete`** *(D-11)* | `…/labels(/*)` |

### 6.2 Platform commands changed by this project

| Command | Change |
|---|---|
| `bk app list` · `bk app use <slug>` | **New.** The address book (D-1) |
| `bk upload`, `bk trash`, `bk storage`, `bk label` | **Moved** under the app namespace (D-11). Bare spellings become deprecation rows for two minor releases |
| `bk search`, `bk activity`, `bk link` | Unchanged spelling. Results now genuinely span two apps and must display the app tag |
| `bk meta` | Gains a `routing` block: which server each verb tier reaches, and this token's `app_servers` |
| `bk skill` | Installs `blackcode`, migrates `blackcode-issues` (D-17) |

### 6.3 Rules the sales commands must follow

From `CLAUDE.md` → *Writing commands agents can survive*:

- **`Confirm()` is not a guard for agents.** It auto-approves under
  `BK_NO_PROMPT=1` and on a non-TTY — which is how the agent runs. Every
  irreversible sales command requires the target repeated back:
  `bk sales prospect delete 12 --confirm StaffUp`.
- **Irreversible commands report WHAT they did**, captured *before* the delete:
  type, #number and name of every row destroyed.
- **Every failure is a non-zero exit and one line on stderr.** Stdout stays
  parseable.
- **Every realistic 400/404/409 carries a `suggestion`**, printed as `hint:`.
  Sales-specific ones worth hand-writing:
  - unknown stage → *"run `bk meta` for the current stage values"*
  - prospect not found → *"run `bk sales prospect list --q <name>`"*
  - template render with a missing variable → name it, and list the declared set
  - wrong app for a file → *"files belong to one app; use `bk sales upload`"*
- **Renamed or removed a flag?** A row in `deprecations.go` in the same commit.

### 6.4 Guide topics

`cli/internal/guide/topics/sales/`. Each needs a `# Title`, a summary line and a
`Related commands:` line — `guide_test.go` checks all three.

| File | Covers |
|---|---|
| `00-pipeline.md` | prospects, stages, owners, the journey, next actions |
| `01-logging.md` | the daily loop: log a call, log an email, record a meeting outcome, raise/counter an objection |
| `02-catalog.md` | products, templates, documents, triangulation |
| `03-cross-app.md` | **the north star, worked end to end**: prospect → issue → link → back |
| `04-pitfalls.md` | confirm tokens, what the web cannot do, `bk search` vs `bk sales search` |

And one platform topic, which is the most important new writing in this project:

| File | Covers |
|---|---|
| `topics/platform/12-apps.md` | **The three verb tiers (D-11).** Which commands are neutral, which cross apps, which belong to one app. How to switch. Why `bk sales upload` is spelled that way |

> **Never state a dynamic value.** Not a stage name in a list, not a size cap.
> Write *"run `bk meta` for the current stage values"*. `guide_test.go` counts
> vocabulary membership — three values from one set is a restatement and fails
> the build unless `bk meta` is named on an adjacent line.
>
> **A topic under `topics/sales/` may not describe another app.** `03-cross-app.md`
> is the tricky one: write it in terms of **URNs and `bk link`**, not in terms of
> what the issues app is. Shared behaviour belongs in `topics/platform/`.

---

## 7. The HTTP surface

Under `apps/sales/app/api/**`. Private plumbing, **no OpenAPI spec, ever**.

- Workspace-scoped: `/api/workspaces/{ws}/…`. **Never** an implicit active
  workspace resolved server-side.
- Auth + app access via one `resolveWorkspace` call (the shared one, post-D-2).
- Lists return `{ data, next_cursor }` via `jsonList()`. Single resources return
  the bare entity. Create → `201`. Delete → `{ deleted: true }`.
- Addressed by **`{n}` = the workspace #number**, never the row id.
- Errors via `Errors.*` with a `suggestion` wherever an agent can act on it.

Plus the mounted platform routes from D-2.

**Genuine non-CLI routes go in `EXCLUDED_PATHS` with a reason.** Reach for an
exclusion last — writing the annotations is what surfaces the holes.

---

## 8. The web surface

Next.js 16 App Router. Thin server pages rendering `'use client'` feature
components that fetch with TanStack Query.

### 8.1 Routes

| Path | Page |
|---|---|
| `/` | Sign-in redirect / minimal landing |
| `/login` | Auth (NextAuth, sales' own config) |
| `/dashboard` | Resolves the sales workspace → redirect (D-3) |
| `/dashboard/{ws}` | **Today** — greeting, KPI strip, upcoming meetings, action queue |
| `/dashboard/{ws}/metrics` | Pipeline by stage, win rate 30/90d, per-owner breakdown |
| `/dashboard/{ws}/prospects` | Table ⇄ board toggle, filter bar |
| `/dashboard/{ws}/prospects/{n}` | Tabs: Overview / Communications / Meetings / Documents — plus the **Related** cross-app block (D-18) |
| `/dashboard/{ws}/meetings` | Cross-prospect meetings ledger |
| `/dashboard/{ws}/communications` | Cross-prospect comms ledger |
| `/dashboard/{ws}/activity` | `platform.events`, `app = sales` |
| `/dashboard/{ws}/products` · `/templates` · `/documents` | Catalog |
| `/dashboard/{ws}/search` | Full search results (D-9) |
| `/dashboard/{ws}/trash` | Recycle bin |
| `/dashboard/settings/{profile,account,tokens,workspace,preferences}` | **`preferences` holds the read-only/full toggle** |
| `/dashboard/super-admin/{users,errors}` | Gated by `SUPER_ADMINS` + a server-side check in the layout |

### 8.2 Page notes worth writing down

- **Today** shows upcoming meetings across **all** prospects as their own block,
  not buried in one deal's card, and contains **no AI/approval UI whatsoever**
  (`UPDATE-7.md` item 1 — the mockup shipped it twice by accident).
- **Prospects list** is a normal full-width table. **No inner scrollbox, no
  fixed-height container** (`UPDATE-7.md` item 4).
- **Filter bar on every list page**: date range, prospect, channel, stage, owner.
  Persist per workspace across client navigation.
- **Prospect detail is tabbed**, not one long scroll — Communications must not
  compete with the deal journey (`INSTRUCTIONS.md` UPDATE 3).
- **The Documents tab is a filtered view into the shared library**, never a
  parallel store (`UPDATE-6.md`). Same for template attachments.
- **The metrics page computes in SQL** from the tables. The mockup calls these
  "stored aggregates"; at our volume, computing live is simpler, always correct,
  and removes a table that can go stale. Say so in the file header.
- Every mutation (in `full` mode) → `toast.success` / `toast.error`.
  Confirmations through `useConfirm()`, **never** `window.confirm`.

---

## 9. The phases

**Phase 1 is not optional and not reorderable.** Everything after it assumes
those gaps are closed. Phase 13 is what makes app #3 cheap and must not be
dropped when the launch looks done.

Each phase ends with the full gate:

```bash
npm run typecheck && npm test && npm run lint && npm run build
cd cli && go build ./... && go vet ./... && go test ./... && make routes
```

---

### Phase 0 — Setup

- [ ] Confirm the app slug is **`sales`** (one string in six places).
- [ ] Confirm the subdomain **`sales.blackcode.ch`** and that DNS is available.
- [ ] Create a Neon **rehearsal branch**. Every migration in this plan is
      rehearsed there first, **including its rollback**.
- [ ] Create `docs/changelog/sales.md` with the header block copied from
      `docs/changelog/issues.md` and no entries yet.
- [ ] Name the person who owns data protection for prospect data (§12).

---

### Phase 1 — Platform foundations (the one-time tax)

**Everything here is shared code. Every database change is expand → migrate →
contract, rehearsed on a branch including the rollback. Ship these as separate,
small PRs — never bundled.**

> **STATUS 2026-08-06 — 1a AND 1b COMPLETE** (agent1 + agent10, branch
> `sales/phase-1a-1b`, 20 commits). Superseded status note below kept for the
> record of what each agent owned.
>
> **STATUS 2026-08-06 (earlier) — 1a COMPLETE, 1b substantially complete** (agent1, branch
> `sales/phase-1a-1b`, 12 commits). Landed: the shared request layer; 15 Class-A
> factories; the first Class-B factory (`activity`); `platformMetaBlock`; five
> query modules moved into `platform-db`; a package graph that is a clean DAG;
> the D-24 privilege-escalation fix; and a parity flag that can now actually
> fail. **Outstanding, owned by agent10:** the D-23 event seam, the five auth
> callbacks, `/api/upload(/blob)`, `/api/cli/authorize`, `/api/me/password/*`,
> and the six event-writing routes that the seam unblocks.

#### 1a. `AppContext` + shared `apiHandler` / `resolveWorkspace`

- [ ] `packages/platform-api/src/app-context.ts` — `{ db, schema, appSlug }`.
- [ ] Move `apps/issues/lib/api/handler.ts` + `workspace-context.ts` into
      `packages/platform-api/src/handler.ts`, parameterised.
      **Keep `platform.error_events` logging and the agent manifest.**
- [ ] `apps/issues/lib/api/*` becomes a thin re-export. Zero behaviour change.
- [ ] Replace the duplicated copy in `apps/_template/lib/api.ts` — **and rewrite
      its long header comment**, which currently says the extraction is
      deliberately deferred. Leaving that in place after doing it is how the next
      person re-litigates a settled decision.

#### 1b. Platform route factories (D-2, Tier 1)

- [ ] `packages/platform-api/src/routes/` — one module per route.
- [ ] `apps/issues` Tier-1 routes become 3-line mounts.
- [ ] `packages/platform-testing/src/cli-parity.ts` — `hostsPlatformRoutes` now
      means "mounts the factories" and may be true for several apps. **Update
      both apps' test comments in the same commit.**
- [ ] Manual pass over every bare verb against the issues deployment.

> **Prove it fires:** delete one mounted route file in `apps/issues` and confirm
> `cli-parity.test.ts` goes red. Restore.

#### 1c. CLI verb re-tiering (D-11)

- [ ] Move `upload`, `trash`, `storage`, `label` under each app group:
      `bk sales upload`, `bk issues trash`, …
- [ ] Bare spellings → `cli/internal/commands/deprecations.go`, two minor
      releases, each naming its replacement.
- [ ] `hintFor()` in `cmd/bk/main.go` turns the old spelling into the new one.
- [ ] `rootLong` in `root.go` rewritten around the three tiers.
- [ ] Write `topics/platform/12-apps.md`.
- [ ] Changelog: `docs/changelog/platform.md`.

#### 1d. CLI address book (D-1)

- [ ] `config.Config` gains `HomeApp`, `HomeServer`, `AppServers`.
- [ ] `client.Client` takes a base URL; `cmdutil.ClientForApp(slug)`.
- [ ] `bk login` / `bk meta` refresh `AppServers` from `apps.<slug>.base_url`.
- [ ] `bk app list` / `bk app use <slug>`.
- [ ] `bk meta` gains the `routing` block.
- [ ] Guide: `topics/platform/00-overview.md`, `01-install-auth.md`, `12-apps.md`.

> **Prove it fires:** point `AppServers["sales"]` at a dead host. `bk sales
> prospect list` must exit non-zero with a hint — **not** fall back to issues.

#### 1e. Shared-table changes (D-14)

- [ ] `comments.parent_type` — expand to app-qualified.
- [ ] `deletion_batches.root_type` — same.
- [ ] `labels.app varchar(40) NULL` — plus filtering in every label read path and
      in `bk <app> label`.
- [ ] Backfill; deploy issues writing the qualified form.
- [ ] Record the **contract step** as a dated follow-up in `platform.md` so it is
      not forgotten. Verify in the code, not just the data.

#### 1f. Chart kit → `platform-ui` (D-12)

- [ ] Move `apps/issues/components/analytics/charts.tsx` to
      `packages/platform-ui/src/charts/`, themed from CSS variables.
- [ ] Issues imports from there. Visual regression check on the analytics page.

#### 1g. Skill rename (D-17)

- [ ] `skill.Name` → `blackcode`; `bk skill sync` migrates the old directory.
- [ ] `skill_test.go` still passes.

#### 1h. Session cookie → `.blackcode.ch` (D-16)

- [ ] **Its own release, nothing else in it.** Quiet hour. Changelog first.
- [ ] Cookie rename (the `__Host-` prefix cannot carry `Domain`).
- [ ] Verify a fresh sign-in on issues, then confirm the cookie is visible to a
      `sales.blackcode.ch` preview.

#### 1i. Docs for everything above

- [ ] `docs/cli.md`, `docs/backend.md`, `docs/platform-db.md`,
      `docs/platform-architecture.md` (§4.6 owed table, §7.1 verb tiers, §7.6
      parity flag), `docs/frontend.md` (chart kit moved).
- [ ] `CLAUDE.md` + `AGENTS.md` — **the "platform verbs stay bare" line is now
      wrong.** Replace it with the three tiers.

**Phase 1 exit criteria:** issues behaves identically and all its tests pass;
`bk` can address two servers; `bk issues upload` works and `bk upload` prints a
deprecation pointing at it; the database accepts a `sales:prospect` comment and an
app-scoped label.

---

### Phase 2 — Scaffold `apps/sales`

Follow `docs/adding-an-app.md` steps 1–6. Deltas:

- [ ] `cp -R apps/_template apps/sales` — **not** `apps/issues`.
- [ ] Rename: `package.json` → `sales`; `lib/app.ts` `APP_SLUG = 'sales'` and
      **delete the scaffold's underscore note**; `lib/db/schema.ts` →
      `pgSchema('sales')`.
- [ ] `lib/app-isolation.test.ts` → `OTHER_SCHEMAS = ['issues', 'template']`.
- [ ] **Add `'sales'` to `OTHER_SCHEMAS` in `apps/issues` and `apps/_template`.**
      The one edit outside the new directory; it is what makes the guard symmetric.
- [ ] `next.config.js`: add `platform-ui`, `platform-storage` to
      `transpilePackages`; keep `outputFileTracingIncludes` for
      `docs/changelog/*.md`; update `serverActions.allowedOrigins`.
- [ ] Tailwind v4 + `app/globals.css` with the sales tokens (D-4). No
      `tailwind.config`.
- [ ] `postcss.config.js`, `components.json` (`baseColor: stone`).
- [ ] **`apps/sales/.eslintrc.json` — a real config file.** Guardrail #1 in
      `CLAUDE.md` was three packages that had none and whose lint had been
      failing unnoticed.
- [ ] `vitest.config.ts`, `drizzle.config.ts`, `middleware.ts`.
- [ ] `npm run typecheck` passes before a line of domain code.

---

### Phase 3 — Database

- [ ] `CREATE SCHEMA sales;`
- [ ] `docs/sql/app-role.sql` for `sales_app`. **Do not skip step 5b** (revoke
      write on `platform.blob_references`, leave `SELECT`).
- [ ] `docs/sql/app-boundary-probe.sql` **as `sales_app`**. Every deny `42501`.
      `SET ROLE` from the owner is not a substitute.
      - Check (2) runs *for real* for the first time. If it says `SKIPPED`,
        something is wrong with the app registry, not the probe.
- [ ] Migration `0001_sales_init.sql` — §5.2, the counters table, tsvector
      columns + GIN indexes.
- [ ] Migration `0002_blob_reference_index.sql` — all fourteen triggers, the
      backfill, **then** `maintains_blob_index = true`.
- [ ] `platform.apps` row with **`enabled = false`**; flip to `true` only after
      `0002`. Registering an app that cannot answer for its references **stops
      blob deletion platform-wide** — correctly.
- [ ] `apps/sales/lib/db/queries/entities.ts` — the projection. Header read first.
- [ ] `apps/sales/lib/storage.ts` — register the sales reference scanner.
- [ ] `apps/sales/scripts/seed.ts` — the mockup's data as dev fixtures, derived
      from `bsales-mockup/assets/js/data.js`. Gated on `NODE_ENV !== 'production'`
      **and** `SALES_SEED=1`.
- [ ] Rollback scripts for `0001` and `0002` in `docs/sql/`, **rehearsed**.

> **Prove it fires:** with `sales` enabled and `maintains_blob_index = false`,
> confirm blob deletion is **refused** with `ReferenceCoverageError`. Then run
> `0002` and confirm it answers again.

---

### Phase 4 — CLI command group

- [ ] `cp -R cli/internal/commands/template cli/internal/commands/sales`;
      `cp cli/internal/client/template.go cli/internal/client/sales.go`.
- [ ] Every command in §6.1, including the four app-owned verbs from D-11.
- [ ] `routes` annotation on **every** leaf, or `"none"`.
- [ ] Register in `root.go`; add `sales` to `rootLong`'s APPS block.
- [ ] Guide topics (§6.4), including `03-cross-app.md`.
- [ ] `cd cli && go build ./... && go vet ./... && go test ./... && make routes`.

---

### Phase 5 — HTTP routes

- [ ] Mount the D-2 platform factories in `apps/sales/app/api/**`.
      **Decide here whether trash + labels move from Tier 2 to Tier 1** — they do
      if `bk sales trash` / `bk sales label` ship with the app.
- [ ] Every sales route in §6.1.
- [ ] `/api/meta` for sales: `apps.sales.{vocabulary, limits, entity_types}` from
      `lib/pipeline.ts` / `lib/limits.ts` / `lib/entity-address.ts`. **Nothing
      hand-typed.**
- [ ] NextAuth config (`apps/sales/lib/auth.ts`).
- [ ] `lib/cli-parity.test.ts` green, ideally with zero exclusions; every
      exclusion carries a reason.

---

### Phase 6 — Web foundation

- [ ] `app/layout.tsx`, `app/providers.tsx` (SessionProvider → QueryClientProvider
      → ThemeProvider `defaultTheme="dark"` → ConfirmProvider), `<Toaster>`.
- [ ] `app/globals.css` — the sales token set (D-4), light and dark.
- [ ] `components/sales-shell.tsx` — sidebar (Today, Metrics, Prospects,
      Meetings, Communications, Activity · Catalog: Products, Templates,
      Documents), slim sticky header, ⌘K trigger, theme toggle, account footer.
      **No workspace switcher.**
- [ ] `lib/pipeline.ts`, `lib/format.ts`, `lib/ui-mode.ts`.
- [ ] `app/dashboard/layout.tsx` — reproduce the **two different empties** the
      issues layout distinguishes (no memberships at all vs. member with no app
      access). Collapsing them shows a member-without-access an onboarding screen
      that "works" and hides the real problem.

---

### Phase 7 — Web pages

One PR per group, each with page, query hooks and empty state.

- [ ] Today
- [ ] Prospects list + board + filter bar
- [ ] Prospect detail (4 tabs, journey, contacts, objections, triangulation,
      **Related cross-app block**)
- [ ] Meetings · Communications · Activity
- [ ] Products · Templates · Documents
- [ ] Metrics (using the promoted chart kit)
- [ ] Settings (incl. the preferences toggle) · Super-admin · Trash

---

### Phase 8 — The search module (D-9)

- [ ] Wire the tsvector columns + GIN indexes from Phase 3.
- [ ] `GET …/sales-search` — grouped, ranked, faceted.
- [ ] `bk sales search`.
- [ ] ⌘K palette + `/dashboard/{ws}/search`.
- [ ] Ranking rules documented in `apps/sales/docs/frontend.md`.

---

### Phase 9 — Read-only / full mode (D-7)

- [ ] `sales.user_preferences` + `GET/PATCH /api/me/sales-preferences`.
- [ ] `useUiMode()`; every mutation affordance behind it.
- [ ] Settings copy stating plainly that it is not a permission.
- [ ] `lib/ui-mode.test.ts` — no server module imports `ui-mode`.

---

### Phase 10 — Cross-app integration (the north star)

**This phase is the point of the project. Do not fold it into "testing".**

- [ ] `bk sales prospect show <n>` prints cross-app links (D-18).
- [ ] The prospect detail page's **Related** block, with absolute URLs built from
      the other app's `base_url`.
- [ ] `bk issues issue show` displays links back into sales — verify, don't assume.
- [ ] `bk search` output shows the app tag on every result.
- [ ] `bk activity` merges both apps in one timeline.
- [ ] Run the north-star script (§10.4) end to end against preview deployments,
      with **one** token, and record the transcript in
      `apps/sales/docs/backend.md`.

---

### Phase 11 — Guardrails

See §10. **Nothing ships until every row in the prove-it-fires table has been
watched fail.**

---

### Phase 12 — Provisioning and release

See §11.

---

### Phase 13 — Make the next app easy

> **This is the phase that gets dropped, and it is the reason the whole project
> is worth doing this carefully.** Budget it before Phase 12, not after.

- [ ] **Update `apps/_template`** to the post-Phase-1 world: mounted platform
      route factories, the shared `AppContext`, a stub app-owned `upload`/`trash`
      command group, an app-scoped label example, one blob-reference trigger with
      the correct ordering, and one entity projection. **The scaffold must
      demonstrate every one-time thing sales had to invent.**
- [ ] **Rewrite `docs/adding-an-app.md`**:
      - Replace the "⚠️ STEPS 7–10 ARE UNVERIFIED" box with the date, the app
        name (`sales`), and what actually broke.
      - Add the verb-tier rule (D-11) to step 5.
      - Add "mount the platform route factories" as a step.
      - Rewrite "What the walk actually cost" with the real second-app numbers.
      - Add a "what you no longer have to do" section listing everything Phase 1
        removed from the checklist.
- [ ] **GUARDRAIL #10 — `npm test` replayed a cached green over a failing suite.**
      `turbo.json`'s `test` inputs resolve relative to the package, so
      `platform-testing` — whose two tests scan `apps/**` and
      `packages/platform-*/src/**` — had a cache key blind to everything it
      reads. It reported PASS to four consecutive agents who had each been told
      to prove their guards fire, and it hid precisely the two guards
      `adding-an-app.md` promises a new app inherits "with nothing to register".
      Fixed in Phase 2-3; **belongs in `CLAUDE.md`'s table as entry #10.**
      *(Found by agent4, 2026-08-07, by experiment — prime green, restore the
      file byte-identically, watch turbo say FULL TURBO over a red suite.)*
- [ ] **Put D-42's paragraph in the header of every guard that matches text.**
      A lesson lands where the next person will be standing, not where it is
      catalogued — the one self-reference trap caught before commit was caught
      because the previous write-up was in a file somebody had reason to open.
      *(agent7, 2026-08-07.)*
- [ ] **Rename the scaffold's app slug `template` -> `scaffold`** (D-38). It bit
      three guards in one phase because it is a word every app uses as an entity,
      a local and a directory. Five places plus a deprecation row, and it gets
      more expensive with every app. **Settled — do not re-litigate.**
      *(agent5, 2026-08-07.)*
- [ ] **A 409 has no branch in `classify()`**, so `confirm_mismatch` exits 1 from
      the server and 2 from the binary — one condition, two exit codes, and an
      agent cannot write one recovery. The principle: a pre-check in the binary
      must exit the same code the server would. *(agent5, 2026-08-07.)*
- [ ] **Grep comments for `*.test.ts` references and assert the files exist** —
      a cited guard that does not exist reads as protection. *(agent5.)*
- [ ] **`AppContext.resolveUser` drops the credential that proved the caller.**
      There is no supported way to know WHICH token a request arrived on, so
      `platform.events.actor_token_id` is NULL in **both** apps and has been since
      it was created. Sales works around it by matching `token_prefix` among the
      authenticated user's own tokens. The proper fix is `resolveUser` returning
      who *and by what means*. *(agent5, 2026-08-07.)*
- [ ] **`docs/sql/app-role.sql` never grants `EXECUTE ON platform.blob_refs_purge`.**
      0038 granted it by looping over the roles that existed at that moment, so
      every app created since has the gap. It surfaces as the boundary probe's
      check (4e) failing with `permission denied for function` — **the wrong
      error for the right check, which reads as the boundary working** — and it
      stops `bk super-admin blob-drift --repair` clearing an ORPHANED reference,
      the one repair with no source row left to re-trigger. *(agent4, 2026-08-07.)*
- [ ] **Rollback scripts need `\set ON_ERROR_STOP on` + BEGIN/COMMIT.** A `DO`
      block that RAISEs is not a guard: psql prints the error in capitals and
      carries straight on. Reproduced by the agent that wrote the guard to avoid
      exactly that. *(agent4, 2026-08-07.)*
- [ ] **`docs/sql/app-role.sql` is hardcoded to `issues_app`** with a note to
      substitute nine times. Should be a generator or `psql -v app=sales`.
      *(agent4, 2026-08-07.)*
- [ ] **The isolation scanner misses `require()`, `.js` files, and — until Phase
      2-3 — `.sql` and the whole `migrations/` directory.** *(agent4, 2026-08-07.)*
- [ ] **React version conflict in the scaffold.** `apps/_template` declares React
      19; `platform-ui` peers on React 18; `apps/issues` runs 18.3.1. Every real
      app that copies the scaffold and uses the shared UI package hits it, and the
      checklist never mentions it. *(agent4, 2026-08-07.)*
- [ ] **`cli-parity.test.ts` CRASHES on a brand-new app** — `readdirSync` throws
      on the missing `app/api` before any assertion runs, so the reader gets a
      stack trace instead of the message written to teach them. *(agent4.)*
- [ ] **`packages/*` test coverage.** `platform-testing` gains a test task in
      Phase 1b-C for the D-25 cross-schema guard; the rest of the packages still
      have none, and `platform-api`'s tests live in `apps/issues` because there
      is nowhere else to put them. Finish the job. *(Found by agent1; upgraded by
      agent10's D-25 finding, 2026-08-06.)*
- [ ] **The package ESLint config bans app imports and nothing else.**
      `const x: any = 1` in `platform-api` passes clean. This is guardrail #1's
      neighbourhood — a config that exists and checks almost nothing reads as
      protection. Widen it, and watch each new rule fail before trusting it.
      *(Found by agent1, 2026-08-06.)*
- [ ] **`apps/_template` must mount the platform route factories and the
      app-owned verb tier.** It cannot today (it mounts no platform routes, so
      `bk template upload` would claim a route that does not exist and its parity
      test would correctly go red) — but the scaffold is supposed to demonstrate
      everything sales had to invent. *(Agent2, 2026-08-06.)*
- [ ] **Purging an issue/task/project ORPHANS its `platform.comments` rows.** The
      FK that cascaded them (`comments.issue_id`) was dropped in migration 0032,
      and `deletion.ts`'s own header still claims the cascade exists. Worse than
      unbounded row growth: `platform.blob_references` is trigger-maintained on
      comments, so **a file attached only to a comment on a purged item becomes
      permanently undeletable** — a silent leak in the delete gate. Fails closed,
      which is why nobody will notice. Needs a design call (cascade on purge, or
      a reconciler and what it does with the freed references). *(Found by
      agent3, 2026-08-06; the lying header was corrected, the behaviour was
      not.)*
- [ ] **`cli/README.md` documents commands removed in 1.12.0 and restates the
      issue status vocabulary inline** — the same class of thing `guide_test.go`
      bans in guide topics, with no guard covering it. *(Agent2, 2026-08-06.)*
- [ ] `apps/issues/components/landing-page.tsx:614` names bare `bk trash list` in
      the marketing FAQ. Human-facing, low severity. *(Agent2, 2026-08-06.)*
- [ ] `apps/sales/docs/backend.md` + `frontend.md` — this app only.
- [ ] `docs/platform-architecture.md` — §4.6 owed table (strike what's closed),
      §7.1 (verb tiers), §7.6 (parity flag semantics).
- [ ] `docs/2026-08-platform-migration.md` *What is still owed* — strike closed
      rows. **Do not rewrite the history above it.**
- [ ] `CLAUDE.md`, `AGENTS.md`, `README.md`, `ENV_TEMPLATE.md`, `docs/env.md`,
      `docs/devops.md`.
- [ ] `docs/changelog/sales.md` launch entry; platform changes in `platform.md`.
- [ ] **Delete this file, or mark it superseded** with a dated note pointing at
      `adding-an-app.md`. A live plan that has shipped becomes a doc that
      prescribes a finished design, and that is worse than no doc.

---

## 10. Test plan

### 10.1 The standing rule

> **A check you have not watched fail is not a check.** Break the thing it
> guards, watch it go red, then restore.

Nine guardrails in this repo have been found green-but-inert. One was written by
the same session that wrote the rule, an hour later. **Assume the tenth is in
this project.**

### 10.2 The prove-it-fires table

Every row executed and initialled before Phase 12.

| # | Guard | How to break it | Expected failure |
|---|---|---|---|
| 1 | `apps/sales/lib/cli-parity.test.ts` | Delete a `routes` annotation | "no `routes` annotation" |
| 2 | same | Add a route with no command | "routes with no bk command" |
| 3 | same | Point an annotation at a nonexistent path | "claims routes that do not exist" |
| 4 | same, *vacuous-pass assertion* | Remove `topics/sales/` | "no bk command belongs to `sales`" — **the assertion that caught the `__routes` dedup bug.** Confirm it still fires |
| 5 | `apps/sales/lib/app-isolation.test.ts` | `import '../../issues/lib/work-items'` | cross-app import reported |
| 6 | same | `SELECT … FROM issues.issues` in a sales query | cross-schema query reported |
| 7 | `apps/issues/lib/app-isolation.test.ts` | Same two in reverse, naming `sales` | both reported — proves the symmetry edit landed |
| 8 | `guide_test.go` | Three stage names in a sales topic, no `bk meta` nearby | restated vocabulary |
| 9 | same | Write "50 MB" in a sales topic | size-shape violation |
| 10 | same | Reference `bk issues` from a sales topic | cross-app reference |
| 11 | `routes_test.go` | New leaf without an annotation | build fails |
| 12 | `groups_test.go` | — | `bk sales notacommand` exits **non-zero** |
| 13 | `boundaries_test.go` | `import commands/issues` from `commands/sales` | boundary violation |
| 14 | Blob delete gate | `maintains_blob_index = false`, sales enabled | `ReferenceCoverageError` on every URL |
| 15 | Blob triggers | Insert a comm body with an uploaded URL | one `platform.blob_references` row; deleting the comm removes it |
| 16 | `app-boundary-probe.sql` | Run as `sales_app` | every deny `42501`; check (2) **runs**, not `SKIPPED` |
| 17 | Entity projection | Force the source insert to roll back after `projectEntity` | **no** orphan in `platform.entities` |
| 18 | `lib/ui-mode.test.ts` | Import `ui-mode` from a route handler | test fails |
| 19 | **App address book** | Point `AppServers["sales"]` at a dead host | non-zero exit + hint; **no** fallback to issues |
| 20 | **Verb tiering** | `bk upload file.pdf` (bare) | deprecation line naming `bk <app> upload`, non-zero |
| 21 | **File attribution** | `bk sales upload x.pdf`, then query `platform.uploads` | `app = 'sales'`, pathname prefixed `sales/` |
| 22 | **Label scoping** | Create a sales-scoped label, then `bk issues label list` | it does **not** appear |
| 23 | `apps/sales/.eslintrc.json` | `npx eslint .` in `apps/sales` | exits 0 **with a config actually loaded** — guardrail #1 was a *missing config file* |
| 24 | Counter concurrency | Two parallel `prospect create` | two distinct `seq`, no collision |

### 10.3 Automated tests

- **Unit (vitest):** `lib/pipeline.ts` vocabularies; `lib/format.ts` CHF + dates;
  template `{{variable}}` parsing and render-with-missing-var; search ranking.
- **Integration (vitest + Neon branch):** the counter under concurrency; entity
  projection rollback; blob-reference trigger fire/unfire; soft delete → trash →
  restore → purge; app-scoped label visibility.
- **Guards:** `cli-parity.test.ts`, `app-isolation.test.ts` in every app.
- **Go:** the five existing test files, now covering a second app.

### 10.4 The north-star acceptance test

The real acceptance test is the behaviour the project exists for. Run it end to
end against preview deployments, **with one token and one login**:

```bash
# ONE login, against the SALES host. No `bk app use`, no --app-server: the
# whole point is that the app you sign into is the app you can work from.
bk login --token --server https://sales.blackcode.ch
bk workspace use <slug>                         # sales serves this (2026-08-07)
bk app list                                     # both apps, both servers, reachable
bk guide platform/apps                          # the three tiers, readable

# --- record sales work ---
bk sales prospect create --name "Acme SA" --city Lausanne --value 18000
bk sales comm log --prospect 1 --channel call --dir out \
  --body "Intro call. Needs SSO before they can sign."
bk sales meeting schedule --prospect 1 --at "2026-08-14T10:00+02:00" \
  --type video --title "Demo"
bk sales objection raise 1 --type pricing --spoken "Too expensive for a pilot"
bk sales objection counter 1 <objection-id> --counter "Two-milestone offer"
bk sales upload proposal.pdf                    # → filed under SALES
bk sales prospect stage 1 meeting --note "Demo booked"

# --- cross the boundary, without re-auth and WITHOUT CHANGING HOST ---
bk issues issue create --project <n> --title "SSO for Acme SA — blocks CHF 18k deal" --priority 1
bk link create bc:issues:blackcode/issue/N bc:sales:blackcode/prospect/1 --rel blocks

# --- and back ---
bk sales prospect show 1                        # the linked issue is listed
bk search acme                                  # hits in BOTH apps, each tagged
bk activity --since 1h                          # one merged timeline

bk sales prospect delete 1 --confirm "Acme SA"  # reports WHAT it deleted
bk sales trash list                             # it is there
```

> **Four corrections landed on 2026-08-07, after the script was run for the
> first time and did not work.** They are listed because a script in a plan that
> does not run is worse than no script — somebody follows it and blames
> themselves.
>
> - `--at now` is rejected; omit the flag instead (the error says so).
> - `objection raise` takes the prospect POSITIONALLY, not `--prospect`.
> - `--counter` is its own subcommand, `objection counter <prospect> <id>`.
> - `bk issues issue create` requires `--project`.
> - `bk workspace use` was added at the top: without it every later command
>   reports "no active workspace", which is a true statement about a cause three
>   commands earlier.


Then open **both** web apps and confirm: one sign-in covers both, and the
prospect page shows the linked issue as a working link into the other app's
deployment.

> The original wording also asked that "the sales app is read-only with no
> editing affordances anywhere". **That was superseded by full mode (D-7).** The
> web app writes; `ui_mode` is an affordance switch and never a permission, which
> `apps/sales/lib/ui-mode.test.ts` asserts structurally. Rewritten rather than
> footnoted, because a checklist item nobody can satisfy gets ticked anyway.

**If any step needs a second login, a second token, a manual server switch, or
leaves a file in the wrong app — the project is not done.**

---

## 11. Provisioning and release runbook

### 11.1 Database

1. `CREATE SCHEMA sales;` as `neondb_owner`.
2. `docs/sql/app-role.sql` for `sales_app` (incl. step 5b).
3. `docs/sql/app-boundary-probe.sql` **as `sales_app`** — every deny `42501`.
4. Migrations `0001`, then `0002` (triggers → backfill → flag).
5. `platform.apps` row: insert `enabled = false`, flip after `0002`.

### 11.2 Vercel

- **Point at the EXISTING Neon project and Blob store.** A second Neon project
  breaks every cross-app query (`bk search`, `bk activity`, the blob index); a
  second Blob store breaks attribution. Do not let the integration provision new
  ones.
- Root Directory: `apps/sales`.
- Env: `DATABASE_URL` (the `sales_app` role), `MIGRATE_DATABASE_URL`
  (`neondb_owner`), `NEXTAUTH_URL`, **`NEXTAUTH_SECRET` — COPY ISSUES', DO NOT
  GENERATE A NEW ONE (D-39). A fresh secret means single sign-on silently does
  not work and the symptom is a session that works in one app and not the
  other.** `BLOB_READ_WRITE_TOKEN`,
  `SUPER_ADMINS`, `PLATFORM_ENFORCE_APP_ACCESS`, `RUN_MIGRATIONS=1`
  **Production only**.
- **Preview deployments must use `blackcode-platform-preview-blob`.**
  `sweepOrphanedUrls` runs on user action, so a preview pointed at the production
  store would delete real bytes.
- `turbo-ignore` so an issues-only commit does not rebuild sales.
- Update `ENV_TEMPLATE.md` and `docs/env.md`.

### 11.3 DNS + cookies

- `sales.blackcode.ch` → Vercel.
- The cookie rename (D-16) ships **before** this, as its own release.

### 11.4 `devops/release.sh`

One line in `app_registry()`:

```
sales|bc-sales|prj_XXXXXXXX|https://sales.blackcode.ch
```

### 11.5 The release order

```
0. (earlier, standalone)  cookie rename release — everyone signs out once
1. ./devops/release.sh web issues     # Phase 1 platform changes
2. ./devops/release.sh web sales      # the app
3. ./devops/release.sh cli minor      # GitHub + npm (needs `npm login` + an OTP)
4. ./devops/release.sh web issues     # AGAIN — advertises the new CLI version
```

**Why step 4 exists:** the release script bumps `CLI_LATEST_VERSION` in a commit
it creates itself, so that commit lands *after* the first web deploy. Without the
second deploy, production keeps advertising the old version and **no installed
client is ever told an update exists**.

**Answer `normal`, never `forced`.** Publish to npm *before* raising
`CLI_MIN_VERSION` — raise it first and every user is locked out with nothing to
upgrade to. Both versions are overridable by env (`BK_CLI_LATEST` / `BK_CLI_MIN`),
so the floor moves and rolls back without a redeploy.

> **`bk sales` does not exist until the npm publish lands.** Until then sales is
> reachable only from a locally built binary. Sequence the announcement
> accordingly.

### 11.6 Post-release verification

- [ ] `bk meta` from a clean machine shows `apps.sales` with a `base_url`, and
      the `routing` block.
- [ ] The full north-star script (§10.4) against production.
- [ ] `bk super-admin blob-drift` — **read `missing_count` first.** A `missing`
      row is a file another deployment could delete while still in use.
      `unreconciled_count` is not drift.
- [ ] `bk super-admin entity-drift` — zero.
- [ ] Issues unaffected: `bk issues issue list`, `bk issues upload`,
      `bk issues trash list`.
- [ ] One sign-in covers both web apps.

### 11.7 Rollback

- **Web:** Vercel instant rollback per app; sales and issues are independent.
- **CLI:** `BK_CLI_MIN` env override rolls the floor back without a redeploy.
- **App:** `workspace_apps` removal is the soft disable. Setting
  `platform.apps.enabled = false` **re-arms the blob gate** unless
  `maintains_blob_index` stays true — prefer the former.
- **Migrations:** rollback scripts in `docs/sql/`, rehearsed on the branch.

---

## 12. Data protection — D-19, settled 2026-08-06

A CRM holds names, emails, phone numbers and free-text notes about **people at
other companies**. That is a different category of data from an issue tracker,
and it arrives with sales, not before.

Three positions, all confirmed:

| # | Position | Implementation |
|---|---|---|
| 1 | **Retention: 90 days.** A deleted prospect (and its children) stays in trash for 90 days, then is purged automatically | A scheduled purge, plus `bk sales trash list` showing the days remaining per row. **The purge must report what it destroyed** — type, #number and name — to `platform.events`, captured before the delete |
| 2 | **Sales withholds request-derived context from error rows.** *(Amended 2026-08-06 — see the ceiling below)* | The shared `apiHandler` takes a per-app `redactBody` option: when set, `ApiError.details` is **omitted**, not sanitised, and a `{ redacted: 'body' }` marker distinguishes "withheld" from "there was none". Issues keeps today's behaviour. Tested by capturing the INSERT with a fake `Executor` (an integration test would skip when `TEST_DATABASE_URL` is unset, and a skipped check reports success) and by **asserting the premise in the other direction** — with redaction off, the fake email must be present, or the test passes for free |

> **The stated ceiling of D-19 item 2, and why it was amended.** Agent1 measured
> the mechanism before shipping it and found the original wording promised more
> than it can deliver:
>
> 1. **No app records the request body today.** `ApiError.details` is the only
>    request-derived value reaching `error_events.context`. "Redact the body" is
>    really "withhold `details`".
> 2. **Making the handler capture bodies was rejected.** It needs every request
>    cloned up front, and it would make *issues* start recording issue titles it
>    does not record now — the wrong direction.
> 3. **`message` and `stack` are the likelier leak and are NOT redacted.** A
>    driver puts rejected values in error text (`Key (email)=(…) already exists`).
>
> Redacting `message`/`stack` was considered and **rejected**: an error row with
> a scrubbed message is one nobody can triage, and trading diagnosability for a
> partial privacy win is a bad trade. **The honest control is retention** — item
> 1's 90-day horizon covers sales error rows too. That is verifiable; "no
> prospect data can ever appear" was not.
| 3 | **Owner: Andrea**, as company director | Recorded here and in `apps/sales/docs/backend.md` |

---

## 13. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Registering `sales` in `platform.apps` before its blob triggers exist **stops blob deletion in issues too** | **High** | Insert with `enabled = false`; flip only after `0002` |
| A content column added later without a `blob_references` trigger | **High** | §5.4 enumerates all fourteen. Add the trigger in the same migration as the column, every time. Nothing will remind you |
| Phase 1b's route extraction silently changes issues behaviour | **High** | Pure refactor, own PR, existing test suite plus a manual pass over every bare verb |
| Phase 1c's verb move breaks someone's script | **Medium** | Deprecation rows for two minor releases, each naming its replacement; `hintFor()` prints it on failure |
| The read-only toggle is mistaken for a permission | **Medium** | D-7: the copy, the test, and this row |
| `hostsPlatformRoutes` becomes a lie that still passes | **Medium** | Prove-it-fires rows 1–4 |
| Phase 13 gets dropped once sales looks finished | **Medium** | It is a numbered phase with its own checklist, budgeted before release, and it ends by deleting this file |
| Two apps' labels mix | **Low** | `labels.app` (D-14), prove-it-fires row 22 |
| Neon pooled-connection ceiling with a second app | **Low** | Watch it; `platform-architecture.md` §9 flags it |

---

## Appendix A — files to read before touching anything near them

Each exists because something went wrong once, and each header explains what:

- `packages/platform-storage/src/references.ts` — the delete gate.
- `packages/platform-db/src/schema.ts` at `blobReferences` — why the index is
  trigger-maintained.
- `apps/issues/lib/db/queries/entities.ts` — why the projection is written inside
  the source transaction.
- `apps/_template/lib/api.ts` — the recorded reason `apiHandler` was *not*
  extracted, and the stated condition under which it should be (this project).
- `docs/adding-an-app.md`, *"What the walk actually cost"* — the four things that
  broke on the rehearsal.

## Appendix B — mockup reference index

| Source | Use it for |
|---|---|
| `bsales-mockup/assets/js/data.js` | **The schema.** Every field in §5 comes from here |
| `bsales-mockup/README.md` | The doctrine, the page list, the build-next order |
| `bsales-mockup/INSTRUCTIONS.md` | UPDATE 2 (no chat/control surface), UPDATE 3 (meetings + comms tabs). UPDATES 4–5 are **corrupted** and superseded by UPDATE-7 |
| `bsales-mockup/UPDATE-6.md` | The global document library |
| `bsales-mockup/UPDATE-7.md` | Filters, prospects layout, products, templates, triangulation. **The authoritative recovery of the corrupted span** |
| `bsales-mockup/UPDATE-8.md` | Google Workspace direction — **excluded from v1** (§2) |
| `bsales-mockup/UPDATE-9.md` | Kanban, deal owner, dashboard, ⌘K search, settings |
| `bsales-mockup/_screenshots/` | 25 verified screenshots — the visual reference |

## Appendix C — decision log

| # | Decision | Settled |
|---|---|---|
| D-1 | CLI carries an app address book | 2026-08-06 |
| D-2 | Platform routes → shared factories, Tier 1 before launch | 2026-08-06 |
| D-3 | Workspaces in the model, hidden in the UI | 2026-08-06 |
| D-4 | Sales skin: emerald-teal, warm neutrals, roomier | 2026-08-06 |
| D-5 | Prospect *is* the deal in v1, split designed for | 2026-08-06 |
| D-6 | Activity = `platform.events` | 2026-08-06 |
| D-7 | Read-only = affordance, not permission | 2026-08-06 |
| D-8 | Documents = `platform.uploads` + sales metadata | 2026-08-06 |
| D-9 | Search: two named layers | 2026-08-06 |
| D-10 | Sales web talks only to its own origin | 2026-08-06 |
| **D-11** | **Three CLI verb tiers; app-owned verbs are namespaced** | 2026-08-06 |
| D-12 | Chart kit → `platform-ui` | 2026-08-06 |
| D-13 | No platform comments in sales v1 | 2026-08-06 |
| D-14 | `comments`, `deletion_batches` app-qualified; `labels.app` added | 2026-08-06 |
| D-15 | No single-client campaign panel | 2026-08-06 |
| D-16 | One login — cookie moves to `.blackcode.ch`, standalone release | 2026-08-06 |
| D-17 | Skill renamed to `blackcode` | 2026-08-06 |
| D-18 | Cross-app links are a first-class sales feature | 2026-08-06 |
| D-19 | Data protection: 90-day retention, context redaction (with a stated ceiling), Andrea accountable | 2026-08-06 |
| D-20 | `/api/meta` stays per-app; only its platform half is shared | 2026-08-06 |
| D-21 | Every deployed app serves `/api/cli/authorize` | 2026-08-06 |
| D-22 | Factories needing app behaviour take a second argument; classify by transitive reach | 2026-08-06 |
| D-23 | The platform/app event seam: `recordPlatformEvent` + a switch split | 2026-08-06 |
| D-24 | `/api/tokens` uses the validated session resolver (real privilege-escalation fix) | 2026-08-06 |
| D-25 | `packages/platform-*` gets its own cross-schema guard, with a derived schema list | 2026-08-06 |
| D-26 | Prove-it-fires is three steps: fail it, question it, **inject the regression** | 2026-08-06 |
| D-44 | Where a value arrives after the check, build the cure, not the detector | 2026-08-07 |
| D-43 | A correct change can silently retarget an existing assertion | 2026-08-07 |
| D-42 | A guard that matches text will match the text that explains it | 2026-08-07 |
| D-41 | A guard can check correctly and too late | 2026-08-07 |
| D-40 | Share a UI component only where it lets the app render its own values | 2026-08-07 |
| D-39 | Every app must hold the SAME `NEXTAUTH_SECRET` — the session cookie is encrypted | 2026-08-07 |
| D-38 | Guards match slugs in context, never bare; derive vocabularies, never enumerate | 2026-08-07 |
| D-37 | A guard must not fail on correct writing; narrow it, and prove both directions | 2026-08-07 |
| D-36 | A platform route is answered by the apps that mount it | 2026-08-07 |
| D-35 | A cache is part of a check — review the key, not just the assertion | 2026-08-07 |
| D-34 | One drizzle migration ledger per app; a shared one silently skips migrations | 2026-08-07 |
| D-33 | Aggregates are computed; the doctrine forbids deciding, not reading | 2026-08-07 |
| D-32 | The blob-trigger rule is the asymmetry, not a list — 22 columns | 2026-08-07 |
| D-31 | Shared UI is for mechanism, not expression; charts are sales' choice | 2026-08-06 |
| D-30 | A shared UI package needs `@source` as well as `transpilePackages` | 2026-08-06 |
| D-29 | Shared-table CHECKs validate shape, not vocabulary; the wire stays bare; labels backfill to `issues` | 2026-08-06 |
| D-28 | `storage` is cross-app; the tier follows the answer, not the feel | 2026-08-06 |
| D-27 | Phase 1b traps: the dual-use `appSlug`, duplicate lists, shared-credential policy, and when precedent may be applied unattended | 2026-08-06 |
