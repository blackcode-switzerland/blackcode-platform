// `bk billing invoice …` — the numbered legal documents.
//
// ---------------------------------------------------------------------------
// THREE THINGS TO KNOW BEFORE READING ANY COMMAND HERE
// ---------------------------------------------------------------------------
//  1. **`<ref>` is the #number OR the printed number.** `bk billing invoice show 7`
//     and `bk billing invoice show BC-2026-0007` reach the same document. The
//     server resolves #number first.
//  2. **An invoice is never deleted.** There is no `invoice delete` and there
//     will not be one: art. 958f CO imposes ten-year retention, and a wrong bill
//     is voided with a reason and reissued. The void keeps its number forever.
//  3. **Creating one consumes a number that cannot be reclaimed.** The sequence
//     per company is contiguous with no holes, so every create is a permanent
//     act. That is why `create` takes `--idempotency-key`: a retry that passes
//     the same key replays rather than minting a second real bill. (Until
//     2026-09-17 this said the command SENT a key on its own. It did not, and a
//     per-invocation key would not have helped — see postJSONIdempotent.)
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

func newInvoiceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "invoice",
		Short: "The bills",
		Long: `Invoices in the active workspace.

AN INVOICE IS A NUMBERED LEGAL DOCUMENT, and three properties follow from that:

  - its number is contiguous per company, with no holes and no reuse
  - it is never deleted; a wrong one is VOIDED with a reason and reissued, and
    the void keeps its number forever
  - once it is sent, the document half is FROZEN: the amounts, the client, the
    currency, the reference and the issue date. The payment message, the due
    date and the status stay editable, because those are not legal facts

<ref> is the #number or the printed number. "invoice show 7" and
"invoice show BC-2026-0007" reach the same document.

TOTALS ARE NEVER STORED. They are derived from the lines, the price mode and the
issuer's rounding policy every time an invoice is read.

THE ISSUER IS COPIED AT ISSUE. A draft reads its company as it is now; from the
moment an invoice leaves draft it carries its own copy of the company — name,
address, accounts, rounding policy — and renders from that forever. Editing a
company changes its drafts and its future bills, never one that already went out.

  bk billing invoice pdf <ref>      the document, with its QR-bill payment part
  bk billing invoice qr <ref>       the payload that QR code carries

A line's VAT rate has three states and they are not two. Unset means the line
carries NO VAT (an exempt act, or a company that is not registered). "0" is a
real rate — an export, a reverse charge — and prints as 0%. They are different
facts on a VAT return.

THE LIFECYCLE is draft -> sent -> paid, and anything -> void:

  bk billing invoice send <ref> --to client@example.ch   email the PDF
  bk billing invoice mark-sent <ref>                     it went out another way
  bk billing invoice paid <ref> --date 2026-10-02        the money arrived
  bk billing invoice void <ref> --reason "…" --confirm <number>

Run "bk guide billing/sending-and-status" for what each one records.`,
	}
	cmd.AddCommand(
		newInvoiceListCmd(), newInvoiceShowCmd(), newInvoiceCreateCmd(), newInvoiceEditCmd(), newInvoiceLineCmd(),
		newInvoiceSendCmd(), newInvoiceMarkSentCmd(), newInvoicePaidCmd(), newInvoiceVoidCmd(),
		newInvoicePdfCmd(), newInvoiceQrCmd(),
	)
	return cmd
}

