// `bk books manifest` — the worker's ledger of one Drive folder.
//
// "Did we miss a file" as a query: every file the worker has seen in the
// inbox, and where each sits in its state machine (discovered → downloaded →
// extracted → validated_staged | needs_review → ingested). `archived` is
// orthogonal and honestly false until the retention-locked archive exists.
package books

import (
	"fmt"
	"io"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newManifestCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "manifest <source-number>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sources/{number}/manifest"},
		Short:       "Every Drive file one source has seen, with its pipeline state",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			files, err := c.GetBooksManifest(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, files, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "FILE\tSTATE\tFETCHED\tPIECE\tARCHIVED")
				for _, f := range files {
					piece := "—"
					if f.Piece != nil {
						piece = "#" + strconv.Itoa(*f.Piece)
					}
					archived := "no"
					if f.Archived {
						archived = "yes"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
						cmdutil.Truncate(strOr(f.Name, f.FileID), 40), f.State, strOr(f.Fetched, "—"), piece, archived)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(files) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no files on record for this source)")
				}
				return nil
			})
		},
	}
	return cmd
}
