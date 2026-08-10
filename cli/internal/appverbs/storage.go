package appverbs

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk storage` — CROSS-APP, and therefore bare (D-28).
//
// It spent one commit in the app-owned tier, which was wrong, and the reason is
// worth keeping because it is the test D-11 actually applies: *does the answer
// depend on the app?*
//
//	upload   YES — the file is permanently attributed to the receiving app and
//	               path-prefixed with it
//	trash    YES — each app has its own bin, holding its own entities
//	label    YES — labels are app-scoped
//	storage  NO  — one ledger, one workspace quota, the same rows either way
//
// `bk sales storage list` would have returned the issues app's files too, which
// teaches an agent that the app segment scopes the answer and is then wrong in
// the one place it went to check. A dishonest consistency is worse than an honest
// asymmetry. Structurally this verb is already shaped like `search`: it tags
// every row with the app that owns it and takes `--app` to filter.
//
// THE PAIRING, which the guide states in as many words: **you upload into one
// app; you list across all of them.**
//
// What did move: `bk storage attachments` was issues-only from the day it was
// written ("every file attached to an ISSUE"), and it is now
// `bk issues attachment list` — a noun in that app's group rather than a
// subcommand of a bare verb. One noun must not straddle two tiers.
func newStorageCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "storage",
		Short: "Uploaded files across every app in the workspace (owner only)",
		Long: `Review and clean up files uploaded into the workspace.

Storage is ONE shared cabinet with one workspace quota: this listing spans every
app, and each row carries the app that uploaded it. That is why the verb is bare
while "bk <app> upload" is not — you upload INTO one app, and you list ACROSS all
of them.

Every file ever uploaded (via the web, the API, or the CLI) is tracked. Removing
a file from a description or comment does NOT delete the stored bytes — that is
deliberate, so trash-restore stays safe. Use these commands to see what is taking
up space and to permanently delete files that nothing references.

Owner only.`,
	}
	cmd.AddCommand(newStorageListCmd(acfg), newStorageRmCmd(acfg))
	return cmd
}

func newStorageListCmd(acfg Config) *cobra.Command {
	var app string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/storage"},
		Short:       "List uploaded files with reference counts and total usage",
		Long: `List every uploaded file in the workspace, across every app.

APP is the app that uploaded each file; --app <slug> narrows the list to one. The
usage total stays workspace-wide even when the list is filtered, because the
quota belongs to the workspace.

REFS is how many things reference the file (descriptions, comments, attachments —
including items in the recycle bin), counted across every app. A file with
REFS = 0 is an orphan and can be removed with "bk storage rm <id>".`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			listing, err := c.ListStorage(app)
			if err != nil {
				return err
			}
			return output.Render(format, listing, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tAPP\tFILENAME\tSIZE\tREFS\tUPLOADED BY\tURL")
				for _, f := range listing.Data {
					uploader := "—"
					if f.UploaderName != nil && *f.UploaderName != "" {
						uploader = *f.UploaderName
					}
					appName := "—"
					if f.App != nil && *f.App != "" {
						appName = *f.App
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d\t%s\t%s\n",
						f.ID, appName, f.Filename, cmdutil.HumanSize(f.Size), f.ReferenceCount, uploader, f.URL)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintf(w, "\n%d file(s), %s used", listing.Total, cmdutil.HumanBytes(int(listing.UsageBytes)))
				if listing.LimitBytes != nil {
					fmt.Fprintf(w, " of %s limit", cmdutil.HumanBytes(int(*listing.LimitBytes)))
				}
				fmt.Fprintln(w)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&app, "app", "", "Only files uploaded by this app (run `bk meta` for the apps you can reach)")
	return cmd
}

func newStorageRmCmd(acfg Config) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "rm <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/storage/{id}"},
		Short:       "Permanently delete an orphaned file",
		Long: `Permanently delete a stored file by its id (from "bk storage list").

The server refuses (exit non-zero) if anything still references the file,
including items in the recycle bin — remove those references or empty the trash
first. The check spans every app, not just the one that uploaded the file.
Deletion is irreversible.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("id must be an integer: %q", args[0])
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Permanently delete file #%d? This cannot be undone.", id), yes) {
				return nil
			}
			if err := c.DeleteStorageFile(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Deleted file #%d\n", id)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}
