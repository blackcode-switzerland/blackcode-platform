package sales

import (
	"errors"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/spf13/cobra"
)

// BOTH SHAPES OF "WHICH PROSPECT" RESOLVE, AND A DISAGREEMENT IS AN ERROR.
//
// The positive cases come first and they assert the RESOLVED NUMBER, not that
// the call merely did not fail: a resolver that returned 0 for everything would
// satisfy "no error" and act on nothing (CLAUDE.md findings #16 and #21).

// ref builds a throwaway command carrying the flag, with argv parsed through
// pflag so the test sees what a real invocation produces.
func ref(t *testing.T, argv []string) (*cobra.Command, *int) {
	t.Helper()
	var prospect int
	cmd := &cobra.Command{Use: "thing <prospect>"}
	addProspectFlag(cmd, &prospect)
	if err := cmd.ParseFlags(argv); err != nil {
		t.Fatalf("%v: %v", argv, err)
	}
	return cmd, &prospect
}

func TestProspectResolvesFromEitherShape(t *testing.T) {
	cases := []struct {
		name      string
		argv      []string
		tailCount int
		want      int
		wantTail  []string
	}{
		{"positional, no tail", []string{"8"}, 0, 8, []string{}},
		{"flag, no tail", []string{"--prospect", "8"}, 0, 8, []string{}},
		{"positional, with a child id", []string{"8", "3"}, 1, 8, []string{"3"}},
		{"flag, with a child id", []string{"--prospect", "8", "3"}, 1, 8, []string{"3"}},
		// The exact shape the experience report dead-ended on: `comm log`'s
		// spelling carried over to an objection verb.
		{"the carried-over spelling", []string{"3", "--prospect", "8"}, 1, 8, []string{"3"}},
		// `prospect stage <n> <stage>` — the tail is not an id.
		{"flag, with a stage", []string{"--prospect", "8", "won"}, 1, 8, []string{"won"}},
		// Both given and agreeing is not an error; it is just redundant.
		{"both, agreeing", []string{"8", "--prospect", "8"}, 0, 8, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cmd, flag := ref(t, tc.argv)
			n, tail, err := resolveProspect(cmd, cmd.Flags().Args(), *flag, tc.tailCount)
			if err != nil {
				t.Fatalf("`bk sales thing %s`: %v", strings.Join(tc.argv, " "), err)
			}
			if n != tc.want {
				t.Errorf("resolved prospect #%d, want #%d", n, tc.want)
			}
			if strings.Join(tail, ",") != strings.Join(tc.wantTail, ",") {
				t.Errorf("tail = %q, want %q", tail, tc.wantTail)
			}
		})
	}
}

// A DISAGREEMENT IS REFUSED, AND THE MESSAGE NAMES BOTH VALUES.
//
// Silently preferring one would act on a record the caller did not name — which
// is the whole failure this file exists to avoid, and the one shape of it that
// no error message would ever surface.
func TestTwoDifferentProspectsAreRefused(t *testing.T) {
	cmd, flag := ref(t, []string{"8", "3", "--prospect", "9"})
	_, _, err := resolveProspect(cmd, cmd.Flags().Args(), *flag, 1)
	if err == nil {
		t.Fatal("`thing 8 3 --prospect 9` was accepted — one of the two prospects was silently preferred")
	}
	for _, want := range []string{"#8", "#9"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not name %s, so a caller cannot tell which half it got "+
				"wrong: %v", want, err)
		}
	}
}

// Neither shape given is a refusal that names BOTH spellings — a dead end that
// does not say its own exit is the thing `hintFor()` exists to prevent.
func TestAMissingProspectNamesBothSpellings(t *testing.T) {
	cmd, flag := ref(t, []string{"3"})
	_, _, err := resolveProspect(cmd, cmd.Flags().Args(), *flag, 1)
	if err == nil {
		t.Fatal("no prospect was given and the call succeeded")
	}
	if !strings.Contains(err.Error(), "--prospect") || !strings.Contains(err.Error(), "thing") {
		t.Errorf("the error names neither the flag nor the positional shape: %v", err)
	}
}

