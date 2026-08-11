# Report 1 — does the CLI teach its own architecture?

Answering `Todo/plan-1-cli-architecture-verification.md`. Written 2026-08-11.

**Method: a built binary, driven.** `cd cli && go build -o /tmp/bk-arch ./cmd/bk`,
`BK_CONFIG_DIR=/tmp/bk-arch-cfg` throughout. Nothing below was concluded from
reading source; source was opened only to find the file:line of something the
binary had already shown.

**Verdict: the binary teaches its architecture well, and the gap is not where
the plan expected it.** The tier rule is stated in five places that agree. What
had rotted was a narrower and more dangerous thing: three copies of a claim
about ACCESS that the platform stopped making on 2026-08-10, sitting in the two
guide topics and the skill file an agent reads before it does anything.

Two commits: `fb759b2` (nine stale strings), `e12628e` (one behaviour fix).

---

## 0. The instrument, first

I built a command inventory by walking `--help` recursively in Python: **44
groups, 206 leaves.** `docs/cli-inventory.md` independently says 206. Every
claim below about "the help omits X" is a diff against that walk.

Two instrument failures worth recording, because both would have produced a
confident wrong answer:

- **`bk __routes` is not a command inventory.** It dedupes, so
  `bk <app> workspace list` — which annotates `GET /api/workspaces` — vanishes
  behind `bk <app> workspace use`, which claims the same route plus one more.
  Finding #5's mechanism, surviving in a narrower form (same app, same route,
  two commands). I switched to the help walk. See §4 for the consequence.
- **I nearly filed "`bk issue list` has no deprecation hint" as the headline
  finding.** It has one. I was reading `head -2` of the output, and cobra's
  "Did you mean this? / issues" block pushed the `hint:` line to position 4.
  The check was correct; the claim I was about to make from it was larger than
  the check — the exact defect CLAUDE.md's table describes on the human side of
  the keyboard. Re-run with `grep '^hint:'`, all 30 spellings pass.

---

## 1. The three journeys

### 1a. Brand new — **passes**

`bk` with no config gets you there. The first screen leads with "one login, one
token, and one command group per app", gives a five-line first run, then lays
out both tiers WITH the reasoning ("no app can be the wrong one to ask"), then
the apps, then a dated breaking-change note. `bk guide platform/overview` is
current and repeats the split in more depth. Unauthenticated bare verbs fail
cleanly: `error: not configured: run bk login first` + `hint: … New here? run
bk guide`.

**Where I would have gone wrong: `bk meta`, on the first read after login.** You
see `apps.sales.workspaces: []` and conclude you have no sales access. You do
not: `workspaces` is populated only for the app that answered, and `[]` for any
other app means *not known here*. This is the one misreading that silently
sends you to the wrong app, and **the guide told you to make it** — see §2.

Second, smaller: `bk login`'s default server is `https://bc-issues.vercel.app`,
not `issues.blackcode.ch`. Reported, not fixed (§3).

### 1b. Returning, taught the OLD shape — **passes, strongly**

Tested against the binary, not by reading `deprecations.go`. **30 old spellings
and flags; all exit 2; 29 carry a SPECIFIC hint naming the replacement**, the
30th (`bk attachment`) being a spelling that never existed bare.

Every 2.1.0 verb (`workspace`, `member`, `invite`, `user`, `inbox`, `storage`,
`search`, `activity`), every 1.10.0 noun (`issue`, `task`, `project`, `move`,
`copy`, `analytics`), the removals (`link`, `undo`), the renamed scaffold
(`template`), the parent-scoped family (`app enable|disable|access|
default-access`), and all three flags (`--app`, `--all`, `--reference`).

The hints are good in the way that matters: each names a CONCRETE next command,
not "use the app name". `bk sales inbox list` — a tier mistake in the other
direction — answers with the sales-specific reason ("`apps/sales` has none")
and the working line.

### 1c. An agent that skips `--help` — **this was the real gap; now fixed**

The two apps do not share a verb vocabulary. issues says `view` / `create` /
`delete`; sales says `show` / `add` / `rm`. An agent that learned one guesses
wrong in the other, which is feedback item 2 exactly (`issue get`, `issue show`
tried before `issue view`).

Nothing helped it. `rejectUnknownSubcommands` builds the error itself, so
cobra's "Did you mean…" never runs below the root — and would not have helped
if it did, since these are synonyms, not typos (Levenshtein view→show = 4).
What you got was the generic hint, which costs a second round trip and prints a
literal `bk <group> --help` with `<group>` not substituted.

Fixed in `e12628e`:

```
error: unknown command "view" for "bk sales prospect" (have: assign, create,
delete, edit, list, next, show, stage)
```

