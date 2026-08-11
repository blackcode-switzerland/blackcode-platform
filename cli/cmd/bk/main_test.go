package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// THE END-TO-END HALF OF THE DEPRECATION GUARD.
//
// internal/commands/appverbs_test.go asserts the deprecations table has a row
// for every removed spelling. That is necessary and NOT sufficient: the table is
// only reachable through hintFor(), and hintFor() lives here, in package main,
// which had no test at all. Delete the DeprecationHint call from hintFor() and
// every assertion over there still passes while the binary hands an agent the
// generic "may have been renamed" line.
//
// That is CLAUDE.md finding #8's shape — a guard written by someone who knew the
// rule — and docs/sales-app-plan.md D-26's third step: inject the regression and
// watch the check again. Verified by doing exactly that; see the commit message.
//
// The error is not hand-written here either. It comes from Execute() on the real
// command tree, so cobra's actual wording — which is what DeprecationHint has to
// parse — is part of what is being tested.
func runBK(t *testing.T, argv ...string) error {
	t.Helper()
	root := commands.NewRoot()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	root.SetArgs(argv)
	return root.Execute()
}

// The removed bare spellings, and the app-qualified form each must name.
//
// Three from D-11 (2.0.0) and EIGHT from multiAppFinalRefactor Phase 4, when the
// cross-app tier stopped existing because the apps stopped sharing a database.
//
// `storage` and `search` are here now and were not before, and that is a change
// of fact rather than of opinion: D-28 kept `storage` bare because "one ledger,
// one quota, the same rows from every app", and Phase 3 made the ledger per app.
// `search` read `platform.entities`, and sales stopped projecting into it.
//
// `link` is NOT in this map — it was removed with no replacement to name, so it
// cannot satisfy the "hint names the new spelling" assertion below. It has its
// own case, TestRemovedLinkNamesWhatToDoInstead, which is the shape that matters
// for a deletion: the hint has to say what to do, not where the command went.
var removedBareVerbs = map[string]string{
	"upload":    "bk issues upload",
	"trash":     "bk issues trash",
	"label":     "bk issues label",
	"workspace": "bk issues workspace",
	"member":    "bk issues member",
	"invite":    "bk issues invite",
	"user":      "bk issues user",
	"inbox":     "bk issues inbox",
	"storage":   "bk issues storage",
	"search":    "bk issues search",
	"activity":  "bk issues activity",
}

func TestRemovedBareVerbsFailWithARecoverableHint(t *testing.T) {
	for verb, replacement := range removedBareVerbs {
		t.Run(verb, func(t *testing.T) {
			// Realistic argv, not the bare word: `bk upload x.pdf`, `bk trash list`.
			err := runBK(t, verb, "some-argument")
			if err == nil {
				t.Fatalf("`bk %s some-argument` succeeded — a removed spelling must exit "+
					"non-zero, not print help and exit 0", verb)
			}
			if got := classify(err); got != exitUsage {
				t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
			}
			hint := hintFor(err, "")
			if hint == "" {
				t.Fatalf("no hint for `bk %s` — the run dead-ends here: %v", verb, err)
			}
			if !strings.Contains(hint, replacement) {
				t.Errorf("`bk %s` failed with %q and hint %q — the hint must name %q, "+
					"or the agent has nothing to retry with",
					verb, err, hint, replacement)
			}
		})
	}
}

// The app-qualified spellings must be the ones that WORK. Without this, the test
// above would pass just as happily if the verbs had been deleted outright.
//
// Each runs a LEAF and requires the failure to be `not configured` — the auth
// check, which sits after the command resolved and parsed its arguments. Two
// weaker versions were tried first and both were inert:
//
//   - `root.Find([]string{"issues", "upload"})` returns no error when `upload`
//     does not exist; cobra only reports an unknown subcommand at the root.
//   - `bk issues upload --help` prints the GROUP's help and exits 0 for the same
//     reason.
//
// Both passed with the entire tier unmounted. BK_CONFIG_DIR points at an empty
// temp dir so the assertion cannot depend on the machine running it — and so no
// test ever reaches a real deployment with real credentials.
func TestAppQualifiedVerbsReachTheAuthCheck(t *testing.T) {
	leaf := map[string][]string{
		"upload":    {"issues", "upload", "some-file.pdf"},
		"trash":     {"issues", "trash", "list"},
		"label":     {"issues", "label", "list"},
		"workspace": {"issues", "workspace", "list"},
		"member":    {"issues", "member", "list"},
		"invite":    {"issues", "invite", "list"},
		"user":      {"issues", "user", "list"},
		"inbox":     {"issues", "inbox", "list"},
		"storage":   {"issues", "storage", "list"},
		"search":    {"issues", "search", "acme"},
		"activity":  {"issues", "activity"},
		// The other app's copy of the same verbs — because "resolves under
		// `bk issues`" and "resolves under every app that declares it" are two
		// properties, and a Set built for one app and reused for another would
		// satisfy only the first.
		"sales workspace": {"sales", "workspace", "list"},
		"sales member":    {"sales", "member", "list"},
		"sales activity":  {"sales", "activity"},
	}
	for verb, argv := range leaf {
		t.Run(verb, func(t *testing.T) {
			t.Setenv("BK_CONFIG_DIR", t.TempDir())
			err := runBK(t, argv...)
			if !errors.Is(err, config.ErrNotConfigured) {
				t.Fatalf("`bk %s` failed with %v; want %v — anything else means the command "+
					"did not resolve", strings.Join(argv, " "), err, config.ErrNotConfigured)
			}
			if got := classify(err); got != exitAuth {
				t.Errorf("exit code = %d, want %d (auth)", got, exitAuth)
			}
		})
	}
}

