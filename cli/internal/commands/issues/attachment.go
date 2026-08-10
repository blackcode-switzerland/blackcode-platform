package issues

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk issues attachment` — the workspace-wide view of this app's attachment rows.
//
// It was `bk storage attachments` until D-28, hanging off a bare platform verb
// while listing nothing but ISSUE attachments. That made one noun straddle two
// tiers: `storage list` spans every app, `storage attachments` could only ever
// speak for this one. Splitting them is the point of the ruling — `bk storage`
// is cross-app and bare, and everything that is really about issues sits behind
// `bk issues`.
//
// The per-issue commands are elsewhere and stay there: `bk issues issue attach`,
// `attachments`, `detach` operate on ONE issue. This one is the workspace list.
func newAttachmentCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "attachment",
		Short: "Files attached to issues, workspace-wide",
	}
	cmd.AddCommand(newAttachmentListCmd())
	return cmd
}

func newAttachmentListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/attachments"},
		Short:       "List every issue attachment in the workspace",
		Long: `List the workspace's attachments table — every file attached to an issue via
the API/CLI ("bk issues issue attach"), joined to its issue and uploader.

This is separate from files embedded inline in descriptions and comments. For
everything this app has stored in the workspace, use "bk issues storage list".`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			atts, err := c.ListWorkspaceAttachments()
			if err != nil {
				return err
			}
			return output.Render(format, atts, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tISSUE\tFILENAME\tSIZE\tURL")
				for _, a := range atts {
					issue := "—"
					if a.IssueSeq != nil {
						issue = "#" + strconv.Itoa(*a.IssueSeq)
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						a.ID, issue, a.Filename, cmdutil.HumanSize(a.FileSize), a.FileURL)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(atts) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no attachments)")
				}
				return nil
			})
		},
	}
}
