// `bk billing company …` — the issuing entities.
//
// A company is whose name, address and bank account appear on the bill.
// Multi-entity by design: a new one is a row, never a code change, and a second
// entity to bill from is a company inside the workspace rather than a second
// workspace.
//
// ---------------------------------------------------------------------------
// THERE IS NO `company delete`, AND THERE WILL NOT BE
// ---------------------------------------------------------------------------
// Past invoices reference the company and a statement for a past year has to
// render, so a company is RETIRED: it stops being offered for new invoices and
// keeps rendering its old ones. Migration 0006 revokes DELETE and 0005 installs
// a trigger, so the absence here is not the only thing standing in the way.
package billing

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newCompanyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "company",
		Short: "The entities you bill from",
		Long: `The issuing companies in this workspace.

A COMPANY is the entity whose name, address and bank account appear on a bill —
and whose name on the payment part must match the holder of the credit account,
or a bank may refuse it. A workspace bills from as many as it has.

Each company owns its own INVOICE SEQUENCE. The numbers are contiguous per
company with no holes and no reuse, so "company" is the level at which a wrong
choice is a wrong number on a legal document, not just a wrong label.

ONE setting here is read when a total is DERIVED rather than when an invoice is
created:

  rounding              how five-rappen rounding is applied

Changing it changes the total of every DRAFT this company has, at once. It does
not reach an invoice that already left draft: that one carries its own copy of
the company — rounding policy, names, address, accounts — taken at that moment.

Everything under "defaults" — whether prices include VAT among them — is a
prefill for NEW invoices only. Each invoice stores its own price mode.

There is no "company delete". A company is RETIRED — it issues no new invoices
and still renders its old ones — because past invoices reference it.

The IBAN fields are OWNER-ONLY. Changing one redirects real money, and the bill
would look entirely normal afterwards.`,
	}
	cmd.AddCommand(newCompanyListCmd(), newCompanyShowCmd(), newCompanyCreateCmd(), newCompanyEditCmd(), newCompanyRetireCmd())
	return cmd
}

