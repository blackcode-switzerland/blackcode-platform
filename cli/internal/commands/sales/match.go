package sales

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales match` — triangulation: client × product × message.
//
//	┌──────────────────────────────────────────────────────────────────────────┐
//	│ YOU decide. The app stores. There is no recommender and there will not    │
//	│ be one.                                                                   │
//	└──────────────────────────────────────────────────────────────────────────┘
//
// This is the one thing in the app that is genuinely JUDGEMENT rather than
// arithmetic — which product suits this client, which message to lead with — and
// it is the reason `bk sales pipeline` is computed while this is written. A live
// matching engine would contradict the doctrine and double the surface.
//
// `set` is an UPSERT on (prospect, product): re-running the triangulation
// replaces the verdict rather than accumulating three contradictory ones.
func newMatchCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "match",
		Short: "Triangulation — which product and message fit which prospect",
	}
	cmd.AddCommand(newMatchListCmd(), newMatchSetCmd(), newMatchClearCmd())
	return cmd
}

func newMatchListCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "list <prospect>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/matches"},
		Short:       "What has been matched to this prospect",
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
			rows, err := c.ListMatches(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "PRODUCT\tFIT\tTEMPLATE\tBY\tWHY")
				for _, r := range rows {
					fit := "—"
					if r.Fit != nil {
						fit = fmt.Sprintf("%d%%", *r.Fit)
					}
					tpl := "—"
					if r.TemplateNumber != nil {
						tpl = fmt.Sprintf("#%d %s", *r.TemplateNumber, cmdutil.Truncate(r.TemplateName, 18))
					}
					fmt.Fprintf(tw, "#%d %s\t%s\t%s\t%s\t%s\n",
						r.ProductNumber, cmdutil.Truncate(r.ProductName, 24), fit, tpl,
						cmdutil.Truncate(dashIf(r.ComputedBy), 14), cmdutil.Truncate(r.Why, 40))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(nothing matched — `bk sales match set` records your verdict; the app does not compute one)")
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newMatchSetCmd() *cobra.Command {
	var product, fit, template int
	var why string
	var prospect int
	cmd := &cobra.Command{
		Use: "set <prospect> --product <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}," +
			"POST /api/workspaces/{ws}/prospects/{n}/matches"},
		Short:       "Record which product fits this prospect, and why",
		Long: `Store your verdict for one prospect and one product.

--fit is a percentage you decided, 0–100. Nothing computes it: this command
records a judgement, and the app has no matching engine by design.

--template names the message to lead with. --why is your reasoning, and it is
worth writing: it is what the next person (or the next run) reads instead of
guessing why this pairing was chosen.

Running it again for the same pair REPLACES the verdict rather than adding a
second one.

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
			req := client.SetMatchRequest{Product: product, Why: why}
			if cmd.Flags().Changed("fit") {
				req.Fit = &fit
			}
			if cmd.Flags().Changed("template") {
				req.Template = &template
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.SetMatch(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "matched prospect %s with product #%d (%s)\n",
					prospectLabel(c, ws, n), m.ProductNumber, m.ProductName)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().IntVar(&product, "product", 0, "The product's #number (required)")
	cmd.Flags().IntVar(&fit, "fit", 0, "How well it fits, 0-100 — your judgement, not a computed score")
	cmd.Flags().IntVar(&template, "template", 0, "The template to lead with (its #number)")
	cmd.Flags().StringVar(&why, "why", "", "Why this pairing — the reasoning, for whoever reads it next")
	_ = cmd.MarkFlagRequired("product")
	return cmd
}

func newMatchClearCmd() *cobra.Command {
	var product int
	var yes bool
	var prospect int
	cmd := &cobra.Command{
		Use:         "clear <prospect> --product <n>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/matches"},
		Short:       "Remove a match",
		Long: `Remove the stored verdict for one (prospect, product) pair.

A match is a judgement with no bin state behind it, so this is permanent — but
it is also cheap to redo, which is why it does not demand a name repeated back
the way a record delete does.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"Remove the match between prospect #%d and product #%d?", n, product), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.ClearMatch(ws, n, product); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "cleared the match between prospect #%d and product #%d\n", n, product)
			return nil
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().IntVar(&product, "product", 0, "The product's #number (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	_ = cmd.MarkFlagRequired("product")
	return cmd
}
