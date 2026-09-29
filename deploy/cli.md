# Releasing the `bk` CLI

Publishes the Go binary to a **GitHub Release** and an npm package
(`@blackcode_sa/bc-issues`). Run from the repo root. Read [`README.md`](README.md)
first if you have not.

## Defaults — do not ask, just do

| Decision | Default | Override when the user says… |
|---|---|---|
| Bump | **minor** | `patch` / `major` / an exact `vX.Y.Z` |
| Policy | **unforced** (normal) | `forced` / "force" / "block old clients" |

A request to "release the CLI" **is** the approval. Take the defaults and go. You
may choose differently **from context**, and say so in one line rather than asking:

- **patch** — the work in this session was only bug fixes; nothing new to call.
- **major** — a command, flag or exit code was removed or renamed in a way that
  breaks scripts (its `deprecations.go` row is the tell).
- **forced** — a server change is **incompatible with older binaries** (a renamed
  route or field an old `bk` would mis-call), so leaving them running is worse than
  blocking them. Otherwise never.

`forced` locks every older binary out with exit code 8 within ~5 minutes, on every
app at once. It is the one decision here that is expensive to get wrong — when in
doubt, unforced.

## Preflight — stop on any failure

```bash
git rev-parse --abbrev-ref HEAD          # must print: main
git status --porcelain                   # must print nothing (clean tree)
git fetch origin && git status -sb | head -1   # must NOT say behind
git push --dry-run origin main           # must succeed — catches a rejected push BEFORE any tag exists
gh auth status                           # logged in
npm whoami                               # logged in
npm owner ls @blackcode_sa/bc-issues     # the npm whoami user must be listed
go version
```

- **Clean tree is a hard requirement.** The binary is stamped with
  `git describe --tags --dirty`; a dirty tree makes `bk-vX.Y.Z-dirty-*` while the
  GitHub step looks for `bk-vX.Y.Z-*`, and it fails **after** the tag is pushed.
  (Hit for real on v2.0.0.) Commit or stash, then continue.
- Not on `main`, or behind `origin/main`: stop and tell the user. Do not release
  from a branch.
- **Ahead of `origin/main`** is allowed: step 2's push sends those commits too.
  List them (`git log origin/main..HEAD --oneline`) in your report so it is
  visible what went out alongside the release.
- If `npm whoami` fails or the user is not an owner of the package, stop and say
  which: the user must `npm login` as a member with publish access to the
  `@blackcode_sa` organisation.

## Steps

**1. Resolve the version.** From the latest tag, and cross-check npm:

```bash
LATEST=$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
npm view @blackcode_sa/bc-issues dist-tags        # latest should equal $LATEST without the v
echo "$LATEST"
```

Compute the next version by hand from `$LATEST` and the bump (`minor`: `vX.(Y+1).0`;
`patch`: `vX.Y.(Z+1)`; `major`: `v(X+1).0.0`). Set it as `VERSION=vX.Y.Z` and
`NUM=X.Y.Z`. It must not already exist: `git tag --list "$VERSION"` prints nothing
and `npm view @blackcode_sa/bc-issues@$NUM version` fails with E404 (that is the
good answer).

**2. Bump, commit, push.** `cli/npm/install.js` derives its version from
`package.json`, so `package.json` is the only file:

```bash
(cd cli/npm && npm version "$NUM" --no-git-tag-version)
git add cli/npm/package.json
git commit -m "chore: release CLI $VERSION"          # forced: "… $VERSION (forced min)"
git push origin main
```

**Do not continue unless that push succeeded** (check its exit status; don't pipe
it through `tail`, which hides a failure). If it was rejected, stop — see the
recovery table.

**3. Tag.**

```bash
git tag "$VERSION" && git push origin "$VERSION"
```

**4. Build all six binaries** (takes a minute or two):

```bash
(cd cli && make dist)
ls cli/dist | grep "$VERSION\|SHA256SUMS"   # six bk-$VERSION-* files + SHA256SUMS
# cli/dist also keeps every older bk-v* binary; the release command below names
# each file explicitly, so those are never uploaded. `make dist` also rewrites
# cli/routes.json — it should show no diff.
```

**5. GitHub Release.**

```bash
D=cli/dist; B="bk-$VERSION"
gh release create "$VERSION" \
  $D/$B-darwin-amd64 $D/$B-darwin-arm64 $D/$B-linux-amd64 $D/$B-linux-arm64 \
  $D/$B-windows-amd64.exe $D/$B-windows-arm64.exe $D/SHA256SUMS \
  --repo blackcode-switzerland/blackcode-platform --title "$VERSION" \
  --notes '## Install

```bash
npm install -g @blackcode_sa/bc-issues
```

Then `bk login --server https://issues.blackcode.ch` and `bk guide`.'
```

**6. Publish to npm.** This moves the `latest` dist-tag, and every app advertises
it within ~5 minutes:

```bash
(cd cli/npm && npm publish --access public)
```

If npm answers `EOTP`, the account needs a one-time code. **This is the one
question you may ask**: get the 6-digit code from the user and re-run with
`--otp=<code>`. (Nothing has been published yet, so re-running is safe.)

**7. Forced only** — raise the floor. npm refuses to tag an unpublished version,
so this can only follow step 6:

```bash
npm dist-tag add "@blackcode_sa/bc-issues@$NUM" min     # may need a fresh --otp
```

## Verify

```bash
npm view @blackcode_sa/bc-issues dist-tags        # latest = $NUM; min = $NUM only if forced
gh release view "$VERSION" --repo blackcode-switzerland/blackcode-platform --json assets --jq '.assets|length'   # 7
```

After ~5 minutes any app shows the new version (the cache is per server instance):

```bash
curl -sI https://issues.blackcode.ch/api/meta | grep -i x-bk-cli
```

`x-bk-cli-latest` should equal `$NUM`. Absence of the new value in the first five
minutes is the cache, not a failure — wait, then re-check before reporting one.

## Order relative to web deploys

There is **no deploy after** a CLI release (since 2026-09-24 the apps read the
version from npm). The only ordering rule: if the new binary calls routes that
production does not serve yet, deploy the apps that changed
([`web.md`](web.md)) **before** step 6.

## Report back

State: version released, bump and policy chosen (and why if not the default), the
GitHub Release URL `https://github.com/blackcode-switzerland/blackcode-platform/releases/tag/$VERSION`,
and the npm dist-tags after publishing.

## If it fails halfway

The release is not atomic. Find out how far it got before re-running anything:

| It stopped after… | State | Recovery |
|---|---|---|
| step 2, push **rejected** | release commit exists locally only | fix the cause (e.g. GitHub push protection on a secret in an unpushed commit), push, then continue. If you cannot, `git reset --hard origin/main` and `git tag -d $VERSION` and start over |
| step 2 | commit on `main`, no tag | continue from step 3 |
| step 3 | tag pushed, no binaries | continue from step 4 |
| step 5 | GitHub Release exists, npm unpublished | do step 6. Never re-create the release |
| step 6 | published | nothing to redo; do step 7 if forced |

Never re-use a version number that reached npm — npm will not let you republish it;
cut the next patch instead. Roll the floor back any time, no deploy:
`npm dist-tag add @blackcode_sa/bc-issues@<previous> min`.
