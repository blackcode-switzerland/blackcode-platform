// The invoice as a document: `invoice pdf` and `invoice qr`.
//
// ---------------------------------------------------------------------------
// BOTH ARE READS, AND BOTH REFUSE RATHER THAN HAND BACK SOMETHING WRONG
// ---------------------------------------------------------------------------
// The server validates an invoice against the QR-bill standard before it renders
// or serializes anything, through the same seam `invoice send` uses. So a
// failure here is the failure `send` would have had, found without mailing
// anybody — which makes `invoice pdf` the dry run for `invoice send`.
//
// `pdf` never writes to a terminal and never overwrites silently: a PDF on
// stdout is only useful piped, and a file that already exists may be the copy
// somebody sent.
package billing

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

var unsafeFilenameRunes = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// pdfFilename is the server's own rule (lib/db/queries/lifecycle.ts,
// documentFilename): a number format is free text and a filename is not.
func pdfFilename(number string) string {
	return unsafeFilenameRunes.ReplaceAllString(number, "-") + ".pdf"
}

// pdfVerdict says how the bytes just fetched relate to the bytes that were
// emailed. Three states, and the middle one is not an error.
func pdfVerdict(status, got, sent string) string {
	switch {
	case status == "draft":
		return "a DRAFT: rendered from the company as it is now, and it can still change until it is sent"
	case status == "void":
		return "VOID: stamped, and rendered with no payment part — a cancelled bill must not be payable"
	case sent == "":
		return "issued outside this app (mark-sent), so no emailed copy was fingerprinted to compare against"
	case sent == got:
		return "byte for byte the PDF that was emailed"
	default:
		return "NOT the bytes that were emailed (" + sent[:12] + "…): the payment message or the due date was edited since — everything else on a sent invoice is frozen"
	}
}

