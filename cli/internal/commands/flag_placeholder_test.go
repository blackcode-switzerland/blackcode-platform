package commands

import (
	"strconv"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// A BACKQUOTE IN A FLAG'S USAGE STRING IS NOT MARKUP — IT RENAMES THE FLAG
// ---------------------------------------------------------------------------
// pflag's UnquoteUsage reads the FIRST backquoted word of a usage string as the
// flag's value placeholder, strips the backquotes from the rendered text, and
// prints the placeholder after the flag name. So this:
//
//	cmd.Flags().StringVar(&x, "body", "", "Alias for --description (`issue comment` calls it --body)")
//
// renders as:
//
//	--body issue comment        Alias for --description (issue comment calls it --body)
//
// A caller reading that sees a flag that takes two words, and one following the
// shape types `--body issue comment`. It is not cosmetic: the placeholder IS
// the type as far as `--help` is concerned, and it is the only type information
// the flag carries.
//
// WHY THIS TEST WALKS THE WHOLE BINARY.
//
// The same bug was found and fixed by hand in `sales` on 2026-08-12, and
// recurred in `issues` the next day, because that fix was manual and
// package-local and nothing held it. When it was finally swept on 2026-08-12 it
// was in SEVEN flags across FIVE packages — including `--app-server`, a
// PERSISTENT ROOT flag, which meant every `--help` screen in the binary rendered
// it wrong. Twice in two days in two packages is the argument for a guard
// rather than a third sweep.
//
// It asserts on pflag's own UnquoteUsage rather than grepping the source for
// backquotes: a backquote is legitimate in a usage string as long as it is not
// the FIRST one and does not wrap a phrase, and the source cannot tell the
// difference. This asks the renderer what it decided.
//
// WATCHED FAIL: reverting the seven fixes below makes this report all seven,
// each with the phrase it rendered — see report-phase-3.md.
func TestNoFlagUsageStringStealsThePlaceholder(t *testing.T) {
	root := NewRoot()

	var bad []string
	// LocalFlags() already includes the persistent flags declared on the same
	// command, and every app mounts the shared appverbs group — so the same
	// flag is reachable by more than one path. Report each one once.
	seen := map[string]bool{}
	check := func(path string, f *pflag.Flag) {
		if seen[path+" --"+f.Name] {
			return
		}
		seen[path+" --"+f.Name] = true
		name, _ := pflag.UnquoteUsage(f)
		// A multi-word placeholder can only come from a backquoted phrase:
		// pflag's own inferred placeholders are single tokens (string, int,
		// stringArray, …) and a bool's is empty.
		if strings.ContainsAny(name, " \t") {
			bad = append(bad, path+" --"+f.Name+"  →  placeholder "+strconv.Quote(name))
		}
	}

	var walk func(c *cobra.Command, path string)
	walk = func(c *cobra.Command, path string) {
		p := strings.TrimSpace(path + " " + c.Name())
		c.LocalFlags().VisitAll(func(f *pflag.Flag) { check(p, f) })
		c.PersistentFlags().VisitAll(func(f *pflag.Flag) { check(p, f) })
		for _, sub := range c.Commands() {
			walk(sub, p)
		}
	}
	walk(root, "")

	// Assert the instrument saw something. A walk that visited no flags at all
	// would report clean, which is the failure mode this whole file is about.
	if visited := countFlags(root); visited < 100 {
		t.Fatalf("walked only %d flags — the walk is broken, not the binary", visited)
	}

	if len(bad) > 0 {
		t.Errorf("%d flag(s) whose usage string steals the value placeholder.\n"+
			"A backquoted phrase in a usage string becomes the flag's rendered\n"+
			"argument name. Rephrase without backquotes, or backquote a single\n"+
			"word that IS the placeholder:\n  %s",
			len(bad), strings.Join(bad, "\n  "))
	}
}

func countFlags(root *cobra.Command) int {
	n := 0
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		c.LocalFlags().VisitAll(func(*pflag.Flag) { n++ })
		c.PersistentFlags().VisitAll(func(*pflag.Flag) { n++ })
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
	return n
}
