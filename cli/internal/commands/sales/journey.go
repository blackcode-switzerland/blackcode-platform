package sales

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales journey` — the deal ladder.
//
// ---------------------------------------------------------------------------
// `journey add` DOES NOT MOVE THE DEAL. `prospect stage` DOES.
// ---------------------------------------------------------------------------
// Two commands rather than one with a flag, because a flag defaulting to "also
// move it" is a second, undocumented way to change a prospect's stage — and one
// that would be discovered the first time somebody recorded a historical step
// and found the deal had jumped backwards.
//
//	bk sales prospect stage 12 negotiation   moves the deal AND records the step
//	bk sales journey add 12 --stage meeting  records a step that did not move it
//
// The second is for the rungs the ladder shows ahead of where a deal is
// (`--status upcoming`) and for filling in history that happened before the
// record existed (`--at`).
func newJourneyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "journey",
		Short: "The deal journey — one step per stage, including the ones not reached",
	}
	cmd.AddCommand(newJourneyListCmd(), newJourneyAddCmd())
	return cmd
}

func newJourneyListCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "list <prospect>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/journey"},
		Short:       "Show a prospect's journey",
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
			steps, err := c.ListJourney(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, steps, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "STAGE\tSTATUS\tWHEN\tBY\tNOTE")
				for _, s := range steps {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n",
						s.Stage, s.Status, dateOnly(s.OccurredAt), dashIf(s.Actor),
						cmdutil.Truncate(s.Note, 50))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(steps) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no journey steps)")
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newJourneyAddCmd() *cobra.Command {
	var req client.AddJourneyStepRequest
	var prospect int
	cmd := &cobra.Command{
		Use: "add <prospect> --stage <stage>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}," +
			"POST /api/workspaces/{ws}/prospects/{n}/journey"},
		Short:       "Record a journey step WITHOUT moving the deal",
		Long: `Add a step to the ladder without changing the prospect's stage.

To MOVE the deal, use "bk sales prospect stage <n> <stage>" — that writes the
step and sets the stage together, and on a closing stage records the close date.

This command is for the two cases where the deal did not move:
  --status upcoming   a rung ahead of where the deal is (no date, no actor)
  --at <timestamp>    a step that happened before this record existed

Run "bk meta" for the current stage and status values.

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
			step, err := c.AddJourneyStep(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, step, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "recorded %s (%s) on prospect %s — its stage is unchanged\n",
					step.Stage, step.Status, prospectLabel(c, ws, n))
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&req.Stage, "stage", "", "The stage this step is about — "+vocab("stages", "required"))
	cmd.Flags().StringVar(&req.Status, "status", "", vocab("stage_entry_statuses", "default done"))
	cmd.Flags().StringVar(&req.Note, "note", "", "What happened at this step")
	cmd.Flags().StringVar(&req.OccurredAt, "at", "", "When it happened, ISO 8601 (default now)")
	_ = cmd.MarkFlagRequired("stage")
	return cmd
}
