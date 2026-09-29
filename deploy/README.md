# deploy/ — how to ship the CLI and the web apps

These docs are the whole release procedure. They are written to be followed by an
**agent or a person with no other context** — read the one you need and do what it
says. There is no release script: `devops/release.sh` was retired on 2026-09-29.

| You want to… | Read |
|---|---|
| Release the `bk` CLI (GitHub Release + npm) | [`cli.md`](cli.md) |
| Deploy one or more web apps (`issues`, `sales`, `books`, `billing`) to Vercel production | [`web.md`](web.md) |

They are independent. **A CLI release never deploys an app, and a web deploy never
releases the CLI.** The binary serves every app; an app serves only itself.

## The two rules that shape everything

**1. Don't ask blocking questions — use the defaults.** A request to "deploy" or
"release" is the go-ahead. Each doc names its defaults (CLI: **minor, unforced**;
web: the apps that changed, or all four) and the ways to override them. An agent
following these docs asks a question only when a precondition fails and it cannot
fix it itself (a missing npm OTP, a dirty working tree). It states a decision it
took from context in one line, instead of asking.

**2. Deploys are local and explicit.** Nothing here is continuous deployment.
Vercel's Git integration is switched off for every app (`vercel.json` →
`git.deploymentEnabled.main: false`), so **pushing to GitHub never deploys
anything.** A deploy happens only when someone runs the command in `web.md` from
the repo root; the upload goes to Vercel, which builds it there.

## Why web deploys use tokens

Vercel bills per team member seat, and its Git integration blocks a deployment
whose commit author is not a paid seat on the team. Deploying through the Vercel
CLI with an **access token** sidesteps both: the deployment is attributed to the
token, not to whoever authored the commit. So:

- **No `vercel login`**, no Vercel MCP, no browser — the token is the whole
  credential.
- **No tricks.** Nobody needs to re-author a commit, make an empty commit, or
  change `git config user.*` to get past the seat check. Deploy whatever is on
  your machine as whoever you are.
- **One token per app**, each scoped to its own project. The `sales` token cannot
  touch `issues` — the Vercel API answers "Project not found" — so a wrong token
  fails cleanly instead of shipping to the wrong app.

It was proven on 2026-09-29: with the local Vercel CLI logged out and the HEAD
commit authored by a different team member, a token-only `vercel --prod` for
`sales` succeeded (exit 0) and published to `https://sales.blackcode.ch`. All four tokens
were also checked against the Vercel API: each reads its own project and gets
"Project not found" for the others.

## Prerequisites (one-time per machine)

| Tool | For | Check |
|---|---|---|
| Node.js + `npm` | both | `npm --version` |
| `gh` logged in | CLI release | `gh auth status` |
| `npm` logged in **as a member with publish access to `@blackcode_sa`** | CLI release | `npm whoami` |
| Go | CLI release (`make dist`) | `go version` |
| `vercel` CLI | web | **not required** — `npx vercel` fetches it. No login needed |

## The tokens are committed to this repo — read this

The four Vercel tokens live in plain text in [`web.md`](web.md), committed, **by
decision** (2026-09-29): it makes the docs self-contained, so a fresh clone can
deploy with nothing else. The repository is **public**, which means anyone who
reads it can deploy to production on those four apps.

- Vercel scans public repos for its own tokens and may revoke them automatically.
  **If a deploy fails with 401/403 and the token looks right, it was revoked** —
  mint a new one (Vercel → Team settings → Tokens), replace it in `web.md`.
- Treat a leak as real: rotate all four if the repo has been public with them in
  it and you are not sure nobody copied them.
- **Making the repo private, or moving the tokens out of git, needs no change to
  the procedure** — only the token table in `web.md` moves.

## Related docs

- [`docs/devops.md`](../docs/devops.md) — environment variables, migrations, the
  operational rules learned the hard way. Deploying is here; *operating* is there.
- [`docs/env.md`](../docs/env.md) — the per-project environment audit.
- [`docs/cli.md`](../docs/cli.md) — CLI internals and the normal-vs-forced policy.
- [`docs/adding-an-app.md`](../docs/adding-an-app.md) — adding an app adds one row
  to `web.md`.
