package billing

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// EVERY WRITE COMMAND ENDS WITH A RUNNABLE NEXT STEP
// ---------------------------------------------------------------------------
// Adapted from `cli/internal/commands/books/nextstep_test.go`, which exists
// because the rule is easy to state and easy to forget: a write that succeeds
// silently is how an agent stops one step early and reports the work as done.
//
// ── WHY IT READS THE AST AND NOT THE OUTPUT ────────────────────────────────
// A test that ran the commands would need a server, a token and a workspace, so
// it would be an integration test that skips by default — and a skipped check
// reports success (CLAUDE.md finding #12). This one reads the source: for every
// `newXxxCmd` whose `routes` annotation contains a WRITE verb, the function body
// must mention `nextStep`.
//
// What it cannot see: whether the next step is CORRECT, or whether it is
// reachable. A text scan cannot, and pretending otherwise is finding #11. It
// answers the question that actually goes wrong — is there one at all?
//
// ── ITS FIRST VERSION HAD FINDING #11's DEFECT, IMMEDIATELY ────────────────
// It looked for a write verb ANYWHERE in the function body, and reported
// `newAuditListCmd` — a plain GET — as a write with no next step. The match was
// the phrase "ON DELETE SET NULL" in a comment explaining why the actor join is
// a LEFT join.
//
// So it extracts the annotation's VALUE now, rather than scanning the body for a
// word that also appears in English and in SQL. The granularity of a text scan
// is part of what it checks, and the version that read the whole body was
// measuring the wrong thing while looking stricter.

func TestEveryWriteCommandPrintsANextStep(t *testing.T) {
	fset := token.NewFileSet()
	files, err := filepath.Glob("*.go")
	if err != nil || len(files) == 0 {
		t.Fatalf("found no Go files to scan in this package (err=%v)", err)
	}

	writeVerbs := []string{"POST ", "PATCH ", "PUT ", "DELETE "}
	// Matches `"routes": "POST /api/…"` and pulls out just the value, so a verb
	// appearing in prose or in a SQL comment cannot be mistaken for a claim.
	routesAnnotation := regexp.MustCompile(`"routes":\s*"([^"]*)"`)
	checked := 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		f, err := parser.ParseFile(fset, path, src, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}

		for _, decl := range f.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || !strings.HasPrefix(fn.Name.Name, "new") || !strings.HasSuffix(fn.Name.Name, "Cmd") {
				continue
			}
			body := string(src[fset.Position(fn.Pos()).Offset:fset.Position(fn.End()).Offset])

			// Only the leaf commands that WRITE. A group node has no annotation,
			// and a read has no next step to print.
			m := routesAnnotation.FindStringSubmatch(body)
			if m == nil {
				continue
			}
			claim := m[1]
			isWrite := false
			for _, v := range writeVerbs {
				if strings.Contains(claim, v) {
					isWrite = true
					break
				}
			}
			if !isWrite {
				continue
			}
			checked++
			if !strings.Contains(body, "nextStep(") {
				t.Errorf("%s in %s claims a write route and never calls nextStep.\n"+
					"A write that succeeds silently is how an agent stops one step early and "+
					"reports the work as done. See nextstep.go's header for the three rules.",
					fn.Name.Name, path)
			}
		}
	}

	// Assert the input. A scan that found no write commands would pass every
	// assertion above while checking nothing — and this package starts with
	// none, so the day somebody adds the first one is the day this guard has to
	// already be watching.
	if checked == 0 {
		t.Fatal("found 0 write commands to check, so this guard verified nothing. " +
			"If this package really has no writes yet, that is the state to notice — " +
			"delete this assertion only when you have replaced it with something better.")
	}
	t.Logf("checked %d write command(s)", checked)
}
