package commands

import (
	"regexp"
	"strings"
)

// Renamed or removed flags and commands, keyed by the OLD spelling.
//
// When a cobra usage error mentions one of these keys, main.go appends the
// value to the `hint:` line on stderr. That turns a dead run into a recovered
// one: the agent is told the new spelling and can retry immediately, instead of
// giving up on "unknown flag".
//
// THE RULE: add an entry here in the SAME commit as any rename or removal.
// Keep entries for two minor releases, then prune — a hint for a rename nobody
// remembers is just noise.
//
// Flag keys are written bare ("--assignee") so they match whatever command the
// user typed them on. Command keys are written as the path ("issue milestone").
var deprecations = map[string]string{
	// --- 1.9.0 (2026-08-03): the CLI became the only supported interface ---
	// Nothing was renamed in the CLI itself. `bk changelog --reference` lost its
	// backing document: the pinned Platform Reference is now the embedded guide.
	"--reference": "`bk changelog --reference` was retired on 2026-08-03 — the platform reference is now the embedded guide. Run `bk guide`.",

	// --- 1.10.0 (2026-08-04): app nouns moved behind the app name ---
	//
	// These six still RUN in 1.10.x and 1.11.x — aliases.go registers each old
	// spelling as a working, hidden copy that prints one deprecation line. The
	// rows below are what happens when those aliases are pruned in 1.12.0: cobra
	// answers `bk issue create` with `unknown command "issue" for "bk"`, and
	// hintFor() turns that into the new spelling instead of a dead end.
	//
	// PRUNE THESE IN THE SAME COMMIT AS THE ALIASES — one release after the
	// aliases go, not with them. A hint outlives the thing it replaces on
	// purpose; that gap is the only thing a stale script has left to read.
	"issue":     "`bk issue …` is now `bk issues issue …` — app verbs sit behind their app name. Same flags, same output.",
	"task":      "`bk task …` is now `bk issues task …` — app verbs sit behind their app name. Same flags, same output.",
	"project":   "`bk project …` is now `bk issues project …` — app verbs sit behind their app name. Same flags, same output.",
	"move":      "`bk move …` is now `bk issues move …` — app verbs sit behind their app name. Same flags, same output.",
	"copy":      "`bk copy …` is now `bk issues copy …` — app verbs sit behind their app name. Same flags, same output.",
	"analytics": "`bk analytics …` is now `bk issues analytics …` — it reports this app's statuses and priorities, so it moved with the app. Same flags, same output.",

	// --- 3.0.0 (2026-08-06): the four app-owned verbs moved under the app ---
	//
	// D-11. `upload`, `trash` and `label` are the verbs whose ANSWER DEPENDS ON
	// THE APP: a file is attributed to the app that received it, a bin holds one
	// app's entities, a label is filtered by app. With one deployment a
	// bare spelling was correct; with two it has no correct answer, only a
	// default — and a default is how a sales contract gets filed under issues.
	//
	// Unlike the 1.10.0 rename, these rows are LIVE from day one: there is no
	// alias, because an alias would have to pick an app silently, which is the
	// exact accident being removed. The failure is loud and names its replacement.
	// Keep for two minor releases (through 3.2.0), then prune.
	"upload": "`bk upload …` is now `bk <app> upload …` — a file is stored against one app, so the app names itself: `bk issues upload contract.pdf`. Run `bk --help` for the apps this binary knows, or `bk guide platform/apps` for why.",
	"trash":  "`bk trash …` is now `bk <app> trash …` — each app has its own recycle bin, e.g. `bk issues trash list`. Run `bk guide platform/apps`.",
	"label":  "`bk label …` is now `bk <app> label …` — labels are filtered by app, e.g. `bk issues label list`. Run `bk guide platform/apps`.",

	// --- 3.1.0 (2026-08-07): the scaffold's slug is `scaffold`, not `template` ---
	//
	// D-38. Nothing a user deployed is affected — the scaffold app is never
	// deployed — but `bk template …` was in the advertised surface, in `bk --help`
	// and in `bk __routes`, so a script or an agent on stale context can have it.
	//
	// It was renamed because `template` is not a word this platform can spend on
	// an app: `sales` has a `template` ENTITY (`bk sales template list`, URN
	// `bc:sales:{ws}/template/{n}`), Go code has locals called `template`, and
	// guards that match text cannot tell the three apart. Four of them mis-fired
	// on the collision, the last one found on the day of the rename — a routing
	// test that kept passing because cobra's "unknown command \"template\"" also
	// contains the word it was asserting on.
	"template": "`bk template …` is now `bk scaffold …` — the scaffold app's slug was renamed on 2026-08-07 (D-38) because `template` collides with `bk sales template`. Same commands, same output: `bk scaffold note list`.",

	// `bk storage attachments` moved to a noun of the issues app in 3.0.0 — one
	// noun must not straddle two tiers. `bk storage` itself has since moved too
	// (see 4.0.0 below), so cobra now reports the FIRST token and the `storage`
	// row answers. This entry stays until the 3.0.0 batch is pruned: it names a
	// different replacement from the group's row, and a caller who typed the
	// two-word form is better served by the specific one if cobra ever reports
	// it again.
	"storage attachments": "`bk storage attachments` is now `bk issues attachment list` — it lists issue attachments and only ever did, so it is a noun of that app.",

	// --- 4.0.0 (2026-08-10): the cross-app tier is gone; the apps are separate ---
	//
	// multiAppFinalRefactor Phase 4. Every verb below read a `platform.*` table
	// that two apps shared, which is what made a bare spelling defensible:
	// `bk workspace list` had one workspace table to read, `bk search` had one
	// entity index, `bk storage` had one upload ledger.
	//
	// Phases 2 and 3 ended that. `apps/sales` has its own workspaces, members,
	// invitations, labels, uploads ledger and event spine, and stopped projecting
	// into the shared index altogether. A bare spelling now has no correct answer
	// — only a DEFAULT, taken from whichever app the config was last homed on,
	// with nothing in the command saying which. That is how `bk trash purge`
	// destroyed things in an app the caller never named.
	//
	// TEN VERBS AT ONCE, which is the largest batch this repo has taken, and the
	// rows are what make the difference between an agent that retries correctly
	// and one that stops. Live from day one with no alias, for 3.0.0's reason: an
	// alias would have to pick an app silently, which is the accident being
	// removed. Keep for two minor releases (through 4.2.0), then prune.
	//
	// Each hint names `bk <app> <verb>` AND a concrete example, because "use the
	// app name" is not something an agent can execute. `bk --help` lists the apps
	// this binary knows.
	"workspace": "`bk workspace …` is now `bk <app> workspace …` — each app has its own workspaces since 2026-08-10, and each remembers its own active one. Try `bk issues workspace list` or `bk sales workspace list`. Run `bk guide platform/apps`.",
	"member":    "`bk member …` is now `bk <app> member …` — membership is per app now, so the same person can be in one app's workspace and not another's. Try `bk issues member list` or `bk sales member list`.",
	"invite":    "`bk invite …` is now `bk <app> invite …` — an invitation grants access to ONE app's workspace. Try `bk issues invite list` or `bk sales invite send <email>`. `bk <app> invite accept <token>` still redeems one.",
	"user":      "`bk user …` is now `bk issues user …` — it lists the people you share a workspace with, which is an answer only that app's membership table can give. `bk sales member list` is the sales equivalent.",
	"inbox":     "`bk inbox …` is now `bk issues inbox …` — notifications belong to the app that raised them, and `apps/sales` has none. Try `bk issues inbox list`.",
	"storage":   "`bk storage …` is now `bk <app> storage …` — the upload LEDGER became per app on 2026-08-10, so two deployments no longer return the same rows (the Blob store and the workspace quota are still shared). Try `bk issues storage list`.",
	"search":    "`bk search …` is now `bk <app> search …` — there is no cross-app index any more. Try `bk issues search <query>` for issues, tasks and projects, or `bk sales search <query>`, which searches INSIDE sales' records.",
	"activity":  "`bk activity …` is now `bk <app> activity …` — each app keeps its own event feed. Try `bk issues activity --since 24h` or `bk sales activity`.",

	// `bk link` is REMOVED, not moved, and this row is the only thing an agent
	// on stale context has left. PLAN.md §3: a link's two ends could live in two
	// apps, which needed one shared entity index; that index is now written by
	// one app, so the feature has no honest implementation. Say what to do
	// instead, because there is no new spelling to name.
	"link": "`bk link` was removed on 2026-08-10 — it recorded a relation between two apps' entities in a shared index, and the apps no longer share one. Put the other end's URN (`bc:sales:<ws>/prospect/12`) in the description or a comment instead; `bk <app> search` finds a URN.",

	// --- 1.12.0 (2026-08-05): `bk undo` removed ---
	//
	// It never worked. `platform.transaction_log` had no writer, so the table was
	// empty in production and `undo` reported "0 operations" every time it was
	// run. A documented agent-facing command that does nothing is worse than a
	// missing one: an agent that believes it can undo takes risks it would not
	// otherwise take. Trash is the working undo and always was.
	"undo": "`bk undo` was removed in 1.12.0 — it never recorded anything and could not undo. Deletes are restorable: use `bk issues trash list` then `bk issues trash restore <type>:<#number>` (the recycle bin is per-app since 3.0.0).",
}

