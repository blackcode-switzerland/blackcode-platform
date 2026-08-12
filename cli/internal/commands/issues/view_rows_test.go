package issues

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
)

// AN ABSENT ROW AND AN EMPTY ROW MUST NOT LOOK IDENTICAL.
//
// ---------------------------------------------------------------------------
// WHY THIS IS AN AST WALK AND NOT A STRING MATCH
// ---------------------------------------------------------------------------
// `issue view` hid its `Labels:` row when the list was empty, and a reporter
// who could not find one concluded the route had no such field and that
// labelling was UI-only. The fix was to print it unconditionally. The
// `Attachments:` row landed in 2026-08-12 with the same shape of bug behind it
// — attaching a file worked and `view` said nothing, so the only way to learn a
// file was there was to guess that `issue attachments` exists — and therefore
// with the same rule.
//
// The property is "this line is NOT inside a conditional", and that is a fact
// about the syntax tree. CLAUDE.md finding #11 is a text scan that matched the
// WORD `focus` and passed against `const focus = null`; the granularity of a
// text scan is part of what it checks, and grepping for `Attachments:` would
// pass against a line nested three `if`s deep — which is the exact bug.
//
// So: parse the file, find `view`'s render closure, and assert both rows are
// direct statements of its body.
func TestIssueViewPrintsLabelsAndAttachmentsUnconditionally(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "issue.go", nil, 0)
	if err != nil {
		t.Fatalf("parse issue.go: %v", err)
	}

	body := renderClosureBody(t, file, "newIssueViewCmd")

	// ASSERT THE INPUT before asserting anything about it. A walk that found the
	// wrong function, or an empty one, would make every check below vacuous.
	if len(body) < 5 {
		t.Fatalf("newIssueViewCmd's render closure has %d statements — this walk is looking at "+
			"the wrong function, and a walk that finds nothing passes on everything", len(body))
	}

	unconditional := map[string]bool{}
	for _, stmt := range body {
		for _, prefix := range printedPrefixes(stmt) {
			unconditional[prefix] = true
		}
	}

	for _, want := range []string{"Labels:", "Attachments:"} {
		if !unconditional[want] {
			t.Errorf("`issue view` does not print a %q row unconditionally. Either it was removed, "+
				"or it moved inside an `if` — and a row that disappears when the value is empty is "+
				"indistinguishable from a route that has no such field, which is the conclusion two "+
				"separate reporters actually drew.", want)
		}
	}

	// The guard must be able to tell the difference. `Due:` IS conditional
	// (`if iss.DueDate != nil`), and if this walk reported it as unconditional
	// the two assertions above would be meaningless.
	if unconditional["Due:"] {
		t.Error("this walk reports the conditional `Due:` row as unconditional, so it cannot " +
			"distinguish the property it exists to check")
	}
}

// renderClosureBody returns the statements of the `func(w io.Writer) error`
// literal inside the named constructor — the human renderer.
func renderClosureBody(t *testing.T, file *ast.File, fnName string) []ast.Stmt {
	t.Helper()
	var found []ast.Stmt
	ast.Inspect(file, func(n ast.Node) bool {
		fn, ok := n.(*ast.FuncDecl)
		if !ok || fn.Name.Name != fnName {
			return true
		}
		ast.Inspect(fn, func(inner ast.Node) bool {
			lit, ok := inner.(*ast.FuncLit)
			if !ok || found != nil {
				return true
			}
			// The render closure is the one taking a single io.Writer.
			params := lit.Type.Params.List
			if len(params) != 1 {
				return true
			}
			if sel, ok := params[0].Type.(*ast.SelectorExpr); !ok || sel.Sel.Name != "Writer" {
				return true
			}
			found = lit.Body.List
			return false
		})
		return false
	})
	if found == nil {
		t.Fatalf("no `func(w io.Writer) error` literal in %s — this parser is stale", fnName)
	}
	return found
}

// printedPrefixes returns the literal label a statement prints, if the
// statement is a top-level Fprintf/Fprintln whose format string starts with one.
func printedPrefixes(stmt ast.Stmt) []string {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return nil
	}
	call, ok := expr.X.(*ast.CallExpr)
	if !ok || len(call.Args) < 2 {
		return nil
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || !strings.HasPrefix(sel.Sel.Name, "Fprint") {
		return nil
	}
	lit, ok := call.Args[1].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return nil
	}
	value := strings.Trim(lit.Value, `"`)
	if i := strings.Index(value, ":"); i > 0 {
		return []string{value[:i+1]}
	}
	return nil
}

// THE COUNT IS FREE AND MUST STAY FREE.
//
// `GET …/issues/{id}` already returns `attachment_count`, so an issue with no
// attachments must not pay a request to print `—`. The nil client is the
// instrument: any call panics, so returning is the evidence.
func TestAttachmentRowCostsNothingWhenThereAreNone(t *testing.T) {
	zero := 0
	for _, iss := range []*client.Issue{
		{ID: 4, AttachmentCount: &zero},
		{ID: 4}, // the field absent entirely — an older server, or a list payload
	} {
		if got := issueAttachmentLabel(nil, iss); got != "—" {
			t.Errorf("issueAttachmentLabel = %q, want %q", got, "—")
		}
	}
}
