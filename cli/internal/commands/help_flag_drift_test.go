package commands

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// HELP TEXT MAY NOT NAME A FLAG THAT DOES NOT EXIST
// ---------------------------------------------------------------------------
// `guide_test.go` catches a guide topic that hardcodes a dynamic value. NOTHING
// caught a `Long:` describing a flag that had been renamed or removed — and
// help text is the easiest thing in this repo to write convincingly and never
// check, because a paragraph that reads well is indistinguishable from one that
// is true. An agent has only `--help`; a sentence naming `--rule` on a command
// whose real flag is `--rule-counterparty` costs it a failed call and a guess,
// and this CLI is the only door the product has.
//
// This walks every command in the binary and, for every `--flag` spelled in its
// Short, Long, Example or any of its own flags' usage strings, asserts the flag
// exists on the command the sentence is talking about.
//
// TWO THINGS MAKE IT WORK, and both came out of watching it go red:
//
//  1. ATTRIBUTION. A flag is checked against the command the sentence is about,
//     which is not always the command whose help it is. The rule is deliberately
//     conservative — only a CODE SPAN (backticks, a line of an Example block, or
//     a row of a group's prose command table) can move a flag off the owning
//     command. Prose that merely mentions a neighbour does not: "Run `bk meta`
//     for the values --ui-mode accepts" is about --ui-mode on the OWNER, and a
//     greedier first version of this file blamed `bk meta` for it.
//
//  2. NEGATIVE MENTIONS ARE INVERTED, NOT SKIPPED. This repo's help says things
//     like "There is no --status: a task's status is derived from its issues"
//     and "`bk sales prospect edit` refuses --stage". Skipping those would make
//     the guard blind to the more dangerous drift — a documented refusal that
//     stopped being true — so a negated mention asserts the flag is ABSENT and
//     goes red if somebody adds it without correcting the sentence.
//
// TestFlagDriftGuardFires below keeps the mutations IN the suite rather than
// performing them by hand once, so a later narrowing of the scanner goes red
// instead of the real check going quiet.
//
// Inherited flags count: `--json` is real on every command because the root
// declares it persistently.

// helpFlagMention is one `--flag` found in help text, with the command the
// sentence attributed it to and whether the sentence DENIED it.
type helpFlagMention struct {
	flag    string
	owner   *cobra.Command
	where   string
	line    string
	negated bool
}

var (
	// Deliberately narrow: a real long flag is lower-case kebab. This does not
	// match a bare `--`, an upper-case `--FOO`, or the hyphen in `2026-01-01`.
	helpFlagRe = regexp.MustCompile(`--[a-z][a-z0-9]*(?:-[a-z0-9]+)*`)
	// A code span: `like this`, or "like this" — this repo uses both to quote a
	// command ("bk sales prospect edit" refuses --stage).
	helpSpanRe = regexp.MustCompile("`[^`]+`|\"[^\"]+\"")
	// A row of a group's hand-written command table:
	//     entity     list, create      a book. Arrives with the PME chart in it
	helpTableRowRe = regexp.MustCompile(`^\s{2,}([a-z][a-z0-9-]*)\s\s+\S`)
	// The shapes this repo uses to say a flag is deliberately absent.
	// Deliberately NARROW. A first version matched any "no|not|without" within
	// forty characters and called "pass no --ws", "without --source", "--approve,
	// --reject, …" and "instead of opening a browser … --token" all negations —
	// eight false positives, every one of them a flag that exists. Only the
	// phrasings this repo actually uses to DENY a flag count, and they must sit
	// flush against it.
	helpNegBeforeRe = regexp.MustCompile(
		"(?i)(there is no|there's no|there are no|refuses|refuse) [`\"']?$")
	helpNegAfterRe = regexp.MustCompile(
		"^ (is NOT|is not a flag|is not here|does not exist|was removed)")
	// The app groups a `bk <app> …` placeholder can stand for.
	helpAppPlaceholders = []string{"books", "issues", "sales", "scaffold"}
)

