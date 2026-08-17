package sales

// `bk sales strategy` — why a SEGMENT was chosen (#37).
//
// ---------------------------------------------------------------------------
// A NOUN OF ITS OWN, NOT A FIELD ON A PROSPECT
// ---------------------------------------------------------------------------
// The reasoning behind "watch & jewellery boutiques in Lausanne, pitched with
// the AP configurator demo plus the consciencegems.ch case study" applies to ten
// prospects at once. Copied onto each of them it goes stale nine times; stored
// once and linked, it is a thing you can browse, cite by #number and change in
// one place.
//
// The PER-PROSPECT half is `bk sales prospect edit --game-plan` (#35): the
// upsell angle, the talking points, the objections to expect for ONE company.
// Two fields because they are two shapes — migration 0010's header has the long
// version.
//
// ---------------------------------------------------------------------------
// --product REPLACES THE SET
// ---------------------------------------------------------------------------
// `--product 3 --product 8` means "this strategy leads with exactly 3 and 8",
// not "add 3 and 8". There are no add/remove verbs, because expressing "these
// two" through them is three round trips and requires first finding out what is
// there now. Omitting the flag leaves the set alone; `--no-products` clears it.

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newStrategyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "strategy",
		Aliases: []string{"strategies"},
		Short:   "Segment strategies — why a vertical was chosen and what we lead with",
	}
	cmd.AddCommand(
		newStrategyListCmd(),
		newStrategyShowCmd(),
		newStrategyCreateCmd(),
		newStrategyEditCmd(),
		newStrategyDeleteCmd(),
	)
	return cmd
}

func newStrategyListCmd() *cobra.Command {
	var query string
	cmd := &cobra.Command{
		Use:         "list",
		Aliases:     []string{"ls"},
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/strategies"},
		Short:       "List segment strategies",
		Args:        cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListStrategies(ws, query)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tNAME\tVERTICAL\tAREA\tPRODUCTS\tPROSPECTS")
				for _, r := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%d\n",
						r.Number, cmdutil.Truncate(r.Name, 30),
						cmdutil.Truncate(dashIf(r.Vertical), 22), cmdutil.Truncate(dashIf(r.Area), 16),
						cmdutil.Truncate(productList(r.Products), 24), r.ProspectCount)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no strategies — `bk sales strategy add` records why a segment was chosen)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&query, "q", "", "Filter by name, substring match")
	return cmd
}

// productList renders "#3 b/suite, #8 Websites" — the #number first, because
// that is the address both a human and an agent use (sales #30).
func productList(ps []client.SalesStrategyProduct) string {
	if len(ps) == 0 {
		return "—"
	}
	out := make([]string, 0, len(ps))
	for _, p := range ps {
		out = append(out, fmt.Sprintf("#%d %s", p.Number, p.Name))
	}
	return strings.Join(out, ", ")
}

func newStrategyShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/strategies/{n}"},
		Short:       "One strategy, with the prospects running against it",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "strategy")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			g, err := c.GetStrategy(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, g, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s\n", g.Number, g.Name)
				if g.URN != "" {
					fmt.Fprintf(w, "%s\n", g.URN)
				}
				fmt.Fprintln(w)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "vertical\t%s\n", dashIf(g.Vertical))
				fmt.Fprintf(tw, "area\t%s\n", dashIf(g.Area))
				fmt.Fprintf(tw, "products\t%s\n", productList(g.Products))
				if g.DeletedAt != "" {
					fmt.Fprintf(tw, "binned\t%s\n", dateOnly(g.DeletedAt))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if g.Rationale != "" {
					fmt.Fprintf(w, "\nWHY\n%s\n", g.Rationale)
				}
				if g.CaseStudies != "" {
					fmt.Fprintf(w, "\nCASE STUDIES\n%s\n", g.CaseStudies)
				}
				if len(g.Prospects) > 0 {
					fmt.Fprintln(w, "\nPROSPECTS")
					pt := output.Tabwriter(w)
					for _, p := range g.Prospects {
						fmt.Fprintf(pt, "  #%d\t%s\t%s\n", p.Number, cmdutil.Truncate(p.Name, 30), p.Stage)
					}
					if err := pt.Flush(); err != nil {
						return err
					}
				}
				return nil
			})
		},
	}
	return cmd
}

