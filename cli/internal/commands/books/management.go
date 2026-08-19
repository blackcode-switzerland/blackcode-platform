// Package books — phase 4B: the management layer.
//
// `analytique` and `tax` are pure reads over derivations the server computes
// at request time. `analyse record` is the agent write-back contract: an
// outside agent reads the data, answers a question, and files the answer WITH
// its based_on snapshot. The record is permanent — there is no analyse edit
// and no analyse delete, on purpose, and the server enforces it by grant.
// `category create` is configuration: the breakdown's buckets, per book.
package books

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// biText renders a bilingual {fr, en} value (or a plain string) for a card.
// English first when both halves exist — the CLI's own copy is English.
func biText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case map[string]any:
		if en, ok := t["en"].(string); ok && en != "" {
			return en
		}
		if fr, ok := t["fr"].(string); ok && fr != "" {
			return fr
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// bk books analytique
// ---------------------------------------------------------------------------

func newAnalytiqueCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "analytique",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/analytique"},
		Short:       "Cost breakdown per category, and the monthly flows",
		Long: "The management view of one (book, exercice): charges per category and the\n" +
			"monthly produits/charges series. Derived from POSTED lines at request time —\n" +
			"staged money reaches no chart. A simplified book groups its dépenses by their\n" +
			"own category label instead.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.GetBooksAnalytique(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "%s · %d\n\n", r.Entity, r.Exercice)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "CATEGORY\tLABEL\tAMOUNT\tLINES")
				for _, cat := range r.Categories {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%d\n", cat.Key, cmdutil.Truncate(biText(cat.Label), 28), cat.Amount, len(cat.Lines))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintln(w)
				tw = output.Tabwriter(w)
				fmt.Fprintln(tw, "MONTH\tPRODUITS\tCHARGES")
				for _, f := range r.MonthlyFlows {
					fmt.Fprintf(tw, "%s\t%s\t%s\n", f.Month, f.Produits, f.Charges)
				}
				return tw.Flush()
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

// ---------------------------------------------------------------------------
// bk books analyse — list, show, record
// ---------------------------------------------------------------------------

func newAnalyseCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "analyse",
		Short: "Recorded analyses — questions asked, verdicts filed, snapshots kept",
	}
	cmd.AddCommand(newAnalyseListCmd(), newAnalyseShowCmd(), newAnalyseRecordCmd())
	return cmd
}

func newAnalyseListCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/analyses"},
		Short:       "List filed analyses",
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
			rows, err := c.ListBooksAnalyses(ws, entity)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tASKED\tBOOK\tBY\tAGENT\tQUESTION")
				for _, a := range rows {
					asked := a.Asked
					if len(asked) > 10 {
						asked = asked[:10]
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						a.Number, asked, a.Entity, a.AskedBy, a.Agent, cmdutil.Truncate(biText(a.Question), 44))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no analyses filed)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Only this book's analyses")
	return cmd
}

func newAnalyseShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <number>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/analyses/{number}"},
		Short:       "One analysis, whole: verdict, figures, and the based_on snapshot as filed",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not an analysis number; bk books analyse list shows them", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			a, err := c.GetBooksAnalysis(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, a, func(w io.Writer) error {
				fmt.Fprintf(w, "Analysis #%d · %s · asked %s by %s · agent %s\n", a.Number, a.Entity, a.Asked, a.AskedBy, a.Agent)
				if s := biText(a.ScenarioLabel); s != "" {
					fmt.Fprintf(w, "Scenario: %s", s)
					if a.RunwayAfterMonths != nil {
						fmt.Fprintf(w, " (runway after: %.1f months)", *a.RunwayAfterMonths)
					}
					fmt.Fprintln(w)
				}
				fmt.Fprintf(w, "\nQ: %s\n", biText(a.Question))
				fmt.Fprintf(w, "A: %s\n", biText(a.Verdict))
				if len(a.Figures) > 0 {
					fmt.Fprintln(w, "\nFigures:")
					for _, f := range a.Figures {
						fmt.Fprintf(w, "  %s: %v\n", biText(f["label"]), f["value"])
					}
				}
				if len(a.BasedOn) > 0 {
					fmt.Fprintln(w, "\nBased on (snapshot at answer time, never recomputed):")
					for _, b := range a.BasedOn {
						line := fmt.Sprintf("  %s: %v", biText(b["label"]), b["value"])
						if href, ok := b["href"].(string); ok && href != "" {
							line += "  → " + href
						}
						fmt.Fprintln(w, line)
					}
				}
				return nil
			})
		},
	}
	return cmd
}