// helpKnownFlag reports whether cmd accepts --name, counting inherited
// (persistent) flags.
func helpKnownFlag(cmd *cobra.Command, name string) bool {
	if name == "help" {
		return true // cobra adds it at render time on some paths
	}
	return cmd.Flags().Lookup(name) != nil ||
		cmd.InheritedFlags().Lookup(name) != nil ||
		cmd.PersistentFlags().Lookup(name) != nil
}

func helpChild(c *cobra.Command, w string) *cobra.Command {
	for _, sub := range c.Commands() {
		if !sub.IsAvailableCommand() {
			continue
		}
		if sub.Name() == w {
			return sub
		}
		for _, a := range sub.Aliases {
			if a == w {
				return sub
			}
		}
	}
	return nil
}

// helpDescend walks `words` down from `base`, stopping at the first word that
// is not a subcommand. It returns nil when the FIRST word matches nothing, so a
// span that merely starts with an English word resolves to no command.
func helpDescend(base *cobra.Command, words []string) *cobra.Command {
	c, _ := helpDescendN(base, words)
	return c
}

// helpDescendN also reports HOW MANY words matched, which is what tells a real
// `bk <app> activity` (two) from a table row whose verb that app does not serve
// (one — "books" matched, "activity" did not, and blaming `bk books` for the
// row's --since was the greedier version's last false positive).
func helpDescendN(base *cobra.Command, words []string) (*cobra.Command, int) {
	cur, matched := base, 0
	for _, w := range words {
		next := helpChild(cur, w)
		if next == nil {
			break
		}
		cur, matched = next, matched+1
	}
	if matched == 0 {
		return nil, 0
	}
	return cur, matched
}

// helpResolveSpan turns the leading words of a code span into the command it
// names, or nil. It accepts the three spellings this repo's help actually uses:
//
//	bk books source edit --draws-from     fully qualified
//	source edit --draws-from              relative, from inside the books tree
//	bk <app> activity --since             an app placeholder
func helpResolveSpan(root, owner *cobra.Command, span string) *cobra.Command {
	words := strings.Fields(strings.Trim(span, "`\""))
	if len(words) == 0 {
		return nil
	}
	if words[0] == "bk" {
		rest := words[1:]
		// `bk --version` is the ROOT carrying a flag, not a subcommand.
		if len(rest) == 0 || strings.HasPrefix(rest[0], "-") {
			return root
		}
		if rest[0] == "<app>" {
			for _, app := range helpAppPlaceholders {
				// Require the VERB to resolve too, not just the app segment.
				if c, n := helpDescendN(root, append([]string{app}, rest[1:]...)); n >= 2 {
					return c
				}
			}
			return nil
		}
		return helpDescend(root, rest)
	}
	// Relative: the owner's own subcommands first, then each ancestor's, so a
	// sibling named bare from inside a group resolves.
	for base := owner; base != nil; base = base.Parent() {
		if c := helpDescend(base, words); c != nil {
			return c
		}
	}
	return nil
}

// helpNegated reports whether the sentence around a flag at [start,end) denies
// the flag rather than describing it.
func helpNegated(line string, start, end int) bool {
	return helpNegBeforeRe.MatchString(line[:start]) || helpNegAfterRe.MatchString(line[end:])
}