// flagRe pulls the offending token out of a cobra usage error, e.g.
// `unknown flag: --assignee` or `unknown command "milestone" for "bk issue"`.
var flagRe = regexp.MustCompile(`unknown (?:flag|shorthand flag): (-{1,2}[A-Za-z0-9-]+)`)
var cmdRe = regexp.MustCompile(`unknown command "([^"]+)" for "([^"]+)"`)

// DeprecationHint returns the migration note for the flag or command named in a
// usage error, or "" when there is no entry. Matching is exact on the flag
// spelling and, for commands, on both `<parent> <cmd>` and the bare `<cmd>`.
func DeprecationHint(errMsg string) string {
	if m := flagRe.FindStringSubmatch(errMsg); m != nil {
		if note, ok := deprecations[m[1]]; ok {
			return note
		}
	}
	if m := cmdRe.FindStringSubmatch(errMsg); m != nil {
		sub, parent := m[1], m[2]
		// parent is the full invocation path, e.g. `bk issue`. Drop the binary
		// name so the key reads `issue milestone`.
		parent = strings.TrimSpace(strings.TrimPrefix(parent, "bk"))
		if parent != "" {
			if note, ok := deprecations[parent+" "+sub]; ok {
				return note
			}
		}
		if note, ok := deprecations[sub]; ok {
			return note
		}
		// `sub` may be cobra's whole remaining argv rather than one word — e.g.
		// `unknown command "issue list" for "bk"` — in which case the lookup
		// above misses `issue` and the spelling falls through to the generic
		// hint. That is how `bk issue …`, `bk task …` and `bk project …` came to
		// get the useless hint while `bk move`, `bk copy` and `bk analytics`
		// matched; found by running the built binary, against a test that was
		// asserting a hand-written single-word string instead.
		//
		// MEASURED AGAIN 2026-08-06 on cobra v1.10.2, because the 1.13 verb move
		// depends on this path: the root now reports the FIRST token only
		// (`unknown command "upload" for "bk"`, from legacyArgs), and a group
		// reports the first token too (`… for "bk issues"`, from
		// rejectUnknownSubcommands' RunE). So today the branch below is
		// belt-and-braces, not the live path. It stays: it costs one map lookup,
		// the wording is cobra's to change, and cmd/bk/main_test.go now runs the
		// real tree so the live shape is measured on every build rather than
		// assumed here.
		if first, _, found := strings.Cut(sub, " "); found {
			if note, ok := deprecations[first]; ok {
				return note
			}
		}
	}
	return ""
}
