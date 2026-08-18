// Recognition — the worklist, the rules, and the first write verb.
//
// ===========================================================================
// `bk books resolve` IS THE VERB AGENTS EXIST FOR
// ===========================================================================
// The app stores legible records and derives statements; the judgment of what a
// transaction MEANS lives in whoever drives these commands. An agent reads the
// worklist, reasons outside, and writes its conclusion back through resolve —
// which is why resolve reports the WHOLE consequence: the new state, the kept
// history, and the rule it taught, so the caller can say what it did.
//
// Nothing here applies a rule by itself. A suggestion column is as far as the
// machine goes; acting on it is the human's (or the human's agent's) line.
package books

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// ---------------------------------------------------------------------------
// worklist
// ---------------------------------------------------------------------------

func newWorklistCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "worklist",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/worklist"},
		Short:       "Everything needing a human: unrecognized and inferred, with suggestions",
		Long: "The to-do list of money that moved without an agreed meaning.\n\n" +
			"Each row shows the rules that WOULD explain it (computed live, never stored).\n" +
			"A suggestion is an opinion: apply one with `bk books resolve <n>`, or resolve\n" +
			"without a rule for a one-off. Rows come from both bookkeeping regimes; KIND\n" +
			"says which, and an ri_entry has no account to assign.",
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
			rows, err := c.GetBooksWorklist(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tDATE\tKIND\tLABEL\tAMOUNT\tRECOGNITION\tSUGGESTED RULES")
				for _, r := range rows {
					suggested := "—"
					if len(r.SuggestedRules) > 0 {
						parts := make([]string, len(r.SuggestedRules))
						for i, n := range r.SuggestedRules {
							parts[i] = "#" + strconv.Itoa(n)
						}
						suggested = strings.Join(parts, " ")
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						r.Number, r.Date, r.Kind, cmdutil.Truncate(r.RawLabel, 32), r.Amount, r.Recognition, suggested)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(worklist empty — every entry in scope is explained)")
				}
				return nil
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

// ---------------------------------------------------------------------------
// rule
// ---------------------------------------------------------------------------

func newRuleCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "rule",
		Short: "Recognition rules — remembered judgments, keyed to the (source, counterparty) pair",
	}
	cmd.AddCommand(newRuleListCmd(), newRuleCreateCmd())
	return cmd
}

func newRuleListCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/rules"},
		Short:       "List a book's recognition rules",
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
			rows, err := c.ListBooksRules(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tACTIVE\tCOUNTERPARTY\tAMOUNT\tACCOUNT\tLEARNED\tTAUGHT BY")
				for _, r := range rows {
					active := "yes"
					if !r.Active {
						active = "no"
					}
					amount := "any"
					if r.Pattern.AmountChf != nil {
						amount = fmt.Sprintf("%.2f", *r.Pattern.AmountChf)
						if r.Pattern.ToleranceChf != nil && *r.Pattern.ToleranceChf > 0 {
							amount += fmt.Sprintf(" ±%.2f", *r.Pattern.ToleranceChf)
						}
					}
					taughtBy := "—"
					if r.CreatedFrom != nil {
						taughtBy = "#" + strconv.Itoa(*r.CreatedFrom)
					}
					account := r.Account
					if account == "" {
						account = "—"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						r.Number, active, r.Pattern.Counterparty, amount, account, r.LearnedFrom, taughtBy)
				}
				return tw.Flush()
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

func newRuleCreateCmd() *cobra.Command {
	var req client.CreateBooksRuleRequest
	var amount, tolerance float64
	var sourceID int
	cmd := &cobra.Command{
		Use:         "create --counterparty <fragment>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/rules"},
		Short:       "Create a rule that predates its first matching entry",
		Long: "Most rules are taught by resolving an entry (`bk books resolve --rule ...`),\n" +
			"which records the teaching entry forever. This command is for knowledge that\n" +
			"arrives BEFORE the money: a signed lease, a subscription — set --learned-from\n" +
			"accordingly.\n\n" +
			"The match key is the PAIR: without --source the rule only matches sourceless\n" +
			"entries. The same merchant on an untracked card must stay unrecognized, so a\n" +
			"rule is never allowed to match on the name alone.",
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
			if cmd.Flags().Changed("amount") {
				req.AmountChf = &amount
			}
			if cmd.Flags().Changed("tolerance") {
				req.ToleranceChf = &tolerance
			}
			if cmd.Flags().Changed("source") {
				req.SourceID = &sourceID
			}
			r, err := c.CreateBooksRule(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created rule #%d: %s (%s)\n", r.Number, r.Pattern.Counterparty, r.LearnedFrom)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (default: the first book)")
	cmd.Flags().StringVar(&req.Counterparty, "counterparty", "", "Fragment matched against the raw label (required)")
	cmd.Flags().IntVar(&sourceID, "source", 0, "Source id the pair is keyed to (omit only for sourceless entries)")
	cmd.Flags().Float64Var(&amount, "amount", 0, "Expected amount in CHF (omit: any amount matches)")
	cmd.Flags().Float64Var(&tolerance, "tolerance", 0, "Accepted deviation in CHF (with --amount; omit: exact)")
	cmd.Flags().StringVar(&req.Interval, "interval", "", "Documented cadence: monthly, quarterly, weekly (not matched on)")
	cmd.Flags().StringVar(&req.Account, "account", "", "Account a match posts to")
	cmd.Flags().StringVar(&req.LearnedFrom, "learned-from", "manual", "contract, subscription, or manual")
	_ = cmd.MarkFlagRequired("counterparty")
	return cmd
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

func newResolveCmd() *cobra.Command {
	var req client.ResolveBooksEntryRequest
	var explanation, ruleCounterparty, ruleLearnedFrom, ruleInterval string
	var ruleAmount, ruleTolerance float64
	cmd := &cobra.Command{
		Use:         "resolve <number> --explanation <text>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entries/{number}/resolve"},
		Short:       "Say what the money was — the first write, and it keeps its history",
		Long: "Resolve one worklist entry by its #number.\n\n" +
			"The entry keeps its old state in history forever: a resolved row still shows\n" +
			"\"was: unrecognized\". Teach a rule with --rule-counterparty and the next\n" +
			"matching payment suggests itself; the rule is keyed to the SOURCE this entry\n" +
			"came through, because the pair is the match key.\n\n" +
			"--account fills the staged line that has none. On a POSTED entry the server\n" +
			"refuses it: those lines are accounting facts, and a correction is a reversing\n" +
			"entry. Interpretation (explanation, counterparty, recognition) stays open on\n" +
			"posted entries — that is the point of the freeze line, and why the frozen-UBS\n" +
			"mystery outflow can still be resolved months later.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not an entry number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			req.Explanation = map[string]any{"en": explanation}
			if ruleCounterparty != "" {
				req.Rule = &struct {
					Counterparty string   `json:"counterparty"`
					AmountChf    *float64 `json:"amount_chf,omitempty"`
					ToleranceChf *float64 `json:"tolerance_chf,omitempty"`
					Interval     string   `json:"interval,omitempty"`
					LearnedFrom  string   `json:"learned_from,omitempty"`
				}{Counterparty: ruleCounterparty, Interval: ruleInterval, LearnedFrom: ruleLearnedFrom}
				if cmd.Flags().Changed("rule-amount") {
					req.Rule.AmountChf = &ruleAmount
				}
				if cmd.Flags().Changed("rule-tolerance") {
					req.Rule.ToleranceChf = &ruleTolerance
				}
			}
			r, err := c.ResolveBooksEntry(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "resolved #%d -> %s\n", r.Number, r.Recognition); err != nil {
					return err
				}
				if r.TaughtRule != nil {
					_, err := fmt.Fprintf(w, "taught rule #%d — the next matching payment will suggest itself\n", *r.TaughtRule)
					return err
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&explanation, "explanation", "", "What this money was (required)")
	cmd.Flags().StringVar(&req.Recognition, "recognition", "", "known_one_off or known_recurring (default: from whether a rule is taught)")
	cmd.Flags().StringVar(&req.Counterparty, "counterparty", "", "Counterparty, once identified")
	cmd.Flags().StringVar(&req.Account, "account", "", "Account for the staged line that has none (refused on posted entries)")
	cmd.Flags().StringVar(&ruleCounterparty, "rule-counterparty", "", "Teach a rule: fragment matched against future labels")
	cmd.Flags().Float64Var(&ruleAmount, "rule-amount", 0, "Taught rule's expected amount in CHF")
	cmd.Flags().Float64Var(&ruleTolerance, "rule-tolerance", 0, "Taught rule's accepted deviation in CHF")
	cmd.Flags().StringVar(&ruleInterval, "rule-interval", "", "Taught rule's documented cadence")
	cmd.Flags().StringVar(&ruleLearnedFrom, "rule-learned-from", "manual", "contract, subscription, or manual")
	_ = cmd.MarkFlagRequired("explanation")
	return cmd
}
