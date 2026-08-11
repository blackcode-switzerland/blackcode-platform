# How this refactor is run

Read this first, whoever you are.

---

## The three roles

| Who | Does |
|---|---|
| **The master** (a Claude session) | Plans, writes each agent's brief, reviews what comes back, decides whether a phase is done. **Never writes product code.** |
| **The agents** (fresh Claude sessions) | Execute exactly one phase each, in this repo, and report back. |
| **The human** | Carries files between master and agents, and is the only one who runs deploys, takes backups, and touches production. |

The master never talks to an agent directly and vice versa. Everything goes
through files in this directory, relayed by the human. This exists because a
single session that both plans and executes eight phases runs out of context
somewhere in the middle and starts forgetting its own decisions.

---

## The file protocol

Each agent has a folder: `agent1/`, `agent2/`, … Inside it, files alternate:

```
agent3/
  master-2026-08-11-1.txt     ← the brief. Written by the master. Read this first.
  agent-2026-08-11-1.txt      ← the agent's reply
  master-2026-08-11-2.txt     ← the master's review, or answers to questions
  agent-2026-08-11-2.txt      ← …
```

Naming: `<who>-<YYYY-MM-DD>-<n>.txt`, where `n` restarts at 1 each day.

**Always read the LATEST `master-*.txt` in your own folder.** Nothing else in
that folder is instructions to you — earlier files are history, and other
agents' folders are none of your business.

### If you are an agent

1. Read the latest `master-*.txt` in **your** folder
2. Read `PLAN.md` and `SAFETY.md` in this directory. They are the contract; your
   brief is the slice of it you own
3. Do the work
4. Write `agent-<date>-<n>.txt` in your folder and stop

Write a file and stop **whenever** you need a decision, hit something the brief
did not predict, or believe the brief is wrong. **A brief that turns out to be
wrong is the single most valuable thing you can report.** The master would
rather be corrected than obeyed — the last project's masters got things wrong
in every phase, and the agents that said so saved the most time.

**Your reply is read by a machine, not skimmed by a human.** Say what you did,
what you could not verify, what you changed that the brief did not ask for, and
what you think the master got wrong. Do not pad it. Do not report success for
anything you did not observe.

**In chat, print one line: the path of the file you wrote.** Nothing else. The
human relays the file; anything you say in chat is lost.

### If you are the master

One brief per phase, written only when the previous phase is accepted. Do not
write ahead: each brief should be informed by what the last agent actually
found.

---

## The rules every agent inherits

**1. `apps/issues` is in production. `apps/sales` is not.**
Nothing may be lost from `issues.*`, or from the `platform.*` rows that belong
to issues. Sales' own data may be destroyed freely. If a step would touch a row
issues can see and your brief did not explicitly say so, **stop and report**.

**2. Never touch production.** You do not have, and must not ask for, production
credentials. Develop against the local Postgres (`docker compose up -d`; the
scripts reach it on port **5432**, inside the container). The human runs
everything that reaches production.

> **`bk` DEFAULTS TO PRODUCTION. This has already happened once.**
>
> The CLI reads `~/.config/bk/config.json` — the human's real config, homed on
> `https://sales.blackcode.ch` with a live token. Nothing about running `bk` on
> this machine tells you that. Agent 4 sent five list commands to production
> before noticing a workspace name in an error message was not one of theirs.
>
> **Always run `bk` under an isolated config:**
>
> ```bash
> export BK_CONFIG_DIR=/tmp/bk-agentN
> ```
>
> Rule 2 is not only about `psql`. Anything that can carry a credential —
> `bk`, `vercel`, `gh` — reads a config you did not write.

**3. Prove every check fires.** From `CLAUDE.md`:

> A check you have not watched fail is not a check.

Break the thing it guards, watch it go red, restore. Then ask what it would
*still* pass on, inject that, and watch again. **Twenty-one guardrails in this
repo have been found green and inert**, several written by the same session that
wrote the rule about it. Report which checks you watched fail and how.

**4. The gate, before you report DONE.** From the repo root:

```bash
npm run typecheck
npx turbo test --force      # --force: a cached green has replayed over a
npm run lint                #          failing suite here before
npm run build
cd cli && go build ./... && go vet ./... && go test ./...
cd cli && make routes       # only if a `routes` annotation changed
```

`npx tsc --noEmit` does not work from the root, by design.

**5. Three places, every change** (`CLAUDE.md`): route → `bk` command +
its `routes` annotation → a dated `docs/changelog/*.md` entry. Plus a guide
topic if agent-visible *behaviour* changed.

**6. Commit as you go, do not push.** Small commits with real messages. The
master reviews the branch; the human pushes and deploys.

**7. Update the docs in the same phase.** `CLAUDE.md`'s Docs sync rule is
mandatory. A doc that describes the pre-refactor world is worse than no doc.

---

## The phases and who owns them

| Agent | Phase | What |
|---|---|---|
| **1** | 0 | Backup tooling, the row-count baseline, and `verify.sh` — the thing that stands between this refactor and losing someone's comments |
| **2** | 1 | Sales' own tables (additive), plus the one expand-only column on `platform.error_events` |
| **3** | 2 | Sales bootstraps itself: sign-up, a workspace on first sign-in, members + invite pages |
| **4** | 3 | Sales moves off the shared tables. **The only phase that deletes.** |
| **5** | 4 | The CLI: verb re-tiering, deprecations, guide topics |
| **6** | 5 + 6 | Retire the gates, drop the dead table; then cross-app search as a CLI fan-out |
| **7** | 7 | The scaffold and every doc, so app #3 is born correct |

A phase is not started until the previous one is deployed and verified in
production. Phases are not merged to save time; the boundaries are where the
risk is.

---

## Where the truth lives

- **`PLAN.md`** — what we are doing and why, phase by phase, and the fate of all
  21 `platform.*` tables
- **`SAFETY.md`** — backups, the row-count ledger, and what to do when it goes
  wrong. Read before any phase that touches the database
- **`CLAUDE.md`** (repo root) — the standing rules, and the twenty-one green-but-
  inert guardrails that are the reason for rule 3
- **`docs/adding-an-app.md`** — the current checklist. This refactor changes it;
  agent 7 rewrites it
