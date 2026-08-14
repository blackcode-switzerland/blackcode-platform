package issues

import (
	"reflect"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// EVERY `issue list` FILTER IS APPLIED BY THE SERVER
// ---------------------------------------------------------------------------
// This file REPLACES `clientside_filters_test.go`, which asserted the opposite
// and was correct when it was written. `--status`, `--assignee` and `--mine`
// fetched every issue in the workspace and filtered locally; that file made sure
// the help said so, and made sure `ListIssuesOpts` could not grow a field that
// looked server-side without being sent.
//
// On 2026-08-12 the filters moved. The route had accepted `status`,
// `assignee_id`, `priority` and `task_id` since it was written — the CLIENT was
// the only thing not sending them. So the guard is inverted rather than deleted,
// and it now holds the same two halves in the new direction:
//
//  1. the request the CLIENT builds carries every filter, and
//  2. no flag's help claims to be client-side any more.
//
// (1) is the half held against a fact, and it is the half that fails if someone
// adds a field to `ListIssuesOpts` and forgets to send it — the exact defect the
// old file was written for, which is why the shape is kept.
//
// WHAT THIS FILE CANNOT SEE: whether the SERVER actually filters on what it
// receives. A route that read `?label=` and ignored it would pass every case
// here. That half is
// `apps/issues/lib/db/queries/issues-list-filters.integration.test.ts`, which
// asserts the rows each filter EXCLUDES against a real Postgres. Neither file is
// sufficient alone.

// The filters, their opts field, and the query parameter each must produce.
// One table, so a new filter that is added to the command and not to the wire
// has somewhere obvious to go missing from.
var wireFilters = []struct {
	param string
	opts  client.ListIssuesOpts
	want  string
}{
	{"project_id", client.ListIssuesOpts{ProjectID: 4}, "4"},
	{"task_id", client.ListIssuesOpts{TaskID: 9}, "9"},
	{"search", client.ListIssuesOpts{Search: "crash"}, "crash"},
	{"status", client.ListIssuesOpts{Status: "in_progress"}, "in_progress"},
	{"priority", client.ListIssuesOpts{Priority: 1}, "1"},
	{"assignee_ids", client.ListIssuesOpts{AssigneeIDs: []int{7}}, "7"},
	{"assignee_id", client.ListIssuesOpts{Unassigned: true}, "null"},
	{"reporter_ids", client.ListIssuesOpts{ReporterIDs: []int{7}}, "7"},
	{"reporter_id", client.ListIssuesOpts{NoReporter: true}, "null"},
	{"label", client.ListIssuesOpts{Labels: []string{"bug"}}, "bug"},
	{"due_before", client.ListIssuesOpts{DueBefore: "2026-08-14"}, "2026-08-14"},
}

func TestEveryIssueListFilterReachesTheQueryString(t *testing.T) {
	for _, tc := range wireFilters {
		got := client.IssuesQuery(tc.opts).Get(tc.param)
		if got != tc.want {
			t.Errorf("IssuesQuery did not send %s=%s (got %q). A filter the request does not carry "+
				"is a filter the server never applies — the call succeeds and returns a WIDER set "+
				"than was asked for, with nothing to notice.", tc.param, tc.want, got)
		}
	}
	// Assert the input: a loop over an empty table passes while checking nothing.
	if len(wireFilters) != 11 {
		t.Fatalf("this table covers %d filters — update it when one is added", len(wireFilters))
	}

	// The zero value must filter NOTHING. A parameter that appears unasked-for
	// silently narrows a listing the caller believes is complete.
	if q := client.IssuesQuery(client.ListIssuesOpts{}); len(q) != 0 {
		t.Errorf("an unfiltered `issue list` sent %v — it must ask for everything", q)
	}
}

// "Nobody" and "no filter" are different requests, and an empty slice already
// means the second. If `Unassigned` were ever folded into `AssigneeIDs`, this is
// what notices: `--assignee none` would come back as the whole workspace.
func TestUnassignedIsNotTheSameAsNoAssigneeFilter(t *testing.T) {
	none := client.IssuesQuery(client.ListIssuesOpts{Unassigned: true})
	if none.Get("assignee_id") != "null" {
		t.Errorf("--assignee none sent %v — it must ask for assignee_id=null", none)
	}
	if len(none["assignee_ids"]) != 0 {
		t.Errorf("--assignee none also sent assignee_ids=%v — the two clauses would fight", none["assignee_ids"])
	}

	blank := client.IssuesQuery(client.ListIssuesOpts{AssigneeIDs: nil})
	if len(blank) != 0 {
		t.Errorf("no assignee filter sent %v — an empty list is not a request for unassigned issues", blank)
	}
}

// The same split for --created-by. `none` here means the author's account was
// deleted (`reporter_id IS NULL`), and folding it into ReporterIDs would turn
// that request into the whole workspace — the shape the assignee case above
// exists to prevent, one filter over.
func TestNoReporterIsNotTheSameAsNoCreatorFilter(t *testing.T) {
	none := client.IssuesQuery(client.ListIssuesOpts{NoReporter: true})
	if none.Get("reporter_id") != "null" {
		t.Errorf("--created-by none sent %v — it must ask for reporter_id=null", none)
	}
	if len(none["reporter_ids"]) != 0 {
		t.Errorf("--created-by none also sent reporter_ids=%v — the two clauses would fight", none["reporter_ids"])
	}

	blank := client.IssuesQuery(client.ListIssuesOpts{ReporterIDs: nil})
	if len(blank) != 0 {
		t.Errorf("no creator filter sent %v — an empty list is not a request for authorless issues", blank)
	}
}

// Several --label values are an OR, and every one is sent. Sending only the last
// would silently narrow "the bugs or the regressions" to "the regressions".
func TestRepeatedLabelsAreAllSent(t *testing.T) {
	q := client.IssuesQuery(client.ListIssuesOpts{Labels: []string{"bug", "regression"}})
	got := q["label"]
	if len(got) != 2 || got[0] != "bug" || got[1] != "regression" {
		t.Fatalf("label=%v, want [bug regression]", got)
	}
}

// The opts struct is a claim about the request, and it has been wrong before —
// it carried a `Status` field nothing set and nothing sent. Every field must now
// appear in the table above, so the next one added has to be wired or explained.
func TestListIssuesOptsHasNoUnwiredFields(t *testing.T) {
	rt := reflect.TypeOf(client.ListIssuesOpts{})
	if rt.NumField() == 0 {
		t.Fatal("ListIssuesOpts has no fields — this check has nothing to look at")
	}
	covered := map[string]bool{}
	for _, tc := range wireFilters {
		v := reflect.ValueOf(tc.opts)
		for i := 0; i < rt.NumField(); i++ {
			if !v.Field(i).IsZero() {
				covered[rt.Field(i).Name] = true
			}
		}
	}
	for i := 0; i < rt.NumField(); i++ {
		if name := rt.Field(i).Name; !covered[name] {
			t.Errorf("ListIssuesOpts.%s is set by nothing in wireFilters — either it reaches the "+
				"query string (add a row) or it is a capability the request does not have, which is "+
				"how `--status` came to be documented as server-side while it was not.", name)
		}
	}
}

// NO FLAG CLAIMS TO BE CLIENT-SIDE ANY MORE.
//
// The wording is only a string and cannot tell a locally-filtered flag from a
// remote one — that judgement is the test above. What it does prevent is the old
// label surviving the move, which would have every caller believing a cliff is
// still there and reaching for `--search` to avoid it.
func TestNoIssueFilterStillAdvertisesItselfAsClientSide(t *testing.T) {
	root := &cobra.Command{Use: "issues"}
	root.AddCommand(NewGroup().Commands()...)
	var checked int
	for _, path := range [][]string{{"issue", "list"}, {"project", "issues"}} {
		cmd, _, err := root.Find(path)
		if err != nil {
			t.Fatalf("bk issues %s does not resolve: %v", strings.Join(path, " "), err)
		}
		cmd.Flags().VisitAll(func(f *pflag.Flag) {
			checked++
			if strings.Contains(strings.ToUpper(f.Usage), "CLIENT-SIDE") {
				t.Errorf("bk issues %s --%s still says it is client-side:\n  %s",
					strings.Join(path, " "), f.Name, f.Usage)
			}
		})
	}
	if checked < 12 {
		t.Fatalf("visited %d flags across the two commands, expected at least 12 — the walk found "+
			"less than it should have, so a clean result means nothing", checked)
	}
}

// EVERY FILTER `issue list` OFFERS, `project issues` OFFERS TOO.
//
// They are built from one constructor now. They were a hand-copied subset before,
// which is how `project issues` kept a "CLIENT-SIDE" label for a mechanism
// `issue list` had already left behind — and how it would have quietly missed
// --label, --priority and --due-before.
func TestProjectIssuesOffersTheSameFiltersAsIssueList(t *testing.T) {
	root := &cobra.Command{Use: "issues"}
	root.AddCommand(NewGroup().Commands()...)

	list, _, err := root.Find([]string{"issue", "list"})
	if err != nil {
		t.Fatalf("issue list: %v", err)
	}
	proj, _, err := root.Find([]string{"project", "issues"})
	if err != nil {
		t.Fatalf("project issues: %v", err)
	}

	var missing []string
	var seen int
	list.Flags().VisitAll(func(f *pflag.Flag) {
		// --project is the positional on `project issues`; it is the one flag
		// that is legitimately absent.
		if f.Name == "project" {
			return
		}
		seen++
		if proj.Flags().Lookup(f.Name) == nil {
			missing = append(missing, f.Name)
		}
	})
	if seen < 7 {
		t.Fatalf("issue list has %d filter flags — this comparison is checking almost nothing", seen)
	}
	if len(missing) > 0 {
		t.Errorf("bk issues project issues is missing %v — the two listings answer the same question "+
			"about different scopes and must offer the same filters", missing)
	}
}
