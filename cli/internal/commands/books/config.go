// A book's own facts, its tax parameters, and switching a rule off.
//
// The three doors that stood between "an agent can keep the books" and "an
// agent can run a company's books". Each closes a hole that was invisible until
// somebody drove the CLI as a person would:
//
//   entity edit     `vat_registered` defaults to false, `entity create` never
//                   set it, and `getTaxSnapshot` gates the whole VAT position
//                   on it. Every book created through the app reported no VAT
//                   position at all, permanently.
//
//   tax-params set  `books.tax_params` was SELECT-only in the application. Only
//                   the seed ever wrote a row, so a real book answered
//                   `tax: null, configured: false` for ever.
//
//   rule deactivate `deactivateRule` was written, exported, and reachable from
//                   nothing. A rule taught against the wrong fragment kept
//                   matching every future import with no way to stop it.

package books

import (
	"fmt"
	"io"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// ---------------------------------------------------------------------------
// entity edit
// ---------------------------------------------------------------------------

func newEntityEditCmd() *cobra.Command {
	var slug string
	var name, seat, vatMethod, vatFiling, auditStatus, regimeElection, fteCount, accent string
	var vatRegistered bool

	cmd := &cobra.Command{
		Use:         "edit --entity <slug> [--vat-registered …]",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/entities/{slug}"},
		Short:       "Change a book's own facts",
		Long: "The things about a company that genuinely change: its name, its seat, whether\n" +
			"it is VAT-registered and how it reports, its audit status, its headcount.\n\n" +
			"Registration is the one to know about. A company that crosses the art. 10\n" +
			"LTVA threshold registers mid-life, and the tax snapshot serves no VAT\n" +
			"position at all until this flag says so. Registering needs the method and\n" +
			"the period too, because a position nobody can file is not worth computing:\n\n" +
			"  bk books entity edit --entity acme --vat-registered \\\n" +
			"    --vat-method effective --vat-filing quarterly\n\n" +
			"Three fields are permanent and are refused by name. The SLUG is how every\n" +
			"URL, command and stored reference names the book. The LEGAL FORM changes by\n" +
			"re-registration at the commercial register, with new books. The BOOKKEEPING\n" +
			"REGIME follows from the legal form under art. 957 and 0004 holds it as a\n" +
			"CHECK.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			// Only flags the caller actually typed are sent. A zero value that
			// was never asked for must not clear a field on the server.
			req := client.EditBooksEntityRequest{}
			f := cmd.Flags()
			if f.Changed("name") {
				req.Name = &name
			}
			if f.Changed("seat") {
				req.Seat = &seat
			}
			if f.Changed("vat-registered") {
				req.VatRegistered = &vatRegistered
			}
			if f.Changed("vat-method") {
				req.VatMethod = &vatMethod
			}
			if f.Changed("vat-filing") {
				req.VatFiling = &vatFiling
			}
			if f.Changed("audit-status") {
				req.AuditStatus = &auditStatus
			}
			if f.Changed("regime-election") {
				req.RegimeElection = &regimeElection
			}
			if f.Changed("fte-count") {
				req.FteCount = &fteCount
			}
			if f.Changed("accent") {
				req.Accent = &accent
			}

			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			e, err := c.EditBooksEntity(ws, slug, req)
			if err != nil {
				return err
			}
			return output.Render(format, e, func(w io.Writer) error {
				vat := "not registered"
				if e.Vat.Registered {
					vat = fmt.Sprintf("VAT %s, %s", e.Vat.Method, e.Vat.Filing)
				}
				if _, err := fmt.Fprintf(w, "updated %s — %s (%s)\n", e.Slug, e.Name, vat); err != nil {
					return err
				}
				// What changed decides what to do next. Turning VAT on changes
				// how every later entry is written — the rate arrives when
				// somebody reads the invoice, and until then the snapshot
				// serves no VAT position at all.
				if cmd.Flags().Changed("vat-registered") && e.Vat.Registered {
					also(w, "entries now carry a VAT story; the rate comes off the invoice, not the bank line:")
					nextStep(w, "bk books resolve <n> --tva-rate <rate> --explanation <text>   (bk meta --app-server books lists the rates)")
					also(w, "  and the position it produces: bk books tax --entity %s", e.Slug)
					return nil
				}
				nextStep(w, "bk books overview")
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&slug, "entity", "", "Book slug (required)")
	cmd.Flags().StringVar(&name, "name", "", "Legal name")
	cmd.Flags().StringVar(&seat, "seat", "", "Registered seat")
	cmd.Flags().BoolVar(&vatRegistered, "vat-registered", false, "Whether the company is VAT-registered (art. 10 LTVA)")
	cmd.Flags().StringVar(&vatMethod, "vat-method", "", "effective or net_debt_rate (art. 37 LTVA)")
	cmd.Flags().StringVar(&vatFiling, "vat-filing", "", "monthly, quarterly, semiannual or annual (art. 35 LTVA)")
	cmd.Flags().StringVar(&auditStatus, "audit-status", "", "ordinary, limited or opted_out (art. 727 CO)")
	cmd.Flags().StringVar(&regimeElection, "regime-election", "", "The art. 957 al. 2 election, recorded")
	cmd.Flags().StringVar(&fteCount, "fte-count", "", "Full-time equivalents, e.g. 2.50")
	cmd.Flags().StringVar(&accent, "accent", "", "Display accent colour")
	_ = cmd.MarkFlagRequired("entity")
	return cmd
}

// ---------------------------------------------------------------------------
// tax-params
// ---------------------------------------------------------------------------

func newTaxParamsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "tax-params",
		Short: "Where a company is taxed, and at what rates",
	}
	cmd.AddCommand(newTaxParamsShowCmd(), newTaxParamsSetCmd())
	return cmd
}

func newTaxParamsShowCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "show --entity <book>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tax-params"},
		Short:       "The canton, commune and rates this book is taxed at",
		Long: "Where this book is taxed and at what rates — the five figures `bk books tax`\n" +
			"needs before it can compute anything.\n\n" +
			"UNCONFIGURED IS A REAL ANSWER and this command gives it plainly. Nothing in\n" +
			"this app may assume a canton, and no rate is ever defaulted: a supplied rate\n" +
			"would be inventing somebody's tax bill. So until `bk books tax-params set` has\n" +
			"run, this says so and names the command, and the tax snapshot answers\n" +
			"`configured: false` rather than a plausible number.\n\n" +
			"These are CONFIGURATION, not history: setting them again replaces them, because\n" +
			"a coefficient that has been voted supersedes the one before it. A snapshot\n" +
			"already taken is unaffected — it is derived at request time and stored nowhere.",
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
			p, err := c.GetBooksTaxParams(ws, entity)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				if !p.Configured {
					// Not an error and not filled in with a default: a supplied
					// rate would be inventing somebody's tax bill.
					_, err := fmt.Fprintf(w,
						"%s has no tax parameters — the tax snapshot answers `configured: false`.\nSet them: bk books tax-params set --entity %s --canton VD --commune Renens …\n",
						p.Entity, p.Entity)
					return err
				}
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "CANTON\t%s\n", p.Canton)
				fmt.Fprintf(tw, "COMMUNE\t%s\n", p.Commune)
				for _, k := range []string{"ifd", "cantonal", "communal", "capital_tax"} {
					fmt.Fprintf(tw, "%s\t%v\n", k, p.Params[k])
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug (required)")
	_ = cmd.MarkFlagRequired("entity")
	return cmd
}

