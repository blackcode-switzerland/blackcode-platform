# Report 2 — triage of `Todo/issues-app-feedback.md`

Answering `Todo/plan-2-issues-feedback-triage.md`. Written 2026-08-11.

**Method: a built binary, a running dev server and a local Postgres.** `cd cli &&
go build -o /tmp/bk-tri ./cmd/bk`, `BK_CONFIG_DIR=/tmp/bk-tri-cfg` throughout,
`docker compose` Postgres on host port **5434**, `npm run dev` (which landed on
**3001**, port 3000 being taken). A local API token was minted straight into
`platform.api_tokens` so the HTTP claims could be checked as a real caller rather
than reasoned about. Nothing below was concluded from reading source alone;
source was opened to explain a behaviour the running system had already shown.

**Verdict: one of the five reports describes something that was actually broken.**
Two were fixed hours earlier by report 1's commits, one was a misspelling in a
message rather than a fault in the app, and the biggest one — item 1 — is four
claims of which one is true. The true one is the sharpest defect in the file, and
it is not the one the report leads with.

Four commits: `e0e9458` (labels), `49a980d` (dead links), `1431db6` (login
`--token`), `12af6d6` (changelog).

---

## 1. The triage table

| # | Claim | Category | Evidence |
|---|---|---|---|
| **1a** | "labeling is effectively a UI-only feature, not exposed via CLI or REST" | **Never broken** | `bk issues label attach 16 99` → `attached label 99 to issue 16`, watched, then detached. The reporter typed `bk label attach --ws … --issue … --label …`: bare tier (moved 2026-08-10) *and* flags where the command takes two positionals |
| **1b** | `PATCH …/issues/{id}` silently accepts and ignores `labels`/`label_ids` | **Still broken** → fixed | Three PATCHes at an issue with `labels: []` — `{"label_ids":[99]}`, `{"labels":[…]}`, and a nonsense field — all returned **200**, and a re-GET showed `labels: []`. `updateIssue` copies a fixed whitelist |
| **1c** | `issue view` output "doesn't even include a `labels` field on the response shape" | **Never broken** (but invisible) | `GET …/issues/{id}` returns `labels` and always has — `issueListSelect` aggregates it. The CLI's table output printed the `Labels:` line *only when non-empty*, so an unlabeled issue looked like a response with no such field |
| **1d** | `bk issues issue edit` has no `--label` flag | **True — and a decision, not a bug** | Confirmed via `--help`. See §3 |
| **2** | No verb synonyms; `get`/`show`/`update` dead-end | **Already fixed** | `9d568c1`, hours before this triage. Verified by sweep, not by reading: **162 synonym probes across 45 groups and 208 leaves, 0 dead ends** |
| **3** | The first unknown-command failure should suggest `bk skill sync` | **Already fixed** | Every unknown command at every depth already answers with a `hint:` naming `bk skill sync` *and* the real group. No second mechanism needed or added |
| **4a** | `/agent-updater` → doesn't resolve | **Never broken — misspelled** | The page is `/agent-updator`, and always has been. `updater` is the correct English spelling, so it is the one anyone writing the link from memory reaches for |
| **4b** | `/changelog` → 404 | **Working as designed** | The page was deliberately removed 2026-08-03 and must not return. Both paths now **307** to the real thing |
| **5a** | `bk login --token <value>` / `--token=<value>` fail ambiguously | **Still broken** → fixed | Reproduced exactly, including the `strconv.ParseBool` message |
| **5b** | Windows PowerShell execution policy blocks the npm/`bk` shims | **Could not reproduce — no Windows machine** | Documented, not coded. See §4 |

**"Collateral damage" is empty.** Nothing here was broken by the ten-phase
refactor. Item 1a is the closest — the reporter used a spelling the refactor
moved — but the tier change carries a deprecation hint, and the command they
wanted existed under its new name the whole time.

---

## 2. What I fixed, and how I watched it work

### Item 1b — the silent 200 (`e0e9458`)

The real defect in the file. `PATCH` now answers **400 `labels_not_patchable`**
with a suggestion naming `bk issues label attach`, so a caller who guesses the
field is told where to go instead of receiving a success that changed nothing.

Watched live: 400 with the suggestion for both keys, and — the half that matters —
an ordinary `{"priority":4}` still 200.

**Deliberately narrow: only those two keys.** A blanket unknown-field rejection
would break any client sending anything extra. `{"totally_made_up_field":1}` is
still a 200 no-op, and that is a bigger, breaking decision that nobody asked for.

The test was mutated twice, per the standing rule:

| Mutation | Result |
|---|---|
| rejection loop emptied | 3 red |
| `if (key in body)` → `if (true)` — refuse everything | **2 red, including the positive case** |

The second is the mutation CLAUDE.md finding #21 exists for, and the positive
case asserts the RESPONSE (`status === 200`, field applied), not a side effect
reached on the way to one.

### Item 1c — the invisible empty list (`e0e9458`)

`bk issues issue view` now always prints `Labels:`, showing `—` when empty. The
full loop, watched:

