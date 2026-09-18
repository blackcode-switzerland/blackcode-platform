// `bk billing invoice send | mark-sent | paid | void` — the lifecycle.
//
// ---------------------------------------------------------------------------
// FOUR COMMANDS, AND WHAT EACH ONE IS A STATEMENT OF
// ---------------------------------------------------------------------------
//
//	send       "this app emailed the PDF; here is the message id"
//	mark-sent  "it went out some other way; we were told"      (no message id)
//	paid       "the money arrived on this date"                (an assertion)
//	void       "cancelled, for this reason"                    (number kept)
//
// None of them can be undone. `sent -> draft` and `void -> anything` are not
// transitions the database allows, so every command here prints what it DID —
// the number, the client and the amount, captured from the response — rather
// than a bare "ok".
//
// ---------------------------------------------------------------------------
// VOID REQUIRES --confirm, AND --yes DOES NOT REPLACE IT
// ---------------------------------------------------------------------------
// `cmdutil.Confirm()` returns true under --yes, under BK_NO_PROMPT=1 and on any
// non-TTY — which is exactly how agents run. So the guard is the caller
// repeating the invoice's PRINTED NUMBER back. Three details, each learned
// elsewhere in this repo:
//
//  1. TRIM, then compare, then SEND THE TRIMMED VALUE. A version elsewhere once
//     compared a trimmed copy and put the untrimmed flag on the wire, so the
//     server decided on input the binary had never looked at.
//  2. READ THE TARGET FIRST, and compare against its real number. Comparing
//     `--confirm` with the <ref> argument would let `void 7 --confirm 7` through
//     — the same typo twice is not a confirmation.
//  3. Word the refusal to contain "required" and return a UsageError: exit 2,
//     the code the server's own 409 `confirm_mismatch` maps to.
package billing

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// sentHow says which of the two "sent" facts an invoice records.
func sentHow(inv *client.BillingInvoice) string {
	if inv.SentMessageID == "" {
		return "outside this app (no email, no PDF fingerprint)"
	}
	sha := inv.PdfSha256
	if len(sha) > 12 {
		sha = sha[:12] + "…"
	}
	return fmt.Sprintf("by email, message %s, PDF sha256 %s", inv.SentMessageID, sha)
}

// checkVoidConfirm is the whole --confirm rule, as a function a test can call.
// It returns the value to SEND — trimmed — so the caller cannot compare one
// string and transmit another.
func checkVoidConfirm(flag, number string) (string, error) {
	confirm := strings.TrimSpace(flag)
	if confirm == "" {
		return "", cmdutil.Usagef(
			"--confirm is required: repeat the invoice's printed number (%s) to void it, even with --yes", number)
	}
	if confirm != number {
		return "", cmdutil.Usagef(
			"--confirm is required and must match the invoice being voided exactly: --confirm %s (got %q)", number, confirm)
	}
	return confirm, nil
}

