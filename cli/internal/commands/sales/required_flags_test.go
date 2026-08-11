package sales

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// EVERY FLAG THE SERVER REFUSES WITHOUT MUST SAY SO IN `--help`.
//
// ── WHY THIS IS WORTH A FILE ────────────────────────────────────────────────
// An agent composing `bk sales product create` has exactly two sources for
// "what does this need?": the flag descriptions, and a 400 from the server. The
// second works — every one of these routes answers `missing_name` /
// `unknown_category` with a suggestion naming the flag — but it costs a round
// trip, and a round trip inside an agent run is where a task gets abandoned.
//
// On 2026-08-11 four commands were checked against their routes and EIGHT flags
// were found unmarked: `product create --name/--category`,
// `template create --name/--channel/--category`, `doc add --kind`, and the
// either/or between `doc add --upload` and `--url`. Every one is enforced
// server-side and none of them said so. `prospect create`, `meeting schedule`
// and `comm log` were already correct, which is what made the gap invisible —
// the app looked consistent from any single example.
//
// ── THIS TABLE IS A SNAPSHOT, AND THE ROUTE IS THE AUTHORITY ────────────────
// It is hand-written, and that is a real weakness: a NEW required field added
// to a route tomorrow will not appear here, and this test will not notice. It
// catches the regression it can catch — somebody deleting a marker, or copying
// a flag registration without one — and nothing more. Do not read a pass here
// as "the help is complete".
//
// The honest fix would derive the list from `apps/sales/app/api/**`, which
// means a test in this Go package reading another app's TypeScript. That is a
// worse coupling than the one it removes, so: when you add a required field to
// a sales route, add its flag here in the same commit, the way a `routes`
// annotation goes in with its command.
func TestRequiredSalesFlagsSayRequired(t *testing.T) {
	// command path under `bk sales` → flags the ROUTE refuses without.
	cases := map[string][]string{
		"prospect create":  {"name"},
		"product create":   {"name", "category"},
		"template create":  {"name", "channel", "category"},
		"doc add":          {"title", "kind"},
		"meeting schedule": {"prospect", "title", "type", "at"},
		"meeting log":      {"prospect", "title", "type", "at", "outcome"},
		"comm log":         {"prospect", "channel", "dir"},
		"contact add":      {"name"},
		"objection raise":  {"type"},
	}

	root := NewGroup()
	for path, flags := range cases {
		t.Run(path, func(t *testing.T) {
			cmd, _, err := root.Find(strings.Fields(path))
			if err != nil {
				t.Fatalf("`bk sales %s` does not resolve: %v — this table is stale", path, err)
			}
			for _, name := range flags {
				f := cmd.Flags().Lookup(name)
				if f == nil {
					t.Errorf("`bk sales %s` has no --%s, but the route requires it", path, name)
					continue
				}
				if !strings.Contains(strings.ToLower(f.Usage), "required") {
					t.Errorf("`bk sales %s --%s` is required by the route and its help does not "+
						"say so — an agent learns it only from a 400:\n  %s", path, name, f.Usage)
				}
			}
		})
	}
}

// The either/or on `doc add` is not expressible as "required", so it gets its
// own case: the route refuses BOTH-missing and BOTH-present, and each flag has
// to point at the other or the caller cannot tell it is a choice.
func TestDocAddNamesItsEitherOr(t *testing.T) {
	cmd, _, err := NewGroup().Find([]string{"doc", "add"})
	if err != nil {
		t.Fatalf("`bk sales doc add` does not resolve: %v", err)
	}
	for _, pair := range [][2]string{{"upload", "--url"}, {"url", "--upload"}} {
		f := cmd.Flags().Lookup(pair[0])
		if f == nil {
			t.Fatalf("no --%s", pair[0])
		}
		if !strings.Contains(f.Usage, pair[1]) {
			t.Errorf("`--%s` does not mention `%s`, so nothing says a document needs "+
				"exactly one of them:\n  %s", pair[0], pair[1], f.Usage)
		}
	}
}

// ASSERT THE INPUT. If NewGroup() ever stops returning a populated tree, every
// lookup above fails loudly rather than the table silently matching nothing —
// but a `Find` that errors is easy to mistake for a stale entry, so the count
// is checked directly.
func TestTheSalesTreeIsPopulated(t *testing.T) {
	var leaves int
	var walk func(*cobra.Command)
	walk = func(c *cobra.Command) {
		if !c.HasSubCommands() {
			leaves++
			return
		}
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(NewGroup())
	if leaves < 40 {
		t.Fatalf("only %d leaves under `bk sales` — the tree looks empty, which would make "+
			"every assertion above vacuous", leaves)
	}
}