// A MISNAMED PROSPECT IS BAD USAGE (exit 2), NEVER A RUNTIME FAULT (exit 1).
//
// `cmd/bk/main.go` owns the exit-code table and classifies a `*cmdutil.UsageError`
// as 2. The rule it is an instance of is written down at that switch: a
// pre-check in the binary must exit the same code the server would — an agent
// branching on `$?` cannot write one recovery for a condition that returns two
// different codes depending on who caught it.
func TestProspectRefusalsAreUsageErrors(t *testing.T) {
	cases := map[string][]string{
		"two different prospects": {"8", "3", "--prospect", "9"},
		"neither shape given":     {"3"},
		"a nonsense --prospect":   {"3", "--prospect", "0"},
	}
	for name, argv := range cases {
		t.Run(name, func(t *testing.T) {
			cmd, flag := ref(t, argv)
			_, _, err := resolveProspect(cmd, cmd.Flags().Args(), *flag, 1)
			if err == nil {
				t.Fatalf("%v was accepted", argv)
			}
			var use *cmdutil.UsageError
			if !errors.As(err, &use) {
				t.Errorf("this exits 1 (runtime fault) rather than 2 (bad usage): %v", err)
			}
		})
	}
}

// EVERY COMMAND THAT TAKES A PROSPECT ACCEPTS BOTH SPELLINGS.
//
// The point of the change is consistency, so the guard has to be about the
// SURFACE rather than about one helper: a command added tomorrow that takes a
// prospect positionally and forgets the flag re-creates the exact friction this
// closed. The list is derived from `Use` rather than hand-written, so it cannot
// go stale by omission — a new `<prospect>` command joins it automatically.
func TestEveryProspectCommandAcceptsBothSpellings(t *testing.T) {
	var checked int
	var walk func(*cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			walk(sub)
		}
		if c.HasSubCommands() || !strings.Contains(c.Use, "<prospect>") {
			return
		}
		checked++
		if f := c.Flags().Lookup("prospect"); f == nil {
			t.Errorf("`bk sales %s` takes <prospect> positionally and has no --prospect, so the "+
				"spelling every ledger command uses dead-ends here", c.CommandPath())
		}
	}
	walk(NewGroup())

	// ASSERT THE INPUT: a walk that matched nothing would pass silently.
	if checked < 10 {
		t.Fatalf("only %d commands matched `<prospect>` in their Use line — the walk is not "+
			"finding the surface it is meant to check", checked)
	}
}

// ...AND THE OTHER DIRECTION, which the walk above cannot see.
//
// It sweeps commands whose CANONICAL shape is positional. The four whose
// canonical shape is the FLAG do not say `<prospect>` in their Use line, so
// nothing above would notice if one of them stopped accepting the positional —
// and that is half the change. They are listed by hand because a sweep over
// "has a --prospect flag" would also catch `doc add`, `doc link`, `doc list`,
// `meeting list` and `comm list`, where --prospect is a link target or a filter
// and a leading positional would mean nothing.
//
// `prospect next` and `prospect stage` are here for the same reason: their Use
// lines say `<n>`, not `<prospect>`, because under `bk sales prospect` the
// prospect IS the noun.
func TestTheFlagCanonicalCommandsAlsoTakeThePositional(t *testing.T) {
	for _, path := range []string{
		"comm log", "meeting schedule", "meeting log",
		"prospect next", "prospect stage",
	} {
		t.Run(path, func(t *testing.T) {
			cmd, _, err := NewGroup().Find(strings.Fields(path))
			if err != nil {
				t.Fatalf("`bk sales %s` does not resolve: %v — this list is stale", path, err)
			}
			if cmd.Flags().Lookup("prospect") == nil {
				t.Fatalf("`bk sales %s` has no --prospect at all", path)
			}
			// The positional form has to be ACCEPTED by the arg validator. A
			// command still on cobra.NoArgs/ExactArgs would refuse it before
			// resolveProspect ever ran, and every other assertion here would
			// still pass.
			tail := 0
			if path == "prospect stage" {
				tail = 1 // <stage>
			}
			args := make([]string, tail+1)
			for i := range args {
				args[i] = "8"
			}
			if err := cmd.Args(cmd, args); err != nil {
				t.Errorf("`bk sales %s` refuses the leading positional (%v), so the shape the "+
					"prospect-first families use dead-ends here: %v", path, args, err)
			}
		})
	}
}
