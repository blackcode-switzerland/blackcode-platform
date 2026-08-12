package sales

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales search` — the INSIDE-the-records half of D-9.
//
// ---------------------------------------------------------------------------
// THERE IS NO LONGER A `bk search` TO CONFUSE THIS WITH
// ---------------------------------------------------------------------------
// This header, and the `Long` below, used to contrast two commands:
//
//	bk search        cross-app, bare. Read the platform entity index (TITLES
//	                 ONLY) and return URNs tagged with the app they came from.
//	bk sales search  app-owned. Read this app's full-text columns.
//
// **The first one was removed on 2026-08-10** (multiAppFinalRefactor Phase 4).
// `apps/sales` stopped projecting into `platform.entities` in Phase 3, so a
// bare `bk search` had no cross-app index left to read from a sales context;
// search is app-owned now and `bk search` exits 2.
//
// The prose was left behind, and it did not merely go stale — the `Long` told
// an agent to run `bk search` INSTEAD of this command, at the exact moment it
// was choosing between them. That is CLAUDE.md's `bk undo` defect inside the
// binary's own help. Corrected 2026-08-11 (parity audit).
//
// The snippet column still earns its place: it shows WHICH text matched, which
// is what separates this from a name filter like `prospect list --q`.
func newSearchCmd() *cobra.Command {
	var types []string
	var limit int
	cmd := &cobra.Command{
		Use:         "search <query>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sales-search"},
		Short:       "Full-text search INSIDE this app's records",
		Long: `Search the text inside this app's records — summaries, outcomes, message
bodies, objections, product pitches, template copy.

For "where is the thing called X" — a prospect or product by NAME rather than by
a phrase inside it — use the listing filters ("bk sales prospect list --q",
"bk sales product list"). This one reads this app's own text columns and returns
what matched, with the snippet it matched in.

--type narrows it; run "bk meta" for the searchable types. Note they are WIDER
than the addressable ones: a contact and an objection are searchable and have no
#number, so those hits carry their prospect instead.`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			hits, err := c.SalesSearch(ws, strings.Join(args, " "), splitAll(types), limit)
			if err != nil {
				return err
			}
			return output.Render(format, hits, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "TYPE\tREF\tTITLE\tMATCH")
				for _, h := range hits {
					ref := "—"
					if h.Number != nil {
						ref = fmt.Sprintf("%d", *h.Number)
					} else if h.ProspectNumber != nil {
						// No #number of its own: say which prospect it hangs off,
						// which is the only address a caller can act on.
						ref = fmt.Sprintf("via prospect %d", *h.ProspectNumber)
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						h.Type, ref, cmdutil.Truncate(h.Title, 30),
						cmdutil.Truncate(strings.ReplaceAll(h.Snippet, "\n", " "), 56))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(hits) == 0 {
					// The empty result is the moment the caller most needs a next
					// step, so this line names one that EXISTS. It named `bk search`
					// until 2026-08-11 — removed on 2026-08-10 — which meant a search
					// that found nothing handed back a command that exits 2.
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no matches inside this app's records — `bk sales prospect list --q <name>` filters by company name)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringSliceVar(&types, "type", nil, "Restrict to these record types — "+vocab("search_types", "repeatable"))
	cmd.Flags().IntVar(&limit, "limit", 0, "Max hits (bk meta for the cap)")
	return cmd
}
