package appverbs

// `bk search` — federated search across every app, in one workspace.
//
// A bare platform verb, and it has to be. It reads `platform.entities`, the
// projection every app writes into, which is the only thing that CAN be searched
// across apps: an app's own tables are unreadable to another app's Postgres role
// by design (docs/platform-architecture.md §4.3), so a per-app fan-out is not merely
// slower — it is refused at the database.
//
// It answers one question: "where is the thing called X". For filtering by
// status, assignee or label, use that app's own listing — `bk issues issue list
// --search`, which searches descriptions too.

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newSearchCmd(acfg Config) *cobra.Command {
	var (
		apps           []string
		types          []string
		limit          int
		includeDeleted bool
	)
	cmd := &cobra.Command{
		Use:         "search <query>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/search"},
		Short:       "Search every app's entities in the active workspace",
		Long: `Search every app's entities in the active workspace.

Matches titles case-insensitively; a bare number (or #482) also matches the
workspace #number. Results carry the URN, which is what "bk link" takes.

  bk search auth
  bk search "#482"
  bk search acme --type issue,project --json

Binned items are hidden unless --include-deleted. Run "bk meta" for the entity
types each app publishes.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			results, err := c.SearchEntities(args[0], apps, types, limit, includeDeleted)
			if err != nil {
				return err
			}
			return output.Render(format, results, func(w io.Writer) error {
				if len(results) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no matches)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "URN\tAPP\tTYPE\t#\tTITLE")
				for _, e := range results {
					title := e.Title
					if e.DeletedAt != nil {
						title += " (in trash)"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n", e.URN, e.App, e.EntityType, e.Number, title)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringSliceVar(&apps, "app", nil, "Only these apps (comma-separated)")
	cmd.Flags().StringSliceVar(&types, "type", nil, "Only these entity types (comma-separated)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max results (server default applies when unset)")
	cmd.Flags().BoolVar(&includeDeleted, "include-deleted", false, "Include items in the recycle bin")
	return cmd
}
