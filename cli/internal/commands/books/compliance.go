// Package books — phase 5: compliance.
//
// `compliance list/show` read the 19 statutory rules — every one born DRAFT,
// because research against Fedlex is not a fiduciary's sign-off. `compliance
// review` is that sign-off, one rule at a time. `verdict` is the Devil's
// Advocate's door: an external agent files a structured verdict onto a
// record; the app never computes one itself, and the single enforced
// consequence — blocked refuses to post — lives in the server's posting path.
package books

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newComplianceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "compliance",
		Short: "The statutory rules — draft until the fiduciary signs off",
	}
	cmd.AddCommand(newComplianceListCmd(), newComplianceShowCmd(), newComplianceReviewCmd())
	return cmd
}

func newComplianceListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/compliance-rules"},
		Short:       "The statutory rules, with severity, confidence and review state",
		Long: "Every statutory rule this app knows, with how hard it bites, where it came\n" +
			"from, and whether a fiduciary has signed it off.\n\n" +
			"THE RULES ARE THE APP'S, NOT A BOOK'S. There is no --entity here: the set is\n" +
			"the same for every book, and APPLIES TO says which legal form each one bites on —\n" +
			"`SA`, `RI` or `both`. A rule that does not apply to a book simply never fires\n" +
			"against it.\n\n" +
			"CONFIDENCE is provenance, not quality: `verified_fedlex` means the citation was\n" +
			"checked against the federal text, `doctrine_inferred` means it was reasoned from\n" +
			"practice and wants a human before it is trusted.\n\n" +
			"STATE is the operational column. Everything starts `draft`; `bk books\n" +
			"compliance review` moves it to approved or rejected, and an approved rule may\n" +
			"carry the reviewer's corrected wording. Read one whole with `bk books\n" +
			"compliance show <rule-id>` — the ids are words, not numbers.\n\n" +
			"Filing a verdict against an ENTRY is a different verb: `bk books verdict`.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListBooksComplianceRules()
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "RULE\tSEVERITY\tAPPLIES\tCONFIDENCE\tSTATE\tCITATION")
				for _, r := range rows {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\n",
						r.RuleID, r.Severity, r.AppliesTo, r.SourceConfidence, r.ReviewState, cmdutil.Truncate(r.Citation, 40))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				draft := 0
				for _, r := range rows {
					if r.ReviewState == "draft" {
						draft++
					}
				}
				if draft > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(), "\n%d of %d rules are DRAFT: researched, not fiduciary-reviewed. bk books compliance review signs one off.\n", draft, len(rows))
				}
				return nil
			})
		},
	}
	return cmd
}

func newComplianceShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <rule-id>",
		Annotations: map[string]string{"routes": "GET /api/compliance-rules/{rule}"},
		Short:       "One rule, whole: trigger, logic, consequence, review trail",
		Long: "One statutory rule in full: what triggers it, the check as written, what\n" +
			"happens if it is breached, and who has signed it off.\n\n" +
			"CONFIDENCE says where the rule came from. `verified_fedlex` means the citation\n" +
			"was checked against the federal text; `doctrine_inferred` means it was reasoned\n" +
			"from practice and is exactly the kind a fiduciary should read before it is\n" +
			"trusted. It is not a quality score — it is a provenance label.\n\n" +
			"REVIEW is the operational half. A rule is `draft` until somebody signs it off\n" +
			"with `bk books compliance review`, and an `approved` rule may carry EDITED\n" +
			"LOGIC — the reviewer's corrected wording, shown beside the original rather than\n" +
			"replacing it.\n\n" +
			"The argument is the rule id, which is a WORD (bk-001, ret-002, receipt-001) and\n" +
			"never a number. `bk books compliance list` shows them.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.GetBooksComplianceRule(args[0])
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "%s · %s · applies to %s · %s\n", r.RuleID, r.Severity, r.AppliesTo, r.Citation)
				if s := biText(r.Summary); s != "" {
					fmt.Fprintf(w, "%s\n", s)
				}
				fmt.Fprintf(w, "\nTrigger:     %s\n", r.TriggerCondition)
				fmt.Fprintf(w, "Check:       %s\n", r.CheckLogic)
				if r.EditedLogic != "" {
					fmt.Fprintf(w, "As edited:   %s\n", r.EditedLogic)
				}
				fmt.Fprintf(w, "Consequence: %s\n", r.Consequence)
				fmt.Fprintf(w, "Confidence:  %s\n", r.SourceConfidence)
				fmt.Fprintf(w, "\nReview: %s", r.ReviewState)
				if r.ReviewedBy != "" {
					fmt.Fprintf(w, " — by %s at %s", r.ReviewedBy, r.ReviewedAt)
				}
				fmt.Fprintln(w)
				if r.ReviewNote != "" {
					fmt.Fprintf(w, "Note: %s\n", r.ReviewNote)
				}
				if r.ReviewState == "draft" {
					fmt.Fprintln(w, "\nDRAFT: researched against Fedlex, not reviewed by a fiduciary or lawyer.")
				}
				return nil
			})
		},
	}
	return cmd
}