func newInvoiceListCmd() *cobra.Command {
	var o client.ListBillingInvoicesOptions
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invoices"},
		Short:       "List invoices, newest first",
		Long: `Invoices in the active workspace, newest first.

--company matters in a workspace with more than one issuing entity: each keeps
its own number sequence, so an unfiltered list interleaves two sequences.

--status is refused if it is not a real status rather than ignored, because a
filter the server dropped would return everything and read as "there are none".
Run "bk meta --app-server billing" for the values.

--external-ref finds the invoice carrying your own identifier, which is how an
outside system looks up what it created.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			page, err := c.ListBillingInvoices(ws, o)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				if len(page.Data) == 0 {
					fmt.Fprintln(w, "No invoices.")
					nextStep(w, `bk billing invoice create --company <slug> --item "desc|1|pcs|100.00"`)
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tNUMBER\tCOMPANY\tCLIENT\tISSUED\tDUE\tSTATUS\tTOTAL")
				for _, i := range page.Data {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s %s\n",
						i.Number, i.Ref, i.Company, cmdutil.Truncate(i.Client.Name, 22),
						i.IssueDate, orDash(i.DueDate), i.Status, i.Currency, i.Totals.Total)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if page.NextCursor != nil {
					fmt.Fprintf(w, "\nmore: --cursor %d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&o.Company, "company", "", "Only this company's invoices")
	f.StringVar(&o.Status, "status", "", "Only this status (bk meta for the values)")
	f.StringVar(&o.Currency, "currency", "", "Only this currency")
	f.StringVar(&o.ExternalRef, "external-ref", "", "The invoice carrying your own identifier")
	f.IntVar(&o.Limit, "limit", 0, "How many (bk meta for the ceiling)")
	f.IntVar(&o.Cursor, "cursor", 0, "Continue from the cursor the last page returned")
	return cmd
}

func newInvoiceShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <ref>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invoices/{ref}"},
		Args:        cobra.ExactArgs(1),
		Short:       "One invoice, with its lines and its derived totals",
		Long: `One invoice in full. <ref> is the #number or the printed number.

The totals shown are DERIVED, not stored: computed from the lines, whether the
prices include VAT, and the issuing company's rounding policy.

The VAT block has one line per distinct rate. A line whose rate is unset carries
no VAT and appears in the subtotal and in no VAT line — which is a different
statement from a line rated at 0%.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			inv, err := c.GetBillingInvoice(ws, args[0])
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				return renderInvoice(w, inv)
			})
		},
	}
	return cmd
}