// helpMentionsIn attributes every flag spelled in `text` to a command.
// `exampleLines` treats each line as one code span, which is what an Example
// block is.
func helpMentionsIn(root, owner *cobra.Command, where, text string, exampleLines bool) []helpFlagMention {
	var out []helpFlagMention

	type claim struct {
		lo, hi int
		cmd    *cobra.Command
	}

	for _, line := range strings.Split(text, "\n") {
		var claims []claim

		// A line that STARTS with `bk …` is a command line wherever it appears —
		// an Example block, a fenced snippet inside a Long, or a row of a group's
		// prose table ("bk sales metrics   how the last N days went (--period 30d)").
		// Without this the flags on such a line are blamed on the enclosing group,
		// which owns none of them: eleven of the first run's findings were this.
		if exampleLines || strings.HasPrefix(strings.TrimSpace(line), "bk ") {
			if c := helpResolveSpan(root, owner, strings.TrimSpace(line)); c != nil {
				claims = append(claims, claim{0, len(line), c})
			}
		}
		if !exampleLines {
			// A group's prose command table: the row's first word names a
			// child, and the rest of the row describes that child. Appended
			// FIRST, because a later claim wins and an explicit code span in
			// the row ("bk --version" too) is the more specific statement.
			if m := helpTableRowRe.FindStringSubmatchIndex(line); m != nil {
				if c := helpChild(owner, line[m[2]:m[3]]); c != nil {
					claims = append(claims, claim{m[3], len(line), c})
				}
			}
			for _, sp := range helpSpanRe.FindAllStringIndex(line, -1) {
				if c := helpResolveSpan(root, owner, line[sp[0]:sp[1]]); c != nil {
					claims = append(claims, claim{sp[0], sp[1], c})
				}
			}
		}

		for _, fm := range helpFlagRe.FindAllStringIndex(line, -1) {
			target := owner
			for _, cl := range claims {
				if fm[0] >= cl.lo && fm[1] <= cl.hi {
					target = cl.cmd
				}
			}
			out = append(out, helpFlagMention{
				flag:    strings.TrimPrefix(line[fm[0]:fm[1]], "--"),
				owner:   target,
				where:   where,
				line:    strings.TrimSpace(line),
				negated: helpNegated(line, fm[0], fm[1]),
			})
		}
	}
	return out
}

// helpCollectFlagMentions gathers every flag mention in the whole tree.
func helpCollectFlagMentions(root *cobra.Command) (mentions []helpFlagMention, commands int) {
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		commands++
		mentions = append(mentions, helpMentionsIn(root, c, "Short", c.Short, false)...)
		mentions = append(mentions, helpMentionsIn(root, c, "Long", c.Long, false)...)
		mentions = append(mentions, helpMentionsIn(root, c, "Example", c.Example, true)...)
		c.Flags().VisitAll(func(f *pflag.Flag) {
			mentions = append(mentions,
				helpMentionsIn(root, c, "usage of --"+f.Name, f.Usage, false)...)
		})
		for _, sub := range c.Commands() {
			if !sub.IsAvailableCommand() || sub.Name() == "help" || sub.Name() == "completion" {
				continue
			}
			walk(sub)
		}
	}
	walk(root)
	return
}

// helpFlagDriftFindings returns one human line per mention that disagrees with
// the binary. Shared by the real check and by the mutation test, so the two can
// never drift apart.
func helpFlagDriftFindings(root *cobra.Command) []string {
	mentions, _ := helpCollectFlagMentions(root)
	var bad []string
	for _, m := range mentions {
		exists := helpKnownFlag(m.owner, m.flag)
		switch {
		case !m.negated && !exists:
			bad = append(bad, fmt.Sprintf(
				"%s (%s) names --%s, which it does not accept\n      %s",
				m.owner.CommandPath(), m.where, m.flag, m.line))
		case m.negated && exists:
			bad = append(bad, fmt.Sprintf(
				"%s (%s) says --%s is absent, but it EXISTS\n      %s",
				m.owner.CommandPath(), m.where, m.flag, m.line))
		}
	}
	sort.Strings(bad)
	return bad
}

