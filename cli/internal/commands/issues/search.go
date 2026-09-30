package issues

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk issues search` — search INSIDE this app's records.
//
// ---------------------------------------------------------------------------
// THIS REPLACED THE SHARED `search` VERB FOR THIS APP (2026-09-30)
// ---------------------------------------------------------------------------
// `internal/appverbs` still builds a `search` for an app that wants one, over
// `GET …/search` — the platform route that reads `platform.entities`, which holds
// titles of issues, tasks and projects and nothing else. This app switched that
// off (`appverbs.Config.Search`) and registers this one instead, exactly as
// `bk sales search` did: the shared route may not learn about any one app, and
// the web app's workspace search needed labels, people, descriptions and
// comments, none of which the index holds.
//
// The verb, the `--type`, `--limit` and `--include-deleted` flags kept their
// spelling, so a script that ran `bk issues search auth` still works and now
// finds more. What changed is the answer: the columns, and a snippet showing
// which text the match was found in.
func newSearchCmd() *cobra.Command {
	var (
		types          []string
		perType, limit int
		includeDeleted bool
	)
	cmd := &cobra.Command{
		Use:         "search <query>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues-search"},
		Short:       "Search issues, tasks, projects, labels, members and comments",
		Long: `Search everything in the active workspace at once: issues, tasks and projects
(by title, and inside their descriptions), labels, members (by name or email)
and comments. This is the same search as the search button in the web app.

Every word must match (a different word may match a different field). A bare
number also matches the workspace #number, and an explicit #482 finds exactly the
record numbered 482 (an issue, task or project) and nothing else. Results are
ranked — an exact #number or title first, a match found only in a body last — and
grouped by type, at most --per-type of each so one noisy type cannot bury the rest.

  bk issues search auth
  bk issues search "#482"
  bk issues search "login timeout" --type issue,comment --json

--type narrows it and lifts the per-type cap; run "bk meta" for the searchable
types. A comment hit shows the record it lives on (its #number, its title) and
the text that matched. Binned records are hidden unless --include-deleted.`,
		Args: cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			hits, err := c.IssuesSearch(strings.Join(args, " "), types, perType, limit, includeDeleted)
			if err != nil {
				return err
			}
			return output.Render(format, hits, func(w io.Writer) error {
				if len(hits) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no matches)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "TYPE\tREF\tTITLE\tMATCH")
				for _, h := range hits {
					ref := "—"
					switch {
					case h.Parent != nil:
						// A comment has no number of its own: name the record it hangs off.
						ref = fmt.Sprintf("on %s #%d", h.Parent.Type, h.Parent.Number)
					case h.Number != nil:
						ref = fmt.Sprintf("#%d", *h.Number)
					}
					title := h.Title
					if h.Deleted {
						title += " (in trash)"
					}
					match := h.MatchedIn
					if h.Snippet != nil {
						match = strings.ReplaceAll(*h.Snippet, "\n", " ")
					} else if h.Detail != nil {
						match = *h.Detail
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", h.Type, ref,
						cmdutil.Truncate(title, 40), cmdutil.Truncate(match, 60))
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringSliceVar(&types, "type", nil, "Only these types — "+vocab("search_types", "comma-separated"))
	cmd.Flags().IntVar(&perType, "per-type", 0, "Max hits per type (bk meta for the cap; server default applies when unset)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max hits overall")
	cmd.Flags().BoolVar(&includeDeleted, "include-deleted", false, "Include issues, tasks and projects in the recycle bin")
	return cmd
}
