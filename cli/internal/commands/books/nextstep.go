// Next-step output: what a write tells you to do AFTER it succeeds.
//
// ---------------------------------------------------------------------------
// WHY EVERY WRITE ENDS WITH A COMMAND
// ---------------------------------------------------------------------------
// The CLI is the only door this product has. A write that succeeds and says
// nothing leaves the caller to reconstruct the workflow from a guide topic it
// may not have read, and the failure mode is not an error — it is an agent that
// stops one step early and reports the work as done. Bookkeeping is a CHAIN: a
// source with no import has produced nothing, an unmatched pièce is evidence
// attached to nothing, a staged entry is money nobody has judged. Each of those
// is a half-finished state that reads exactly like a finished one.
//
// So `bk books entity create` has always ended with
//
//	chart of accounts installed. Next: bk books exercice create --entity acme --year <yyyy>
//
// and as of 2026-08-20 every other write does too. Three rules, learned from the
// one that already worked:
//
//  1. A RUNNABLE COMMAND, not a topic. "see `bk guide books/money-in`" is a
//     second lookup; `bk books source import 5 --file <statement.xml>` is the
//     next call.
//  2. THE ARGUMENTS IT ALREADY KNOWS. `bk books worklist` is runnable and, in a
//     workspace with more than one book, answers about a different book than the
//     one you just wrote to — which is worse than saying nothing, because it
//     looks like an answer. Every next step carries --entity when the scope
//     needs it. (Found in this phase's cold run: `source import` printed the
//     bare form and the follow-up showed another book's worklist.)
//  3. WHERE THE NEXT STEP DEPENDS ON STATE, SAY THE STATE. After `resolve`,
//     "post it" is right only when nothing blocks posting; a `blocked` verdict
//     means the post will be refused, and saying so is worth more than a
//     suggestion that will fail.
//
// Next-step lines go to the SAME writer as the result, so `--json` and `--yaml`
// never see them: output.Render only calls the table renderer for table format.
package books

import (
	"fmt"
	"io"
)

// nextStep prints the "and now do this" line under a successful write.
//
// It is one function so the wording stays uniform — every one of them reads
// "next: <a command you can run>" — and so that a reader grepping for `nextStep`
// finds every write that has one, and by absence every write that does not.
func nextStep(w io.Writer, format string, args ...any) {
	fmt.Fprintf(w, "next: "+format+"\n", args...)
}

// also prints a consequence that is not itself a command — the state that makes
// the next step conditional, or the thing that just became true.
func also(w io.Writer, format string, args ...any) {
	fmt.Fprintf(w, format+"\n", args...)
}

// verdictState reads the operational half of an entry's verdict payload:
// {verdict, rules, worst_case, resolves}. It returns the verdict word, whether
// it BLOCKS posting (imports.ts refuses a post server-side on `blocked`), and
// what the filer said would clear it.
//
// `any`, because the wire owns the shape and a typed struct would silently drop
// whatever the server adds next — the same reason BooksEntry.Verdict is `any`.
func verdictState(raw any) (verdict string, blocked bool, resolves string) {
	v, ok := raw.(map[string]any)
	if !ok || v == nil {
		return "", false, ""
	}
	verdict, _ = v["verdict"].(string)
	resolves, _ = v["resolves"].(string)
	return verdict, verdict == "blocked", resolves
}

// entityFlag renders ` --entity <slug>` when the slug is known, and nothing when
// it is not, so a next step is never printed with an empty flag value. A command
// that cannot name the book prints the bare form, which is correct for a
// single-book workspace and explicitly incomplete for any other.
func entityFlag(slug string) string {
	if slug == "" {
		return ""
	}
	return " --entity " + slug
}
