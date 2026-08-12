package issues

import (
	"strings"
	"testing"
)

// ONE VOCABULARY, TWO STORAGE SHAPES.
//
// `issue create --priority` took an int and `project create --priority` took a
// word, inside one app. Both now take the same five names; each still writes
// what its own column holds.

func TestIssuePriorityAcceptsNamesAndIntegers(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0}, // not given
		{"urgent", 1},
		{"URGENT", 1}, // the vocabulary is case-insensitive, like every other one here
		{" high ", 2},
		{"medium", 3},
		{"low", 4},
		{"none", 5},
		{"1", 1}, // the spelling every existing script passes
		{"5", 5},
	}
	for _, tc := range cases {
		got, err := parseIssuePriority(tc.in)
		if err != nil {
			t.Errorf("parseIssuePriority(%q) errored: %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("parseIssuePriority(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

// THE PLAN'S EXPLICIT WARNING: "make sure an out-of-range integer still fails as
// clearly as it does now."
//
// It fails EARLIER than it did. Before, `--priority 9` parsed fine and the
// route answered `priority must be 1-5 (400)` — one round trip to learn a fact
// the binary already had. The message must still name the range, and now also
// names the alternative spelling.
func TestIssuePriorityRejectsOutOfRangeAndGarbage(t *testing.T) {
	for _, in := range []string{"0", "6", "9", "-1", "urgentish", "P1", "??"} {
		got, err := parseIssuePriority(in)
		if err == nil {
			t.Errorf("parseIssuePriority(%q) = %d with no error — an out-of-range or unknown "+
				"priority must not reach the route", in, got)
			continue
		}
		msg := err.Error()
		if !strings.Contains(msg, "1-5") {
			t.Errorf("parseIssuePriority(%q) stopped naming the valid range: %s", in, msg)
		}
		for _, a := range priorityAliases {
			if !strings.Contains(msg, a.Name) {
				t.Errorf("parseIssuePriority(%q) does not name %q, so the caller cannot see "+
					"the spelling that would have worked: %s", in, a.Name, msg)
			}
		}
	}
}

// THE BUG THIS FIXES, PINNED.
//
// `--priority urgent` on a project was passed to the route VERBATIM, the route
// does no vocabulary check on it, and `issues.projects.priority` is a
// varchar(10). So the literal string "urgent" landed in a column the web app,
// `bk meta` and `projectPriorityLabel()` all read as P0..P4, and the project
// rendered as "No priority" everywhere — while the CLI's own help had told the
// caller to type exactly that.
//
// Reproduced against a running route on 2026-08-12 before the fix
// (project #153, priority='urgent'). Nothing in the app would ever have said so.
func TestProjectPriorityNeverPassesANameThrough(t *testing.T) {
	for _, a := range priorityAliases {
		got, err := parseProjectPriority(a.Name)
		if err != nil {
			t.Errorf("parseProjectPriority(%q) errored: %v", a.Name, err)
			continue
		}
		if got != a.Project {
			t.Errorf("parseProjectPriority(%q) = %q, want %q — a value the column does not hold",
				a.Name, got, a.Project)
		}
		if got == a.Name {
			t.Errorf("parseProjectPriority(%q) passed the NAME through — this is the exact "+
				"defect: the route accepts it, stores it, and every reader renders it as "+
				"'No priority'", a.Name)
		}
	}
}

func TestProjectPriorityAcceptsItsStoredCodes(t *testing.T) {
	cases := map[string]string{
		"":   "", // not given
		"P0": "P0",
		"p3": "P3", // normalised up: the column and the UI only know upper case
		"P4": "P4",
	}
	for in, want := range cases {
		got, err := parseProjectPriority(in)
		if err != nil {
			t.Errorf("parseProjectPriority(%q) errored: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("parseProjectPriority(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestProjectPriorityRejectsGarbage(t *testing.T) {
	for _, in := range []string{"P9", "1", "critical", "no priority"} {
		if got, err := parseProjectPriority(in); err == nil {
			t.Errorf("parseProjectPriority(%q) = %q with no error — a value outside the "+
				"vocabulary reaches a column with no CHECK constraint and no route validation",
				in, got)
		}
	}
}

// The two mappings must be a bijection over the same five names. A sixth
// priority added to one side and not the other is drift the TypeScript guard
// catches against the SERVER; this catches it inside the table itself.
func TestPriorityAliasesAreConsistent(t *testing.T) {
	names := map[string]bool{}
	issues := map[int]bool{}
	projects := map[string]bool{}
	for _, a := range priorityAliases {
		if names[a.Name] {
			t.Errorf("duplicate priority name %q", a.Name)
		}
		if issues[a.Issue] {
			t.Errorf("duplicate issue priority %d", a.Issue)
		}
		if projects[a.Project] {
			t.Errorf("duplicate project priority %q", a.Project)
		}
		names[a.Name], issues[a.Issue], projects[a.Project] = true, true, true
		if strings.TrimSpace(a.Label) == "" {
			t.Errorf("priority %q has no Label — the label is what holds this mapping to "+
				"apps/issues/lib/work-items.ts; without it the mapping is unfalsifiable", a.Name)
		}
	}
	if len(priorityAliases) != len(vocabularies["issue_priorities"]) {
		t.Errorf("%d aliases for %d issue priorities — every value the server serves needs "+
			"exactly one name, or --help enumerates a vocabulary the app does not have",
			len(priorityAliases), len(vocabularies["issue_priorities"]))
	}
	if len(priorityAliases) != len(vocabularies["project_priorities"]) {
		t.Errorf("%d aliases for %d project priorities", len(priorityAliases), len(vocabularies["project_priorities"]))
	}
	// And the alias table's codes must BE the vocabulary, not merely be the same
	// size as it.
	for _, a := range priorityAliases {
		if !contains(vocabularies["project_priorities"], a.Project) {
			t.Errorf("priorityAliases maps %q to %q, which is not in vocabularies[\"project_priorities\"]",
				a.Name, a.Project)
		}
	}
}

func contains(hay []string, needle string) bool {
	for _, h := range hay {
		if h == needle {
			return true
		}
	}
	return false
}

// A confirmation line must never print a wrong word. An unknown priority — a
// sixth one added server-side before a CLI release — prints as the bare code.
func TestIssuePriorityLabelFallsBackRatherThanGuessing(t *testing.T) {
	if got := issuePriorityLabel(1); got != "P1 urgent" {
		t.Errorf("issuePriorityLabel(1) = %q, want %q", got, "P1 urgent")
	}
	if got := issuePriorityLabel(9); got != "P9" {
		t.Errorf("issuePriorityLabel(9) = %q — an unknown priority must print as its code, "+
			"never as another priority's name", got)
	}
}
