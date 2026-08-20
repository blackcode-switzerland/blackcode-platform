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
				fmt.Fprintln(tw, "#\tDATE\tKIND\tLABEL\tAMOUNT\tRECOGNITION\tSUGGESTED")
				for _, r := range rows {
					// Entries suggest RULES that would explain them; pieces
					// suggest ENTRIES they could prove. One column, labelled
					// by what each row is.
					suggested := "—"
					if len(r.SuggestedRules) > 0 {
						parts := make([]string, len(r.SuggestedRules))
						for i, n := range r.SuggestedRules {
							parts[i] = "rule #" + strconv.Itoa(n)
						}
						suggested = strings.Join(parts, " ")
					} else if len(r.SuggestedEntries) > 0 {
						parts := make([]string, len(r.SuggestedEntries))
						for i, n := range r.SuggestedEntries {
							parts[i] = "entry #" + strconv.Itoa(n)
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
		Long: "A rule is a judgment this app remembered so the next identical payment does not\n" +
			"need one.\n\n" +
			"THE MATCH KEY IS THE PAIR: the SOURCE a payment arrives through, and a fragment\n" +
			"of its label. Never the name alone — the same merchant on an untracked card has\n" +
			"to stay unexplained, because that is what keeps the completeness signal honest.\n\n" +
			"RULES RUN AT IMPORT AND NEVER APPLY THEMSELVES. A match marks the line\n" +
			"`inferred` and puts it on the worklist citing the rule; a human or an agent\n" +
			"still resolves it. The machine suggests, and that is the whole of its authority.\n\n" +
			"Most rules are TAUGHT by `bk books resolve --rule-counterparty …`, which records\n" +
			"the teaching entry forever. `create` is for knowledge that arrives before the\n" +
			"money — a signed lease, a subscription.\n\n" +
			"Nothing here is deleted. `deactivate` stops a rule matching future imports; the\n" +
			"entries it already explained keep it, because a posted entry may cite it for ten\n" +
			"years. There is no reactivate.",
	}
	cmd.AddCommand(newRuleListCmd(), newRuleCreateCmd(), newRuleDeactivateCmd())
	return cmd
}

func newRuleListCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/rules"},
		Short:       "List a book's recognition rules",
		Long: "The judgments this book has remembered. A rule is keyed to the PAIR — the\n" +
			"source a payment arrives through and a fragment of its label — never the\n" +
			"merchant name alone, so the same name on an untracked card stays unexplained.\n\n" +
			"TAUGHT BY names the entry the rule was learned from, and it is kept forever: a\n" +
			"rule that is marking the wrong thing can be traced to the resolution that\n" +
			"created it. A `—` means the rule was declared ahead of the money with `bk books\n" +
			"rule create`.\n\n" +
			"ACTIVE `no` means `bk books rule deactivate` has switched it off. The row stays:\n" +
			"a posted entry may cite the rule for the ten years art. 958f keeps the entry, so\n" +
			"a rule is never deleted and there is no reactivate.\n\n" +
			"RULES ARE PER BOOK, NOT PER YEAR. --exercice is accepted and changes nothing.",
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
		Long: "Most rules are taught by resolving an entry, which records the teaching\n" +
			"entry forever:\n\n" +
			"  bk books resolve <n> --explanation <text> --rule-counterparty <fragment>\n\n" +
			"This command is for knowledge that arrives BEFORE the money: a signed lease,\n" +
			"a subscription — set --learned-from accordingly.\n\n" +
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
				req.Source = &sourceID
			}
			r, err := c.CreateBooksRule(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "created rule #%d: %s (%s)\n", r.Number, r.Pattern.Counterparty, r.LearnedFrom); err != nil {
					return err
				}
				// A rule changes nothing that has already landed: rules run AT
				// ARRIVAL, and only ever to mark a line `inferred`. Saying so is
				// the point — a caller that expects the existing worklist to
				// shrink will read the unchanged list as the rule not working.
				also(w, "rules run at IMPORT and only suggest — nothing already imported changes:")
				nextStep(w, "bk books source import <n> --file <statement.xml>   (bk books source list%s)",
					entityFlag(req.Entity))
				also(w, "  what it will match, and every other rule: bk books rule list%s", entityFlag(req.Entity))
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (default: the first book)")
	cmd.Flags().StringVar(&req.Counterparty, "counterparty", "", "Fragment matched against the raw label (required)")
	cmd.Flags().IntVar(&sourceID, "source", 0, "Source #number the pair is keyed to, as bk books source list prints it (omit only for sourceless entries)")
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
		Use: "resolve <number> --explanation <text>",
		// The GET is the state read behind the next-step line: whether the
		// entry is still staged, and whether a `blocked` verdict stands. "Post
		// it" is a refusal waiting to happen against a blocked entry, and the
		// phase README is explicit that saying the state beats suggesting a
		// call that will fail.
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entries/{number}/resolve, GET /api/workspaces/{ws}/entries/{number}"},
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
			// THE NEXT STEP HERE DEPENDS ON STATE, and getting it wrong is
			// worse than silence: "post it" is a refusal waiting to happen when
			// a `blocked` verdict stands, and a no-op when the entry is already
			// posted. The resolve response carries neither fact, so the entry
			// is read back. Best effort — a failed read costs the tailored
			// line, never the resolution, which has already landed.
			after, afterErr := c.GetBooksEntry(ws, n, req.Entity)
			return output.Render(format, r, func(w io.Writer) error {
				line := fmt.Sprintf("resolved #%d -> %s", r.Number, r.Recognition)
				if r.Direction != nil {
					line += fmt.Sprintf(" (%s)", *r.Direction)
				}
				if _, err := fmt.Fprintf(w, "%s\n", line); err != nil {
					return err
				}
				if r.TaughtRule != nil {
					if _, err := fmt.Fprintf(w, "taught rule #%d — the next matching payment will suggest itself\n", *r.TaughtRule); err != nil {
						return err
					}
				}
				if afterErr != nil {
					nextStep(w, "bk books entry show %d", n)
					return nil
				}
				if v, blocked, resolves := verdictState(after.Verdict); blocked {
					also(w, "verdict %s: this entry will REFUSE to post, server side.", v)
					if resolves != "" {
						also(w, "  what clears it: %s", resolves)
					}
					nextStep(w, "bk books verdict %d --verdict accepted --rules <rule-ids> --worst-case <text>", n)
					return nil
				}
				switch after.Status {
				case "posted":
					also(w, "the entry is already posted — interpretation is what you just changed; the lines are fixed.")
					nextStep(w, "bk books entry show %d", n)
				default:
					nextStep(w, "bk books entry post %d", n)
					also(w, "  what is still unjudged: bk books worklist%s", entityFlag(after.Entity))
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&explanation, "explanation", "", "What this money was (required)")
	cmd.Flags().StringVar(&req.Recognition, "recognition", "", "known_one_off or known_recurring (default: from whether a rule is taught)")
	cmd.Flags().StringVar(&req.Direction, "direction", "", "SIMPLIFIED books: recette, depense, or neutral for an own-account transfer")
	cmd.Flags().StringVar(&req.Counterparty, "counterparty", "", "Counterparty, once identified")
	cmd.Flags().StringVar(&req.Account, "account", "", "Account for the staged line that has none (refused on posted entries)")
	cmd.Flags().StringVar(&req.Entity, "entity", "", "A SIMPLIFIED book's slug: resolve in its recettes-dépenses journal")
	cmd.Flags().StringVar(&req.TvaRate, "tva-rate", "", "VAT rate as written on the invoice; run bk meta for the current ones (frozen once posted)")
	cmd.Flags().StringVar(&req.TvaAmount, "tva-amount", "", "VAT in CHF (default: derived from the entry's amount at that rate)")
	cmd.Flags().BoolVar(&req.TvaInputClaimed, "tva-input-claimed", false, "Claim the input tax (art. 28 LTVA; needs --evidence-tier full)")
	cmd.Flags().StringVar(&req.EvidenceTier, "evidence-tier", "", "full, partial or bare — full means the pièce is on file")
	cmd.Flags().BoolVar(&req.TvaClear, "no-tva", false, "Remove the VAT story this entry carries (omitting the rate leaves it alone)")
	cmd.Flags().StringVar(&ruleCounterparty, "rule-counterparty", "", "Teach a rule: fragment matched against future labels")
	cmd.Flags().Float64Var(&ruleAmount, "rule-amount", 0, "Taught rule's expected amount in CHF")
	cmd.Flags().Float64Var(&ruleTolerance, "rule-tolerance", 0, "Taught rule's accepted deviation in CHF")
	cmd.Flags().StringVar(&ruleInterval, "rule-interval", "", "Taught rule's documented cadence")
	cmd.Flags().StringVar(&ruleLearnedFrom, "rule-learned-from", "manual", "contract, subscription, or manual")
	_ = cmd.MarkFlagRequired("explanation")
	return cmd
}
