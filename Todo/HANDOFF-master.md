# Handoff — read this first after a compact

Written 2026-08-11. You are the master on the blackcode platform. You plan,
review agent reports, and make decisions. **You do not normally write product
code** — with one standing exception below.

---

## Where things are

**Both apps are live and healthy:** `issues.blackcode.ch`, `sales.blackcode.ch`.
Repo clean, everything pushed, `main` is the only meaningful branch.

**Finished, in order, over the last week:**

1. **The sales app** — built by 9 agents, shipped 2026-08-10
2. **The multi-app refactor** — 10 phases, 10 agents. The two apps now share
   **accounts, passwords, API tokens, sign-in and the app registry, and nothing
   else.** Each owns its workspaces, members, comments, labels, uploads,
   activity, trash and search
3. **The CLI re-tiering** — two tiers, not three. Bare = your account and the
   binary; anything touching an app's data is `bk <app> <verb>`
4. **A UI polish pass** on sales, and a docs pass
5. **A web⇄CLI parity audit** — its findings are all closed except what is in
   `Todo/`

**The record lives in** `docs/2026-08-multi-app-refactor.md` (§9 is the open
ledger, four items, none blocking) and `docs/working-in-this-repo.md` (the traps,
written so the next person does not pay for them again).

## What is waiting

**`Todo/` holds two plans, both unstarted.** The human hands each to a fresh
agent and relays the reply.

- `plan-1-cli-architecture-verification.md` — does the binary explain the new
  architecture to a new user and to one who learned the old shape? I spot-checked
  this and it is largely green; the plan is the thorough version.
- `plan-2-issues-feedback-triage.md` — five user reports in
  `issues-app-feedback.md`, all from the rebuild window. **The central instruction
  is to establish which of four categories each falls into before proposing
  anything**: still broken / already fixed / collateral damage / never broken.

**The most useful thing I learned reading them:** item 1 says "labels are UI-only,
CLI and REST both broken". False — `bk issues label attach <issue_id> <label_id>`
exists. The reporter used flags where it takes positional args, and a bare verb
that had moved. Two people reached "this feature does not exist" while it was one
`--help` away. **Several of these are discoverability, not absence.**

## How this human works

- Direct answers. They push back, and they are usually right — when they say
  "that's wrong", re-check rather than defend.
- They deploy and run production commands themselves. Hand over exact commands.
- They will ask you to do small fixes directly rather than spawn an agent. **That
  is the standing exception to "no product code"** — take it, and say plainly
  when you are stepping outside the role.
- They think in terms of "is this professional / will this confuse a new
  developer or agent".

## The thing that will bite you

**This project's recurring defect is a claim larger than the check that produced
it.** I made it at least six times in a week:

| Claimed | What I had actually checked |
|---|---|
| "neither app has a signup screen" | is there a *page path* containing "signup" — it was a tab on `/login` |
| "one call site" | one file, after the wide grep timed out |
| "`verify.sh` is clean" | three schemas, while a fourth app existed |
| "this edit landed" | that the commit succeeded — the `assert` before it had failed |

**Before reporting a negative, say what question your command actually asked.**
It is written into `CLAUDE.md` next to the guardrail table, and into both plans.

Related, and the reason every plan ends the same way: **every plan written on
this project has contained something false.** Ten agents, ten for ten. Ask for
that explicitly; it is the highest-value thing an agent reports.

## Practical notes

- `BK_CONFIG_DIR` before any `bk` command — the default is the human's real
  config, pointed at **production**. An agent reached production that way once.
- No `psql` on this machine; go through `docker exec -i blackcode-postgres psql`.
  Local Postgres is port **5432 inside** the container, 5434 on the host.
- `pg_dump` must match the server major version — production is PG 17, the local
  container is 16. Use `docker run --rm -i postgres:17 pg_dump`.
- Production connection strings are **not** kept on disk. Ask the human to save
  one to a gitignored path when needed, and delete it after.
- The gate: `npm run typecheck && npx turbo test --force && npm run lint &&
  npm run build`, plus `cd cli && go build ./... && go vet ./... && go test ./...`
  and `make routes` if annotations changed. `npx tsc --noEmit` does not work from
  the root, by design.
- Working folders are gitignored and archived to
  `~/Documents/BAK/blackcode-platform-backups/` when done. `Todo/` is tracked.

## What has NOT been done

**The product work.** The human's original ask was *"redefining the sales app,
issues app, and improve the CLI."* The CLI and the architecture are done. **What
the two apps should DO — features, gaps, how they feel to use — has not been
touched.** Everything so far was the ground it needs to stand on.

When they are ready, the useful opening is not "what should we build" but **"tell
me what irritates you when you actually use them"** — this project spent a week
proving that reading a codebase is not the same as knowing it.
