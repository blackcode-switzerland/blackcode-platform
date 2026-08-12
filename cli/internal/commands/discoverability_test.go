package commands

import (
	"bytes"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// `bk skill sync` AND `bk changelog` MUST BE FINDABLE WITHOUT A GUIDE TOPIC
// ---------------------------------------------------------------------------
// The 2026-08-12 report ran a full session across two apps and never learned
// that this binary can tell it when it is out of date:
//
//	"`bk skill sync` and `bk changelog` — found only now, while answering
//	 these questions."
//	"The discoverability path to `bk skill sync` is: bk guide → notice
//	 platform/staying-current → bk guide platform/staying-current → read.
//	 That is three commands and one read."
//
// Both commands were already in `bk --help`'s command list, so the fix was not
// "add them" — it was making the top-level text say WHEN to run them. Help text
// has no test unless someone writes one and it drifts silently, which is how
// the sales app ended up with 25 flags in two styles. This is that test.
//
// It asserts on the RENDERED help, not on the rootLong constant: the constant
// is not what a caller sees, and a change that stops rootLong reaching the
// screen is exactly the regression worth catching.
func renderHelp(t *testing.T, path ...string) string {
	t.Helper()
	// Through Execute, not c.Help(): cobra adds its `help` and `completion`
	// commands lazily inside ExecuteC, so a direct Help() call renders a list
	// two rows shorter than the one a caller sees. A count checked against the
	// short list would agree with itself and say nothing about the binary — an
	// instrument that cannot see the thing it is measuring.
	root := NewRoot()
	var buf bytes.Buffer
	root.SetOut(&buf)
	root.SetErr(&buf)
	root.SetArgs(append(append([]string{}, path...), "--help"))
	if err := root.Execute(); err != nil {
		t.Fatalf("bk %s --help failed: %v", strings.Join(path, " "), err)
	}
	return buf.String()
}

func TestTopLevelHelpNamesTheRecoveryLoop(t *testing.T) {
	help := renderHelp(t)
	for _, want := range []string{
		// The command itself, spelled the way it must be typed.
		"bk skill sync",
		"bk changelog",
		// And the trigger — a list of verbs is what the report scrolled past.
		"stops working",
	} {
		if !strings.Contains(help, want) {
			t.Errorf("`bk --help` never says %q — an agent that never fails will not learn it exists", want)
		}
	}
}

// One level down: the group help has to teach the loop too, because `bk skill
// --help` is where a caller who found `install` lands. The report understood
// `install` and never learned the other two existed.
func TestSkillHelpStatesWhenToRunEachVerb(t *testing.T) {
	help := renderHelp(t, "skill")
	for _, want := range []string{"install", "sync", "check", "exit 9"} {
		if !strings.Contains(help, want) {
			t.Errorf("`bk skill --help` never mentions %q", want)
		}
	}
	// The list of subcommands is not the thing under test — cobra prints that
	// for free, and printing it is what was already happening when the report
	// missed two of them. What must be present is the WHEN.
	if !strings.Contains(help, "THE LOOP") {
		t.Error("`bk skill --help` lists the verbs but never says when to run which")
	}
}

// ---------------------------------------------------------------------------
// EVERY COMMAND CARRIES A SUMMARY, AND IT SAYS SOMETHING THE NAME DOES NOT
// ---------------------------------------------------------------------------
// The report skipped `bk sales pipeline` as "probably a view", never ran it,
// and filed it as a missing feature. (That specific summary turned out to be
// fine — see report-phase-1.md — but the class of failure is real, and nothing
// stopped the next command from shipping without one.)
//
// Mechanical, deliberately: a checker cannot judge whether prose is useful. It
// can catch the two shapes that are never useful — an empty summary, and one
// that only restates the command's own name.
func TestEveryCommandHasASummaryThatIsNotItsOwnName(t *testing.T) {
	var checked int
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			if !sub.IsAvailableCommand() || sub.Name() == "help" || sub.Name() == "completion" {
				continue
			}
			checked++
			short := strings.TrimSpace(sub.Short)
			switch {
			case short == "":
				t.Errorf("%s has no summary — its line in the parent's help is a bare name",
					sub.CommandPath())
			case strings.EqualFold(short, sub.Name()):
				t.Errorf("%s summarises itself as %q, which the reader already knows",
					sub.CommandPath(), short)
			case len(short) > 90:
				// One line, no wrapping: cobra pads to the longest name and a long
				// Short wraps into the next command's column.
				t.Errorf("%s has a %d-character summary; it wraps in the parent's help:\n  %s",
					sub.CommandPath(), len(short), short)
			}
			walk(sub)
		}
	}
	walk(NewRoot())
	// ASSERT THE INPUT. A walk that found nothing passes every check above.
	if checked < 100 {
		t.Fatalf("only walked %d commands — the tree walk is broken, not the summaries", checked)
	}
}

// ---------------------------------------------------------------------------
// THE COMMAND-COUNT HEADING (§3)
// ---------------------------------------------------------------------------
// helptemplate.go patches cobra's own usage template instead of replacing it,
// which means a cobra release that rewords "Available Commands:" turns the
// patch into a silent no-op. That is a green-but-inert guard in template form,
// so the substitution is never trusted: this asserts the RENDERED help.
//
// And it checks the number AGAINST THE ROWS, not against a constant. A count
// that is merely present can be wrong, and a heading that disagrees with the
// list under it is worse than no heading at all.
func TestGroupHelpCountsTheCommandsItLists(t *testing.T) {
	for _, path := range [][]string{
		nil,
		{"issues", "issue"},
		{"sales", "prospect"},
		{"skill"},
	} {
		name := "bk " + strings.Join(path, " ")
		t.Run(strings.TrimSpace(name), func(t *testing.T) {
			help := renderHelp(t, path...)
			m := regexp.MustCompile(`Available Commands \((\d+)\):\n((?:  \S.*\n)+)`).FindStringSubmatch(help)
			if m == nil {
				t.Fatalf("%s --help has no counted `Available Commands (n):` heading:\n%s", name, help)
			}
			claimed, err := strconv.Atoi(m[1])
			if err != nil {
				t.Fatal(err)
			}
			rows := len(strings.Split(strings.TrimRight(m[2], "\n"), "\n"))
			if claimed != rows {
				t.Errorf("%s --help says (%d) and lists %d commands", name, claimed, rows)
			}
			if rows < 2 {
				t.Errorf("%s --help listed %d rows — this case cannot tell a right count from a wrong one",
					name, rows)
			}
		})
	}
}