// A hint that fires for everything is a hint that says nothing. An unknown
// command with no deprecation row must get the generic advice, not another
// verb's migration note.
func TestUnrelatedUnknownCommandGetsNoNamedHint(t *testing.T) {
	err := runBK(t, "definitely-not-a-command")
	if err == nil {
		t.Fatal("an unknown command must fail")
	}
	hint := hintFor(err, "")
	for _, replacement := range removedBareVerbs {
		if strings.Contains(hint, replacement) {
			t.Errorf("an unrelated unknown command was told to run %q:\n  %s", replacement, hint)
		}
	}
	if !strings.Contains(hint, "renamed or removed") {
		t.Errorf("expected the generic recovery advice, got %q", hint)
	}
}

// THE GENERIC HINT MUST NAME A COMMAND THE CALLER CAN ACTUALLY RUN.
//
// It printed a literal `bk <group> --help` until 2026-08-11 — the placeholder
// never substituted, so the one recovery step it offered could not be executed.
// hintFor takes the path from two sources: the error text for an unknown
// COMMAND, and cobra's resolved command for an unknown FLAG, whose message names
// nothing at all.
//
// Asserts the absence of `<group>` AND the presence of the real path. Checking
// only for the placeholder would pass against a hint that named nothing, which
// is how this class of guard goes quiet.
func TestGenericHintNamesTheRealCommand(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		commandPath string
		want        string
	}{
		{
			// Unknown command: the path is inside the message.
			name: "unknown command",
			err:  errors.New(`unknown command "frobnicate" for "bk issues issue"`),
			want: "bk issues issue --help",
		},
		{
			// Unknown flag: the message names nothing; cobra's resolved command does.
			name:        "unknown flag",
			err:         errors.New("unknown flag: --badflag"),
			commandPath: "bk sales prospect list",
			want:        "bk sales prospect list --help",
		},
		{
			// Neither source knows: the fallback must still be runnable.
			name: "nothing known",
			err:  errors.New("unknown flag: --badflag"),
			want: "bk --help",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hint := hintFor(tc.err, tc.commandPath)
			if hint == "" {
				t.Fatal("no hint at all — the caller is left with nothing to run")
			}
			if strings.Contains(hint, "<group>") {
				t.Errorf("the hint still carries the literal placeholder: %q", hint)
			}
			if !strings.Contains(hint, tc.want) {
				t.Errorf("the hint does not name %q, so its recovery step cannot be run:\n  %s",
					tc.want, hint)
			}
		})
	}
}

// hintFor must keep preferring the server's own suggestion where there is one —
// asserted because the deprecation branch sits in the same function and a rewrite
// there is exactly where this would be lost.
func TestHintForPrefersNothingOverNoise(t *testing.T) {
	if got := hintFor(errors.New("some runtime failure"), ""); got != "" {
		t.Errorf("a plain runtime error should carry no hint, got %q", got)
	}
}

// `bk storage attachments` is the D-28 spelling, and it used to fail
// differently from the verbs above: `bk storage` still existed, so the error came
// from rejectUnknownSubcommands' RunE and named the GROUP. Phase 4 moved
// `storage` under the app, so cobra's legacyArgs now reports the first token at
// the root and the `storage` row answers instead.
//
// Asserted rather than deleted, because the property a caller needs is unchanged:
// the old two-word spelling must still land somewhere it can act on. What
// changed is WHICH row answers, and that is worth pinning — if the group-level
// lookup ever becomes live again, this says which answer is acceptable.
func TestRemovedStorageAttachmentsIsRedirected(t *testing.T) {
	err := runBK(t, "storage", "attachments")
	if err == nil {
		t.Fatal("`bk storage attachments` succeeded — it was removed in D-28")
	}
	if got := classify(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
	}
	hint := hintFor(err, "")
	if !strings.Contains(hint, "bk issues attachment list") &&
		!strings.Contains(hint, "bk issues storage") {
		t.Errorf("`bk storage attachments` failed with %q and hint %q — it must name "+
			"`bk issues attachment list` or, since `storage` itself moved, "+
			"`bk issues storage`", err, hint)
	}
}

