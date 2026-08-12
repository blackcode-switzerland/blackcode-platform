package issues

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// EVERY FLAG THAT TAKES A VOCABULARY VALUE NAMES ITS VALUES.
//
// ── WHAT THIS CATCHES, AND WHAT IT DOES NOT ─────────────────────────────────
// It catches a flag registered with a hand-typed description that bypasses
// `vocab()`/`vocabPriority()` — which is how this app got into the state that
// prompted the work: `issue create --priority` said "Priority 1-5 (1=urgent)"
// and `project create --priority` said "(urgent/high/medium/low/none)", inside
// one app, and the second list was not a vocabulary this app has ever served.
//
// It does NOT catch drift against the server. Nothing in Go can: the
// vocabularies are TypeScript constants in `apps/issues/lib/work-items.ts` and
// the two ship separately. That is `apps/issues/lib/cli-vocabulary.test.ts`'s
// job, and the two guards are a pair — this one holds the FLAGS to `vocab.go`,
// that one holds `vocab.go` to the source of truth. Either alone passes on the
// bug the other exists for.
//
// ── THE TABLE IS HAND-WRITTEN, AND THAT IS A REAL WEAKNESS ──────────────────
// A NEW vocabulary flag added tomorrow will not appear here and this test will
// not notice. Add the row in the same commit as the flag, the way a `routes`
// annotation goes in with its command.
func TestVocabularyFlagsNameTheirValues(t *testing.T) {
	cases := []struct{ path, flag, key string }{
		{"issue list", "status", "issue_statuses"},
		{"issue create", "status", "issue_statuses"},
		{"issue edit", "status", "issue_statuses"},
		{"project issues", "status", "issue_statuses"},

		{"project edit", "status", "project_statuses"},

		{"project updates add", "status", "project_update_health"},
		{"project updates add", "health", "project_update_health"},
	}

	root := newIssuesGroupForTest(t)
	for _, tc := range cases {
		t.Run(tc.path+" --"+tc.flag, func(t *testing.T) {
			f := lookupFlag(t, root, tc.path, tc.flag)
			for _, want := range vocabularies[tc.key] {
				if !strings.Contains(f.Usage, want) {
					t.Errorf("`bk issues %s --%s` does not name %q from %s:\n  %s",
						tc.path, tc.flag, want, tc.key, f.Usage)
				}
			}
			if !strings.Contains(f.Usage, "bk meta") {
				t.Errorf("`bk issues %s --%s` enumerates without pointing at the live authority:\n  %s",
					tc.path, tc.flag, f.Usage)
			}
		})
	}
}

// --health is an ALIAS, so it must name the same values --status does. A caller
// choosing between two spellings of one flag must not have to wonder whether
// they take different words.
func TestHealthAliasNamesTheSameValuesAsStatus(t *testing.T) {
	root := newIssuesGroupForTest(t)
	status := lookupFlag(t, root, "project updates add", "status")
	health := lookupFlag(t, root, "project updates add", "health")
	for _, want := range vocabularies["project_update_health"] {
		if !strings.Contains(status.Usage, want) || !strings.Contains(health.Usage, want) {
			t.Errorf("--status and --health disagree about %q:\n  status: %s\n  health: %s",
				want, status.Usage, health.Usage)
		}
	}
}

// BOTH --priority flags name BOTH spellings, and the same five names.
//
// This is the whole of the reported inconsistency: one command took an integer,
// the other took words, and neither said the other existed. The names are the
// shared half, so they are what is asserted on both; the raw codes are asserted
// per command because they genuinely differ.
func TestBothPriorityFlagsNameTheSharedVocabulary(t *testing.T) {
	root := newIssuesGroupForTest(t)
	for _, path := range []string{"issue create", "issue edit"} {
		f := lookupFlag(t, root, path, "priority")
		for _, a := range priorityAliases {
			if !strings.Contains(f.Usage, a.Name) {
				t.Errorf("`bk issues %s --priority` does not name %q:\n  %s", path, a.Name, f.Usage)
			}
		}
		if !strings.Contains(f.Usage, "1-5") {
			t.Errorf("`bk issues %s --priority` stopped naming the integer spelling every "+
				"existing script passes:\n  %s", path, f.Usage)
		}
	}
	for _, path := range []string{"project create", "project edit"} {
		f := lookupFlag(t, root, path, "priority")
		for _, a := range priorityAliases {
			if !strings.Contains(f.Usage, a.Name) {
				t.Errorf("`bk issues %s --priority` does not name %q:\n  %s", path, a.Name, f.Usage)
			}
			if !strings.Contains(f.Usage, a.Project) {
				t.Errorf("`bk issues %s --priority` does not name the stored code %q:\n  %s",
					path, a.Project, f.Usage)
			}
		}
	}
}

// A --priority flag that is still typed `int` cannot accept a name at all, and
// the failure is pflag's `strconv.ParseInt` text — which is what the reported
// session got. The TYPE is the property, not the help string.
func TestPriorityFlagsAcceptStrings(t *testing.T) {
	root := newIssuesGroupForTest(t)
	for _, path := range []string{"issue create", "issue edit", "project create", "project edit"} {
		if got := lookupFlag(t, root, path, "priority").Value.Type(); got != "string" {
			t.Errorf("`bk issues %s --priority` is %s — a name cannot reach parseIssuePriority/"+
				"parseProjectPriority through an int flag", path, got)
		}
	}
}

// Every --project that is a FLAG takes a string, so a name can reach
// resolveProjectRef. An int flag rejects "Website relaunch" in pflag, before
// any of this package runs.
func TestProjectFlagsAcceptNames(t *testing.T) {
	root := newIssuesGroupForTest(t)
	for _, path := range []string{"issue list", "issue create", "task list", "task create", "project updates add"} {
		f := lookupFlag(t, root, path, "project")
		if f.Value.Type() != "string" {
			t.Errorf("`bk issues %s --project` is %s — a project NAME cannot reach "+
				"resolveProjectRef through an int flag", path, f.Value.Type())
		}
		if !strings.Contains(f.Usage, "NAME") {
			t.Errorf("`bk issues %s --project` does not say it takes a name:\n  %s", path, f.Usage)
		}
	}
}

// ── helpers ────────────────────────────────────────────────────────────────

// newIssuesGroupForTest builds the real `bk issues` tree. Not a hand-assembled
// subset: the property under test is what a caller's `--help` prints, and a
// command left out of a test-local tree is a flag nothing checks.
func newIssuesGroupForTest(t *testing.T) *cobra.Command {
	t.Helper()
	cmd := NewGroup()
	if cmd == nil {
		t.Fatal("NewGroup() returned nil")
	}
	return cmd
}

// lookupFlag walks a space-separated command path and returns one flag,
// INCLUDING inherited ones. It fails rather than returning nil, because a
// missing command would otherwise make every assertion above vacuous —
// CLAUDE.md finding #5 is a guard that found nothing and passed.
func lookupFlag(t *testing.T, root *cobra.Command, path, flag string) *pflag.Flag {
	t.Helper()
	cmd := root
	for _, part := range strings.Fields(path) {
		var next *cobra.Command
		for _, c := range cmd.Commands() {
			if c.Name() == part {
				next = c
				break
			}
		}
		if next == nil {
			t.Fatalf("no command `bk issues %s` — this table is stale, and a stale table "+
				"names flags nothing checks", path)
		}
		cmd = next
	}
	f := cmd.Flags().Lookup(flag)
	if f == nil {
		f = cmd.InheritedFlags().Lookup(flag)
	}
	if f == nil {
		t.Fatalf("`bk issues %s` has no --%s", path, flag)
	}
	return f
}