```
$ bk issues label attach 16 99   → attached
$ bk issues issue view 16        → Labels:      agent7-browser-pass
$ bk issues label detach 16 99   → detached
$ bk issues issue view 16        → Labels:      —
```

An absent row and an empty row looked identical and only one of them was true.
That is the whole reason the reporter could not confirm anything had worked.

### Item 4 — the two dead links (`49a980d`)

`/agent-updater` → `/agent-updator`, `/changelog` → `/api/changelog`, both
**307**, both watched with `curl` (307 → destination 200). 307 rather than 308
because both point at spellings we may yet want to change — the `updator` typo
above all — and a permanent redirect is cached past our ability to fix it.

The `/changelog` redirect is **not** a reinstatement of the page. The config
guard asserts the destination starts with `/api/`, so a future edit pointing it
at a page fails.

**The host was not the problem.** The plan wondered whether the shared advice
simply named the wrong host. It did not: the reporter confirmed
`bc-issues.vercel.app/api/changelog` returned real data, so that host answers.
Only the paths were wrong.

### Item 5a — `bk login --token` (`1431db6`)

The flag stays a **switch**, and that is a security property rather than an
oversight: passing the token as a flag value puts the secret in the shell
history, the process list and any CI log of the command line. Stdin puts it in
none of them. So the fix is to make every wrong guess name the working line
rather than to start accepting a value.

All four paths, watched against a built binary:

| Spelling | Before | After |
|---|---|---|
| `--token=<v>` | `strconv.ParseBool: parsing "bk_live_…"` | same + `hint:` naming the piped form |
| `--token <v>` | `Server: …` then `read token: EOF` | `--token takes no value …` + the piped form |
| `--token`, no pipe | `read token: EOF` | `no token on stdin …` + the piped form + how to mint one |
| stray positional | silently swallowed | `unexpected argument "…"` |
| `echo <tok> \| bk login --token` | works | **still works, exit 0** |

They are caught in three different places because pflag rejects `--token=<v>`
during parsing, before any `Args` or `RunE` hook exists to see it. That one lives
in `hintFor()`, matched on the flag **name** so the recovery cannot fire for an
unrelated bool — asserted by `TestTokenHintDoesNotFireForOtherBooleanFlags`.

**A finding of its own, not in the feedback: the exit code was wrong.** All three
new messages exited **1** (runtime fault) rather than the **2** the documented
table promises for a flag mistake. `exitCodeFor` derives "usage" from cobra's
phrasings — `unknown flag`, `arg(s)`, a leading `invalid ` — so any check of ours
phrased as a readable sentence falls through to 1 silently. Adding
`cmdutil.UsageError` fixes it by type, and `docs/cli.md` now warns about the
trap, because every future hand-written usage check has it.

Three mutations, each watched red then restored: hint branch removed; `Usagef`
downgraded to `fmt.Errorf` (caught by the exit-code assertion, not the message
one); `Args` hook made to reject everything (caught by the positive case).

### Items 1a / 1 discoverability — the guide (`e0e9458`)

The plan called this "the bigger finding" and it is right: **two people reached
"this feature does not exist" while the command was one `--help` away.**
`bk guide issues/items` gained a *"Labels on an issue that already exists"*
section — the two-positional shape, the id-vs-name split between `attach` and
`create --label`, and an explicit statement that `edit --label` does not exist
and that the PATCH field is rejected rather than ignored.

---

## 3. What needs a decision

### `bk issues issue edit --label` (item 1d) — recommend: add it

> **DECIDED AND IMPLEMENTED 2026-08-11 in `4d5f646`. Both options were taken**,
> not one: `issue edit --label` / `--label-remove` (names, repeatable) AND
> `label attach|detach` accepting a name in the second position. No new HTTP
> surface — `edit` fans out to the existing sub-resource, and PATCH still
> rejects a `labels` field. `detach <issue> <name>` resolves against the
> issue's own labels, so a miss is an error naming what it does carry.

Not implemented; the plan says to stop and say so when an item is a decision.

The asymmetry is real and it is what generates this report. `bk issues issue
create --label urgent` exists and takes a **name**, creating unknown ones.
`bk issues label attach 189 58` takes two **ids** and needs a `label list` first.
So an agent that has just learned `create --label` guesses `edit --label`, gets
nothing, and concludes the feature is missing — which is verbatim what happened.

| | For | Against |
|---|---|---|
| **Add `edit --label` / `--label-remove`** | Symmetry with `create`; accepts names, so no id lookup; removes the whole class of report | Two spellings for one operation; `edit` gains three HTTP calls behind one verb |
| **Keep `label attach` as the only shape** (today) | One write path; matches the sub-resource the route models | The guess keeps failing; the guide is the only thing standing between a caller and the wrong conclusion |

**Recommendation: add it, as a CLI-only change** — `edit --label <name>` and
`--label-remove <name>`, implemented over the existing `POST`/`DELETE …/labels`
routes. No new HTTP surface, no new decision about `PATCH` semantics, and it
accepts names like `create` does. It is a product call about verb shape, so it is
here rather than in a commit.