func newStrategyCreateCmd() *cobra.Command {
	var name, vertical, area, rationale, caseStudies string
	var productNums []int
	cmd := &cobra.Command{
		Use:         "add --name <name>",
		Aliases:     []string{"create", "new"},
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/strategies"},
		Short:       "Record why a segment was chosen",
		Long: `Create a segment strategy.

--why is the part worth writing. It is what the next person (or the next run)
reads instead of reconstructing the reasoning from a list of prospects, and it
is the whole reason this record exists rather than a tag.

--product takes a product's #number and is repeatable: "bk sales strategy add
--product 3 --product 8" leads with both.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req := client.StrategyRequest{Name: name}
			if cmd.Flags().Changed("vertical") {
				req.Vertical = client.Set(vertical)
			}
			if cmd.Flags().Changed("area") {
				req.Area = client.Set(area)
			}
			if cmd.Flags().Changed("why") {
				req.Rationale = client.Set(rationale)
			}
			if cmd.Flags().Changed("case-studies") {
				req.CaseStudies = client.Set(caseStudies)
			}
			if cmd.Flags().Changed("product") {
				req.Products = &productNums
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			g, err := c.CreateStrategy(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, g, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created strategy #%d: %s\n%s\n", g.Number, g.Name, g.URN)
				return err
			})
		},
	}
	addStrategyFields(cmd, &name, &vertical, &area, &rationale, &caseStudies, &productNums)
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newStrategyEditCmd() *cobra.Command {
	var name, vertical, area, rationale, caseStudies string
	var productNums []int
	var clearProducts bool
	cmd := &cobra.Command{
		Use:         "edit <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/strategies/{n}"},
		Short:       "Edit a strategy",
		Long: `Edit a segment strategy. Only the flags you pass are changed.

PASSING AN EMPTY VALUE CLEARS THE FIELD: --area "" removes the area. Not passing
the flag leaves it alone.

--product REPLACES the product set rather than adding to it, so pass every
product the strategy leads with. --no-products clears it.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "strategy")
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("product") && clearProducts {
				return fmt.Errorf("--product and --no-products contradict each other — pass one")
			}
			req := client.StrategyRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = name
			}
			req.Vertical = patched(cmd, "vertical", vertical)
			req.Area = patched(cmd, "area", area)
			req.Rationale = patched(cmd, "why", rationale)
			req.CaseStudies = patched(cmd, "case-studies", caseStudies)
			if cmd.Flags().Changed("product") {
				req.Products = &productNums
			} else if clearProducts {
				empty := []int{}
				req.Products = &empty
			}
			if req.Name == "" && req.Vertical == nil && req.Area == nil &&
				req.Rationale == nil && req.CaseStudies == nil && req.Products == nil {
				return fmt.Errorf("nothing to change — pass at least one flag (bk sales strategy edit --help)")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			g, err := c.UpdateStrategy(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, g, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated strategy #%d: %s\n", g.Number, g.Name)
				return err
			})
		},
	}
	addStrategyFields(cmd, &name, &vertical, &area, &rationale, &caseStudies, &productNums)
	cmd.Flags().BoolVar(&clearProducts, "no-products", false, "Remove every product from this strategy")
	return cmd
}

func addStrategyFields(cmd *cobra.Command, name, vertical, area, rationale, caseStudies *string, products *[]int) {
	cmd.Flags().StringVar(name, "name", "", "What this segment is (\"Lausanne watch & jewellery\")")
	cmd.Flags().StringVar(vertical, "vertical", "", "The trade (\"watch & jewellery boutiques\")")
	cmd.Flags().StringVar(area, "area", "", "Where (\"Lausanne\", \"Romandie\")")
	cmd.Flags().StringVar(rationale, "why", "", "Why this segment, and how we pitch it")
	cmd.Flags().StringVar(caseStudies, "case-studies", "", "What we point at as proof")
	cmd.Flags().IntSliceVar(products, "product", nil, "A product's #number — repeatable; REPLACES the set")
}

func newStrategyDeleteCmd() *cobra.Command {
	var confirm string
	cmd := &cobra.Command{
		Use:         "rm <n> --confirm <name>",
		Aliases:     []string{"remove", "delete"},
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/strategies/{n}"},
		Short:       "Bin a strategy — recoverable from `bk sales trash`",
		Long: `Retire a segment strategy. This is a SOFT delete: it goes to the bin and
"bk sales trash restore strategy:<n>" brings it back.

The prospects linked to it are NOT unlinked, deliberately — a soft delete that
detached them could not be undone, since restoring the strategy would not
restore the links. This prints how many deals are affected.

--confirm must repeat the strategy's name back.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "strategy")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Read it first so --confirm can be checked against the NAME, which
			// is a value the caller can only supply by having looked at the row.
			// The server has no name in its URL to check against, so unlike the
			// prospect delete this guard lives here — and it is checked before
			// the request that bins anything is sent.
			existing, err := c.GetStrategy(ws, n)
			if err != nil {
				return err
			}
			if confirm != existing.Name {
				return fmt.Errorf("--confirm %q does not name strategy #%d — it is %q; nothing was removed",
					confirm, n, existing.Name)
			}
			gone, err := c.DeleteStrategy(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, gone, func(w io.Writer) error {
				fmt.Fprintf(w, "binned strategy #%d: %s\n", gone.Number, gone.Name)
				if gone.ProspectCount > 0 {
					fmt.Fprintf(w, "%d prospect(s) still point at it — they were NOT unlinked.\n",
						gone.ProspectCount)
				}
				fmt.Fprintf(w, "restore with: bk sales trash restore strategy:%d\n", gone.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the strategy's name back (required)")
	_ = cmd.MarkFlagRequired("confirm")
	return cmd
}
