package sales

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales objection` — what they pushed back on, and our answer.
//
// ---------------------------------------------------------------------------
// THREE FIELDS, KEPT APART
// ---------------------------------------------------------------------------
//
//	--spoken     what they actually SAID, in their words
//	--real-fear  what we think is really going on
//	--counter    what we say back
//
// Collapsing them into one notes field would delete the only structured sales
// insight in the product. The gap between the first two is the thing worth
// recording; a single blob loses it.
//
// `counter` and `resolve` are separate verbs because writing an answer is not
// the same event as the objection going away — which is the opposite of a
// meeting outcome, where recording one IS evidence the meeting happened.
//
// `rm` is the ONE hard delete in this app: objections carry no bin state, so
// there is nothing for `bk sales trash` to hold and nothing to restore.
func newObjectionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "objection",
		Short: "Objections — what they pushed back on, and our counter",
	}
	cmd.AddCommand(
		newObjectionListCmd(),
		newObjectionRaiseCmd(),
		newObjectionCounterCmd(),
		newObjectionResolveCmd(),
		newObjectionRemoveCmd(),
	)
	return cmd
}

func newObjectionListCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "list <prospect>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/objections"},
		Short:       "List a prospect's objections",
		Args:        cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListObjections(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tTYPE\tSTATUS\tRAISED BY\tSPOKEN")
				for _, r := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.ID, r.Type, r.Status, dashIf(r.RaisedBy),
						cmdutil.Truncate(strings.ReplaceAll(r.Spoken, "\n", " "), 48))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no objections)")
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newObjectionRaiseCmd() *cobra.Command {
	var req client.RaiseObjectionRequest
	var prospect int
	cmd := &cobra.Command{
		Use: "raise <prospect> --type <type>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}," +
			"POST /api/workspaces/{ws}/prospects/{n}/objections"},
		Short: "Record an objection",
		Long: `Record something they pushed back on.

--spoken is what they SAID; --real-fear is what you think is really going on.
Both, when you have both: the gap between them is the thing worth recording, and
a single notes field loses it.

Run "bk meta" for the objection types.

The prospect may be given as the first argument or as --prospect <n>.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.RaiseObjection(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "raised objection %d (%s) on prospect %s\n",
					row.ID, row.Type, prospectLabel(c, ws, n))
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&req.Type, "type", "", "Objection type — "+vocab("objection_types", "required"))
	cmd.Flags().StringVar(&req.RaisedBy, "raised-by", "", "Who raised it, by name")
	cmd.Flags().StringVar(&req.RaisedAt, "at", "", "When, ISO 8601 (default now)")
	cmd.Flags().StringVar(&req.Spoken, "spoken", "", "What they actually said")
	cmd.Flags().StringVar(&req.RealFear, "real-fear", "", "What you think is really going on")
	_ = cmd.MarkFlagRequired("type")
	return cmd
}

func newObjectionCounterCmd() *cobra.Command {
	var counter string
	var prospect int
	cmd := &cobra.Command{
		Use:         "counter <prospect> <objection-id> --counter <text>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}/objections/{oid}"},
		Short:       "Write the answer to an objection",
		Long: `Record what we say back, and mark the objection countered.

Countered is not resolved: it means we have answered, not that they accepted.
"bk sales objection resolve" is the second event, and keeping them apart is what
lets you see which counters actually worked.

The prospect may be given as the first argument or as --prospect <n>: the second
is the spelling "bk sales comm log" uses, and carrying it over here used to
dead-end.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, oid, err := prospectAndChild(cmd, args, prospect, "objection")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.UpdateObjection(ws, n, oid, client.UpdateObjectionRequest{
				Counter: counter,
				Status:  "countered",
			})
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "objection %d is now %s\n", row.ID, row.Status)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&counter, "counter", "", "What we say back (required)")
	_ = cmd.MarkFlagRequired("counter")
	return cmd
}

func newObjectionResolveCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "resolve <prospect> <objection-id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}/objections/{oid}"},
		Short:       "Mark an objection as settled",
		Long: `Mark an objection resolved — they accepted the answer, or it stopped
mattering. The record stays: an objection that was raised and settled is part of
how the deal went.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, oid, err := prospectAndChild(cmd, args, prospect, "objection")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.UpdateObjection(ws, n, oid, client.UpdateObjectionRequest{Status: "resolved"})
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "objection %d is now %s\n", row.ID, row.Status)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newObjectionRemoveCmd() *cobra.Command {
	var confirm string
	var yes bool
	var prospect int
	cmd := &cobra.Command{
		Use:         "rm <prospect> <objection-id> --confirm <type>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/objections/{oid}"},
		Short:       "Delete an objection PERMANENTLY",
		Long: `Delete an objection. THIS IS NOT REVERSIBLE.

It is the one hard delete in this app: objections carry no recycle-bin state,
because an objection is a note about a conversation rather than an addressable
record, so there is nothing to restore it from.

To say it stopped mattering, use "bk sales objection resolve" — that keeps the
record, which is almost always what you want.

--confirm must be the objection's TYPE, as shown by "bk sales objection list".`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, oid, err := prospectAndChild(cmd, args, prospect, "objection")
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the type of objection %d "+
					"— run `bk sales objection list %d` to see it", oid, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Read first: this is a hard delete, so what goes has to be reported,
			// and the type has to be checked against the row that would actually
			// be destroyed.
			rows, err := c.ListObjections(ws, n)
			if err != nil {
				return err
			}
			var target *client.SalesObjection
			for i := range rows {
				if rows[i].ID == oid {
					target = &rows[i]
					break
				}
			}
			if target == nil {
				return fmt.Errorf("no objection %d on prospect #%d — run `bk sales objection list %d`", oid, n, n)
			}
			if confirm != target.Type {
				return fmt.Errorf("--confirm is required to match objection %d, which is %q — got %q; nothing was deleted",
					oid, target.Type, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"PERMANENTLY delete objection %d (%s) on prospect #%d? This cannot be undone.", oid, target.Type, n), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := c.DeleteObjection(ws, n, oid, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				// WHAT was destroyed, including what it said — this echo and the
				// event are the only record left of it.
				_, err := fmt.Fprintf(w, "destroyed objection %d (%s): %s\n",
					done.ID, done.ObjectionType, cmdutil.Truncate(done.Spoken, 60))
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the objection TYPE to authorise (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}
