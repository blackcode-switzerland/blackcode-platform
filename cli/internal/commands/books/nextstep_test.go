package books

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// EVERY WRITE ENDS WITH A NEXT STEP
// ---------------------------------------------------------------------------
// The nextstep.go header says why. This is the part that keeps it true.
//
// A write that succeeds silently is not an error and never will be — it is an
// agent that stops one step early and reports the work as done, and nothing in
// the suite can see that from the outside. So it is checked from the INSIDE: a
// command whose `routes` annotation carries a POST, PATCH, PUT or DELETE must
// call `nextStep` somewhere in the function that builds it.
//
// This is a source-level check, and that is a deliberate trade. It cannot tell
// a good next step from a bad one — only `--help` read against a real run can,
// which is what the phase-8 cold run was for. What it CAN do is notice a write
// that was added later and never given one, which is exactly how the first
// twenty-two came to be missing.
//
// The declared exemption list is empty on purpose. If a write ever genuinely
// has nothing to say next, add it here WITH ITS REASON — the same rule
// EXCLUDED_PATHS follows in cli-parity. A silent write with no recorded reason
// is the bug.
var nextStepExempt = map[string]string{
	// "newFooCmd": "reason this write has no next step",
}

var writeMethods = []string{"POST ", "PATCH ", "PUT ", "DELETE "}

// booksCommandFuncs parses this package and returns, per `newXxxCmd` function,
// the routes annotation it declares and whether its body calls nextStep.
func booksCommandFuncs(t *testing.T) (routes map[string]string, callsNextStep map[string]bool) {
	t.Helper()
	routes, callsNextStep = map[string]string{}, map[string]bool{}

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		file, err := parser.ParseFile(fset, f, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil || !strings.HasPrefix(fn.Name.Name, "new") {
				continue
			}
			name := fn.Name.Name
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.CallExpr:
					if id, ok := x.Fun.(*ast.Ident); ok && id.Name == "nextStep" {
						callsNextStep[name] = true
					}
				case *ast.KeyValueExpr:
					// Annotations: map[string]string{"routes": "POST /api/…"}
					if k, ok := x.Key.(*ast.BasicLit); ok && k.Kind == token.STRING &&
						strings.Trim(k.Value, `"`) == "routes" {
						if v, ok := x.Value.(*ast.BasicLit); ok && v.Kind == token.STRING {
							routes[name] = strings.Trim(v.Value, `"`)
						}
					}
				}
				return true
			})
		}
	}
	return
}

// booksWriteCommands is the subject list, shared by the check and its mutation.
func booksWriteCommands(t *testing.T) (writes []string, callsNextStep map[string]bool) {
	t.Helper()
	routes, calls := booksCommandFuncs(t)
	for fn, r := range routes {
		for _, m := range writeMethods {
			if strings.Contains(r, m) {
				writes = append(writes, fn)
				break
			}
		}
	}
	sort.Strings(writes)
	return writes, calls
}

func TestEveryBooksWritePrintsANextStep(t *testing.T) {
	writes, calls := booksWriteCommands(t)

	// ASSERT THE INPUT. A parser that found no commands, or a glob that read no
	// files, passes the loop below without checking anything — finding #5.
	if len(writes) < 20 {
		t.Fatalf("found only %d write commands in this package — the AST walk is broken, "+
			"not the commands (25 is the count as of 2026-08-20)", len(writes))
	}

	var silent []string
	for _, fn := range writes {
		if calls[fn] {
			continue
		}
		if reason, ok := nextStepExempt[fn]; ok {
			t.Logf("%s is exempt: %s", fn, reason)
			continue
		}
		silent = append(silent, fn)
	}
	if len(silent) > 0 {
		t.Errorf("%d write command(s) succeed without telling the caller what to do next:\n  %s\n\n"+
			"Bookkeeping is a chain — a source with no import has produced nothing, an "+
			"unmatched pièce is evidence attached to nothing, a staged entry is money nobody "+
			"has judged. Each of those reads exactly like a finished state.\n"+
			"Call nextStep() with a runnable command, or add the function to nextStepExempt "+
			"WITH its reason.", len(silent), strings.Join(silent, "\n  "))
	}
}

// THE STANDING RULE. The mutation lives in the suite: if the AST walk is ever
// broken so that it finds no nextStep calls (a renamed helper, a changed call
// shape, a glob that stops reading a file), this goes red instead of the check
// above going quiet and green.
func TestNextStepGuardFires(t *testing.T) {
	writes, calls := booksWriteCommands(t)

	// Shape 1: the helper is renamed or the call removed — every write looks
	// silent. This is what a broken scanner ALSO looks like, which is the point:
	// the check above cannot distinguish them, so this one asserts the scanner
	// currently sees them.
	var seen int
	for _, fn := range writes {
		if calls[fn] {
			seen++
		}
	}
	if seen == 0 {
		t.Fatal("the AST walk sees no nextStep() call on any write command — " +
			"the scanner is broken, and TestEveryBooksWritePrintsANextStep would be " +
			"reporting every command as silent rather than reporting nothing")
	}

	// Shape 2: a write command that has no next step must be CAUGHT. Injected by
	// pretending one of the real ones does not call the helper.
	victim := writes[0]
	mutated := map[string]bool{}
	for k, v := range calls {
		mutated[k] = v
	}
	delete(mutated, victim)

	var silent []string
	for _, fn := range writes {
		if !mutated[fn] {
			silent = append(silent, fn)
		}
	}
	if len(silent) != 1 || silent[0] != victim {
		t.Fatalf("removing %s's next step should leave exactly it reported; got %v", victim, silent)
	}
}
