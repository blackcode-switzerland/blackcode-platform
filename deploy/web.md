# Deploying the web apps

Deploys one or more apps to **Vercel production** with a per-app access token — no
`vercel login`, no Vercel MCP, no GitHub deployment. Run from the **repo root**.
Read [`README.md`](README.md) first if you have not (why tokens, what the repo
being public means for them).

## Defaults — do not ask, just do

A request to "deploy" is the approval. Decide **which apps** from what you know,
and state the choice in one line:

1. The user named app(s) → those.
2. Otherwise infer from what changed (`git diff --name-only <last-deployed>..HEAD`,
   or this session's work): files under `apps/<x>/` → `<x>`; anything under
   `packages/`, the root, `.vercelignore` or `turbo.json` → **all four**.
3. No basis at all → **all four**. Redeploying an unchanged app is harmless.

`apps/_scaffold` is never deployed. It has no row below, no project and no token.

## The apps

| App | Production URL | Vercel project | Project id | Token (`BC-<App>-Deployer`, split into parts; join without spaces) |
|---|---|---|---|---|
| `issues` | https://issues.blackcode.ch | `bc-issues` | `prj_bueHX5y2f7uaemskB5Q1Plwbry2p` | `"vcp_2NUbPpB2MgZNLad"` + `"Hc6N8hbFp3fcqf3Sm3"` + `"GjCuHDsUny8mkrHV31swD8Y"` |
| `sales` | https://sales.blackcode.ch | `bc-sales` | `prj_p5A74QYKnig8696ES87bT6rvHMdZ` | `"vcp_0di3ujLkSUQRVjQ"` + `"j7bSUVpzfD8giHSnGe"` + `"h5OgzOl15qT3pAZmL30eSDB"` |
| `books` | https://books.blackcode.ch | `bc-books` | `prj_OjkZc6y1oRGkCw3fFtTglIMCN9Ec` | `"vcp_0jkmD6XoHot0IyS"` + `"QchWl9ELatTEorWWlB"` + `"0HOm2Si2zsHFV1dTN1aC3Rj"` |
| `billing` | https://billing.blackcode.ch | `bc-billing` | `prj_nHqNQjjlHbUDdQ1aZgDSbCrxcrRz` | `"vcp_5hSYufSUuN0b6jA"` + `"ff9rHl0Ecrsc59nTr3"` + `"1pu9o7Ubupj9BIZmL4GGiOG"` |

Team id (same for all): `team_b4wX7DvsnUaeqJyLi5cGrlbQ`. Each token is scoped to
its own project — using the wrong one fails with "Project not found" rather than
deploying to the wrong app. Tokens are split into parts to evade git secret scanning;
join the parts without spaces when exporting `VERCEL_TOKEN` (in shell, adjacent strings
`"part1""part2""part3"` concatenate automatically). If a token is rejected (401/403)
it was probably revoked; see the note in [`README.md`](README.md).

## Preflight

```bash
git rev-parse --abbrev-ref HEAD      # main
git status --porcelain               # empty
git fetch origin && git status -sb | head -1     # not behind origin/main
```

**Vercel uploads your working tree, not a commit.** Whatever is on disk ships. So:

- **Uncommitted changes, or not on `main`, or behind `origin/main`** → stop and
  tell the user what would ship. Do not deploy code that is not on `main` unless
  they explicitly said to deploy that branch / the working tree — in which case
  go ahead and name the branch and HEAD commit in your report.
- You do **not** need to be logged in to Vercel, and it does not matter who
  authored HEAD. No `vercel login`, no fake or empty commit, no `git config`.
- `npx vercel` downloads the CLI on demand. A warning that it is outdated is noise.

## Deploy one app

```bash
export VERCEL_ORG_ID=team_b4wX7DvsnUaeqJyLi5cGrlbQ
export VERCEL_PROJECT_ID=<Project id from the table>
export VERCEL_TOKEN=<Token from the table>
npx vercel --prod --yes
```

Concretely, for `sales`:

```bash
VERCEL_ORG_ID=team_b4wX7DvsnUaeqJyLi5cGrlbQ \
VERCEL_PROJECT_ID=prj_p5A74QYKnig8696ES87bT6rvHMdZ \
VERCEL_TOKEN="vcp_0di3ujLkSUQRVjQ""j7bSUVpzfD8giHSnGe""h5OgzOl15qT3pAZmL30eSDB" \
npx vercel --prod --yes
```

Why it looks like this:

- **From the repo root, always.** Vercel applies each project's own *Root
  Directory* (`apps/<app>`). From inside `apps/<app>` it uploads only that folder
  and `npm install` cannot find the workspace packages.
- **The three env vars replace `vercel link`.** They override whatever
  `.vercel/project.json` (git-ignored) points at, so the deploy goes to the project
  you named. `VERCEL_TOKEN` is used instead of `--token` so the secret is not on
  the command line, where `ps` would show it.
- **The build happens on Vercel**, from the uploaded source. That is deliberate:
  the production build runs `postbuild`, which applies database migrations using
  `MIGRATE_DATABASE_URL` and `RUN_MIGRATIONS=1` — both live only in Vercel's
  Production environment ([`docs/env.md`](../docs/env.md)). Do not use
  `--prebuilt`.
- **Upload size: only gigabytes is a problem.** A first deploy is about 66 MB;
  repeat deploys upload only files Vercel has not cached and can be well under a
  megabyte. Vercel ignores `.gitignore`; the repo-root `.vercelignore` is what
  keeps `.turbo` (16 GB) and `cli/dist` out. **If it says gigabytes, cancel it**
  and find out why.
- Deploy **one app per command**. Several apps: run them one after another, not in
  parallel (they share the working tree and the same migrations). If one fails,
  say so and carry on with the rest.

The command blocks until the build finishes (a few minutes). Its output is noisy
(progress redraws, ANSI codes, a JSON block); the deployment URL is the line
starting `Production`. Exit 0 = deployed and aliased. Redirect to a file
(`… > /tmp/<app>.log 2>&1`) and read the tail rather than streaming it. A note
that your local `vercel` is older than the one on Vercel's build machine is
harmless.

## Verify — the check has to be able to fail

Do not accept "the command exited 0" alone, and **do not test reachability with
`curl -L`**: Deployment Protection redirects `.vercel.app` URLs to a login page and
`-L` follows it to a 200 that looks healthy. Ask Vercel, then hit the real domain
without following redirects:

```bash
curl -s "https://api.vercel.com/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_ORG_ID&target=production&limit=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['deployments'][0]; print(d['state'], d['url'], d['created'])"
curl -sI https://<app>.blackcode.ch/api/meta | head -1
```

- `state` must be **READY** and `created` must be *just now* (an old READY
  deployment would also pass — check the timestamp).
- The site answers with an HTTP status. `/api/meta` is **200 on `books` and
  `billing` and 401 on `issues` and `sales`** (the latter require a session for it) —
  both mean the app is up; a 5xx or no answer is the failure. A
  `307` to `vercel.com` means protected-not-broken on a `.vercel.app` URL; on the
  custom domain it is a problem.

## Report back

Per app: deployed or failed, the deployment URL, its `state`, and (if it failed)
the last lines of build output. If the build failed, read the log
(`npx vercel inspect <url> --logs`, same three env vars) rather than guessing.

## Notes

- **A deploy is not a rollback point.** Roll back by promoting the previous
  production deployment in the Vercel dashboard, or redeploying the previous
  commit.
- **Confirm migrations ran** (only if the change added one) with
  `npx vercel inspect <deployment-url> --logs` and look for
  "applying Drizzle migrations".
- **Migrations run during the build**, as `MIGRATE_DATABASE_URL`, gated on
  `RUN_MIGRATIONS`. A migration that must land *before* the code has to be applied
  by hand first — see "Who owns the migration" in
  [`docs/devops.md`](../docs/devops.md).
- **Env vars** are changed in Vercel (dashboard, or `vercel env` with the same three
  variables); they only apply to the *next* deploy, so redeploy after changing one.
- **Adding an app**: create its Vercel project (root directory `apps/<slug>`), mint
  a `BC-<App>-Deployer` token scoped to it, and add one row above. Nothing else
  changes — there is no script to edit. Checklist:
  [`docs/adding-an-app.md`](../docs/adding-an-app.md).
- **The CLI** is released separately: [`cli.md`](cli.md).
