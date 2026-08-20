package commands

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// A SERVER `suggestion` MUST NAME A COMMAND THAT RUNS
// ---------------------------------------------------------------------------
// Every recoverable 4xx in this platform carries a `suggestion`, and the CLI
// prints it as its `hint:` line. It is the single most valuable sentence the
// server ever sends an agent: the difference between stopping and recovering.
//
// It is also written in TypeScript, about a Go binary, and nothing checked it.
// Four hints in `apps/books` named a recovery that could not be performed, and
// three were the SAME defect — a command spelled without a flag it requires:
//
//	bk books exercice create --year 2027        (--entity is required)
//	bk books exercice close --year 2024         (--entity is required)
//	"shorten the exercice first"                (no verb writes ends_on at all)
//
// An agent that pastes one of those gets `required flag(s) "entity" not set`
// and has learned nothing about its actual problem. This closes it: every
// `bk books …` spelling in that app's source is resolved against the real
// command tree, and its flags are checked against the real flag set.
//
// SCOPE: `apps/books` only, and deliberately. This is the app whose web surface
// writes nothing, so its hints are the whole recovery path. Widening it to the
// other two apps is one line in `hintScannedApps` and would be welcome — it is
// scoped narrowly because a guard nobody can read the failures of gets deleted.

var hintScannedApps = []string{"books"}

// A `bk <app> …` run inside a string. Stops at a quote, a backtick, a comma, a
// semicolon or a closing paren — the shapes that end a command in prose.
var hintRunRe = regexp.MustCompile("bk (?:books|issues|sales) [^`'\"\\n,;)]*")

// Tokens that mean "and the rest is left to you". A run ending in one of these
// is deliberately abbreviated and its required flags are not checked.
var hintAbbrev = []string{"…", "...", "<", "["}

type hintFinding struct {
	file, run, problem string
}

// hintRequiredFlags returns the names of cmd's flags marked required by cobra.
func hintRequiredFlags(cmd *cobra.Command) []string {
	var out []string
	cmd.Flags().VisitAll(func(f *pflag.Flag) {
		if ann, ok := f.Annotations[cobra.BashCompOneRequiredFlag]; ok &&
			len(ann) > 0 && ann[0] == "true" {
			out = append(out, f.Name)
		}
	})
	sort.Strings(out)
	return out
}

// hintSplitRun turns "bk books exercice close --year 2024" into its command
// path words and the set of flags it names.
func hintSplitRun(root *cobra.Command, run string) (cmd *cobra.Command, flags []string, pathWords int) {
	words := strings.Fields(run)
	if len(words) < 2 {
		return nil, nil, 0
	}
	rest := words[1:] // drop "bk"

	// Walk as far down the tree as the words go.
	cur := root
	for i, w := range rest {
		if strings.HasPrefix(w, "-") {
			pathWords = i
			break
		}
		next := helpChild(cur, w)
		if next == nil {
			pathWords = i
			break
		}
		cur = next
		pathWords = i + 1
	}
	if cur == root {
		return nil, nil, 0
	}
	for _, w := range rest {
		if strings.HasPrefix(w, "--") {
			flags = append(flags, strings.TrimPrefix(strings.TrimSuffix(w, ","), "--"))
		}
	}
	return cur, flags, pathWords
}

// hintStripComments blanks out `//` line comments and `/* */` blocks, leaving
// everything else at its original offset. It is not a TypeScript parser and does
// not need to be: a `bk books ...` run contains no `//` and no `/*`, so the only
// way this can be wrong is by stripping too little -- which costs a false
// positive and never a false negative.
func hintStripComments(src string) string {
	out := []byte(src)
	inLine, inBlock := false, false
	for i := 0; i < len(out); i++ {
		switch {
		case inLine:
			if out[i] == '\n' {
				inLine = false
			} else {
				out[i] = ' '
			}
		case inBlock:
			if out[i] == '*' && i+1 < len(out) && out[i+1] == '/' {
				out[i], out[i+1] = ' ', ' '
				i++
				inBlock = false
			} else if out[i] != '\n' {
				out[i] = ' '
			}
		case out[i] == '/' && i+1 < len(out) && out[i+1] == '/':
			inLine = true
			out[i] = ' '
		case out[i] == '/' && i+1 < len(out) && out[i+1] == '*':
			inBlock = true
			out[i], out[i+1] = ' ', ' '
			i++
		}
	}
	return string(out)
}