func newCompanyListCmd() *cobra.Command {
	var includeRetired bool
	var externalRef string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/companies"},
		Short:       "List the companies you bill from",
		Long: `The companies in the active workspace.

Retired companies are hidden; pass --retired to include them. A retired company
still renders its old invoices, so it exists — what stops is being offered for
new ones.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListBillingCompanies(ws, includeRetired, externalRef)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				if len(rows) == 0 {
					fmt.Fprintln(w, "No companies yet.")
					nextStep(w, `bk billing company create --slug acme-sa --name "Acme SA"`)
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tSLUG\tNAME\tNEXT No\tVAT\tROUNDING\tSTATE")
				for _, r := range rows {
					state := "active"
					if r.RetiredAt != "" {
						state = "retired " + r.RetiredAt[:10]
					}
					vat := "not registered"
					if r.VatRegistered {
						vat = "registered"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%d\t%s\t%s\t%s\n",
						r.Number, r.Slug, cmdutil.Truncate(r.Name, 28), r.NextSeq, vat, r.Rounding, state)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().BoolVar(&includeRetired, "retired", false, "Include retired companies")
	cmd.Flags().StringVar(&externalRef, "external-ref", "", "Find the company carrying this caller-supplied reference")
	return cmd
}

func newCompanyShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <slug>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/companies/{slug}"},
		Args:        cobra.ExactArgs(1),
		Short:       "One company in full",
		Long: `Everything about one company, including "rounding" — the one setting read
when a total is derived rather than when an invoice is created. It decides what
every DRAFT of this company totals; an issued invoice keeps the policy it was
issued under.

"next number" is what the next invoice from this company will be numbered. It
is read-only everywhere: the sequence is moved only by creating an invoice.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			co, err := c.GetBillingCompany(ws, args[0])
			if err != nil {
				return err
			}
			return output.Render(format, co, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "Company:\t#%d %s\n", co.Number, co.Slug)
				fmt.Fprintf(tw, "Name:\t%s\n", co.Name)
				fmt.Fprintf(tw, "Legal name:\t%s\t(must match the account holder)\n", co.LegalName)
				fmt.Fprintf(tw, "Address:\t%s\n", addressLine(co.Address))
				if co.Email != "" {
					fmt.Fprintf(tw, "Email:\t%s\n", co.Email)
				}
				fmt.Fprintf(tw, "IBAN:\t%s\n", orDash(co.Iban))
				fmt.Fprintf(tw, "QR-IBAN:\t%s\n", orDash(co.QrIban))
				if co.VatRegistered {
					fmt.Fprintf(tw, "VAT:\tregistered\t%s\n", orDash(co.VatNumber))
				} else {
					fmt.Fprintf(tw, "VAT:\tnot registered\t(omitted from its invoices entirely)\n")
				}
				fmt.Fprintf(tw, "UID:\t%s\n", orDash(co.Uid))
				fmt.Fprintf(tw, "Number format:\t%s\n", co.NumberFormat)
				fmt.Fprintf(tw, "Next number:\t%d\n", co.NextSeq)
				fmt.Fprintf(tw, "Rounding:\t%s\t(read when a bill is rendered)\n", co.Rounding)
				fmt.Fprintf(tw, "Prices include VAT:\t%t\t(default for new invoices)\n", co.Defaults.PricesIncludeVat)
				fmt.Fprintf(tw, "Defaults:\t%s / %s / %s / %d days\n",
					co.Defaults.Currency, co.Defaults.Language, co.Defaults.RefType, co.Defaults.PaymentTermsDays)
				if co.RetiredAt != "" {
					fmt.Fprintf(tw, "Retired:\t%s\t(issues no new invoices)\n", co.RetiredAt[:10])
				}
				if co.ExternalRef != "" {
					fmt.Fprintf(tw, "External ref:\t%s\n", co.ExternalRef)
				}
				return tw.Flush()
			})
		},
	}
	return cmd
}

