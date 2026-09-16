package commands

import (
	"regexp"
	"sort"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// THE ROOT HELP'S "APPS" TOUR NAMES EVERY APP GROUP THE BINARY CARRIES
// ---------------------------------------------------------------------------
// `bk --help` opens with a hand-written tour:
//
//	APPS — every app verb sits behind its app name:
//	  issues      issue, task, project, attachment, move, copy, analytics
//	  sales       prospect, contact, meeting, comm, product, template, doc, …
//
// It is a copy of a fact the command tree owns, which is the shape of CLAUDE.md
// finding #23 — and unlike `bk books --help`, whose tour IS checked against the
// tree by help_prose_table_test.go, this one was checked by nothing.
//
// It had already drifted. On 2026-09-16, while registering the fourth app, the
// tour listed `issues` and `sales` and **not `books`** — which had been in
// PRODUCTION since 2026-08-20 — and not `scaffold`, which the binary has carried
// since the group shipped. So the first thing an agent read about which apps
// exist was missing half of them, for a month, with nothing to say so.
//
// ── WHAT THIS CHECKS, AND WHY NOT THE VERBS ────────────────────────────────
// It checks that every registered app group is NAMED in the tour, and that the
// tour names no group the binary does not carry. It deliberately does NOT check
// the verb lists against the tree, unlike the books guard, and the reason is in
// the text: the sales row ends in `…` and the issues row lists seven of that
// app's nouns. They are illustrative by design — the row is an invitation to run
// `bk <app> --help`, which IS generated.
//
// Checking verbs here would therefore have to either fail on the honest `…` or
// accept any subset, and a guard that accepts any subset of a list is a guard
// that cannot see a missing verb. So this one answers the question that actually
// went wrong: **is every app in the list?**
//
// A name is the whole capability. An app absent from this tour is an app an
// agent has no reason to look for, and no `bk <app> --help` will be run for a
// group nobody knows is there.
//
// TestAppRosterGuardFires keeps both mutations in the suite.

// appRosterRowRe matches a tour row: two-space indent, then the app slug, then
// two or more spaces, then anything. Anchored on the line start so prose
// elsewhere in the help cannot be mistaken for a row.
var appRosterRowRe = regexp.MustCompile(`(?m)^  ([a-z][a-z0-9-]*)\s{2,}\S`)

// appRosterSection returns just the APPS block, so a slug mentioned anywhere
// else in the help — and several are, in the CHANGED note below it — cannot
// stand in for a row that is missing.
//
// Returns "" when the header is absent, which the first assertion reports rather
// than treating as "no rows to check". A scan over an empty string finds no
// offenders and would otherwise pass.
func appRosterSection(long string) string {
	const header = "APPS — every app verb sits behind its app name:"
	i := strings.Index(long, header)
	if i < 0 {
		return ""
	}
	rest := long[i+len(header):]
	// The block ends at the first blank line followed by a non-indented line.
	if j := strings.Index(rest, "\n\n"); j >= 0 {
		return rest[:j]
	}
	return rest
}

// registeredAppGroups is every top-level group that pins an app — which is
// exactly the set `pinApp` was called on in root.go. Read from the tree rather
// than listed here: a hand-written list in the guard would drift the same way
// the prose did, one file over.
func registeredAppGroups(t *testing.T) []string {
	t.Helper()
	root := NewRoot()
	var out []string
	for _, c := range root.Commands() {
		if c.Hidden {
			continue
		}
		// An app group is one whose subtree carries the app-owned `workspace`
		// verb. That is the discriminator rather than a name list: every app
		// group has its own tenancy (multiAppFinalRefactor Phase 7), and no bare
		// verb does — `bk workspace` was removed on 2026-08-10.
		if sub, _, err := c.Find([]string{"workspace"}); err == nil && sub != c {
			out = append(out, c.Name())
		}
	}
	sort.Strings(out)
	return out
}

func TestRootHelpNamesEveryAppGroup(t *testing.T) {
	root := NewRoot()
	section := appRosterSection(root.Long)

	// Assert the inputs before trusting the conclusion. Both halves are
	// discovered — one by parsing text, one by walking the tree — so "found
	// nothing" is a real failure mode, and an empty set on either side makes the
	// comparison below pass while checking nothing.
	if section == "" {
		t.Fatalf("the APPS section was not found in the root help.\n" +
			"Either the header moved or it was removed. This guard has no subject and " +
			"would have passed silently.")
	}

	var listed []string
	for _, m := range appRosterRowRe.FindAllStringSubmatch(section, -1) {
		listed = append(listed, m[1])
	}
	sort.Strings(listed)
	if len(listed) == 0 {
		t.Fatalf("parsed 0 rows out of the APPS section, so nothing was compared:\n%s", section)
	}

	registered := registeredAppGroups(t)
	if len(registered) == 0 {
		t.Fatal("found 0 app groups in the command tree — the discriminator in " +
			"registeredAppGroups no longer matches anything, and this guard is inert")
	}

	inList := map[string]bool{}
	for _, a := range listed {
		inList[a] = true
	}
	inTree := map[string]bool{}
	for _, a := range registered {
		inTree[a] = true
	}

	for _, app := range registered {
		if !inList[app] {
			t.Errorf("app group %q is registered in the binary and MISSING from the "+
				"APPS tour in root.go.\nAn app nobody lists is an app nobody looks for. "+
				"Registered: %v\nListed: %v", app, registered, listed)
		}
	}
	for _, app := range listed {
		if !inTree[app] {
			t.Errorf("the APPS tour lists %q and the binary carries no such app group.\n"+
				"An agent sent at `bk %s …` gets `unknown command`. Registered: %v",
				app, app, registered)
		}
	}
}

// TestAppRosterGuardFires keeps both mutations the guard exists for in the
// suite, rather than as a note claiming they were tried once.
//
// The standing rule is that a check nobody has watched fail is not a check, and
// the specific trap here is the vacuous pass: this guard compares two sets it
// discovers, so either one coming back empty makes it agree with itself.
func TestAppRosterGuardFires(t *testing.T) {
	registered := registeredAppGroups(t)
	if len(registered) < 2 {
		t.Fatalf("expected several app groups, got %v", registered)
	}

	t.Run("a registered app missing from the tour is caught", func(t *testing.T) {
		long := "APPS — every app verb sits behind its app name:\n  issues      issue\n\nnext"
		section := appRosterSection(long)
		var listed []string
		for _, m := range appRosterRowRe.FindAllStringSubmatch(section, -1) {
			listed = append(listed, m[1])
		}
		if len(listed) != 1 || listed[0] != "issues" {
			t.Fatalf("parsed %v, expected exactly [issues]", listed)
		}
		// Every other registered app is absent from that one-row tour, which is
		// the failure the real test reports.
		missing := 0
		for _, a := range registered {
			if a != "issues" {
				missing++
			}
		}
		if missing == 0 {
			t.Fatal("no app would have been reported missing, so the real assertion " +
				"could not have fired")
		}
	})

	t.Run("a missing APPS header is caught rather than passing", func(t *testing.T) {
		if got := appRosterSection("no header here"); got != "" {
			t.Fatalf("expected an empty section for absent header, got %q", got)
		}
		// The real test t.Fatalf's on "" rather than parsing zero rows and
		// agreeing with itself. Asserted here because the difference between
		// those two behaviours is the whole of finding #6.
	})
}