func newComplianceReviewCmd() *cobra.Command {
	var approve, reject bool
	var editedLogic, note string
	cmd := &cobra.Command{
		Use:         "review <rule-id>",
		Annotations: map[string]string{"routes": "PATCH /api/compliance-rules/{rule}"},
		Short:       "Sign one rule off: --approve, --reject, or --edit-logic with the corrected wording",
		Long: "The fiduciary's sign-off, recorded with who and when. --edit-logic files the\n" +
			"corrected wording beside the original (the original stays — provenance is\n" +
			"permanent). There is no path back to draft: draft is where rules are born,\n" +
			"and un-reviewing would erase the fact that somebody looked.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			state := ""
			switch {
			case approve:
				state = "approved"
			case reject:
				state = "rejected"
			case editedLogic != "":
				state = "edited"
			default:
				return fmt.Errorf("say what the review found: --approve, --reject, or --edit-logic \"...\"")
			}
			r, err := c.ReviewBooksComplianceRule(args[0], client.ReviewBooksComplianceRuleRequest{
				State: state, EditedLogic: editedLogic, Note: note,
			})
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "%s is now %s (reviewed by %s)\n", r.RuleID, r.ReviewState, r.ReviewedBy)
				// A review is a signature, and the trail is the point: `show`
				// is where the reviewed logic and who signed it are read back.
				nextStep(w, "bk books compliance show %s", r.RuleID)
				also(w, "  what is still unreviewed: bk books compliance list")
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&approve, "approve", false, "The rule stands as researched")
	cmd.Flags().BoolVar(&reject, "reject", false, "The rule does not apply and must not flag")
	cmd.Flags().StringVar(&editedLogic, "edit-logic", "", "Approve with corrected check logic")
	cmd.Flags().StringVar(&note, "note", "", "Reviewer's note")
	return cmd
}

// ---------------------------------------------------------------------------
// bk books verdict — the Devil's Advocate's door
// ---------------------------------------------------------------------------

func newVerdictCmd() *cobra.Command {
	var entity, verdict, worstCase, resolves, rules string
	cmd := &cobra.Command{
		Use:         "verdict <entry-number>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entries/{number}/verdict"},
		Short:       "File a compliance verdict onto a record (external agent pass)",
		Long: "The Devil's Advocate writes a STRUCTURED verdict, not a pass/fail: accepted,\n" +
			"accepted_with_warning, or blocked — with the rules that triggered, the worst\n" +
			"case, and what would resolve it. It never corrects the record. blocked has\n" +
			"one enforced consequence: the entry refuses to post, server side. A fresh\n" +
			"verdict replaces the current one and the old one stays in history.\n\n" +
			"--entity names a simplified book when the number lives in its RI journal.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not an entry number; bk books entry list shows them", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			var ruleIDs []string
			for _, r := range strings.Split(rules, ",") {
				if s := strings.TrimSpace(r); s != "" {
					ruleIDs = append(ruleIDs, s)
				}
			}
			r, err := c.RecordBooksVerdict(ws, n, client.RecordBooksVerdictRequest{
				Entity: entity, Verdict: verdict, Rules: ruleIDs, WorstCase: worstCase, Resolves: resolves,
			})
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				journal := "grand livre"
				if r.Journal == "recettes_depenses" {
					journal = "recettes-dépenses"
				}
				fmt.Fprintf(w, "verdict %s filed on entry #%d (%s), citing %s\n", verdict, r.Number, journal, strings.Join(ruleIDs, ", "))
				// A verdict never corrects the record; `blocked` is the one
				// with an enforced consequence, and it is enforced server side.
				if verdict == "blocked" {
					fmt.Fprintln(w, "this entry will refuse to post until a fresh verdict clears it")
					if resolves != "" {
						also(w, "  what clears it: %s", resolves)
					}
					nextStep(w, "bk books entry show %d", r.Number)
					also(w, "  and once it is fixed, a FRESH verdict replaces this one (the old stays in history):")
					also(w, "  bk books verdict %d --verdict accepted --rules %s", r.Number, strings.Join(ruleIDs, ","))
					return nil
				}
				nextStep(w, "bk books entry post %d", r.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "The simplified book, when the number is an RI entry")
	cmd.Flags().StringVar(&verdict, "verdict", "", "accepted | accepted_with_warning | blocked (required)")
	cmd.Flags().StringVar(&rules, "rules", "", "The rule_ids that triggered, comma-separated (required)")
	cmd.Flags().StringVar(&worstCase, "worst-case", "", "What happens if this stands")
	cmd.Flags().StringVar(&resolves, "resolves", "", "What would clear it")
	_ = cmd.MarkFlagRequired("verdict")
	_ = cmd.MarkFlagRequired("rules")
	return cmd
}
