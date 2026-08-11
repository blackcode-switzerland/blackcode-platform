package commands

import (
	"io"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// groupPaths returns the argv path of every command GROUP in the tree — a
// command that has subcommands, i.e. one a user can mistype a subcommand under.
// The root itself is included: `bk notacmd` must fail too.
func groupPaths(cmd *cobra.Command, prefix []string) [][]string {
	var out [][]string
	if !cmd.HasSubCommands() {
		return out
	}
	out = append(out, prefix)
	for _, sub := range cmd.Commands() {
		if sub.Name() == "help" || sub.Name() == "completion" {
			continue // cobra's own, and they take arbitrary args by design
		}
		out = append(out, groupPaths(sub, append(append([]string{}, prefix...), sub.Name()))...)
	}
	return out
}

// An unknown subcommand must be an ERROR, not a silent help-and-exit-0.
//
// Cobra's default for a group is to print help and return nil, which an agent
// branching on exit codes reads as success — and which makes main.go's
// "unknown command" deprecation hint unreachable. rejectUnknownSubcommands() in
// root.go fixes it; this asserts it stays fixed for every group, including ones
// added later.
func TestUnknownSubcommandIsAnError(t *testing.T) {
	const bogus = "definitely-not-a-real-command"

	for _, path := range groupPaths(NewRoot(), nil) {
		argv := append(append([]string{}, path...), bogus)
		name := "bk"
		if len(path) > 0 {
			name = "bk " + strings.Join(path, " ")
		}

		t.Run(name, func(t *testing.T) {
			// A fresh tree per case: Execute() mutates command state.
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(argv)

			err := root.Execute()
			if err == nil {
				t.Fatalf("`%s %s` returned no error — a mistyped subcommand would exit 0", name, bogus)
			}
			if !strings.Contains(err.Error(), "unknown command") {
				t.Fatalf("`%s %s` failed with %q; want an \"unknown command\" error so "+
					"main.go can classify it as usage (exit 2) and offer a deprecation hint",
					name, bogus, err)
			}
		})
	}
}

// A SYNONYM MUST RESOLVE, NOT MERELY FAIL HELPFULLY.
//
// The misses that actually happen between these two apps are synonyms, not
// typos — `bk sales prospect view` (it is `show`), `bk sales meeting delete`
// (it is `rm`), `bk issues issue show` (it is `view`). Cobra's "Did you mean…"
// cannot help twice over: rejectUnknownSubcommands builds the error itself so
// the suggestion pass never runs, and Levenshtein scores view→show at 4 anyway.
//
// This test asserted the ERROR named the right sibling until 2026-08-11, which
// was the best available answer while a guess had to fail. It does not have to:
// attachVerbSynonyms gives each leaf the other spellings of its own verb, so
// these now run. Each case asserts the guess lands on the command that OWNS the
// operation — resolving to something is not the property; resolving to the
// right thing is.
func TestVerbSynonymsResolveToTheRightCommand(t *testing.T) {
	cases := []struct {
		argv      []string
		canonical string // the command the guess must land on
	}{
		{[]string{"sales", "prospect", "view"}, "show"},
		{[]string{"sales", "prospect", "get"}, "show"},
		{[]string{"sales", "contact", "create"}, "add"},
		{[]string{"sales", "doc", "delete"}, "rm"},
		{[]string{"issues", "issue", "show"}, "view"},
		{[]string{"issues", "issue", "get"}, "view"},
		{[]string{"issues", "project", "rm"}, "delete"},
		{[]string{"issues", "issue", "update"}, "edit"},
		{[]string{"issues", "issue", "ls"}, "list"},
	}

	for _, tc := range cases {
		name := "bk " + strings.Join(tc.argv, " ")
		t.Run(name, func(t *testing.T) {
			cmd, _, err := NewRoot().Find(tc.argv)
			if err != nil {
				t.Fatalf("`%s` does not resolve: %v — an agent that learned the other "+
					"app's spelling still dead-ends", name, err)
			}
			if cmd.Name() != tc.canonical {
				t.Fatalf("`%s` resolved to %q, want %q — a synonym that lands on the "+
					"WRONG command is worse than one that fails", name, cmd.Name(), tc.canonical)
			}
		})
	}
}

// A NAME A SIBLING ALREADY OWNS IS NEVER REASSIGNED — proven on a CONSTRUCTED
// group, because the real tree cannot currently prove it.
//
// This is the risk attachVerbSynonyms creates and the reason it is worth a test
// of its own: an alias that shadows a real sibling silently runs a command the
// caller did not ask for, and for `rm`/`delete` that is a destructive one.
//
// The walk over the live tree (below) was written first and is NOT sufficient.
// Deleting the collision check from attachVerbSynonyms leaves it GREEN, because
// no group in this binary today contains two commands from the same synonym
// family — `bk sales meeting` has `rm` but no `delete`, `bk issues workspace`
// has `show` but no `view`. The guard was inert against the only mutation that
// matters, which is the defect CLAUDE.md's table is a list of. So the property
// is asserted here on a group built to contain the collision, where it holds
// whatever the command inventory happens to look like; the live walk stays as
// the regression check for the day someone adds `meeting delete` beside `rm`.
func TestSynonymsYieldToAnExistingCommand(t *testing.T) {
	// `rm` and `delete` are the same operation and BOTH exist here — exactly the
	// shape that arrives the first time someone adds the other spelling.
	group := &cobra.Command{Use: "widget"}
	rm := &cobra.Command{Use: "rm", Run: func(*cobra.Command, []string) {}}
	del := &cobra.Command{Use: "delete", Run: func(*cobra.Command, []string) {}}
	show := &cobra.Command{Use: "show", Run: func(*cobra.Command, []string) {}}
	view := &cobra.Command{Use: "view", Run: func(*cobra.Command, []string) {}}
	group.AddCommand(rm, del, show, view)

	attachVerbSynonyms(group)

	for _, c := range []*cobra.Command{rm, del, show, view} {
		for _, alias := range c.Aliases {
			for _, sibling := range []*cobra.Command{rm, del, show, view} {
				if alias == sibling.Name() && sibling != c {
					t.Fatalf("`widget %s` took %q as an alias, but %q is a real command "+
						"in the same group — a caller asking for %q would run %q instead",
						c.Name(), alias, sibling.Name(), sibling.Name(), c.Name())
				}
			}
		}
	}

	// And the resolution itself, which is what a caller actually experiences.
	for _, name := range []string{"rm", "delete", "show", "view"} {
		got, _, err := group.Find([]string{name})
		if err != nil {
			t.Fatalf("`widget %s` does not resolve: %v", name, err)
		}
		if got.Name() != name {
			t.Fatalf("`widget %s` resolved to %q — an alias shadowed the real command",
				name, got.Name())
		}
	}
}

// The same property swept over the LIVE tree. Today this cannot fail on its own
// (see above); it is here so that it starts being able to the moment the
// command inventory grows a colliding pair.
func TestSynonymsNeverShadowARealCommand(t *testing.T) {
	var walk func(c *cobra.Command)
	checked := 0
	walk = func(c *cobra.Command) {
		names := map[string]string{} // spelling -> the command that owns it
		for _, sub := range c.Commands() {
			names[sub.Name()] = sub.Name()
		}
		for _, sub := range c.Commands() {
			for _, alias := range sub.Aliases {
				if owner, taken := names[alias]; taken && owner != sub.Name() {
					t.Errorf("`%s %s` is an alias of %q but %q is a real command in that "+
						"group — the alias shadows it", c.CommandPath(), alias, sub.Name(), owner)
				}
				checked++
			}
			walk(sub)
		}
	}
	walk(NewRoot())

	// ASSERT THE INPUT. With no aliases attached at all the loop above passes
	// vacuously, which is exactly how a guard that stopped guarding looks.
	if checked == 0 {
		t.Fatal("no aliases found anywhere in the tree — attachVerbSynonyms did not run, " +
			"and every assertion above was vacuous")
	}
}

// The unknown-subcommand error must still NAME THE VALID ONES for a miss that is
// not a synonym — a genuine typo, or a verb this group simply does not have.
func TestUnknownSubcommandNamesTheValidOnes(t *testing.T) {
	cases := []struct {
		argv []string
		want []string // real siblings the error must name
	}{
		{[]string{"sales", "prospect", "escalate"}, []string{"stage", "assign", "next"}},
		{[]string{"issues", "issue", "reopen"}, []string{"edit", "comment", "assign"}},
	}

	for _, tc := range cases {
		name := "bk " + strings.Join(tc.argv, " ")
		t.Run(name, func(t *testing.T) {
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(tc.argv)

			err := root.Execute()
			if err == nil {
				t.Fatalf("`%s` returned no error", name)
			}
			// SEVERAL real siblings, not one: an error that happened to contain a
			// single short word would pass while listing nothing useful.
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("`%s` failed with %q; it does not name the real sibling %q — "+
						"the caller has to make a second call to find out what exists",
						name, err, want)
				}
			}
		})
	}
}

// A group invoked with no arguments is a legitimate "what can this do?" — it
// must print help and succeed, not error.
func TestGroupWithNoArgsSucceeds(t *testing.T) {
	for _, path := range groupPaths(NewRoot(), nil) {
		if len(path) == 0 {
			continue // bare `bk` is covered by cobra's own root help
		}
		name := "bk " + strings.Join(path, " ")

		t.Run(name, func(t *testing.T) {
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(path)

			if err := root.Execute(); err != nil {
				t.Fatalf("`%s` with no args returned %q; want help + success", name, err)
			}
		})
	}
}
