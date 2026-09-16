// Next-step output: what a write tells you to do AFTER it succeeds.
//
// ---------------------------------------------------------------------------
// WHY EVERY WRITE ENDS WITH A COMMAND
// ---------------------------------------------------------------------------
// The CLI is one of this product's two doors, and the only one an agent has. A
// write that succeeds and says nothing leaves the caller to reconstruct the
// workflow from a guide topic it may not have read, and the failure mode is not
// an error — it is an agent that stops one step early and reports the work as
// done.
//
// Invoicing is a CHAIN, and every link looks finished from the inside:
//
//	a company with no IBAN        cannot produce a payment part
//	an invoice with no lines      is a bill for nothing
//	a draft that was never sent   is money nobody has asked for
//
// Each of those is a half-finished state that reads exactly like a finished one,
// and the last is the expensive one: a workspace full of drafts is a business
// that has done the work and not been paid.
//
// Three rules, taken from `cli/internal/commands/books/nextstep.go` where they
// were learned:
//
//  1. A RUNNABLE COMMAND, not a topic. "see `bk guide billing/invoices`" is a
//     second lookup; `bk billing invoice line set 7 --item "…"` is the next call.
//  2. THE ARGUMENTS IT ALREADY KNOWS. `bk billing invoice list` is runnable and,
//     in a workspace with more than one company, answers about a different
//     company than the one just written to — which is worse than saying nothing,
//     because it looks like an answer. Every next step carries `--company` when
//     the scope needs it.
//  3. WHERE THE NEXT STEP DEPENDS ON STATE, SAY THE STATE. After creating an
//     invoice with no lines, "send it" is wrong; after creating one for a company
//     with no IBAN, it is wrong for a different reason. Saying which is worth
//     more than a suggestion that will be refused.
//
// Next-step lines go to the SAME writer as the result, so `--json` and `--yaml`
// never see them: `output.Render` only calls the table renderer for table
// format.
package billing

import (
	"fmt"
	"io"
)

// nextStep prints the "and now do this" line under a successful write.
//
// One function, so the wording stays uniform — every one reads
// "next: <a command you can run>" — and so a reader grepping for `nextStep`
// finds every write that has one, and by absence every write that does not.
func nextStep(w io.Writer, format string, args ...any) {
	fmt.Fprintf(w, "next: "+format+"\n", args...)
}