Guarded by five real synonym misses in `groups_test.go`, each watched go red
with the change reverted. All 18 deprecation hints re-verified afterwards,
because the appended text lands inside the string `DeprecationHint`'s regex
parses and the parent-scoped keys depend on that shape.

---

## 2. Stale and one-app-assuming strings

### Fixed (`fb759b2`)

**The access claim — three copies, one wrong architecture.** The per-app gate
(`platform.workspace_apps`, `platform.app_access`) was dropped 2026-08-10, and
`packages/platform-api/src/meta.ts:130-176` has carried a long comment ever
since explaining that `apps` is the ADDRESS BOOK, not a grant list, and that an
empty `workspaces` for another app means "not known here". These said the
opposite:

| file:line | was |
|---|---|
| `cli/internal/guide/topics/platform/00-overview.md:33` | "`bk meta` tells you which apps you can actually reach; you will not be shown one you have no access to" |
| `cli/internal/guide/topics/platform/11-cross-app.md:110` | "An app you have no access to is not in your registry at all" |
| `cli/internal/skill/template.md:13,16` | "every workspace you can write to" / "which apps exist and **which you can reach**" |

`bk app --help` already said it correctly — "Being listed here means the app
EXISTS… It does not mean you have a workspace in it" — which is the only reason
the contradiction was visible. The three now agree with it, and `bk meta`'s own
`Long` (which never mentioned the `apps` block at all) now states both rules.

**The rest**, all hand-written summaries drifted from the generated tree:

| file:line | was | now |
|---|---|---|
| `commands/platform/login.go:31` | "Authenticate against a **blackcode-issues** server" | "any Blackcode app's server", + a paragraph that one login covers every app and grants nothing |
| `appverbs/search.go:46-47` | "Search the **shared** entity index" (Short + Long) | "this app's entity index", + "There is no cross-app search" |
| `commands/issues/issues.go:38` | "the same **three** under every app" — then lists **eleven** | "the same verbs every app has… another app's list is a subset, not a copy" |
| `commands/sales/sales.go:56` | same phrase | same fix, phrased as the subset |
| `issues.go:44`, `sales.go:78` | invite: "send, list, accept, decline, revoke, pending, candidates" — **no `show`** | split by who uses each, `show` restored |
| `commands/root.go:94` | tier-2 list omits `user`, `inbox`, `storage` | all three added |
| `commands/root.go:78` | "skill install / check / sync" | + `path`, `uninstall` |
| `issues.go:29-32` | `issue` omitted attachments/unassign/unwatch; `project` omitted issues/tasks/add-member/remove-member | complete |

`docs/cli-inventory.md` regenerated (206 in, 206 out) rather than hand-edited;
three description cells changed, nothing else.

**Every verb I wrote was resolved against a rebuilt binary — 23, all OK.**

### The lesson the invite rows carry