func newCompanyCreateCmd() *cobra.Command {
	var req client.CreateBillingCompanyRequest
	var addr client.BillingAddress
	var defaults client.BillingCompanyDefaults
	var vatRegistered bool
	var pricesIncludeVat bool
	var meta []string

	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/companies"},
		Short:       "Add an entity to bill from",
		Long: `Create a company in the active workspace.

--legal-name defaults to --name. It is the one that goes on the payment part and
MUST match the holder of the credit account.

--rounding decides how five-rappen rounding is applied and is read whenever a
DRAFT's total is derived, so changing it later changes every draft this company
has. Issued invoices keep the policy they were issued under.
Run "bk meta --app-server billing" for the policies and what each one does.

The IBAN flags are OWNER-ONLY. If you are not the workspace owner, create the
company without them and have the owner add them.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("street") || cmd.Flags().Changed("city") ||
				cmd.Flags().Changed("postal-code") || cmd.Flags().Changed("country") ||
				cmd.Flags().Changed("building") {
				req.Address = &addr
			}
			if cmd.Flags().Changed("currency") || cmd.Flags().Changed("language") ||
				cmd.Flags().Changed("ref-type") || cmd.Flags().Changed("payment-terms") ||
				cmd.Flags().Changed("vat-rate") || cmd.Flags().Changed("prices-include-vat") {
				defaults.PricesIncludeVat = pricesIncludeVat
				req.Defaults = &defaults
			}
			if cmd.Flags().Changed("vat-registered") {
				req.VatRegistered = &vatRegistered
			}
			kv, err := parseMetadata(meta)
			if err != nil {
				return err
			}
			req.Metadata = kv

			co, err := c.CreateBillingCompany(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, co, func(w io.Writer) error {
				fmt.Fprintf(w, "created company #%d %s — %s\n", co.Number, co.Slug, co.Name)
				fmt.Fprintf(w, "first invoice will be numbered %s\n",
					strings.NewReplacer("{SEQ4}", "0001", "{YYYY}", "YYYY").Replace(co.NumberFormat))
				// STATE-DEPENDENT, per nextstep.go rule 3. A company with no
				// IBAN cannot produce a payment part, so "create an invoice" is
				// the wrong next step: the invoice would be created and then
				// refuse to carry a QR bill, one step later, for a reason the
				// caller could have fixed now.
				if co.Iban == "" && co.QrIban == "" {
					fmt.Fprintln(w, "no IBAN yet, so its invoices can carry no payment part")
					nextStep(w, "bk billing company edit %s --iban CH… (workspace owner only)", co.Slug)
					return nil
				}
				nextStep(w, `bk billing invoice create --company %s --client-name "…" --item "desc|1|pcs|100.00"`, co.Slug)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.StringVar(&req.Slug, "slug", "", "URL and CLI handle, e.g. acme-sa (required, permanent)")
	f.StringVar(&req.Name, "name", "", "Display name (required)")
	f.StringVar(&req.LegalName, "legal-name", "", "Name on the payment part; must match the account holder (default: --name)")
	f.StringVar(&addr.Street, "street", "", "Street, without the number")
	f.StringVar(&addr.Building, "building", "", "House number")
	f.StringVar(&addr.PostalCode, "postal-code", "", "Postal code")
	f.StringVar(&addr.City, "city", "", "City")
	f.StringVar(&addr.Country, "country", "", "ISO 3166-1 alpha-2, e.g. CH")
	f.StringVar(&req.Email, "email", "", "Reply-to address for invoices this company sends")
	f.StringVar(&req.Iban, "iban", "", "IBAN for SCOR and NON references (workspace owner only)")
	f.StringVar(&req.QrIban, "qr-iban", "", "QR-IBAN for QRR references (workspace owner only)")
	f.BoolVar(&vatRegistered, "vat-registered", false, "This company charges VAT")
	f.StringVar(&req.Uid, "uid", "", "Swiss UID, e.g. CHE-123.456.789")
	f.StringVar(&req.VatNumber, "vat-number", "", "VAT number as printed on invoices")
	f.StringVar(&defaults.Currency, "currency", "", "Default currency for new invoices")
	f.StringVar(&defaults.Language, "language", "", "Default DOCUMENT language for new invoices")
	f.StringVar(&defaults.RefType, "ref-type", "", "Default reference type (bk meta for the values)")
	f.StringVar(&defaults.VatRate, "vat-rate", "", "Rate prefilled onto new lines; omit for none")
	f.BoolVar(&pricesIncludeVat, "prices-include-vat", false, "New invoices' line prices already contain their VAT")
	f.IntVar(&defaults.PaymentTermsDays, "payment-terms", 0, "Days until a new invoice is due")
	f.StringVar(&req.Rounding, "rounding", "", "Rounding policy; read when a bill is rendered (bk meta for the values)")
	f.StringVar(&req.NumberFormat, "number-format", "", `Invoice number format, e.g. "BC-{YYYY}-{SEQ4}"`)
	f.StringVar(&req.FooterFr, "footer-fr", "", "Footer printed on French invoices")
	f.StringVar(&req.FooterEn, "footer-en", "", "Footer printed on English invoices")
	f.StringVar(&req.ExternalRef, "external-ref", "", "Your own identifier for this company")
	f.StringArrayVar(&meta, "meta", nil, "key=value, repeatable; your own bookkeeping")
	_ = cmd.MarkFlagRequired("slug")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newCompanyEditCmd() *cobra.Command {
	var meta []string
	cmd := &cobra.Command{
		Use:         "edit <slug>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/companies/{slug}"},
		Args:        cobra.ExactArgs(1),
		Short:       "Change a company",
		Long: `Change one or more fields. Only the flags you pass are sent, so nothing else
moves.

The slug cannot change: it appears in URLs and in every URN this app prints.
Neither can the number sequence — that is moved only by creating an invoice.

--iban and --qr-iban are OWNER-ONLY, because changing one redirects real money
and the bill would look entirely normal afterwards.

WHAT AN EDIT REACHES. An invoice takes its own copy of its company the moment it
leaves draft, and renders from that copy forever. So an edit here — a new IBAN, a
corrected legal name, a different --rounding — changes this company's DRAFTS and
its future bills, and no invoice already issued: not its account, not its
creditor name, not its totals. A sent bill that names the wrong account is fixed
by voiding it and issuing a new one.

Changing --rounding re-totals every draft at once, because nothing stores a
total. --prices-include-vat is a prefill for new invoices and changes none.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}

			// Only what the caller actually passed. A struct with `omitempty`
			// cannot tell "leave it alone" from "set it empty", and on a PATCH
			// that difference is the whole meaning of the request.
			patch := map[string]any{}
			flagToField := map[string]string{
				"name": "name", "legal-name": "legal_name", "street": "street",
				"building": "building", "postal-code": "postal_code", "city": "city",
				"country": "country", "email": "email", "iban": "iban", "qr-iban": "qr_iban",
				"uid": "uid", "vat-number": "vat_number", "currency": "default_currency",
				"language": "default_language", "ref-type": "default_ref_type",
				"vat-rate": "default_vat_rate", "rounding": "rounding",
				"number-format": "number_format", "footer-fr": "footer_fr",
				"footer-en": "footer_en", "external-ref": "external_ref",
			}
			for flag, field := range flagToField {
				if cmd.Flags().Changed(flag) {
					v, _ := cmd.Flags().GetString(flag)
					patch[field] = v
				}
			}
			for flag, field := range map[string]string{
				"vat-registered": "vat_registered", "prices-include-vat": "default_prices_include_vat",
			} {
				if cmd.Flags().Changed(flag) {
					v, _ := cmd.Flags().GetBool(flag)
					patch[field] = v
				}
			}
			if cmd.Flags().Changed("payment-terms") {
				v, _ := cmd.Flags().GetInt("payment-terms")
				patch["payment_terms_days"] = v
			}
			if cmd.Flags().Changed("meta") {
				kv, err := parseMetadata(meta)
				if err != nil {
					return err
				}
				patch["metadata"] = kv
			}
			if len(patch) == 0 {
				return fmt.Errorf("nothing to change: pass at least one flag (bk billing company edit --help)")
			}

			co, err := c.EditBillingCompany(ws, args[0], patch)
			if err != nil {
				return err
			}
			return output.Render(format, co, func(w io.Writer) error {
				fields := make([]string, 0, len(patch))
				for k := range patch {
					fields = append(fields, k)
				}
				fmt.Fprintf(w, "updated %s: %s\n", co.Slug, strings.Join(fields, ", "))
				if _, touched := patch["rounding"]; touched {
					fmt.Fprintf(w, "every DRAFT of this company is re-totalled; invoices already issued keep the policy they were issued under\n")
					nextStep(w, "bk billing invoice list --company %s --status draft   and check one", co.Slug)
					return nil
				}
				nextStep(w, "bk billing company show %s", co.Slug)
				return nil
			})
		},
	}
	f := cmd.Flags()
	f.String("name", "", "Display name")
	f.String("legal-name", "", "Name on the payment part; must match the account holder")
	f.String("street", "", "Street, without the number")
	f.String("building", "", "House number")
	f.String("postal-code", "", "Postal code")
	f.String("city", "", "City")
	f.String("country", "", "ISO 3166-1 alpha-2")
	f.String("email", "", "Reply-to address")
	f.String("iban", "", "IBAN (workspace owner only)")
	f.String("qr-iban", "", "QR-IBAN (workspace owner only)")
	f.Bool("vat-registered", false, "This company charges VAT")
	f.String("uid", "", "Swiss UID")
	f.String("vat-number", "", "VAT number")
	f.String("currency", "", "Default currency for new invoices")
	f.String("language", "", "Default document language for new invoices")
	f.String("ref-type", "", "Default reference type")
	f.String("vat-rate", "", "Rate prefilled onto new lines")
	f.Bool("prices-include-vat", false, "New invoices' prices already contain their VAT")
	f.Int("payment-terms", 0, "Days until a new invoice is due")
	f.String("rounding", "", "Rounding policy; re-totals every draft, and no issued invoice")
	f.String("number-format", "", "Invoice number format")
	f.String("footer-fr", "", "Footer printed on French invoices")
	f.String("footer-en", "", "Footer printed on English invoices")
	f.String("external-ref", "", "Your own identifier for this company")
	f.StringArrayVar(&meta, "meta", nil, "key=value, repeatable; replaces the whole map")
	return cmd
}

