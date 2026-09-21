// `bk billing audit …` and `bk billing overview` — the two reads that are not
// about one record.
package billing

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newAuditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "audit",
		Short: "Who changed what, and when",
		Long: `The append-only log.

THE LOG IS THE EDIT WORKFLOW. There is no separate history feature: every write
appends here in the same transaction as the change, so a change with no log
entry is impossible rather than discouraged. Nothing in it is ever updated or
deleted, and the database refuses both.

Humans and agents land in the SAME log. An agent write is a user's token, so the
person is always known; "via" is the only difference between the two.

IT IS ALSO THIS APP'S EVENT FEED. "bk billing audit list" reads forward from a
cursor, which is how a system outside this app learns that a bill was sent, paid
or voided by somebody in the browser. See that command's help for the cursor.`,
	}
	cmd.AddCommand(newAuditListCmd())
	return cmd
}

func newAuditListCmd() *cobra.Command {
	var subject string
	var since int
	var limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/audit"},
		Short:       "Read the log, newest first — or forward from a cursor",
		Long: `Read the log.

WITHOUT --since the newest entry is first, which is what you want when reading.

WITH --since the entries come back ASCENDING from that cursor, which is what you
want when polling: a descending feed would make you re-read the same page
forever. The order changing with the flag is a contract, not a quirk.

A poller cannot miss an entry. The sequence is allocated under a row lock, so
sequence order is commit order — no entry can appear below a cursor you have
already passed. Store the last number you saw and pass it back.

  bk billing audit list --since 0            everything, oldest first
  bk billing audit list --since 412          what has happened since
  bk billing audit list --subject invoice:7  one invoice's history
  bk billing audit list --subject recurrence:3  one series' history: its
                                             counter, pauses, replacements`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// -1 means "not asked", because `--since 0` is meaningful: it is
			// "everything from the beginning, ascending".
			sinceArg := -1
			if cmd.Flags().Changed("since") {
				sinceArg = since
			}
			page, err := c.ListBillingAudit(ws, subject, sinceArg, limit)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				if len(page.Data) == 0 {
					if sinceArg >= 0 {
						fmt.Fprintf(w, "Nothing since %d.\n", sinceArg)
					} else {
						fmt.Fprintln(w, "Nothing in the log yet.")
					}
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "SEQ\tWHEN\tWHO\tVIA\tACTION\tFIELD\tCHANGE")
				for _, e := range page.Data {
					who := e.Actor.Email
					if who == "" {
						// `actor_user_id` is ON DELETE SET NULL, so a closed
						// account leaves its entries in place with no actor. The
						// entry must still appear: that is what append-only means.
						who = "(account closed)"
					}
					change := ""
					if e.Field != "" {
						change = fmt.Sprintf("%s → %s", orDash(e.FromValue), orDash(e.ToValue))
					} else if e.DetailEn != "" {
						change = e.DetailEn
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						e.Number, e.Ts[:19], cmdutil.Truncate(who, 24), e.Actor.Via,
						e.Action, orDash(e.Field), cmdutil.Truncate(change, 40))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if page.NextCursor != nil {
					fmt.Fprintf(w, "\nmore: --since %d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&subject, "subject", "", "One record's history: invoice:<ref> or recurrence:<#>")
	cmd.Flags().IntVar(&since, "since", 0, "Read forward from this seq, ascending (0 = from the beginning)")
	cmd.Flags().IntVar(&limit, "limit", 0, "How many entries (bk meta for the ceiling)")
	return cmd
}

func newOverviewCmd() *cobra.Command {
	var company string
	cmd := &cobra.Command{
		Use:         "overview",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/overview"},
		Short:       "What is owed, what is paid, what needs a person",
		Long: `The workspace at a glance.

MONEY IS REPORTED PER CURRENCY AND NEVER MERGED. Adding CHF to EUR produces a
number that is not money in any currency, so there is deliberately no grand
total: if you want one figure, pick a currency.

"overdue" is a SUBSET of "outstanding", not a third bucket. A late bill is still
owed, so adding them would double-count.

A DRAFT counts toward neither: it has not been sent, so nobody owes it. A VOID
counts toward nothing at all — it is a record that a bill was cancelled, not a
receivable and not revenue.

"needs action" is what a person should look at: a sent bill past its due date, or
a draft that was never sent. The second is the expensive one — work done and
never billed for.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			ov, err := c.GetBillingOverview(ws, company)
			if err != nil {
				return err
			}
			return output.Render(format, ov, func(w io.Writer) error {
				if len(ov.ByCurrency) == 0 {
					fmt.Fprintln(w, "No invoices yet.")
					nextStep(w, `bk billing invoice create --company <slug> --item "desc|1|pcs|100.00"`)
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "CURRENCY\tOUTSTANDING\tOF WHICH OVERDUE\tPAID\tINVOICES")
				for _, b := range ov.ByCurrency {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%d\n",
						b.Currency, b.Outstanding, b.Overdue, b.Paid, b.Count)
				}
				if err := tw.Flush(); err != nil {
					return err
				}

				if len(ov.NeedsAction) > 0 {
					fmt.Fprintf(w, "\nNeeds action (%d):\n", len(ov.NeedsAction))
					t2 := output.Tabwriter(w)
					fmt.Fprintln(t2, "  #\tNUMBER\tSTATUS\tDUE\tTOTAL\tWHY")
					for _, i := range ov.NeedsAction {
						why := "drafted, never sent"
						if i.Status == "sent" {
							why = "past due"
						}
						fmt.Fprintf(t2, "  %d\t%s\t%s\t%s\t%s %s\t%s\n",
							i.Number, i.Ref, i.Status, orDash(i.DueDate), i.Currency, i.Totals.Total, why)
					}
					if err := t2.Flush(); err != nil {
						return err
					}
				}

				if len(ov.RecentAudit) > 0 {
					fmt.Fprintf(w, "\nRecently: ")
					parts := make([]string, 0, 3)
					for i, e := range ov.RecentAudit {
						if i == 3 {
							break
						}
						parts = append(parts, fmt.Sprintf("%s %s", e.Action, e.SubjectType))
					}
					fmt.Fprintln(w, strings.Join(parts, ", "))
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&company, "company", "", "Only this company's figures")
	return cmd
}