`e7638f4` fixed the top-level invite list *yesterday*, one day after `show` was
added. **The same omission was sitting in two more places**, and its commit
message had already named the mechanism. The plan predicted this ("assume there
are more of that shape"); it was right, and the count is now seventeen.

It also shows that commit's verification was half a check: resolving every verb
a summary NAMES catches a summary naming something gone, never a summary
MISSING something real. That second half is what found `user`/`inbox`/`storage`
absent from `bk --help` while the paragraph directly below it named all three.
Both directions need the generated tree.

---

## 3. What a new user still cannot work out from the binary alone

Report-only; each needs a decision, a new command, or a behaviour change.

1. **The verb vocabulary split is nowhere explained.** `view` vs `show`,
   `delete` vs `rm`, `create` vs `add` across the two apps is now *recoverable*
   at the point of error, but no guide topic says it is deliberate or which app
   uses which. If it is not deliberate, the cheaper fix is aliases; that is a
   product decision.
2. **`bk guide --list` orders `platform/apps` LAST of the thirteen platform
   topics** — after `pitfalls`, `encoding` and a tombstone topic
   (`platform/cross-app`, whose summary is "There is no cross-app tier any
   more"). It is the topic `bk --help`, `bk issues --help`, `bk sales --help`
   and four deprecation hints all point at as *the* rule. A newcomer scanning
   the list top-down meets it thirteenth. Renumbering the file is trivial; the
   ordering is presumably someone's call.
3. **`bk login` defaults to `https://bc-issues.vercel.app`**
   (`commands/platform/login.go:39`) while production is `issues.blackcode.ch`.
   A behaviour change, deliberately not touched.
4. **`bk __routes` dedupes two commands claiming one route**, so
   `bk <app> workspace list` shows `—` in the "Routes it claims" column of
   `docs/cli-inventory.md` for all three apps, though it does annotate
   `GET /api/workspaces`. Parity is not affected (the route is still claimed by
   someone, so coverage holds), which is why this has survived. Fixing it means
   touching what `lib/cli-parity.test.ts` consumes — worth doing carefully, not
   as a drive-by.
5. **`bk sales inbox list`'s hint is phrased for a spelling the caller did not
   type**: "`bk inbox …` is now `bk issues inbox …`". It names the right fix and
   the right reason, so it works; it is just off-key for the app-prefixed form.

---

## 4. What I could not test without credentials

Everything requiring a live server. Specifically:

- **`bk meta`'s actual output** — the whole of §1a's "where you would guess
  wrong" rests on `meta.ts` and the guide, not on a response I saw. The fix is
  to the DESCRIPTION of that output; someone with a login should read one real
  `bk meta --json` against both apps and confirm the `apps` block reads as the
  corrected text now says.
- **`bk app list`'s columns**, incl. whether REACHABLE distinguishes "server
  down" from "no access" in practice.
- `bk whoami`, `bk token`, `bk profile`, and every app verb.
- The `routing` block that `guide platform/apps:110` says `bk meta` carries — I
  could not confirm it exists.
- `bk login`'s browser flow, and whether it learns the address book as its Long
  now claims (the claim is from `12-apps.md` and `meta.ts`, not observed).

`bk changelog` DOES run unauthenticated — but it is an HTTP call to
`bc-issues.vercel.app`, so **it renders production's changelog, not the repo's.**
My new entry is invisible to it until a web deploy. I verified the entry parses
by running `changelog.ts`'s own section rules over the file: 45 sections, mine
dated and first.

---

## 5. What in the plan was wrong

1. **"`BK_CONFIG_DIR` always. The default config points at production" is not
   sufficient isolation.** `BK_CONFIG_DIR` does not sandbox `bk skill install`,
   which writes to `~/.claude/skills/blackcode/SKILL.md` — **I overwrote the
   user's installed skill file** while checking whether the template teaches the
   tiers (plan §2b). The content written is byte-identical to what a released
   `bk` v2.2.0 writes, since I installed from an unmodified build, so nothing is
   broken. **But the template has since been corrected, so run `bk skill sync`
   after the next CLI release to pick it up.** A future plan should say: read
   `cli/internal/skill/template.md`, or install into a throwaway `HOME`.
2. **§1's "already verified — do not redo" was half-verified.** "Every verb the
   top-level summary names resolves against a built binary" was true and is not
   the check that mattered; the omissions were in the other direction. Stated
   above.
3. **§2's "do not read the source and conclude" needs a companion rule: do not
   read your own instrument's output through a truncating filter.** `head -2`
   cost me a false headline finding (§0).
4. **§2b's "does anything still describe three tiers?"** — nothing user-facing
   does. The three-tier language survives only in `appverbs/appverbs.go:8` and
   `config/config.go:46`, both comments, both correctly framed as D-11 history
   explaining why the tier is gone. Leave them.
5. **§3's split ("fix if small; report if it changes behaviour") does not
   classify the journey-1c fix.** Appending `(have: …)` to an error is small and
   verifiable, but it does change output an agent may parse. I committed it
   separately (`e12628e`) so it can be reverted alone.
6. The plan's expectation that drift would be concentrated in *tier* wording was
   wrong. Tier wording is in good shape and repeated consistently in five
   places. The rot was in **access** wording, one layer down, where no guardrail
   looks and where `guide_test.go` cannot help — it bans hardcoded *dynamic
   values*, and "you will not be shown an app you have no access to" is a
   hardcoded *architectural claim*. There is no check for that class, and this
   is the second time in a week one has been found by hand.

---

## 6. Gate

Run from the repo root, after the final commit:

```
npm run typecheck                             11/11 ok
npx turbo test --force                        5/5 ok (418 passed, 84 skipped)
npm run lint                                  11/11 ok (9 warnings, pre-existing)
cd cli && go build ./... && go vet ./...      ok
cd cli && go test ./...                       ok
```

`make routes` run (regenerating `docs/cli-inventory.md` needs it), though no
`routes` annotation changed.

**Two guards broken and watched fail before being trusted**, per the standing
rule, both on files this work edited: `skill_test.go`'s 40-line cap (padded the
template → red at 48 lines) and `guide_test.go`'s dynamic-value ban (added
"100 MB" and a status vocabulary to `00-overview.md` → red on both). Restored,
green. The new `groups_test.go` case was watched red on all five subtests with
the behaviour reverted.
