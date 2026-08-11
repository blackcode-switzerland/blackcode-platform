package issues

import (
	"strings"
	"testing"
)

// `label attach|detach <issue> <label>` take a NAME or an id in the second
// position, and `issue edit` grew --label/--label-remove. Both landed on
// 2026-08-11 to close Todo/issues-app-feedback.md item 1, whose whole cause was
// that `issue create --label urgent` took a name while every other way of
// labelling took an id nobody could guess.

// A bare integer is an ID; anything else is a NAME. The ambiguity is real and
// deliberate — a label literally named "58" cannot be attached by name — so it
// is worth pinning rather than leaving to be re-derived from the code.
func TestLabelTargetArgSplitsIdsFromNames(t *testing.T) {
	cases := []struct {
		arg      string
		wantID   int
		wantName string
	}{
		{"58", 58, ""},
		{"0", 0, ""}, // an id, even though it is falsy — not a name
		{"urgent", 0, "urgent"},
		{"P1 blocker", 0, "P1 blocker"},
		{"58-blocked", 0, "58-blocked"}, // leading digits are not an id
		{"", 0, ""},                     // rejected upstream by ExactArgs/the route
	}
	for _, tc := range cases {
		t.Run(tc.arg, func(t *testing.T) {
			id, name := labelTargetArg(tc.arg)
			if id != tc.wantID || name != tc.wantName {
				t.Fatalf("labelTargetArg(%q) = (%d, %q), want (%d, %q)",
					tc.arg, id, name, tc.wantID, tc.wantName)
			}
		})
	}
}

// `issue edit` must carry --label and --label-remove, and both must be
// stringARRAY. The two wrong choices fail differently and both fail quietly:
//
//   - StringVar     `--label a --label b` keeps only b, dropping a in silence
//   - StringSliceVar repeatable, but SPLITS ON COMMAS — a label named
//     "blocked, external" becomes two labels, and since the route creates
//     unknown names on the fly, both would be created rather than rejected
//
// stringArray takes each occurrence whole, which is what a free-text label name
// needs.
func TestIssueEditHasRepeatableLabelFlags(t *testing.T) {
	cmd := newIssueEditCmd()
	for _, name := range []string{"label", "label-remove"} {
		f := cmd.Flags().Lookup(name)
		if f == nil {
			t.Fatalf("`bk issues issue edit` has no --%s — the flag this whole item "+
				"exists to add", name)
		}
		if f.Value.Type() != "stringArray" {
			t.Errorf("--%s is %s, not stringArray — a label name containing a comma "+
				"would be split into two, or repeats would be dropped", name, f.Value.Type())
		}
	}

	// And the behaviour, not just the type: a comma must survive, and repeats
	// must accumulate. The type check alone would pass against a future flag
	// wrapper that reported stringArray while parsing like a slice.
	if err := cmd.Flags().Parse([]string{"--label", "blocked, external", "--label", "urgent"}); err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, err := cmd.Flags().GetStringArray("label")
	if err != nil {
		t.Fatalf("GetStringArray: %v", err)
	}
	want := []string{"blocked, external", "urgent"}
	if len(got) != len(want) {
		t.Fatalf("--label parsed to %q, want %q — a comma was split or a repeat was dropped", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("--label parsed to %q, want %q", got, want)
		}
	}
}

// The routes annotation has to name the sub-resource calls, not just the PATCH.
// cli-parity.test.ts checks these claims against apps/issues' filesystem, and an
// annotation that lags the implementation is how a command comes to make an HTTP
// call nothing has ever verified exists.
func TestIssueEditAnnotatesTheLabelRoutes(t *testing.T) {
	got := newIssueEditCmd().Annotations["routes"]
	for _, want := range []string{
		"PATCH /api/workspaces/{ws}/issues/{id}",
		"POST /api/workspaces/{ws}/issues/{id}/labels",
		"DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid}",
		"GET /api/workspaces/{ws}/issues/{id}/labels",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the routes annotation does not claim %q:\n  %s", want, got)
		}
	}
}