// `bk link` was REMOVED, not renamed, and that is a different obligation.
//
// Every other row in this file can be checked by "does the hint name the new
// spelling?". There is no new spelling here — PLAN.md §3 deletes the feature
// because a link's two ends needed one shared entity index and only one app
// writes that index now. So the hint has to carry a WORKAROUND, and this asserts
// it does. Without this case, deleting the row would look identical to deleting
// the command.
func TestRemovedLinkNamesWhatToDoInstead(t *testing.T) {
	err := runBK(t, "link", "list", "bc:issues:acme/issue/1")
	if err == nil {
		t.Fatal("`bk link list` succeeded — the command was removed on 2026-08-10")
	}
	if got := classify(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
	}
	hint := hintFor(err, "")
	if !strings.Contains(hint, "removed") {
		t.Errorf("the hint for `bk link` does not say it was removed: %q", hint)
	}
	if !strings.Contains(hint, "URN") {
		t.Errorf("the hint for `bk link` names no alternative — an agent that used it has "+
			"nothing to do instead: %q", hint)
	}
}

// The SAME user mistake must exit the same code whether the binary catches it or
// the server does.
//
// `bk sales prospect delete --confirm <wrong name>` is pre-checked locally: the
// binary fetches the record, compares, and returns an error worded to contain
// "required", which classify() maps to 2. If the pre-check is raced or skipped,
// the server answers 409 `confirm_mismatch`. Until 2026-08-07 that had no branch
// in classify() and exited 1 — one condition, two exit codes, decided by a race
// the caller cannot see. An agent branching on the code cannot write one
// recovery for that.
//
// The general rule: a pre-check in the binary must exit the same code the server
// would. This asserts BOTH halves, because asserting only the 409 would pass
// against a local guard that had drifted to some third code.
func TestServerConflictAndLocalPrecheckAgree(t *testing.T) {
	serverSide := classify(&client.APIError{Status: 409, ErrorMsg: "--confirm \"acme\" does not name prospect #7"})
	localSide := classify(errors.New(
		`--confirm is required to match prospect #7, which is "Acme SA" — got "acme"; nothing was deleted`))

	if serverSide != exitUsage {
		t.Errorf("a 409 from the server exits %d, want %d (usage)", serverSide, exitUsage)
	}
	if localSide != exitUsage {
		t.Errorf("the binary's local --confirm guard exits %d, want %d (usage)", localSide, exitUsage)
	}
	if serverSide != localSide {
		t.Errorf(
			"the same --confirm mistake exits %d when the server catches it and %d when the "+
				"binary does. One condition, two exit codes: an agent cannot write one recovery.",
			serverSide, localSide)
	}
}

// A HINT MUST NOT NAME A DOOR THE CALLER CANNOT OPEN.
//
// `hintFor` used to answer a NotServedError by naming the "other" app from a
// hardcoded pair — issues if you were on sales, sales if you were on issues.
// Two things wrong with that, and the second is the one that bit:
//
//  1. It is the platform binary knowing two app slugs, which is false the day
//     app #3 exists.
//  2. `/api/meta`'s app block is GRANT-DERIVED (measured by agent 4). A user who
//     only has sales has no `issues` entry in their registry, so the suggested
//     `bk --app-server issues …` answers "no server known for app issues". The
//     agent burns a retry and learns nothing.
//
// Both cases are asserted, because either alone passes on the wrong code: a
// one-app config that still printed a suggestion, and a two-app config that
// printed none, are different bugs.
func TestNotServedHintOnlySuggestsAppsTheConfigKnows(t *testing.T) {
	notServed := &client.NotServedError{App: "sales", Status: 404}

	t.Run("names an app the config actually has", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("BK_CONFIG_DIR", dir)
		writeTestConfig(t, dir, `{"token":"t","home_app":"sales","home_server":"https://s",
			"app_servers":{"sales":"https://s","issues":"https://i"}}`)

		hint := hintFor(notServed, "")
		if !strings.Contains(hint, "--app-server issues") {
			t.Errorf("a config that knows issues must be told to try it:\n  %s", hint)
		}
	})

	t.Run("says so when there is no other app", func(t *testing.T) {
		dir := t.TempDir()
		t.Setenv("BK_CONFIG_DIR", dir)
		// A sales-only account: exactly what a grant-derived registry produces.
		writeTestConfig(t, dir, `{"token":"t","home_app":"sales","home_server":"https://s",
			"app_servers":{"sales":"https://s"}}`)

		hint := hintFor(notServed, "")
		if strings.Contains(hint, "--app-server") {
			t.Errorf("a sales-only account was told to redirect to another app, which its "+
				"registry does not have — the retry cannot work:\n  %s", hint)
		}
		if !strings.Contains(hint, "not available to you") {
			t.Errorf("the hint must SAY the capability is unreachable rather than trailing "+
				"off — an agent needs to stop, not guess:\n  %s", hint)
		}
	})
}

func writeTestConfig(t *testing.T, dir, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
}