func newInvoiceSendCmd() *cobra.Command {
	var req client.SendBillingInvoiceRequest
	var body, bodyFile, idempotencyKey string

	cmd := &cobra.Command{
		Use:         "send <ref> --to <email>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/invoices/{ref}/send"},
		Args:        cobra.ExactArgs(1),
		Short:       "Email the invoice PDF to the client and mark it sent",
		Long: `Email a DRAFT invoice with its PDF attached, and record that it went.

The email comes from this app's name at the platform's verified address, with
REPLY-TO set to the issuing company's own email — so a client who replies
reaches the company, not the platform. The company therefore needs an email
address before any of its invoices can be sent.

--subject and --body are optional. Without them the mail is written in the
invoice's DOCUMENT language, naming the number, the amount and the due date.
Use --body-file FILE (or --body -) for a multi-line body: a newline typed into
a flag value is where shells and PowerShell disagree.

WHAT IS RECORDED: the status becomes sent, with the moment, the email's
message id, the sha256 of the exact PDF bytes attached, and a copy of the issuing
company as it was — name, address, accounts, rounding policy — which the invoice
renders from forever after. One audit entry names the recipients and the
message id. "invoice pdf" later tells you whether what it fetched is byte for
byte what was mailed.

WHAT CAN GO WRONG, and what each leaves behind:

  email_not_configured   this deployment cannot send email. Nothing happened.
  payment_part_invalid   the record would make a payment part a bank rejects
                         (an incomplete address, no QR-IBAN for a QRR bill, a
                         character the standard does not carry). Nothing
                         happened. Every problem is named; "invoice show" lists
                         them, and "invoice pdf" is the dry run for this.
  email_delivery_failed  the mail was refused. Still a draft; fix and resend.
  delivered_not_recorded the mail WENT and recording it failed. Do NOT send
                         again; run "invoice mark-sent".

From a script, pass --idempotency-key: a rerun with the same key replays the
first answer instead of mailing the client twice.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if strings.TrimSpace(req.To) == "" {
				return cmdutil.Usagef("--to is required: the address the invoice is mailed to")
			}
			if cmd.Flags().Changed("body") || bodyFile != "" {
				b, err := cmdutil.ReadBody(body, bodyFile)
				if err != nil {
					return err
				}
				req.Body = b
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			inv, err := c.SendBillingInvoice(ws, args[0], req, idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				if inv.SentMessageID == "" {
					// The development carve-out: no email key outside production.
					// Said loudly, because "sent" with nothing delivered is the
					// state this command must never let somebody misread.
					fmt.Fprintf(w, "marked %s (#%d) sent WITHOUT delivering it — this deployment has no email key\n",
						inv.Ref, inv.Number)
				} else {
					fmt.Fprintf(w, "sent %s (#%d) to %s — %s %s, message %s\n",
						inv.Ref, inv.Number, req.To, inv.Currency, inv.Totals.Total, inv.SentMessageID)
				}
				nextStep(w, "bk billing invoice paid %d --date <YYYY-MM-DD>   (when the money arrives)", inv.Number)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&req.To, "to", "", "The client's email address (required)")
	f.StringArrayVar(&req.Cc, "cc", nil, "A copy to this address; repeatable")
	f.StringVar(&req.Subject, "subject", "", "Override the default subject")
	f.StringVar(&body, "body", "", `Override the covering note, or "-" to read it from stdin`)
	f.StringVar(&bodyFile, "body-file", "", "Read the covering note from this file")
	f.StringVar(&idempotencyKey, "idempotency-key", "", "Your identifier for this send; a rerun with the same key replays instead of mailing again")
	return cmd
}

func newInvoiceMarkSentCmd() *cobra.Command {
	var idempotencyKey string
	cmd := &cobra.Command{
		Use:         "mark-sent <ref>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/invoices/{ref}/mark-sent"},
		Args:        cobra.ExactArgs(1),
		Short:       "Record that the invoice went out another way (paper, another mailbox)",
		Long: `Mark a DRAFT invoice as sent WITHOUT emailing it.

For a bill delivered on paper, from somebody's own mailbox, or by hand. No email
is sent and no PDF fingerprint is recorded — and the missing message id is how
the record says, permanently, that this app did not deliver it.

The same checks as "invoice send" apply, all of them: it needs lines, a client,
a positive total, an account to be paid into, AND a record that makes a valid
QR-bill (payment_part_invalid otherwise). Once an invoice is sent its document is
frozen, so one that could not render at that moment could never be served.

From that moment the invoice carries its own copy of the issuing company, and
later edits to the company do not reach it.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			inv, err := c.MarkBillingInvoiceSent(ws, args[0], idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				fmt.Fprintf(w, "marked %s (#%d) sent outside this app — %s, %s %s\n",
					inv.Ref, inv.Number, inv.Client.Name, inv.Currency, inv.Totals.Total)
				nextStep(w, "bk billing invoice paid %d --date <YYYY-MM-DD>   (when the money arrives)", inv.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Your identifier for this request")
	return cmd
}

func newInvoicePaidCmd() *cobra.Command {
	var paidDate, idempotencyKey string
	cmd := &cobra.Command{
		Use:         "paid <ref> --date <YYYY-MM-DD>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/invoices/{ref}/paid"},
		Args:        cobra.ExactArgs(1),
		Short:       "Assert that a sent invoice has been paid",
		Long: `Mark a SENT invoice paid, on the date the money arrived.

THIS IS AN ASSERTION, NOT A RECONCILIATION. Nothing in b/billing watches a bank
account or compares an amount; it records what you tell it. The money truth
belongs to b/books.

--date is required rather than defaulting to today, because the day you run
this is rarely the day the payment landed. It may not be in the future.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if strings.TrimSpace(paidDate) == "" {
				return cmdutil.Usagef("--date is required: the day the payment arrived, as YYYY-MM-DD")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			inv, err := c.MarkBillingInvoicePaid(ws, args[0], strings.TrimSpace(paidDate), idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				fmt.Fprintf(w, "marked %s (#%d) paid on %s — %s, %s %s\n",
					inv.Ref, inv.Number, inv.PaidDate, inv.Client.Name, inv.Currency, inv.Totals.Total)
				nextStep(w, "bk billing overview --company %s", inv.Company)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&paidDate, "date", "", "The day the money arrived, YYYY-MM-DD (required)")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Your identifier for this request")
	return cmd
}

func newInvoiceVoidCmd() *cobra.Command {
	var reason, reasonFr, reasonEn, confirmFlag, idempotencyKey string
	var yes bool
	cmd := &cobra.Command{
		Use:         "void <ref> --reason <text> --confirm <number>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invoices/{ref}, POST /api/workspaces/{ws}/invoices/{ref}/void"},
		Args:        cobra.ExactArgs(1),
		Short:       "Cancel an invoice with a reason; its number stays consumed",
		Long: `Void an invoice. PERMANENT: a void cannot be revived, the number is never
reused, and nothing is deleted — the invoice stays on record with who voided it,
when and why.

A correction is a void plus a NEW invoice. There is no other way to change the
amounts of a bill that has been sent.

--reason is required (or --reason-fr / --reason-en for one per language; a
single reason is used for both).

--confirm must repeat the invoice's PRINTED NUMBER exactly, and it is required
even with --yes and even under BK_NO_PROMPT=1:

  bk billing invoice void 7 --reason "Issued to the wrong entity" --confirm BC-2026-0007

The target is read first, so --confirm is checked against the real number, not
against the <ref> you typed.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			ref := strings.TrimSpace(args[0])
			// Both flag checks happen BEFORE any request, so a missing flag fails
			// the same way with or without a network.
			if strings.TrimSpace(confirmFlag) == "" {
				return cmdutil.Usagef(
					"--confirm is required: repeat the invoice's printed number to void it, even with --yes (bk billing invoice show %s)", ref)
			}
			fr := strings.TrimSpace(reasonFr)
			en := strings.TrimSpace(reasonEn)
			if r := strings.TrimSpace(reason); r != "" {
				if fr == "" {
					fr = r
				}
				if en == "" {
					en = r
				}
			}
			if fr == "" && en == "" {
				return cmdutil.Usagef("--reason is required: a void records WHY, or it is a deletion with extra steps")
			}

			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			target, err := c.GetBillingInvoice(ws, ref)
			if err != nil {
				return err
			}
			confirm, err := checkVoidConfirm(confirmFlag, target.Ref)
			if err != nil {
				return err
			}
			if target.Status == "void" {
				return fmt.Errorf("%s (#%d) is already void", target.Ref, target.Number)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Void %s (#%d) — %s, %s %s, currently %s? Its number stays consumed forever.",
				target.Ref, target.Number, target.Client.Name, target.Currency, target.Totals.Total, target.Status), yes) {
				return fmt.Errorf("aborted")
			}

			inv, err := c.VoidBillingInvoice(ws, ref, client.VoidBillingInvoiceRequest{
				ReasonFr: fr, ReasonEn: en, Confirm: confirm,
			}, idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				// WHAT was voided, from the target read before the write: the
				// number, the client and the amount. A count would not let
				// anybody notice the wrong bill was cancelled.
				fmt.Fprintf(w, "voided %s (#%d) — %s, %s %s, was %s; the number stays consumed\n",
					target.Ref, target.Number, target.Client.Name, target.Currency, target.Totals.Total, target.Status)
				nextStep(w, "bk billing invoice create --company %s …   (a correction is a new invoice)", inv.Company)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&reason, "reason", "", "Why it is cancelled; used for both languages (required)")
	f.StringVar(&reasonFr, "reason-fr", "", "The reason in French")
	f.StringVar(&reasonEn, "reason-en", "", "The reason in English")
	f.StringVar(&confirmFlag, "confirm", "", "Repeat the invoice's printed number to authorise the void (required)")
	f.StringVar(&idempotencyKey, "idempotency-key", "", "Your identifier for this request")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}
