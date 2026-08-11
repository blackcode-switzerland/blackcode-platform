# Plan 1 — does the CLI teach its own architecture?

**A direct plan. One agent. Produces a REPORT plus small safe fixes.**

Status: **DONE 2026-08-11** — `Todo/report-1-cli-architecture.md`, commits
`fb759b2` (nine stale strings) and `e12628e` (unknown-subcommand recovery).
Read §5 of the report before writing the next plan: `BK_CONFIG_DIR` does NOT
sandbox `bk skill install`, and §1's "already verified" was half a check.
Written 2026-08-11.

---

## 0. The question

The platform changed shape in the last ten days: two apps, one account, two verb
tiers, per-app workspaces. **An existing `bk` user who learned the old shape, and
a brand-new user who has never seen it, must both be able to work it out from the
binary alone** — because the binary is the only interface agents have.

You are not auditing whether commands exist. That was done on 2026-08-11 (report
archived at `~/Documents/BAK/blackcode-platform-backups/parityAudit/`). **You are
auditing whether the binary EXPLAINS ITSELF.**

## 1. Already verified — do not redo

Spot-checked 2026-08-11 and green:

- `bk --help` leads with "one login, one token, one command group per app", then
  lays out both tiers with their reasoning, and ends on "each app remembers its
  own active workspace"
- `bk guide platform/apps` exists and opens with the tier rule and *why* getting
  it wrong is not a syntax error
- every verb the top-level summary names resolves against a built binary

One drift was found and fixed in that pass: the hand-written invite list had
lost `show` one day after it was added. **Assume there are more of that shape** —
cobra generates the command tree, but every summary, `Long`, `Example` and hint
around it is typed by a person.

## 2. What to actually test

**Build the binary and drive it. Do not read the source and conclude.**

```sh
cd cli && go build -o /tmp/bk-arch ./cmd/bk
export BK_CONFIG_DIR=/tmp/bk-arch-cfg      # NEVER the default — it points at production
```

### 2a. The three journeys

Walk each as the person, writing down what you actually see:

1. **Brand new.** `bk` with no config. Can you get from nothing to "I know there
   are two apps, I know how to address one, I know how to sign in"? Where is the
   first place you would guess wrong?
2. **Returning, taught the OLD shape.** You know `bk issue create`,
   `bk workspace use`, `bk search`. Every one of those moved. **Does each dead
   spelling tell you where it went?** `deprecations.go` is the mechanism; test it
   against the binary, not by reading the file.
3. **An agent that skips `--help`.** It guesses. Does a wrong guess recover or
   dead-end? Feedback item 2 in `issues-app-feedback.md` is a real instance:
   `issue get` / `issue show` guessed before `issue view`.

### 2b. Specific things to check

- **Does anything still describe one app, or three tiers?** Both were true within
  the last week.
- **`bk meta`** — its job is "where will each command go". Does its output make
  the two-app structure legible, or does it assume you already know?
- **`bk app list`** — does a new user learn from it that the home app only
  affects BARE verbs?
- **`bk skill`'s template** — agents install it. Does it teach the tiers?
- **Error copy on the tier mistake.** Run a bare verb that no longer exists and
  an app verb against the wrong app. Both should name the fix.
- **`bk guide --list`** — is there a topic a newcomer would open first, and does
  the ordering put it there?

## 3. Fix / report

**Fix, if small and verifiable:** a summary naming a verb that moved, a `Long`
that describes the old shape, a missing deprecation hint, help text that assumes
one app.

**Report, do not fix:** anything needing a new command, a route, or a decision
about wording that changes behaviour.

**For every fix: resolve the spelling against the built binary.** The 2026-08-11
audit found fourteen dead spellings in live help, and the fifteenth was created
the next day by someone who had just read that report.

## 4. Deliverable

`Todo/report-1-cli-architecture.md`:

1. The three journeys — what you saw, where you would have gone wrong
2. Every stale or one-app-assuming string, with file:line and what you did
3. What a new user still cannot work out from the binary alone
4. What you could not test without credentials
5. What in this plan was wrong

## 5. Rules

- `BK_CONFIG_DIR` always. The default config points at production.
- Full gate before you finish: `npm run typecheck && npx turbo test --force &&
  npm run lint` and `cd cli && go build ./... && go vet ./... && go test ./...`
- `cd cli && make routes` if any `routes` annotation changed.
- Commit as you go; do not push.