A smaller version, if that is too much: let `bk issues label attach <issue> <label>`
accept a **name** in the second position. The route already handles `{"name": …}`
and creates unknown labels; only the CLI insists on `strconv.Atoi`.

### Should `PATCH` reject *every* unknown field? — **DEFERRED 2026-08-11**

> Decision: leave it narrow. Rejecting all unknown keys is breaking for any
> client sending extras, and nothing has been reported against the wider
> silence. Revisit when the apps' feature work starts.

Today it rejects exactly `labels` and `label_ids`. The same silence applies to
any typo'd field — `{"titel": "x"}` is a 200 that changes nothing. Rejecting all
unknown keys is the consistent answer and a **breaking** one for any client
sending extra fields. Not taken unilaterally.

---

## 4. What I could not reproduce, and what would settle it

**Item 5b — the Windows PowerShell execution policy. I could not test this at
all: I have no Windows machine, and nothing on macOS can stand in for it.** The
plan said not to guess a fix, and I have not. What landed is documentation only —
a **Windows** section in `bk guide platform/install-auth` naming
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, the `cmd.exe` / `bk.cmd`
route around it, and the `EBUSY`-on-retry symptom.

**That text is unverified.** It is assembled from the reporter's own transcript
plus the documented default policy for Windows clients, and neither the commands
nor the claim that they resolve it has been run.

What would settle it: one run on a fresh Windows box — `npm install -g
@blackcode_sa/bc-issues` in PowerShell with the default policy, then the two
documented workarounds, recording what each prints. The installer-side option the
plan floats (`install.js` detecting the block) should not be built until someone
has seen the failure: a detector for a condition nobody has observed is a guard
that has never been watched fail.

---

## 5. What in this plan was wrong

- **Item 1c was stated as likely-true; it is false.** The plan says "`bk issues
  issue view` does not show `labels`. Verify; if true it explains why the
  reporter could not tell whether anything had worked." The route has always
  returned `labels`, on `GET` and on `PATCH`. What was missing was one line of
  *table output* for the empty case. The explanation the plan reached for is
  right; the mechanism is not, and only the running system distinguishes them.

- **Item 4 offered two possibilities for `/agent-updater` — "find out whether it
  ever existed. If not, the fix is the message" — and the truth is a third.** It
  exists, spelled `agent-updator`. The fix is neither the app nor the message but
  a landing pad for the correct spelling.

- **Item 3 was already closed before the plan was read.** The plan says to check
  whether `hintFor()` "may already do some of this". It does all of it, at every
  depth, and names the real group as well — from `9d568c1`, the commit the plan
  cites for item 2 without noticing it also settled item 3.

- **The setup block is wrong in two details.** `docker compose up -d` fails with
  a name conflict if the container already exists (`docker start` is what works),
  and the host port is **5434**, not 5432 — 5432 is the container-internal port,
  which the plan does say, but the line reads as though 5432 is what you connect
  to.

- **Item 5's framing of `--token` as "the most fixable item" undersold it.** The
  fix is small, but the flag hides a security property nobody had written down,
  and chasing it turned up an exit-code defect affecting every future
  hand-written usage check in the binary.

### And four instrument failures of my own, because the rule cuts both ways

Each of these produced a confident wrong answer that I nearly kept:

1. **zsh does not word-split unquoted `$c`.** My first synonym check ran
   `/tmp/bk-tri $c` with `c="issues issue get"` and got `unknown command "issues
   issue get"` for **every** spelling — including `issues issue list --help`,
   which obviously works. Had the control been less obviously wrong I would have
   filed "synonyms do not resolve".
2. **The dev server was on 3001, not 3000.** Every route probe returned 404,
   including `/agent-updator`, which I had just found on disk. The "Port 3000 is
   in use" line was four lines up in a log I had grepped for the wrong words.
3. **My first PATCH-label test was inconclusive and looked conclusive.** I sent
   `{"label_ids":[99]}` at an issue that *already had label 99*, then reported
   the unchanged label list as proof nothing was applied. It proves nothing. Redone
   against an issue with `labels: []`.
4. **A mutation that never ran, read as a passing guard.** `cd apps/issues` failed
   because I was already in `apps/issues`; the `&&` chain died, the file was never
   mutated, and the test printed `3 passed`. I was one step from recording
   "watched it fail" about a mutation that did not exist — CLAUDE.md finding #8's
   shape, in the act of applying finding #8's rule.

All four are the same defect the standing rule describes: **the check was
correct, and the claim I was about to make from it was larger than the check.**
The one that worries me is (4), because its output is indistinguishable from
success.

---

## 6. Gate

Run from the repo root, all green:

```
npm run typecheck   11/11
npm test            issues 259 passed / 76 skipped, sales 93 passed / 8 skipped
npm run lint        0 errors (7 pre-existing warnings)
npm run build       3/3
cd cli && go build ./... && go vet ./... && go test ./...    all ok
cd cli && make routes                                        routes.json unchanged
```

No `routes` annotation changed, and `make routes` confirmed it by producing no
diff.

**Not deployed, not pushed.** The `docs/changelog/*.md` entries describe the
behaviour on `main`, not in production.