func newTaxParamsSetCmd() *cobra.Command {
	var req client.SetBooksTaxParamsRequest
	cmd := &cobra.Command{
		Use:         "set --entity <book> --canton <XX> --commune <name> …",
		Annotations: map[string]string{"routes": "PUT /api/workspaces/{ws}/tax-params"},
		Short:       "Set where a company is taxed and at what rates",
		Long: "Nothing in this app may assume a canton, so a book has no tax picture until\n" +
			"somebody who knows says where it is taxed. That is why the snapshot answers\n" +
			"`configured: false` rather than guessing a rate.\n\n" +
			"All five figures are required together: a snapshot built on four of them\n" +
			"would be wrong in a way nobody could see. Vaud, Renens, 2026:\n\n" +
			"  bk books tax-params set --entity acme --canton VD --commune Renens \\\n" +
			"    --ifd-rate 8.5 --cantonal-base-rate 3.3333 --cantonal-coefficient 155 \\\n" +
			"    --communal-coefficient 78.5 --capital-tax-permille 0.6\n\n" +
			"This is configuration, not a record: a coefficient that has been voted\n" +
			"replaces the one before it. A snapshot already taken is unaffected — it is\n" +
			"derived at request time and stored nowhere — and an analysis that cited one\n" +
			"keeps its own based_on snapshot verbatim, which is what that field is for.",
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
			p, err := c.SetBooksTaxParams(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "%s is taxed in %s (%s) — the tax snapshot is configured\n",
					p.Entity, p.Commune, p.Canton); err != nil {
					return err
				}
				// The snapshot is derived at request time and stored nowhere,
				// so it answers with the new rates immediately — which is the
				// only way to see that five figures were typed correctly.
				nextStep(w, "bk books tax --entity %s", p.Entity)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().StringVar(&req.Canton, "canton", "", "Two-letter canton, e.g. VD (required)")
	cmd.Flags().StringVar(&req.Commune, "commune", "", "Commune, e.g. Renens (required)")
	cmd.Flags().Float64Var(&req.IfdRatePct, "ifd-rate", 0, "Federal profit tax rate %, art. 68 LIFD (required)")
	cmd.Flags().Float64Var(&req.CantonalBaseRatePct, "cantonal-base-rate", 0, "Cantonal base rate on profit % (required)")
	cmd.Flags().Float64Var(&req.CantonalCoefficientPct, "cantonal-coefficient", 0, "Cantonal coefficient % (required)")
	cmd.Flags().Float64Var(&req.CommunalCoefficientPct, "communal-coefficient", 0, "Communal coefficient % (required)")
	cmd.Flags().Float64Var(&req.CapitalTaxBaseRatePermille, "capital-tax-permille", 0, "Capital tax on equity, per mille (required)")
	for _, f := range []string{"entity", "canton", "commune", "ifd-rate", "cantonal-base-rate", "cantonal-coefficient", "communal-coefficient", "capital-tax-permille"} {
		_ = cmd.MarkFlagRequired(f)
	}
	return cmd
}

// ---------------------------------------------------------------------------
// rule deactivate
// ---------------------------------------------------------------------------

func newRuleDeactivateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "deactivate <number>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/rules/{number}"},
		Short:       "Stop a rule matching future imports",
		Long: "A rule taught against the wrong fragment, or against an amount that has\n" +
			"since changed, keeps marking every future import `inferred` and citing\n" +
			"itself. This switches it off.\n\n" +
			"The rule is not deleted and never will be: a posted entry may cite it for\n" +
			"the ten years art. 958f keeps the entry, so what it already explained keeps\n" +
			"its explanation. Only future imports stop seeing it.\n\n" +
			"There is no reactivate. Teaching it again is one resolve away, and the new\n" +
			"rule records what it was learned from and when — which a flag flipped back\n" +
			"would not.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a rule number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			if err := c.DeactivateBooksRule(ws, n); err != nil {
				return err
			}
			out := map[string]any{"number": n, "active": false}
			return output.Render(format, out, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "rule #%d no longer matches new imports; the entries it already explained keep it\n", n); err != nil {
					return err
				}
				// There is no reactivate, on purpose: teaching it again records
				// what the new rule was learned from, which a flag flipped back
				// would not.
				nextStep(w, "bk books rule list")
				also(w, "  to teach a corrected one: bk books resolve <n> --explanation <text> --rule-counterparty <fragment>")
				return nil
			})
		},
	}
	return cmd
}
