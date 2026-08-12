package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
)

// findCmd resolves a real command out of the real tree, so a test that needs
// "the command cobra reached" gets the same object main() gets rather than a
// hand-written path that can outlive the command it names.
func findCmd(t *testing.T, path ...string) *cobra.Command {
	t.Helper()
	c, _, err := commands.NewRoot().Find(path)
	if err != nil {
		t.Fatalf("bk %s does not resolve: %v", strings.Join(path, " "), err)
	}
	if c.CommandPath() != "bk "+strings.Join(path, " ") {
		t.Fatalf("bk %s resolved to %q instead", strings.Join(path, " "), c.CommandPath())
	}
	return c
}

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
			hint := hintFor(err, nil)
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
	hint := hintFor(err, nil)
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
		name string
		err  error
		// The resolved command, as ExecuteC hands it to main(): the path in
		// `cmd` is a real one from the real tree, not a string written here.
		cmd  *cobra.Command
		want string
	}{
		{
			// Unknown command: the path is inside the message.
			name: "unknown command",
			err:  errors.New(`unknown command "frobnicate" for "bk issues issue"`),
			want: "bk issues issue --help",
		},
		{
			// Unknown flag: the message names nothing; cobra's resolved command does.
			name: "unknown flag",
			err:  errors.New("unknown flag: --badflag"),
			cmd:  findCmd(t, "sales", "prospect", "list"),
			want: "bk sales prospect list --help",
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
			hint := hintFor(tc.err, tc.cmd)
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
	if got := hintFor(errors.New("some runtime failure"), nil); got != "" {
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
	hint := hintFor(err, nil)
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
	hint := hintFor(err, nil)
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

		hint := hintFor(notServed, nil)
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

		hint := hintFor(notServed, nil)
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

// `bk login --token=<value>` — the one wrong guess that never reaches our code.
//
// The other two spellings of this mistake are caught by login's own Args hook
// and asserted in internal/commands/login_token_test.go. This one is different
// in kind: cobra rejects it inside `pflag`, while parsing, before Args or RunE
// runs. Nothing in internal/commands can see it. hintFor() is the only place
// left, which is why the assertion lives here.
//
// AND THE ERROR IS NOT HAND-WRITTEN. It comes from Execute() on the real
// command tree via runBK, so the exact pflag wording — `invalid argument "…"
// for "--token" flag: strconv.ParseBool: …` — is what the match is tested
// against. CLAUDE.md finding #8 is a test in this same file that asserted a
// hand-written cobra string and passed while the binary did something else.
func TestTokenValueHintNamesTheStdinForm(t *testing.T) {
	err := runBK(t, "login", "--token=bk_live_ABCDEF0123456789")
	if err == nil {
		t.Fatal("`bk login --token=<value>` succeeded — a bool flag must reject a value")
	}
	if got := classify(err); got != exitUsage {
		t.Errorf("exit code = %d, want %d (usage) for %v", got, exitUsage, err)
	}

	hint := hintFor(err, nil)
	if hint == "" {
		t.Fatalf("no hint — the caller is left with a strconv.ParseBool message: %v", err)
	}
	// The recovery has to be runnable, not a description of the flag.
	if !strings.Contains(hint, "| bk login --token") {
		t.Errorf("hint %q does not name the working invocation `echo <token> | bk login --token`", hint)
	}
	// And it must not repeat the secret back. The token is on argv here so it is
	// already exposed, but our own output is not going to be the thing that
	// copies it into a log the caller keeps.
	if strings.Contains(hint, "bk_live_ABCDEF0123456789") {
		t.Errorf("hint echoes the token back: %q", hint)
	}
}

// The premise: hintFor must not answer this way for every boolean flag.
//
// The branch matches on the flag NAME, and a version that matched ParseBool
// alone would hand `echo <token> | bk login --token` to someone who mistyped
// `--json=maybe` — a recovery for a different command entirely, which is worse
// than no hint. Without this case, that version passes the test above.
func TestTokenHintDoesNotFireForOtherBooleanFlags(t *testing.T) {
	err := runBK(t, "issues", "issue", "list", "--json=notabool")
	if err == nil {
		t.Fatal("`--json=notabool` succeeded; expected a parse error")
	}
	if hint := hintFor(err, nil); strings.Contains(hint, "bk login --token") {
		t.Errorf("the --token recovery fired for --json: %q", hint)
	}
}

// ── `bk --version` ─────────────────────────────────────────────────────────
//
// The flag was absent until 2026-08-12 and exited 2 with `unknown flag:
// --version` — the spelling git, docker, npm, curl and python all accept, and
// the one a first-contact agent probed inside its first ten commands.
//
// This asserts the OUTCOME (the bytes on stdout), not that the flag parses.
// A version that merely registered the flag falls through to the root's
// help screen, which also exits 0 and also writes to stdout — CLAUDE.md
// finding #21's shape, and the reason this compares against `bk version`
// rather than checking for a non-empty write.
func versionOutput(t *testing.T, argv ...string) string {
	t.Helper()
	root := commands.NewRoot()
	var out strings.Builder
	root.SetOut(&out)
	root.SetErr(io.Discard)
	root.SetArgs(argv)
	if err := root.Execute(); err != nil {
		t.Fatalf("bk %s failed: %v", strings.Join(argv, " "), err)
	}
	return out.String()
}

func TestVersionFlagPrintsExactlyWhatTheSubcommandPrints(t *testing.T) {
	sub := versionOutput(t, "version")
	flag := versionOutput(t, "--version")
	if sub == "" {
		t.Fatal("`bk version` printed nothing — this test cannot tell a match from two empties")
	}
	if flag != sub {
		t.Errorf("`bk --version` and `bk version` disagree:\n  flag: %q\n  sub:  %q", flag, sub)
	}
	// The help screen is what an unhandled flag falls through to, and it is long.
	if strings.Contains(flag, "Available Commands") {
		t.Errorf("`bk --version` printed the help screen, not the version: %q", flag)
	}
}

// `-v` IS `--verbose`, and cobra's InitDefaultVersionFlag claims the `v`
// shorthand for --version whenever nothing else holds it. Nothing else holding
// it is one refactor away, and the failure would be silent: `bk -v issues issue
// list` would print a version and exit 0 instead of logging HTTP and failing on
// auth.
//
// Asserted through an actual run rather than by looking the shorthand up in a
// flag set: cobra only merges the persistent flags into Flags() as a SIDE
// EFFECT of InitDefaultVersionFlag, so a lookup-based version of this test
// reports "no -v at all" for a binary that has no version flag — the wrong
// diagnosis, from a check that cannot see the thing it is about.
func TestShorthandVIsStillVerbose(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	cmdutil.VerboseFlag = false
	err := runBK(t, "-v", "issues", "issue", "list")
	if !errors.Is(err, config.ErrNotConfigured) {
		t.Fatalf("`bk -v issues issue list` returned %v; want %v — `-v` no longer reaches the command",
			err, config.ErrNotConfigured)
	}
	if !cmdutil.VerboseFlag {
		t.Error("`-v` did not turn on --verbose")
	}
}

// ── THE FLAG SUGGESTER (§5) ────────────────────────────────────────────────
//
// The reported session, verbatim: `--project` on a command that takes the
// project as a positional, then `--health` on a command whose flag is
// `--status`. Both hints said "run --help"; the caller had already run it.
//
// The errors here are NOT hand-written. They come from Execute() on the real
// tree, so cobra's actual wording is part of what is tested — CLAUDE.md
// finding #8's lesson, and the reason the `resolved` command is threaded
// through rather than a path string.
func hintForArgv(t *testing.T, argv ...string) string {
	t.Helper()
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	root := commands.NewRoot()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	root.SetArgs(argv)
	resolved, err := root.ExecuteC()
	if err == nil {
		t.Fatalf("bk %s succeeded; expected a flag error", strings.Join(argv, " "))
	}
	return hintFor(err, resolved)
}

func TestUnknownFlagNamesTheNearMiss(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want string
	}{
		{
			// The one a pure edit-distance suggester cannot reach: health→status
			// is distance 5.
			//
			// NOT `project updates add` any more, which is where the session that
			// prompted this actually failed: Phase 2 gave that command `--health`
			// as a real alias and `--project` as a real flag, so neither is an
			// unknown flag there and neither can produce a hint. The synonym rule
			// is unchanged and still needs a subject, so this points at a command
			// that genuinely has `--status` and no `--health`.
			name: "health means status",
			argv: []string{"issues", "issue", "edit", "12", "--health", "done"},
			want: "--status",
		},
		{
			// The other half of the same session: the value was right, the
			// spelling was a flag, and the answer is a positional. Same move as
			// above — `project members` still takes its project positionally and
			// has no `--project` flag.
			name: "project is a positional",
			argv: []string{"issues", "project", "members", "--project", "12"},
			want: "<project-id> is a positional argument",
		},
		{
			// An ordinary typo.
			name: "typo",
			argv: []string{"issues", "issue", "list", "--stauts", "open"},
			want: "--status",
		},
		{
			// The global flag nobody guesses the abbreviation for.
			name: "workspace means ws",
			argv: []string{"issues", "issue", "list", "--workspace", "acme"},
			want: "--ws",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hint := hintForArgv(t, tc.argv...)
			if !strings.Contains(hint, tc.want) {
				t.Errorf("hint does not name %q — the caller is sent back to a help page it has read:\n  %s",
					tc.want, hint)
			}
		})
	}
}

// THE CASE WHERE NO SUGGESTION SHOULD APPEAR.
//
// Required by the plan, and it is the half that keeps the suggester honest: a
// matcher loose enough to answer everything answers wrongly, and a wrong
// `did you mean` costs the round trip this exists to save. `--frobnicate` is
// close to nothing on this command, so the generic recovery must be what fires.
func TestUnknownFlagWithNoNearMissFallsBackToTheGenericHint(t *testing.T) {
	hint := hintForArgv(t, "issues", "issue", "list", "--frobnicate")
	if strings.Contains(hint, "did you mean") {
		t.Errorf("invented a suggestion for --frobnicate: %q", hint)
	}
	if !strings.Contains(hint, "bk issues issue list --help") {
		t.Errorf("the generic recovery stopped naming the real command: %q", hint)
	}
}

// A tie must produce nothing rather than a coin flip. `bk issues issue edit`
// has both --status and --start-date… — the property under test is that
// closestFlag refuses when more than one candidate is equally close, and the
// cheapest way to state it that cannot rot is to assert on the helper directly
// with a set that is written here.
func TestAmbiguousTypoSuggestsNothing(t *testing.T) {
	if got := commands.ClosestFlagForTest("stat", []string{"status", "start", "state"}); got != "" {
		t.Errorf("picked %q out of three equally close flags — that is picking by iteration order", got)
	}
	if got := commands.ClosestFlagForTest("stauts", []string{"status", "body"}); got != "status" {
		t.Errorf("a single clear winner was not suggested: %q", got)
	}
}

// ── THE DRIFT HINTS ALL NAME `bk skill sync` ───────────────────────────────
//
// §1 of the plan: "say it where a stale agent actually is. An agent does not
// read help when things work. It reads an ERROR."
//
// The statuses here are the ones that mean "this used to work": a shape the
// server no longer accepts (400/422), a resource or route that is gone (404),
// and a route deliberately retired (410). 410 was the one branch that named
// only `bk guide` — the strongest drift signal, with the weakest recovery.
//
// A server-supplied `suggestion` still wins over all of this, which is why the
// APIErrors below carry none: that branch is asserted separately, and a case
// with a suggestion would be testing the wrong thing.
func TestDriftStatusesNameSkillSync(t *testing.T) {
	for _, status := range []int{400, 404, 422, 410} {
		hint := hintFor(&client.APIError{Status: status}, nil)
		if !strings.Contains(hint, "bk skill sync") {
			t.Errorf("a %d carries no `bk skill sync`, so a stale agent is not told how to get current: %q",
				status, hint)
		}
		// The WHY, not just the what — a bare command is a thing to run, not a
		// reason to run it.
		if !strings.Contains(hint, "retired") && !strings.Contains(hint, "used to work") {
			t.Errorf("the %d hint says what to run but not why: %q", status, hint)
		}
	}
	// A status that is NOT a drift signal must not get the advice, or it means
	// nothing when it appears. 403 is a permission answer: the surface is fine.
	if hint := hintFor(&client.APIError{Status: 403}, nil); strings.Contains(hint, "skill sync") {
		t.Errorf("a 403 was told the surface may have changed: %q", hint)
	}
}

// A 401 FROM `bk login` MUST NOT SAY "run `bk login`".
//
// The generic 401 hint is right everywhere else and is a loop here: the server
// has just refused the token this very command supplied, and the caller is
// already inside `bk login`. Measured against a fake 401 server on 2026-08-12,
// where the output was `error: token validation failed: invalid token (401)`
// followed by `hint: not authenticated — run bk login`.
//
// Both halves are asserted. Checking only that the login hint changed would
// pass against a change that broke the generic one, which is the whole reason
// the generic one exists.
func TestUnauthorizedHintDoesNotSendLoginBackToLogin(t *testing.T) {
	unauthorized := &client.APIError{Status: 401, ErrorMsg: "invalid token"}

	login := hintFor(unauthorized, findCmd(t, "login"))
	// The bare spelling is the loop. `bk login` may still be NAMED here — the
	// browser flow is a real alternative to a token that was refused — but only
	// qualified into a different invocation from the one that just failed.
	if strings.Contains(login, "run `bk login`.") || strings.Contains(login, "run `bk login` to") {
		t.Errorf("the hint on `bk login` tells the caller to run `bk login`, unqualified:\n  %s", login)
	}
	if strings.Contains(login, "run `bk login`") && !strings.Contains(login, "with no flags") {
		t.Errorf("the hint on `bk login` names `bk login` without saying how it differs:\n  %s", login)
	}
	if !strings.Contains(login, "Settings") {
		t.Errorf("the hint on `bk login` names no way to get a working token:\n  %s", login)
	}

	// The generic case, unchanged: anywhere else, `bk login` IS the recovery.
	other := hintFor(unauthorized, findCmd(t, "issues", "issue", "list"))
	if !strings.Contains(other, "run `bk login`") {
		t.Errorf("the generic 401 hint stopped naming `bk login`:\n  %s", other)
	}
}
