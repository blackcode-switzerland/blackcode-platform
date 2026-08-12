package issues

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/spf13/cobra"
)

// A BARE INTEGER IS AN ID AND MUST NOT COST A REQUEST.
//
// This is the rule `label attach` already uses, and the property that matters
// most about it is not "12 resolves to 12" — it is that resolving 12 never
// touches the network. Every existing script passes an id, and turning each of
// those into a `GET /projects` would be a silent tax on the common path.
//
// The nil client is the instrument: any call would panic, so a green run is
// evidence no call was made. (An assertion that the result is 12 would pass
// against an implementation that fetched the list first.)
func TestProjectRefIntegerCostsNoRequest(t *testing.T) {
	for _, in := range []string{"12", "0", "  7  "} {
		got, err := resolveProjectRef(nil, in)
		if err != nil {
			t.Fatalf("resolveProjectRef(nil, %q) errored: %v — a bare integer reached the network", in, err)
		}
		want := map[string]int{"12": 12, "0": 0, "  7  ": 7}[in]
		if got != want {
			t.Errorf("resolveProjectRef(%q) = %d, want %d", in, got, want)
		}
	}
	// Empty is "not given" and must also be free: it is the default of every
	// --project filter flag, so it runs on every unfiltered `issue list`.
	if got, err := resolveProjectRef(nil, ""); err != nil || got != 0 {
		t.Errorf("resolveProjectRef(nil, \"\") = (%d, %v), want (0, nil)", got, err)
	}
}

// The name/id split, pinned. A project literally named "12" cannot be reached
// by name; that ambiguity is deliberate and is stated in the flag's help.
func TestProjectRefTreatsLeadingDigitsAsANameNotAnID(t *testing.T) {
	// "12-relaunch" is not an integer, so it is a name — it must NOT be read as
	// project 12. strconv.Atoi refuses it, which is the behaviour being pinned;
	// with a nil client the name path panics, so this asserts the classification
	// without a server.
	defer func() {
		if recover() == nil {
			t.Fatal("resolveProjectRef(nil, \"12-relaunch\") returned without touching the " +
				"client — leading digits were parsed as an id, so `--project 12-relaunch` " +
				"would silently act on project 12")
		}
	}()
	_, _ = resolveProjectRef(nil, "12-relaunch")
}

// ── the alias rule ─────────────────────────────────────────────────────────

func TestMergeAliasPrefersWhicheverWasGiven(t *testing.T) {
	cases := []struct {
		name              string
		argv              []string
		wantValue         string
		wantErrSubstrings []string
	}{
		{name: "neither", argv: nil, wantValue: ""},
		{name: "canonical only", argv: []string{"--description", "hello"}, wantValue: "hello"},
		{name: "alias only", argv: []string{"--body", "hello"}, wantValue: "hello"},
		{name: "both, agreeing", argv: []string{"--description", "hi", "--body", "hi"}, wantValue: "hi"},
		{
			// NOT a silent preference. An agent that built one of them from a
			// variable has to be able to see WHICH one it got wrong, so both
			// values are in the message.
			name:              "both, disagreeing",
			argv:              []string{"--description", "one", "--body", "two"},
			wantErrSubstrings: []string{"--description", "--body", `"one"`, `"two"`, "nothing was changed"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var canonical, alias string
			cmd := &cobra.Command{Use: "x"}
			cmd.Flags().StringVar(&canonical, "description", "", "")
			cmd.Flags().StringVar(&alias, "body", "", "")
			if err := cmd.Flags().Parse(tc.argv); err != nil {
				t.Fatalf("parse: %v", err)
			}
			got, err := mergeAlias(cmd, "description", canonical, "body", alias)
			if len(tc.wantErrSubstrings) > 0 {
				if err == nil {
					t.Fatalf("mergeAlias returned %q with no error — one of two different "+
						"values was silently preferred", got)
				}
				for _, want := range tc.wantErrSubstrings {
					if !strings.Contains(err.Error(), want) {
						t.Errorf("error does not contain %q: %s", want, err)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("mergeAlias errored: %v", err)
			}
			if got != tc.wantValue {
				t.Errorf("mergeAlias = %q, want %q", got, tc.wantValue)
			}
		})
	}
}

// `--body` and `--health` are the two aliases this phase added. Both must exist
// AND both must be absent from the canonical spelling's place in `Use` — i.e.
// nothing was renamed.
func TestTheAliasesExistAndNothingWasRenamed(t *testing.T) {
	root := newIssuesGroupForTest(t)
	for _, tc := range []struct{ path, canonical, alias string }{
		{"issue create", "description", "body"},
		{"task create", "description", "body"},
		{"project updates add", "status", "health"},
	} {
		lookupFlag(t, root, tc.path, tc.canonical) // fails the test if it vanished
		lookupFlag(t, root, tc.path, tc.alias)
	}
}

// ── the confirmation line ──────────────────────────────────────────────────

// `updated #59 (status=done priority=P1)` never said WHICH issue. The report
// that raised it lost track of ids across nineteen issues.
func TestIssueLabelNamesTheRecord(t *testing.T) {
	iss := &client.Issue{ID: 59, Title: "Fix the login race"}
	got := issueLabel(iss)
	if !strings.Contains(got, "#59") || !strings.Contains(got, "Fix the login race") {
		t.Errorf("issueLabel = %q — a confirmation identified only by number is what this "+
			"exists to end", got)
	}
	// A titleless issue must not render as `#59 ""`.
	if got := issueLabel(&client.Issue{ID: 59, Title: "   "}); got != "#59" {
		t.Errorf("issueLabel with a blank title = %q, want %q", got, "#59")
	}
}