func newInvoicePdfCmd() *cobra.Command {
	var out string
	var force bool
	cmd := &cobra.Command{
		Use:         "pdf <ref>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invoices/{ref}/pdf"},
		Args:        cobra.ExactArgs(1),
		Short:       "The invoice as a PDF, with its QR-bill payment part",
		Long: `Fetch the invoice as a PDF: the A4 document in the invoice's own language and,
for a currency the Swiss QR-bill carries, the payment part at the foot of the
last page. <ref> is the #number or the printed number.

  bk billing invoice pdf 7                     writes ./<number>.pdf
  bk billing invoice pdf 7 --out bill.pdf
  bk billing invoice pdf 7 --out - | lp        the bytes on stdout, never to a terminal

NOTHING IS STORED. The PDF is rendered when you ask, and the same invoice always
renders to the same bytes — so this prints the sha256 of what it wrote and, for
an invoice this app emailed, whether it is byte for byte what the client
received. It can differ for one honest reason: the payment message and the due
date stay editable after sending, and nothing else does.

A DRAFT renders from its company as it is now. From the moment an invoice is
issued it renders from its OWN copy of the company — name, address, account,
rounding policy — so editing a company never changes a bill that already went
out. "invoice show" prints that copy.

A VOID invoice still renders, stamped, with NO payment part.

IT REFUSES rather than drawing a payment part a bank would reject: exit 6,
naming every problem at once (an incomplete address, a missing QR-IBAN, a
character the standard does not allow). "invoice show" lists the same problems
without fetching anything. This is the dry run for "invoice send", which
refuses for exactly the same reasons.

It will not overwrite a file unless you pass --force: the file in the way may be
the copy somebody sent.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			toStdout := out == "-"
			if toStdout && term.IsTerminal(int(os.Stdout.Fd())) {
				return cmdutil.Usagef("refusing to write a PDF to a terminal: pipe it (--out - | …) or name a file with --out")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// The printed number names the default file, and the #number the next
			// step. One extra read, and it means a refusal about the INVOICE (not
			// found) arrives before any question about the file.
			inv, err := c.GetBillingInvoice(ws, args[0])
			if err != nil {
				return err
			}
			path := out
			if path == "" {
				path = pdfFilename(inv.Ref)
			}
			if !toStdout && !force {
				if _, statErr := os.Stat(path); statErr == nil {
					return cmdutil.Usagef("%s already exists and may be the copy that was sent: pass --force to replace it, or --out another name", path)
				}
			}

			pdf, err := c.GetBillingInvoicePdf(ws, args[0])
			if err != nil {
				return err
			}
			sum := sha256.Sum256(pdf.Bytes)
			got := hex.EncodeToString(sum[:])
			// The server's own figure for these bytes. A mismatch means something
			// between it and this process altered a legal document.
			if pdf.Sha256 != "" && pdf.Sha256 != got {
				return fmt.Errorf("the PDF was altered in transit: the server sent sha256 %s and %d bytes arrived hashing to %s — nothing was written", pdf.Sha256, len(pdf.Bytes), got)
			}

			if toStdout {
				_, err := os.Stdout.Write(pdf.Bytes)
				return err
			}
			if err := os.WriteFile(path, pdf.Bytes, 0o644); err != nil {
				return err
			}
			abs, absErr := filepath.Abs(path)
			if absErr != nil {
				abs = path
			}

			result := map[string]any{
				"number":       inv.Ref,
				"seq":          inv.Number,
				"status":       pdf.Status,
				"path":         abs,
				"bytes":        len(pdf.Bytes),
				"sha256":       got,
				"sent_sha256":  nilIfEmpty(pdf.SentSha256),
				"matches_sent": matchesSent(got, pdf.SentSha256),
				"payment_part": inv.Derived.HasPaymentPart,
			}
			return output.Render(format, result, func(w io.Writer) error {
				fmt.Fprintf(w, "Wrote %s (%d bytes)\n", abs, len(pdf.Bytes))
				fmt.Fprintf(w, "  sha256 %s\n", got)
				fmt.Fprintf(w, "  %s\n", pdfVerdict(pdf.Status, got, pdf.SentSha256))
				if !inv.Derived.HasPaymentPart && pdf.Status != "void" {
					fmt.Fprintf(w, "  no payment part: the QR-bill does not carry %s\n", inv.Currency)
				}
				if pdf.Status == "draft" {
					nextStep(w, "bk billing invoice send %d --to <client email>", inv.Number)
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&out, "out", "", "File to write (default ./<number>.pdf); - for stdout")
	cmd.Flags().BoolVar(&force, "force", false, "Replace the file if it already exists")
	return cmd
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// matchesSent is nil — not false — when there is nothing to compare against:
// "did not match" and "was never emailed by this app" are different answers.
func matchesSent(got, sent string) any {
	if sent == "" {
		return nil
	}
	return got == sent
}

func newInvoiceQrCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "qr <ref>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invoices/{ref}/qr"},
		Args:        cobra.ExactArgs(1),
		Short:       "The Swiss QR Code payload, exactly as the PDF encodes it",
		Long: `Print the payload the invoice's QR code carries: the lines of text a banking app
reads when it scans the payment part. <ref> is the #number or the printed number.

  bk billing invoice qr 7
  bk billing invoice qr 7 | pbcopy             paste into SIX's validation portal
  bk billing invoice qr 7 > payload.txt

EVERY ELEMENT IS IDENTIFIED BY ITS LINE NUMBER — there are no keys. Line 4 is
the account, 19 the amount, 20 the currency, 28 the reference type, 29 the
reference, 30 the message. So an empty line is content, and the output is
written UNTOUCHED: no trailing newline is added, and none of the empty lines is
dropped. Do not trim it, and do not let an editor "fix" it.

It comes from the same function, through the same validation, as the QR code in
"invoice pdf" — it is what that code says, not a description of it.

Exit 2 when the invoice has no payment part: a currency the QR-bill does not
carry, or a void invoice. Exit 6 when the record would make an invalid payment
part; every problem is named, and "invoice show" lists them too.

--json wraps it as {"payload": "…", "lines": N} for a caller that wants it as a
value; the default output is the payload and nothing else.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			payload, err := c.GetBillingInvoiceQrPayload(ws, args[0])
			if err != nil {
				return err
			}
			lines := 1
			for _, r := range payload {
				if r == '\n' {
					lines++
				}
			}
			return output.Render(format, map[string]any{"payload": payload, "lines": lines}, func(w io.Writer) error {
				// No Fprintln: a trailing newline is not part of the payload, and
				// this output is pasted into a validator.
				_, err := io.WriteString(w, payload)
				return err
			})
		},
	}
	return cmd
}