func renderInvoice(w io.Writer, inv *client.BillingInvoice) error {
	tw := output.Tabwriter(w)
	fmt.Fprintf(tw, "Invoice:\t%s\t(#%d)\n", inv.Ref, inv.Number)
	fmt.Fprintf(tw, "From:\t%s\n", inv.Company)
	fmt.Fprintf(tw, "To:\t%s\t%s\n", inv.Client.Name, addressLine(inv.Client))
	fmt.Fprintf(tw, "Status:\t%s\n", inv.Status)
	fmt.Fprintf(tw, "Issued:\t%s\tdue %s\n", inv.IssueDate, orDash(inv.DueDate))
	if inv.SentAt != "" {
		fmt.Fprintf(tw, "Sent:\t%s\t%s\n", inv.SentAt, sentHow(inv))
	}
	if inv.PaidDate != "" {
		fmt.Fprintf(tw, "Paid:\t%s\n", inv.PaidDate)
	}
	fmt.Fprintf(tw, "Currency:\t%s\tdocument language %s\n", inv.Currency, inv.Language)
	// The FULL reference, check digits included, as it prints — not the stored
	// body, which is what this line showed before the server derived one.
	fmt.Fprintf(tw, "Reference:\t%s\t%s\n", inv.RefType, orDash(deref(inv.Derived.ReferenceFormatted)))
	if inv.Derived.HasPaymentPart {
		fmt.Fprintf(tw, "Pay to:\t%s\t%s\n", orDash(deref(inv.Derived.AccountFormatted)), inv.Derived.Creditor.Name)
	} else if inv.Status == "void" {
		fmt.Fprintf(tw, "Pay to:\t—\tvoid: its PDF carries no payment part\n")
	} else {
		fmt.Fprintf(tw, "Pay to:\t—\tno payment part: the QR-bill does not carry %s\n", inv.Currency)
	}
	switch {
	case inv.Issuer == nil:
		fmt.Fprintf(tw, "Issuer:\tlive\ta draft reads company %s as it is now; the copy is taken when it is issued\n", inv.Company)
	case inv.Issuer.Backfilled:
		fmt.Fprintf(tw, "Issuer:\tcopied %s\tBACKFILLED by a migration — the company as it was then, not at issue\n", inv.Issuer.CapturedAt[:10])
	default:
		fmt.Fprintf(tw, "Issuer:\tcopied %s\t%s — later edits to the company do not reach this invoice\n", inv.Issuer.CapturedAt[:10], inv.Issuer.LegalName)
	}
	if inv.Recurrence != nil {
		if inv.OccurrencePeriod != nil {
			fmt.Fprintf(tw, "Series:\t#%d\toccurrence for %s — bk billing recurrence show %d\n", *inv.Recurrence, *inv.OccurrencePeriod, *inv.Recurrence)
		} else {
			fmt.Fprintf(tw, "Series:\t#%d\tthe template its occurrences copy — bk billing recurrence show %d\n", *inv.Recurrence, *inv.Recurrence)
		}
	}
	if inv.Message != "" {
		fmt.Fprintf(tw, "Message:\t%s\n", inv.Message)
	}
	if inv.Void != nil {
		fmt.Fprintf(tw, "VOIDED:\t%s\t%s\n", inv.Void.Ts[:10], inv.Void.Reason["en"])
	}
	if err := tw.Flush(); err != nil {
		return err
	}

	if len(inv.Items) == 0 {
		fmt.Fprintln(w, "\nNo lines — this is a bill for nothing.")
	} else {
		fmt.Fprintln(w)
		lt := output.Tabwriter(w)
		fmt.Fprintln(lt, "  #\tDESCRIPTION\tQTY\tUNIT\tPRICE\tVAT\tTOTAL")
		for _, l := range inv.Items {
			// The three-state rate, spelled out rather than shown as an empty
			// column: "—" and "0%" mean different things and a blank would read
			// as either.
			vat := "exempt"
			if l.VatRate != "" {
				vat = l.VatRate + "%"
			}
			fmt.Fprintf(lt, "  %d\t%s\t%s\t%s\t%s\t%s\t%s\n",
				l.LineNo, cmdutil.Truncate(l.Description, 34), l.Qty, orDash(l.Unit),
				l.UnitPrice, vat, l.LineTotal)
		}
		if err := lt.Flush(); err != nil {
			return err
		}
	}

	fmt.Fprintln(w)
	st := output.Tabwriter(w)
	fmt.Fprintf(st, "\tSubtotal\t%s %s\n", inv.Currency, inv.Totals.Subtotal)
	for _, v := range inv.Totals.Vat {
		label := fmt.Sprintf("VAT %s%% on %s", v.Rate, v.Base)
		if inv.PricesIncludeVat {
			label = fmt.Sprintf("incl. VAT %s%%", v.Rate)
		}
		fmt.Fprintf(st, "\t%s\t%s %s\n", label, inv.Currency, v.Amount)
	}
	if inv.Totals.Rounding != "0.00" {
		fmt.Fprintf(st, "\tRounding\t%s %s\n", inv.Currency, inv.Totals.Rounding)
	}
	fmt.Fprintf(st, "\tTOTAL\t%s %s\n", inv.Currency, inv.Totals.Total)
	if err := st.Flush(); err != nil {
		return err
	}
	if inv.PricesIncludeVat {
		fmt.Fprintln(w, "\n(prices include VAT: the total is the sum of the lines)")
	}
	if n := len(inv.Derived.Problems); n > 0 {
		fmt.Fprintf(w, "\nNOT A VALID QR-BILL YET — %d problem(s); pdf, qr and send refuse until they are fixed:\n", n)
		for _, p := range inv.Derived.Problems {
			fmt.Fprintf(w, "  [%s] %s\n      fix: %s\n", p.Code, p.Message, p.Suggestion)
		}
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func newInvoiceCreateCmd() *cobra.Command {
	var req client.CreateBillingInvoiceRequest
	var cl client.BillingAddress
	var items []string
	var meta []string
	var vatRate string
	var pricesIncludeVat bool
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/invoices"},
		Short:       "Draft a new invoice",
		Long: `Create a DRAFT invoice, numbered immediately.

THE NUMBER IS CONSUMED BY THIS COMMAND AND CANNOT BE RECLAIMED. The sequence per
company is contiguous, so there is no way to "undo" a create — a bill you did
not mean is voided with a reason and keeps its number.

So from a script, pass --idempotency-key with an identifier of YOUR request (an
order id, an appointment id). Running the same command again with the same key
replays the first answer instead of minting a second real bill. Without the
flag, every run is a new invoice.

--item is "description|qty|unit|price" and repeats. Example:

  --item "Consulting, October|12|days|132.50"
  --item "Licence|1|pcs|400.00"

A fifth field sets that line's VAT rate:

  --item "Product|2|pcs|60.00|8.1"

WITHOUT a fifth field the line carries NO VAT, which is not the same as a rate of
zero. If the company has a default rate, that is what a bare line gets; pass
"none" as the fifth field to override it back to exempt.

--expect-total is worth using from a script. If it disagrees with what this app
derives, the invoice is REFUSED and no number is allocated, and the message names
the company's rounding policy and whether its prices include VAT — which is what
explains almost every disagreement between two billing systems.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			lines, err := parseItems(items)
			if err != nil {
				return err
			}
			req.Items = lines
			if cmd.Flags().Changed("client-name") || cmd.Flags().Changed("client-street") ||
				cmd.Flags().Changed("client-city") || cmd.Flags().Changed("client-postal-code") ||
				cmd.Flags().Changed("client-country") || cmd.Flags().Changed("client-building") {
				req.Client = &cl
			}
			if cmd.Flags().Changed("vat-rate") {
				// "none" is how a caller says "override the company default back
				// to exempt". An empty string would be indistinguishable from
				// not passing the flag at all.
				if vatRate == "none" {
					req.VatRate = nil
				} else {
					req.VatRate = &vatRate
				}
			}
			if cmd.Flags().Changed("prices-include-vat") {
				req.PricesIncludeVat = &pricesIncludeVat
			}
			kv, err := parseMetadata(meta)
			if err != nil {
				return err
			}
			req.Metadata = kv

			inv, err := c.CreateBillingInvoice(ws, req, idempotencyKey)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				fmt.Fprintf(w, "created %s (#%d) — %s %s, %s\n",
					inv.Ref, inv.Number, inv.Currency, inv.Totals.Total, inv.Status)
				// STATE-DEPENDENT, per nextstep.go rule 3. A bill with no lines
				// is a bill for nothing, and telling somebody to send it would
				// be telling them to send that.
				if len(inv.Items) == 0 {
					fmt.Fprintln(w, "it has no lines yet, so it is a bill for nothing")
					nextStep(w, `bk billing invoice line set %d --item "desc|1|pcs|100.00"`, inv.Number)
					return nil
				}
				if inv.Client.Name == "" {
					fmt.Fprintln(w, "it has no client, so there is nobody to send it to")
					nextStep(w, `bk billing invoice edit %d --client-name "…"`, inv.Number)
					return nil
				}
				// The third half-finished state, and the one the server now tells
				// us about: a draft that saved and cannot be sent. "send it" would
				// be a suggestion that is guaranteed to be refused.
				if n := len(inv.Derived.Problems); n > 0 {
					fmt.Fprintf(w, "it cannot be sent yet: %s\n", inv.Derived.Problems[0].Message)
					if n > 1 {
						fmt.Fprintf(w, "(and %d more)\n", n-1)
					}
					nextStep(w, "bk billing invoice show %d   lists each problem with its fix", inv.Number)
					return nil
				}
				nextStep(w, "bk billing invoice pdf %d   then: bk billing invoice send %d --to <client email>", inv.Number, inv.Number)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&req.Company, "company", "", "The issuing company's slug (required)")
	f.StringVar(&cl.Name, "client-name", "", "Who is being billed")
	f.StringVar(&cl.Street, "client-street", "", "Client street, without the number")
	f.StringVar(&cl.Building, "client-building", "", "Client house number")
	f.StringVar(&cl.PostalCode, "client-postal-code", "", "Client postal code")
	f.StringVar(&cl.City, "client-city", "", "Client city")
	f.StringVar(&cl.Country, "client-country", "", "Client country, ISO 3166-1 alpha-2")
	f.StringArrayVar(&items, "item", nil, `"description|qty|unit|price[|vat]", repeatable`)
	f.StringVar(&req.Currency, "currency", "", "Override the company's default currency")
	f.StringVar(&req.Language, "language", "", "The DOCUMENT's language (bk meta for the values)")
	f.StringVar(&req.RefType, "ref-type", "", "Reference type (bk meta for the values)")
	f.StringVar(&vatRate, "vat-rate", "", `Rate prefilled onto new lines, or "none" for exempt`)
	f.BoolVar(&pricesIncludeVat, "prices-include-vat", false, "Line prices already contain their VAT")
	f.StringVar(&req.IssueDate, "issue-date", "", "YYYY-MM-DD (default: today)")
	f.StringVar(&req.DueDate, "due-date", "", "YYYY-MM-DD (default: the company's payment terms)")
	f.StringVar(&req.Message, "message", "", "The payment message a payer sees (140 chars, shared budget)")
	f.StringVar(&req.ExternalRef, "external-ref", "", "Your own identifier for this invoice")
	f.StringArrayVar(&meta, "meta", nil, "key=value, repeatable; your own bookkeeping")
	f.StringVar(&req.ExpectedTotal, "expect-total", "", "Refuse the create if the derived total differs")
	f.StringVar(&idempotencyKey, "idempotency-key", "", "Your identifier for this request; a rerun with the same key replays instead of minting")
	_ = cmd.MarkFlagRequired("company")
	return cmd
}

func newInvoiceEditCmd() *cobra.Command {
	var meta []string
	cmd := &cobra.Command{
		Use:         "edit <ref>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/invoices/{ref}"},
		Args:        cobra.ExactArgs(1),
		Short:       "Change a draft, or a sent bill's non-document fields",
		Long: `Change fields on one invoice. Only the flags you pass are sent.

WHILE IT IS A DRAFT, everything here is editable.

ONCE IT IS SENT, the document half is frozen: currency, reference, client,
issue date, whether prices include VAT, and the lines. The refusal names which
field you touched. What stays editable is the payment message, the due date,
your external reference and your metadata — none of which is a legal fact.

The number, the issuer and the status are never editable here. A wrong bill is
voided with a reason and reissued; the status moves through its own commands.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			patch := map[string]any{}
			for flag, field := range map[string]string{
				"due-date": "due_date", "issue-date": "issue_date", "message": "message",
				"language": "language", "currency": "currency", "ref-type": "ref_type",
				"ref-body": "ref_body", "external-ref": "external_ref",
			} {
				if cmd.Flags().Changed(flag) {
					v, _ := cmd.Flags().GetString(flag)
					patch[field] = v
				}
			}
			// The client block is sent whole, because it is one self-contained
			// object on the invoice — nothing else depends on its internals,
			// which is what makes a later switch to a b/clients lookup a
			// data-source change rather than a rewrite.
			clientTouched := false
			cl := client.BillingAddress{}
			for flag, set := range map[string]*string{
				"client-name": &cl.Name, "client-street": &cl.Street,
				"client-building": &cl.Building, "client-postal-code": &cl.PostalCode,
				"client-city": &cl.City, "client-country": &cl.Country,
			} {
				if cmd.Flags().Changed(flag) {
					v, _ := cmd.Flags().GetString(flag)
					*set = v
					clientTouched = true
				}
			}
			if clientTouched {
				patch["client"] = cl
			}
			if cmd.Flags().Changed("meta") {
				kv, err := parseMetadata(meta)
				if err != nil {
					return err
				}
				patch["metadata"] = kv
			}
			if len(patch) == 0 {
				return fmt.Errorf("nothing to change: pass at least one flag (bk billing invoice edit --help)")
			}

			inv, err := c.EditBillingInvoice(ws, args[0], patch)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				fields := make([]string, 0, len(patch))
				for k := range patch {
					fields = append(fields, k)
				}
				fmt.Fprintf(w, "updated %s: %s\n", inv.Ref, strings.Join(fields, ", "))
				nextStep(w, "bk billing invoice show %d", inv.Number)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.String("due-date", "", "YYYY-MM-DD")
	f.String("issue-date", "", "YYYY-MM-DD (frozen once sent)")
	f.String("message", "", "The payment message (140 chars, shared budget)")
	f.String("language", "", "The DOCUMENT's language (frozen once sent)")
	f.String("currency", "", "Currency (frozen once sent)")
	f.String("ref-type", "", "Reference type (frozen once sent)")
	f.String("ref-body", "", "Reference body, without its check digit (frozen once sent)")
	f.String("client-name", "", "Who is being billed (frozen once sent)")
	f.String("client-street", "", "Client street")
	f.String("client-building", "", "Client house number")
	f.String("client-postal-code", "", "Client postal code")
	f.String("client-city", "", "Client city")
	f.String("client-country", "", "Client country")
	f.String("external-ref", "", "Your own identifier; editable even after sending")
	f.StringArrayVar(&meta, "meta", nil, "key=value, repeatable; replaces the whole map")
	return cmd
}

func newInvoiceLineCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "line",
		Short: "The lines on an invoice",
		Long: `The lines on one invoice.

"line set" replaces the WHOLE set, and that is deliberate rather than a missing
"line add". A line's position is display order, so a partial update has to answer
"what happens to the gap?" every time one is removed — and replacing makes the
order your statement rather than something the server reconstructs.

The log still records it line by line: one entry per changed field, spelled
items[2].unit_price, so "what changed?" has an answer.

Lines are frozen once the invoice is sent. The amounts on a sent bill are a
legal fact.`,
	}
	cmd.AddCommand(newInvoiceLineSetCmd())
	return cmd
}

