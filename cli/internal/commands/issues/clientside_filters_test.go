package issues

import (
	"reflect"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// A CLIENT-SIDE FILTER MUST SAY SO, AND SAY WHAT IT COSTS
// ---------------------------------------------------------------------------
// `--status` and `--assignee` on `bk issues issue list` fetch every issue in
// the workspace and filter locally. The flags were labelled `(client-side)`,
// which names the mechanism and not the CONSEQUENCE: correct at 50 issues, a
// cliff at 10,000. Phase 1 extended the wording; moving the filters onto the
// server is a route change and belongs in a later phase.
//
// TWO HALVES, because the label alone is only a string:
//
//  1. the label is present on every flag that is filtered locally, and
//  2. the request the CLIENT builds still cannot carry those filters.
//
// (2) is the half held against a fact. The day someone adds `Status` to
// ListIssuesOpts and sends it, this fails — and the failure lands on the help
// text that would otherwise have quietly started lying in the other direction.
// That is not hypothetical: the struct carried a `Status` field that nothing
// ever set and ListIssues never sent, so reading it suggested the opposite of
// what the code did.
func TestListIssuesRequestCannotCarryTheClientSideFilters(t *testing.T) {
	rt := reflect.TypeOf(client.ListIssuesOpts{})
	if rt.NumField() == 0 {
		t.Fatal("ListIssuesOpts has no fields — this check has nothing to look at")
	}
	for _, banned := range []string{"Status", "Assignee", "Mine"} {
		if _, ok := rt.FieldByName(banned); ok {
			t.Errorf("ListIssuesOpts now has a %s field. Either the server filters on it — in which "+
				"case drop the CLIENT-SIDE wording from the flag's help and stop filtering in "+
				"filterIssues() — or it is dead and reads as a capability the request does not have.",
				banned)
		}
	}
}

// The label itself. Mechanical, and it cannot tell a locally-filtered flag from
// a server-side one — that judgement is (2) above and the code review. What it
// does prevent is the wording being reworded away, which is how the previous
// version ("(client-side)", mechanism only, no cost) survived unnoticed.
func TestLocallyFilteredFlagsNameTheCost(t *testing.T) {
	cases := []struct {
		path  []string
		flags []string
	}{
		{[]string{"issue", "list"}, []string{"status", "assignee", "mine"}},
		{[]string{"project", "issues"}, []string{"status", "assignee"}},
	}
	root := &cobra.Command{Use: "issues"}
	root.AddCommand(NewGroup().Commands()...)
	var checked int
	for _, tc := range cases {
		cmd, _, err := root.Find(tc.path)
		if err != nil {
			t.Fatalf("bk issues %s does not resolve: %v", strings.Join(tc.path, " "), err)
		}
		for _, name := range tc.flags {
			f := cmd.Flags().Lookup(name)
			if f == nil {
				t.Errorf("bk issues %s has no --%s — this case is checking nothing",
					strings.Join(tc.path, " "), name)
				continue
			}
			checked++
			if !strings.Contains(f.Usage, "CLIENT-SIDE") {
				t.Errorf("bk issues %s --%s is filtered locally and its help does not say so:\n  %s",
					strings.Join(tc.path, " "), name, f.Usage)
			}
			// The cost, not just the mechanism. "(client-side)" told a reader
			// nothing they could act on.
			if !strings.Contains(f.Usage, "fetched first") {
				t.Errorf("bk issues %s --%s says it is client-side but not what that costs:\n  %s",
					strings.Join(tc.path, " "), name, f.Usage)
			}
		}
	}
	if checked != 5 {
		t.Fatalf("checked %d flags, expected 5 — the walk found less than it should have", checked)
	}
}
