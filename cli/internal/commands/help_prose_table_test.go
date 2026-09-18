package commands

import (
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// A HAND-WRITTEN COMMAND TABLE MUST LIST THE COMMANDS THAT EXIST
// ---------------------------------------------------------------------------
// `bk books --help` opens with a hand-written tour of the product:
//
//	bk books entity     list, create      a book. Arrives with the PME chart in it
//	bk books entry      list, show        the grand livre
//
// It is the first thing an agent reads and the only place the verbs are grouped
// by what they are FOR, so it is worth having. It is also a copy of a fact that
// lives in the command tree, and this repo has been bitten by exactly that
// before — the same text carried a "not here yet" list naming `analyse` and
// `tax` months after both shipped, found on 2026-08-20 by an agent that read the
// help and believed it. The paragraph under the table now apologises for that
// and says "where it and this prose disagree, the table is right", which is an
// honest disclaimer and no protection at all: the reader has already read the
// wrong line by then.
//
// So the prose is checked against the tree. For every row naming a GROUP, the
// verbs listed across the whole text must be exactly the verbs that group has —
// missing one hides a capability (`bk books entry` listed "list, show" while
// `declare` and `post`, the two WRITES, existed and were unnamed), and naming
// one that is gone sends an agent at a command that will not run.
//
// TestProseCommandTableGuardFires below keeps both mutations in the suite.

// proseRowRe matches a row of the table: two-space indent, the command path,
// then either a verb list or nothing, then the description.
//
// A verb list is comma-separated lower-case words in the SECOND column. The
// description column is separated by two or more spaces, which is what lets a
// row with no verbs ("bk books bilan      balance sheet, art. 959a") be told
// from one with them — otherwise "balance sheet, art" reads as a verb list.
//
// A row may also END after its verbs, with no description — b/billing's tour
// is written that way. The first version required a description, so its
// trailing `\s{2,}\S` swallowed the newline and the next row's indent, and
// only every other row of such a table was read (found 2026-09-18: one of
// billing's three rows). Whitespace inside a row is `[ \t]` for that reason:
// a row never continues onto the next line. And the space belongs BEFORE each
// word of the command, not after it: `bk (?:word )+?` spent one of the two
// spaces between `bk billing workspace` and its verbs, so a row padded with
// exactly two was never matched at all.
var proseRowRe = regexp.MustCompile(
	`(?m)^  (bk(?: [a-z][a-z0-9-]*)+?)[ \t]{2,}(?:([a-z][a-z0-9-]*(?:, [a-z][a-z0-9-]*)*)(?:[ \t]{2,}|[ \t]*$))?(?:\S|$)`)

// proseTableClaims reads a Long and returns, per command path, the union of the
// verbs the prose claims that command has. A path claiming no verbs maps to an
// empty (non-nil) slice, which means "this is named as a leaf".
func proseTableClaims(root *cobra.Command, long string) (map[string][]string, error) {
	claims := map[string][]string{}
	for _, m := range proseRowRe.FindAllStringSubmatch(long, -1) {
		path := strings.Fields(m[1])
		cmd := helpDescend(root, path[1:]) // drop the leading "bk"
		if cmd == nil {
			continue
		}
		key := cmd.CommandPath()
		if _, ok := claims[key]; !ok {
			claims[key] = []string{}
		}
		if m[2] != "" {
			for _, v := range strings.Split(m[2], ",") {
				claims[key] = append(claims[key], strings.TrimSpace(v))
			}
		}
	}
	return claims, nil
}

func actualVerbs(c *cobra.Command) []string {
	var out []string
	for _, sub := range c.Commands() {
		if !sub.IsAvailableCommand() || sub.Name() == "help" || sub.Name() == "completion" {
			continue
		}
		out = append(out, sub.Name())
	}
	sort.Strings(out)
	return out
}

// proseTableFindings is shared by the real check and the mutation test.
func proseTableFindings(root *cobra.Command, group *cobra.Command) []string {
	claims, _ := proseTableClaims(root, group.Long)
	var bad []string
	for path, listed := range claims {
		cmd, _, err := root.Find(strings.Fields(path)[1:])
		if err != nil || cmd == nil {
			continue
		}
		have := actualVerbs(cmd)
		if len(have) == 0 {
			// A leaf named in the table. The prose must not hang verbs off it.
			if len(listed) > 0 {
				bad = append(bad, path+" is a leaf command, but the table lists verbs on it: "+
					strings.Join(listed, ", "))
			}
			continue
		}
		if len(listed) == 0 {
			bad = append(bad, path+" is a GROUP with "+strings.Join(have, ", ")+
				", but the table names none of them")
			continue
		}
		sorted := append([]string{}, listed...)
		sort.Strings(sorted)
		haveSet := map[string]bool{}
		for _, v := range have {
			haveSet[v] = true
		}
		listedSet := map[string]bool{}
		for _, v := range sorted {
			listedSet[v] = true
		}
		var missing, ghost []string
		for _, v := range have {
			if !listedSet[v] {
				missing = append(missing, v)
			}
		}
		for _, v := range sorted {
			if !haveSet[v] {
				ghost = append(ghost, v)
			}
		}
		if len(missing) > 0 {
			bad = append(bad, path+" has "+strings.Join(missing, ", ")+
				" — the table never names "+pluralIsAre(missing)+" (listed: "+strings.Join(listed, ", ")+")")
		}
		if len(ghost) > 0 {
			bad = append(bad, path+": the table names "+strings.Join(ghost, ", ")+
				", which the binary does not carry")
		}
	}
	sort.Strings(bad)
	return bad
}

// verbRowFindings drops the one finding a noun-and-description tour produces
// by design: a group named with no verbs listed.
func verbRowFindings(bad []string) []string {
	var out []string
	for _, b := range bad {
		if strings.Contains(b, "but the table names none of them") {
			continue
		}
		out = append(out, b)
	}
	return out
}

func pluralIsAre(v []string) string {
	if len(v) == 1 {
		return "it"
	}
	return "them"
}

func TestBooksProseCommandTableMatchesTheTree(t *testing.T) {
	root := NewRoot()
	group, _, err := root.Find([]string{"books"})
	if err != nil {
		t.Fatal(err)
	}

	// ASSERT THE INPUT. A regex that matched nothing would pass every check
	// below while reading none of the table — finding #5's shape.
	claims, _ := proseTableClaims(root, group.Long)
	if len(claims) < 15 {
		t.Fatalf("the row regex found only %d command rows in `bk books --help`'s prose — "+
			"the scanner is broken, not the table", len(claims))
	}
	var withVerbs int
	for _, v := range claims {
		if len(v) > 0 {
			withVerbs++
		}
	}
	if withVerbs < 10 {
		t.Fatalf("only %d rows parsed a verb list — the second-column split is broken, "+
			"so the check below compares empty sets", withVerbs)
	}

	if bad := proseTableFindings(root, group); len(bad) > 0 {
		t.Errorf("`bk books --help`'s hand-written table disagrees with the binary in %d place(s).\n"+
			"It is the first thing an agent reads; a verb it never names is a capability "+
			"that agent will report as missing.\n\n  %s", len(bad), strings.Join(bad, "\n  "))
	}
}

// Every OTHER top-level group that carries a prose tour, found by reading the
// tree.
//
// The books check above was written for books, and b/billing's `--help` grew a
// tour of its own (workspace, member, invite) that nothing checked. Adding a
// "billing" copy of the books test would be finding #22's shape exactly: a
// per-app list a new app must OPT INTO, whose coverage silently shrinks every
// time the platform grows. So this one walks `bk`'s top-level groups and checks
// whichever of them have a tour — an app added tomorrow is covered the moment
// its help grows a table. (2026-09-18.)
//
// ── LESS STRICT THAN THE BOOKS CHECK, ON PURPOSE ──────────────────────────
// `bk issues` and `bk sales` write their tours as a noun and a description,
// with no verbs ("bk sales prospect   the deal"). The books rule — a group
// named without its verbs is a finding — reported nineteen "disagreements" in
// those two on its first run, every one of them a tour written in that other
// style rather than a tour gone stale. So here only a row that LISTS verbs is
// held to them: every verb it names must exist, and it must name them all.
// That is the half that catches a tour advertising a command the binary does
// not carry, which is what finding #23 was.
func TestEveryAppsProseCommandTableMatchesTheTree(t *testing.T) {
	root := NewRoot()
	checked := map[string]int{}
	for _, group := range root.Commands() {
		if group.Name() == "books" || !group.HasAvailableSubCommands() {
			continue // books has its own, stricter check above
		}
		claims, _ := proseTableClaims(root, group.Long)
		if len(claims) == 0 {
			continue
		}
		checked[group.Name()] = len(claims)
		if bad := verbRowFindings(proseTableFindings(root, group)); len(bad) > 0 {
			t.Errorf("`bk %s --help`'s hand-written table disagrees with the binary in %d place(s):\n  %s",
				group.Name(), len(bad), strings.Join(bad, "\n  "))
		}
	}
	// ASSERT THE INPUT: billing's tour has three rows today. A scan that found no
	// tour anywhere would pass the loop above while checking nothing.
	if checked["billing"] < 3 {
		t.Fatalf("expected `bk billing --help`'s tour (workspace, member, invite) to be read; "+
			"found tours in: %v", checked)
	}
}

// The standing rule, kept in the suite rather than performed once by hand.
func TestProseCommandTableGuardFires(t *testing.T) {
	if bad := proseTableFindings(NewRoot(), mustFind(t, NewRoot(), "books")); len(bad) > 0 {
		t.Fatalf("the unmutated table already fails — the injections cannot discriminate:\n  %s",
			strings.Join(bad, "\n  "))
	}

	t.Run("a verb the table stops naming", func(t *testing.T) {
		root := NewRoot()
		g := mustFind(t, root, "books")
		// Drop `post` from the row that lists the entry verbs.
		g.Long = strings.Replace(g.Long,
			"list, show, declare, post", "list, show, declare", 1)
		bad := proseTableFindings(root, g)
		if !containsSub(bad, "bk books entry has post") {
			t.Fatalf("removing `post` from the table was not caught; got:\n  %s", strings.Join(bad, "\n  "))
		}
	})

	t.Run("a verb the table invents", func(t *testing.T) {
		root := NewRoot()
		g := mustFind(t, root, "books")
		g.Long = strings.Replace(g.Long,
			"list, show, declare, post", "list, show, declare, post, unpost", 1)
		bad := proseTableFindings(root, g)
		if !containsSub(bad, "the table names unpost") {
			t.Fatalf("an invented verb was not caught; got:\n  %s", strings.Join(bad, "\n  "))
		}
	})
}

func mustFind(t *testing.T, root *cobra.Command, path ...string) *cobra.Command {
	t.Helper()
	c, _, err := root.Find(path)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func containsSub(hay []string, needle string) bool {
	for _, h := range hay {
		if strings.Contains(h, needle) {
			return true
		}
	}
	return false
}