func TestHelpTextNeverNamesAFlagThatDoesNotExist(t *testing.T) {
	root := NewRoot()
	mentions, commands := helpCollectFlagMentions(root)

	// ASSERT THE INPUT (finding #5). A walk that found nothing passes every
	// check below, and this guard's whole value is that it keeps looking.
	if commands < 100 {
		t.Fatalf("walked only %d commands — the tree walk is broken, not the help text", commands)
	}
	if len(mentions) < 200 {
		t.Fatalf("found only %d flag mentions across %d commands — the scanner is broken, "+
			"not the help text", len(mentions), commands)
	}
	// And assert the NEGATED arm has subjects, or half this guard is inert
	// without ever saying so.
	var negs int
	for _, m := range mentions {
		if m.negated {
			negs++
		}
	}
	// 4 is what the tree carries today. The number is here so the NEGATED arm
	// cannot quietly become inert — a regex tightened until it matches nothing
	// leaves the "documented refusal that stopped being true" half of this guard
	// checking no subjects at all, which is finding #16's shape.
	if negs < 4 {
		t.Fatalf("only %d negated mentions found — the negation patterns match nothing, "+
			"so the 'documented refusal that stopped being true' arm is inert", negs)
	}

	if bad := helpFlagDriftFindings(root); len(bad) > 0 {
		t.Errorf("help text disagrees with the binary in %d place(s).\n"+
			"An agent has only --help; a flag named there and missing here is a failed call "+
			"and a guess.\n\n  %s", len(bad), strings.Join(bad, "\n  "))
	}
}

// ---------------------------------------------------------------------------
// AND THE GUARD ITSELF IS MUTATED, IN THE SUITE
// ---------------------------------------------------------------------------
// THE STANDING RULE: a check you have not watched fail is not a check. The
// three failure shapes this guard exists for are injected here and asserted to
// be caught — so a later narrowing of the scanner goes red HERE instead of
// leaving the real check green and blind.
func TestFlagDriftGuardFires(t *testing.T) {
	// The converse first, and it is the half that matters most: an UNMUTATED
	// tree must be clean, or every injection below is passing on pre-existing
	// noise and proves nothing about the injection.
	if bad := helpFlagDriftFindings(NewRoot()); len(bad) > 0 {
		t.Fatalf("the unmutated tree already has %d finding(s) — the injections below "+
			"cannot discriminate:\n  %s", len(bad), strings.Join(bad, "\n  "))
	}

	cases := []struct {
		name   string
		mutate func(t *testing.T, root *cobra.Command)
		want   string
	}{
		{
			// Shape 1: a command's own Long names a flag it does not have.
			// The rename-and-forget case.
			name: "own Long names a flag that was renamed away",
			mutate: func(t *testing.T, root *cobra.Command) {
				c, _, err := root.Find([]string{"books", "resolve"})
				if err != nil {
					t.Fatal(err)
				}
				c.Long += "\n\nPass --rule to teach one in a single call."
			},
			want: "bk books resolve (Long) names --rule, which it does not accept",
		},
		{
			// Shape 2: a hint spells ANOTHER command and hangs a flag off it
			// that the neighbour does not accept. Nobody proofreads this one,
			// because the sentence is about a command the reader is not on.
			name: "a spelled neighbour command gets a flag it lacks",
			mutate: func(t *testing.T, root *cobra.Command) {
				c, _, err := root.Find([]string{"books", "worklist"})
				if err != nil {
					t.Fatal(err)
				}
				c.Long += "\n\nWhen it is empty run `bk books entry post --dry-run` first."
			},
			want: "bk books entry post (Long) names --dry-run, which it does not accept",
		},
		{
			// Shape 3: a documented refusal that stopped being true. This is
			// the arm that skipping negatives would have thrown away.
			name: "a documented absence that is now present",
			mutate: func(t *testing.T, root *cobra.Command) {
				c, _, err := root.Find([]string{"books", "entry", "post"})
				if err != nil {
					t.Fatal(err)
				}
				c.Long += "\n\nThere is no --json here; posting prints one line."
			},
			want: "bk books entry post (Long) says --json is absent, but it EXISTS",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := NewRoot()
			tc.mutate(t, root)
			bad := helpFlagDriftFindings(root)
			var found bool
			for _, b := range bad {
				if strings.Contains(b, tc.want) {
					found = true
				}
			}
			if !found {
				t.Fatalf("the guard did NOT catch the injected drift.\nwanted a finding containing:\n  %s\ngot:\n  %s",
					tc.want, strings.Join(bad, "\n  "))
			}
			if len(bad) != 1 {
				t.Errorf("expected exactly the injected finding, got %d:\n  %s",
					len(bad), strings.Join(bad, "\n  "))
			}
		})
	}
}