func hintFindings(t *testing.T) (findings []hintFinding, scanned int) {
	t.Helper()
	root := NewRoot()

	for _, app := range hintScannedApps {
		base := filepath.Join("..", "..", "..", "apps", app)
		_ = filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}
			name := info.Name()
			if !strings.HasSuffix(name, ".ts") && !strings.HasSuffix(name, ".tsx") {
				return nil
			}
			// Tests and fixtures state what a hint IS, not what it should be —
			// checking them would report the same finding twice.
			if strings.HasSuffix(name, ".test.ts") || strings.Contains(path, "/fixtures/") {
				return nil
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			// COMMENTS ARE NOT HINTS. This file's subject is the sentence the
			// SERVER sends, and a `bk books ...` inside a `//` or `/* */` block
			// is prose for a maintainer -- including repro notes that quote an
			// incomplete command deliberately. Leaving them in produced a false
			// positive on this guard's first run.
			for _, run := range hintRunRe.FindAllString(hintStripComments(string(src)), -1) {
				run = strings.TrimSpace(run)
				// A run carrying a template expression is only half written at
				// scan time (`--year ${x + 1}`); the flags are still real, the
				// values are not, so keep it and blank the expression.
				//
				// It is replaced with a WORD, not with `<v>`. The first version
				// used the angle-bracket form and every templated hint then
				// matched `hintAbbrev` and was skipped — including a live one
				// (`bk books exercice close --year ${y-1}`, missing --entity).
				// A guard that quietly excuses the commonest shape of the thing
				// it checks is the shape this repo keeps finding.
				clean := regexp.MustCompile(`\$\{[^}]*\}?`).ReplaceAllString(run, "TEMPLATED")
				scanned++

				cmd, flags, pathWords := hintSplitRun(root, clean)
				if cmd == nil {
					findings = append(findings, hintFinding{path, run,
						"names no command in this binary"})
					continue
				}
				// The words AFTER the resolved path and before any flag are
				// prose ("bk books analytique serves ..."), which is fine.
				_ = pathWords

				for _, f := range flags {
					if !helpKnownFlag(cmd, f) {
						findings = append(findings, hintFinding{path, run,
							"names --" + f + ", which " + cmd.CommandPath() + " does not accept"})
					}
				}

				// Required-flag check, skipped for a run that says it is
				// abbreviated and for one that names no flag at all (a bare
				// `bk books entity list` in prose is a reference, not a recipe).
				if len(flags) == 0 {
					continue
				}
				abbreviated := false
				for _, a := range hintAbbrev {
					if strings.Contains(clean, a) {
						abbreviated = true
					}
				}
				// `--help` short-circuits cobra's required-flag check, so
				// `bk books analyse record --help` is a correct thing to print
				// at somebody who does not know the flags yet — which is
				// exactly when a hint is useful.
				for _, f := range flags {
					if f == "help" {
						abbreviated = true
					}
				}
				if abbreviated {
					continue
				}
				have := map[string]bool{}
				for _, f := range flags {
					have[f] = true
				}
				for _, req := range hintRequiredFlags(cmd) {
					if !have[req] {
						findings = append(findings, hintFinding{path, run,
							"omits --" + req + ", which " + cmd.CommandPath() +
								" REQUIRES — pasted as printed it fails before it reaches the server"})
					}
				}
			}
			return nil
		})
	}
	sort.Slice(findings, func(i, j int) bool {
		return findings[i].file+findings[i].run < findings[j].file+findings[j].run
	})
	return
}

func TestServerHintsNameRunnableCommands(t *testing.T) {
	findings, scanned := hintFindings(t)

	// ASSERT THE INPUT. A walk that read no files, or a regex that matched no
	// runs, passes the loop below having checked nothing.
	if scanned < 40 {
		t.Fatalf("found only %d `bk <app> …` spellings in %v — the walk or the regex "+
			"is broken, not the hints", scanned, hintScannedApps)
	}

	if len(findings) > 0 {
		var lines []string
		for _, f := range findings {
			lines = append(lines, f.file+"\n      "+f.run+"\n      → "+f.problem)
		}
		t.Errorf("%d server hint(s) name a command that will not run as printed.\n"+
			"A hint is the difference between an agent recovering and an agent stopping; "+
			"one that fails argument parsing teaches it nothing about its actual problem.\n\n  %s",
			len(findings), strings.Join(lines, "\n  "))
	}
}

// THE STANDING RULE, kept in the suite. Both halves of the check are exercised
// against synthetic runs, so a regex or resolver that stops matching goes red
// here rather than leaving the real check green over an empty set.
func TestServerHintGuardFires(t *testing.T) {
	root := NewRoot()

	cases := []struct {
		run  string
		want string
	}{
		// A flag the command does not have.
		{"bk books exercice close --entity acme --yr 2024", "--yr"},
		// A required flag omitted — the shape that was live three times.
		{"bk books exercice create --year 2027", "--entity"},
		{"bk books opening set --balance 1020=1.00", "--entity"},
	}

	for _, tc := range cases {
		t.Run(tc.run, func(t *testing.T) {
			cmd, flags, _ := hintSplitRun(root, tc.run)
			if cmd == nil {
				t.Fatalf("%q resolved to no command — the resolver is broken", tc.run)
			}
			var problems []string
			for _, f := range flags {
				if !helpKnownFlag(cmd, f) {
					problems = append(problems, "--"+f)
				}
			}
			have := map[string]bool{}
			for _, f := range flags {
				have[f] = true
			}
			for _, req := range hintRequiredFlags(cmd) {
				if !have[req] {
					problems = append(problems, "--"+req)
				}
			}
			if !strings.Contains(strings.Join(problems, " "), tc.want) {
				t.Fatalf("the guard did not object to %q; problems found: %v", tc.run, problems)
			}
		})
	}

	// And the converse: a well-formed run must produce NO problem, or the cases
	// above are passing because the checker objects to everything.
	good := "bk books exercice create --entity acme --year 2027"
	cmd, flags, _ := hintSplitRun(root, good)
	if cmd == nil {
		t.Fatal("the resolver cannot resolve a correct command")
	}
	have := map[string]bool{}
	for _, f := range flags {
		have[f] = true
		if !helpKnownFlag(cmd, f) {
			t.Errorf("%q: --%s reported missing on a correct run", good, f)
		}
	}
	for _, req := range hintRequiredFlags(cmd) {
		if !have[req] {
			t.Errorf("%q: --%s reported omitted on a correct run", good, req)
		}
	}
}