func newInvoiceLineSetCmd() *cobra.Command {
	var items []string
	cmd := &cobra.Command{
		Use:         "set <ref>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/invoices/{ref}"},
		Args:        cobra.ExactArgs(1),
		Short:       "Replace an invoice's lines",
		Long: `Replace every line on a draft invoice, in the order given.

--item is "description|qty|unit|price[|vat]" and repeats:

  bk billing invoice line set 7 \
    --item "Consulting, October|12|days|132.50|8.1" \
    --item "Travel|1|forfait|180.00"

The fifth field is that line's VAT rate. WITHOUT it the line carries NO VAT,
which is not a rate of zero: pass "0" for a genuinely zero-rated line (an export,
a reverse charge) and "none" to be explicit about exempt.

Passing no --item at all empties the invoice, which is a bill for nothing. The
command says so rather than looking like it did nothing.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			lines, err := parseItems(items)
			if err != nil {
				return err
			}
			inv, err := c.SetBillingInvoiceLines(ws, args[0], lines)
			if err != nil {
				return err
			}
			return output.Render(format, inv, func(w io.Writer) error {
				fmt.Fprintf(w, "%s now has %d line(s) — %s %s\n",
					inv.Ref, len(inv.Items), inv.Currency, inv.Totals.Total)
				if len(inv.Items) == 0 {
					fmt.Fprintln(w, "that is a bill for nothing")
					nextStep(w, `bk billing invoice line set %d --item "desc|1|pcs|100.00"`, inv.Number)
					return nil
				}
				nextStep(w, "bk billing invoice show %d", inv.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringArrayVar(&items, "item", nil, `"description|qty|unit|price[|vat]", repeatable`)
	return cmd
}

// parseItems turns `--item "desc|qty|unit|price[|vat]"` into line requests.
//
// ── WHY A PIPE AND NOT REPEATED FLAG GROUPS ────────────────────────────────
// Because a line is four or five values that belong together, and
// `--desc a --qty 1 --unit pcs --price 10 --desc b …` has no way to say where one
// line ends. The mockup's own CLI sketch uses the pipe, and it survives a shell
// without quoting surprises as long as the whole thing is quoted.
//
// ── AND WHY "none" IS A WORD ───────────────────────────────────────────────
// The fifth field distinguishes three states, and only two of them have a
// natural spelling. Absent means "inherit the company/invoice default"; "0"
// means a real zero rate; "none" means explicitly exempt, overriding a default.
// An empty fifth field (`desc|1|pcs|10|`) is refused rather than guessed at.
func parseItems(raw []string) ([]client.CreateBillingInvoiceLineRequest, error) {
	out := make([]client.CreateBillingInvoiceLineRequest, 0, len(raw))
	for i, s := range raw {
		parts := strings.Split(s, "|")
		if len(parts) < 4 || len(parts) > 5 {
			return nil, fmt.Errorf(
				"--item %d is %q: expected \"description|qty|unit|price\" with an optional "+
					"fifth field for the VAT rate", i+1, s)
		}
		desc := strings.TrimSpace(parts[0])
		if desc == "" {
			return nil, fmt.Errorf("--item %d has no description", i+1)
		}
		line := client.CreateBillingInvoiceLineRequest{
			Description: desc,
			Qty:         strings.TrimSpace(parts[1]),
			Unit:        strings.TrimSpace(parts[2]),
			UnitPrice:   strings.TrimSpace(parts[3]),
		}
		if line.UnitPrice == "" {
			return nil, fmt.Errorf("--item %d has no price", i+1)
		}
		if len(parts) == 5 {
			v := strings.TrimSpace(parts[4])
			switch v {
			case "":
				return nil, fmt.Errorf(
					"--item %d has an empty fifth field. Leave it off to inherit the default, "+
						"pass a rate for VAT, or pass \"none\" to be explicit that the line is exempt", i+1)
			case "none":
				// Explicitly nil: the line carries no VAT, overriding any default.
				line.VatRate = nil
			default:
				line.VatRate = &v
			}
		}
		out = append(out, line)
	}
	return out, nil
}
