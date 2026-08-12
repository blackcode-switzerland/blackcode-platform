package commands

import (
	"strings"

	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// "I SCANNED PAST THE SUBCOMMAND LIST LOOKING FOR FLAG LINES"
// ---------------------------------------------------------------------------
// The 2026-08-12 report, on a help screen it had already read:
//
//	"That is when I discovered `edit-comment`, `delete-comment`, `detach` and
//	 `unassign` — I had missed all of them during the session."
//
// Six commands on one noun. Cobra renders `Available Commands:` and `Flags:`
// with the same shape — a heading, then indented two-column rows — and a reader
// hunting for `--x` slides past the first block on its way to the second.
//
// ---------------------------------------------------------------------------
// WHAT WAS AND WAS NOT DONE, AND WHY
// ---------------------------------------------------------------------------
// The template is shared by every command in the binary, so anything done here
// is done to ~200 help screens. Three options were weighed:
//
//	GROUPING related verbs      — rejected. It needs a hand-maintained group per
//	                              noun (nothing derives "edit-comment belongs
//	                              with comment"), so it is 40 lists to keep true,
//	                              and a stale grouping misleads worse than a flat
//	                              list.
//	REPLACING cobra's template  — rejected. A full copy drifts on every cobra
//	                              upgrade, silently, and buys the same thing.
//	A COUNT on the heading      — TAKEN. Additive, one line, and it is the only
//	                              one that speaks to the actual failure: a reader
//	                              who skips a block headed "(17)" knows they
//	                              skipped 17 things. "Available Commands:" reads
//	                              the same whether there are 3 or 17.
//
// The count is a PATCH of cobra's own template rather than a copy of it, so
// everything else — groups, flag sections, the trailing "Use ... --help" line —
// stays whatever the installed cobra does. The cost of that choice is that a
// cobra release which rewords the heading turns this into a silent no-op, which
// is a green-but-inert guard in template form. So it is not trusted: the
// rendered output is asserted in helptemplate_test.go, not the substitution.
//
// Set on the ROOT only. cobra's UsageTemplate() walks up to the parent when a
// command has none of its own, so one call covers the whole tree.

const availableCommandsHeading = "Available Commands:"

// installCommandCountHeading makes every group's help say how many commands it
// is listing.
func installCommandCountHeading(root *cobra.Command) {
	cobra.AddTemplateFunc("listedCommandCount", listedCommandCount)
	tpl := root.UsageTemplate()
	if !strings.Contains(tpl, availableCommandsHeading) {
		// Nothing to patch. Leaving the template alone is the right failure:
		// the help screen stays cobra's, and the test says so out loud.
		return
	}
	root.SetUsageTemplate(strings.ReplaceAll(tpl, availableCommandsHeading,
		"Available Commands ({{listedCommandCount .}}):"))
}

// listedCommandCount counts exactly the rows cobra's template is about to
// print, which is the only count worth showing: a number that disagrees with
// the list under it is worse than no number.
//
// Cobra's condition is `(or .IsAvailableCommand (eq .Name "help"))`, so `help`
// is included and hidden/deprecated commands are not. Mirrored here rather than
// approximated.
func listedCommandCount(c *cobra.Command) int {
	n := 0
	for _, sub := range c.Commands() {
		if sub.IsAvailableCommand() || sub.Name() == "help" {
			n++
		}
	}
	return n
}