func newCompanyRetireCmd() *cobra.Command {
	var confirm string
	cmd := &cobra.Command{
		Use:         "retire <slug>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/companies/{slug}"},
		Args:        cobra.ExactArgs(1),
		Short:       "Stop offering a company for new invoices",
		Long: `Retire a company. It issues no new invoices and still renders its old ones.

This is NOT a delete, and there is no delete: past invoices reference this
company and a statement for a past year has to render. The database refuses a
DELETE on this table in two independent ways.

--confirm takes the company's SLUG, typed back. "Confirm()" is not a guard for
an agent — it auto-approves under BK_NO_PROMPT=1 and on a non-TTY — so anything
that changes what a workspace can still bill from makes you repeat the target.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			slug := args[0]
			if confirm != slug {
				return fmt.Errorf(
					"retiring %s needs --confirm %s (you passed %q).\n"+
						"It stops being offered for new invoices; its old ones still render",
					slug, slug, confirm)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			co, err := c.EditBillingCompany(ws, slug, map[string]any{"retired_at": nowStamp()})
			if err != nil {
				return err
			}
			return output.Render(format, co, func(w io.Writer) error {
				fmt.Fprintf(w, "retired %s — it issues no new invoices and still renders its old ones\n", co.Slug)
				nextStep(w, "bk billing company list --retired")
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the company's slug")
	return cmd
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func addressLine(a client.BillingAddress) string {
	parts := []string{}
	if a.Street != "" {
		parts = append(parts, strings.TrimSpace(a.Street+" "+a.Building))
	}
	if a.PostalCode != "" || a.City != "" {
		parts = append(parts, strings.TrimSpace(a.PostalCode+" "+a.City))
	}
	if a.Country != "" {
		parts = append(parts, a.Country)
	}
	if len(parts) == 0 {
		return "—"
	}
	return strings.Join(parts, ", ")
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

// parseMetadata turns repeated `--meta k=v` into a map.
//
// It refuses a bare key rather than storing an empty value: `--meta paid` is
// almost certainly a typo for `--meta paid=true`, and storing `paid=""` would
// make a caller's later `if meta.paid` read false for a key they thought they
// had set.
func parseMetadata(pairs []string) (map[string]string, error) {
	if len(pairs) == 0 {
		return nil, nil
	}
	out := map[string]string{}
	for _, p := range pairs {
		k, v, found := strings.Cut(p, "=")
		if !found || strings.TrimSpace(k) == "" {
			return nil, fmt.Errorf("--meta takes key=value, got %q", p)
		}
		out[strings.TrimSpace(k)] = v
	}
	return out, nil
}

// nowStamp is the timestamp `company retire` sends.
//
// ── WHY THE CLIENT SENDS IT AT ALL, RATHER THAN THE SERVER DECIDING ────────
// Because `retired_at` is an ordinary field on an ordinary PATCH, and the write
// door audits it like any other change. A dedicated `POST …/retire` route would
// be a second write path to the same column, and the reason `retire` exists as
// its own COMMAND rather than its own ROUTE is that the guard belongs at the
// command layer: what needs guarding is a person typing it by accident, not the
// column being set.
//
// RFC 3339 in UTC, which is what Postgres `timestamptz` accepts unambiguously.
// A local timestamp here would be recorded correctly and read back shifted.
func nowStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}