func newAnalyseRecordCmd() *cobra.Command {
	var req client.RecordBooksAnalysisRequest
	var question, verdict, scenario, figuresJSON, basedOnJSON string
	var runway float64
	cmd := &cobra.Command{
		Use:         "record",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/analyses"},
		Short:       "File an analysis — the agent write-back",
		Long: "File one analysis: the question, the verdict, and the based_on snapshot of\n" +
			"what was READ to answer it. The row is permanent the moment it lands: there is\n" +
			"no edit and no delete. A drifted answer is re-asked into a NEW record, and both\n" +
			"stand.\n\n" +
			"--based-on and --figures take JSON arrays; every based_on item needs label and\n" +
			"value ({\"label\": ..., \"value\": ..., \"href\"?: ...}) — the server refuses a\n" +
			"snapshot that snapshots nothing.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			req.Question = question
			req.Verdict = verdict
			if scenario != "" {
				req.ScenarioLabel = scenario
			}
			if cmd.Flags().Changed("runway-after-months") {
				req.RunwayAfterMonths = &runway
			}
			if figuresJSON != "" {
				if err := json.Unmarshal([]byte(figuresJSON), &req.Figures); err != nil {
					return fmt.Errorf("--figures is not a JSON array: %w", err)
				}
			}
			if basedOnJSON != "" {
				if err := json.Unmarshal([]byte(basedOnJSON), &req.BasedOn); err != nil {
					return fmt.Errorf("--based-on is not a JSON array: %w", err)
				}
			}
			a, err := c.RecordBooksAnalysis(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, a, func(w io.Writer) error {
				fmt.Fprintf(w, "analysis #%d filed on %s — permanent, with its snapshot\n", a.Number, a.Entity)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "The book this analysis is about (required)")
	cmd.Flags().StringVar(&req.AskedBy, "asked-by", "", "Who asked the question (required)")
	cmd.Flags().StringVar(&req.Agent, "agent", "", "Which agent answered (required)")
	cmd.Flags().StringVar(&question, "question", "", "The question, as asked (required)")
	cmd.Flags().StringVar(&verdict, "verdict", "", "The verdict, as given (required)")
	cmd.Flags().StringVar(&figuresJSON, "figures", "", `Headline figures, JSON: [{"label": ..., "value": ...}]`)
	cmd.Flags().StringVar(&basedOnJSON, "based-on", "", `What was read, JSON: [{"label": ..., "value": ..., "href"?: ...}]`)
	cmd.Flags().StringVar(&scenario, "scenario", "", "Optional what-if label")
	cmd.Flags().Float64Var(&runway, "runway-after-months", 0, "Numeric runway restatement, for charts")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("asked-by")
	_ = cmd.MarkFlagRequired("agent")
	_ = cmd.MarkFlagRequired("question")
	_ = cmd.MarkFlagRequired("verdict")
	return cmd
}

// ---------------------------------------------------------------------------
// bk books category — list, create
// ---------------------------------------------------------------------------

func newCategoryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "category",
		Short: "The analytique's cost buckets — per book, account-mapped",
	}
	cmd.AddCommand(newCategoryListCmd(), newCategoryCreateCmd())
	return cmd
}

func newCategoryListCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/analytique/categories"},
		Short:       "List a book's cost categories",
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
			rows, err := c.ListBooksCategories(ws, entity)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tKEY\tLABEL\tACCOUNTS\tRETIRED")
				for _, r := range rows {
					retired := ""
					if r.Retired {
						retired = "retired"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.Number, r.Key, cmdutil.Truncate(biText(r.Label), 28), cmdutil.Truncate(fmt.Sprint(r.Accounts), 30), retired)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Which book (defaults to the first)")
	return cmd
}

func newCategoryCreateCmd() *cobra.Command {
	var entity, key, labelFr, labelEn string
	var accounts []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/analytique/categories"},
		Short:       "Create a cost category",
		Long: "Create one cost category: a key, a label, and the ledger accounts it counts.\n\n" +
			"Two refusals guard it: every account must exist in the book's chart, and no\n" +
			"account may already be counted by another active category — one franc, one bar.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			var label any
			switch {
			case labelFr != "" && labelEn != "":
				label = map[string]any{"fr": labelFr, "en": labelEn}
			case labelFr != "":
				label = labelFr
			default:
				label = labelEn
			}
			r, err := c.CreateBooksCategory(ws, client.CreateBooksCategoryRequest{
				Entity: entity, Key: key, Label: label, Accounts: accounts,
			})
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "category #%d %q on %s, counting %v\n", r.Number, r.Key, r.Entity, r.Accounts)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "The book (required)")
	cmd.Flags().StringVar(&key, "key", "", "Stable key: lowercase, digits, underscores (required)")
	cmd.Flags().StringVar(&labelFr, "label-fr", "", "French label")
	cmd.Flags().StringVar(&labelEn, "label-en", "", "English label (at least one label required)")
	cmd.Flags().StringSliceVar(&accounts, "accounts", nil, "Ledger accounts this bucket counts, comma-separated (required)")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("key")
	_ = cmd.MarkFlagRequired("accounts")
	return cmd
}

// ---------------------------------------------------------------------------
// bk books tax
// ---------------------------------------------------------------------------

func newTaxCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "tax",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tax-snapshot"},
		Short:       "The PM tax snapshot — derived, cited, never stored",
		Long: "VAT position from the entries' own TVA columns, profit and equity from the\n" +
			"statements, and the two PM tax ESTIMATES from the book's parameter record.\n" +
			"A book with no parameters answers 'not configured' — never someone else's\n" +
			"rates. Tracking over time is b/tax; this is a snapshot only.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.GetBooksTaxSnapshot(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "%s · %d\n\n", r.Entity, r.Exercice)
				fmt.Fprintf(w, "Résultat: %s   Capitaux propres: %s\n", r.Profit, r.Equity)
				if r.Vat != nil {
					fmt.Fprintf(w, "\nTVA — opening due %s, output YTD %s, input claimed YTD %s → net due %s\n",
						r.Vat.OpeningDue, r.Vat.OutputYtd, r.Vat.InputClaimedYtd, r.Vat.NetDue)
				} else {
					fmt.Fprintln(w, "\nTVA — not registered")
				}
				if r.Tax == nil {
					fmt.Fprintln(w, "\nTax parameters: NOT CONFIGURED for this book — no rates are shown rather than someone else's.")
					return nil
				}
				t := r.Tax
				fmt.Fprintf(w, "\nImpôt sur le bénéfice (%s / %s) — estimate:\n", t.Canton, t.Commune)
				fmt.Fprintf(w, "  cantonal %s + communal %s + IFD %s = %s\n", t.ProfitTax.Cantonal, t.ProfitTax.Communal, t.ProfitTax.Ifd, t.ProfitTax.Total)
				fmt.Fprintf(w, "  statutory %.2f%% · effective %.2f%% (taxes are deductible)\n", t.ProfitTax.StatutoryPct, t.ProfitTax.EffectivePct)
				fmt.Fprintf(w, "Impôt sur le capital — gross %s, credited against profit tax %s → net due %s\n",
					t.CapitalTax.Gross, t.CapitalTax.Credited, t.CapitalTax.NetDue)
				if cap, ok := t.Params["capital_tax"].(map[string]any); ok {
					if confirmed, ok := cap["confirmed"].(bool); ok && !confirmed {
						fmt.Fprintln(w, "  (capital tax UNCONFIRMED: the art. 118 imputation question is open with the fiduciary)")
					}
				}
				return nil
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}
