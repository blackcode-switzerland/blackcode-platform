package sales

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk sales product`, `template` and `doc` — what we sell, how we say it, and
// the one library both draw on.
//
// All three are workspace-scoped rather than per-prospect, which is what makes
// them a catalog: a document attached to three prospects is ONE row with three
// links, never three copies, and the per-prospect view is a filter over the
// library.

func newProductCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "product", Short: "The catalog — what we sell"}
	cmd.AddCommand(
		newProductListCmd(), newProductShowCmd(), newProductCreateCmd(),
		newProductEditCmd(), newProductDeleteCmd(),
	)
	return cmd
}

func newProductListCmd() *cobra.Command {
	var category, query string
	var limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/products"},
		Short:       "List products",
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
			rows, err := c.ListProducts(ws, category, query, limit)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tCATEGORY\tNAME\tPRICE\tSTATUS")
				for _, r := range rows {
					// The price AS WRITTEN wins over the numeric range: half the
					// catalogue is not a single number ("on request", "from CHF
					// 12,000"), and the label is what a human wrote for a reason.
					price := r.PriceLabel
					if strings.TrimSpace(price) == "" {
						price = money(r.PriceFrom, r.Currency)
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.Number, r.Category, cmdutil.Truncate(r.Name, 34),
						cmdutil.Truncate(price, 26), cmdutil.Truncate(dashIf(r.StatusLabel), 18))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no products)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&category, "category", "", "Filter by category — "+vocab("product_categories"))
	cmd.Flags().StringVar(&query, "q", "", "Substring match on the name")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max products to return")
	return cmd
}

func newProductShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/products/{n}"},
		Short:       "Show one product",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "product")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.GetProduct(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s\n%s\n\n", p.Number, p.Name, p.URN)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "category\t%s\n", p.Category)
				fmt.Fprintf(tw, "price\t%s\n", dashIf(p.PriceLabel))
				if p.PriceFrom != "" {
					fmt.Fprintf(tw, "range\t%s – %s\n", money(p.PriceFrom, p.Currency), money(p.PriceTo, p.Currency))
				}
				if len(p.Fit) > 0 {
					fmt.Fprintf(tw, "fits\t%s\n", strings.Join(p.Fit, ", "))
				}
				if len(p.Refs) > 0 {
					fmt.Fprintf(tw, "references\t%s\n", strings.Join(p.Refs, ", "))
				}
				// `external` is printed even though `internal` is the default and
				// the common case: the whole content of the field is "our page is
				// not the whole story here", and a reader who does not see it
				// stated will write the full page anyway.
				if p.Reach == "external" || p.ExternalURL != "" {
					fmt.Fprintf(tw, "reach\t%s%s\n", dashIf(p.Reach), suffix(p.ExternalURL))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				// ── INTERNAL ONLY ────────────────────────────────────────────
				// Labelled on screen, every time, and not merely stored under an
				// internal-sounding key. This is the number a rep reads out
				// loud, and the one context where it must not be read out loud
				// is the one where somebody forgot which field it came from.
				if p.InternalPriceMin != "" || p.InternalPriceMax != "" || p.InternalPriceNote != "" {
					fmt.Fprintf(w, "\nINTERNAL — do not quote this to a customer as our list price\n")
					it := output.Tabwriter(w)
					if p.InternalPriceMin != "" || p.InternalPriceMax != "" {
						fmt.Fprintf(it, "  guidance\t%s\n", internalRange(p))
					}
					if p.InternalPriceNote != "" {
						fmt.Fprintf(it, "  note\t%s\n", p.InternalPriceNote)
					}
					if err := it.Flush(); err != nil {
						return err
					}
				}
				if p.Pitch != "" {
					fmt.Fprintf(w, "\n%s\n", p.Pitch)
				}
				if p.Description != "" {
					fmt.Fprintf(w, "\n%s\n", p.Description)
				}
				return nil
			})
		},
	}
}

func productFlags(cmd *cobra.Command, req *client.ProductRequest, fit, refs *[]string) {
	cmd.Flags().StringVar(&req.Category, "category", "", vocab("product_categories", "required"))
	cmd.Flags().StringVar(&req.Name, "name", "", "Product name (required)")
	cmd.Flags().StringVar(&req.PriceLabel, "price", "", "The price AS WRITTEN (\"from CHF 12,000\")")
	cmd.Flags().StringVar(&req.PriceFrom, "price-from", "", "Lower bound, a plain amount")
	cmd.Flags().StringVar(&req.PriceTo, "price-to", "", "Upper bound, a plain amount")
	cmd.Flags().StringVar(&req.Currency, "currency", "", "ISO currency code (default CHF)")
	cmd.Flags().StringVar(&req.Description, "description", "", "What it is")
	cmd.Flags().StringVar(&req.Pitch, "pitch", "", "The one-line pitch")
	cmd.Flags().StringVar(&req.StatusLabel, "status", "", "Maturity note (\"v1.3 · shipped internally\")")
	cmd.Flags().StringSliceVar(fit, "fit", nil, "Who it suits (repeatable)")
	cmd.Flags().StringSliceVar(refs, "ref", nil, "Reference customers, by name (repeatable) — NOT a place for a url")
	cmd.Flags().StringVar(&req.InternalPriceMin, "internal-price-min", "", "INTERNAL ONLY: the floor you may quote")
	cmd.Flags().StringVar(&req.InternalPriceMax, "internal-price-max", "", "INTERNAL ONLY: the ceiling you may quote")
	cmd.Flags().StringVar(&req.InternalPriceNote, "internal-price-note", "", "INTERNAL ONLY: the negotiating context a number cannot carry")
	cmd.Flags().StringVar(&req.Reach, "reach", "", "How far our own site carries it — "+vocab("product_reaches", "default: internal"))
	cmd.Flags().StringVar(&req.ExternalURL, "external-url", "", "An external product's own site, full url including https://")
}

// internalRange renders a one- or two-ended price range. A floor with no
// ceiling ("never below 8k") is a legitimate answer, so it must not print as
// "CHF 8'000 – " with nothing after the dash.
func internalRange(p *client.SalesProduct) string {
	switch {
	case p.InternalPriceMin != "" && p.InternalPriceMax != "":
		return money(p.InternalPriceMin, p.Currency) + " – " + money(p.InternalPriceMax, p.Currency)
	case p.InternalPriceMin != "":
		return "from " + money(p.InternalPriceMin, p.Currency)
	default:
		return "up to " + money(p.InternalPriceMax, p.Currency)
	}
}

func newProductCreateCmd() *cobra.Command {
	var req client.ProductRequest
	var fit, refs []string
	cmd := &cobra.Command{
		Use:         "create --category <c> --name <name>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/products"},
		Short:       "Add a product to the catalog",
		Long: `Add a product.

--price is the price AS WRITTEN, because half a catalogue is not a single
number. --price-from / --price-to are the machine-readable half where one
exists; neither derives from the other.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req.Fit, req.Refs = splitAll(fit), splitAll(refs)
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.CreateProduct(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created product #%d: %s\n%s\n", p.Number, p.Name, p.URN)
				return err
			})
		},
	}
	productFlags(cmd, &req, &fit, &refs)
	for _, f := range []string{"category", "name"} {
		_ = cmd.MarkFlagRequired(f)
	}
	return cmd
}

func newProductEditCmd() *cobra.Command {
	var req client.ProductRequest
	var fit, refs []string
	cmd := &cobra.Command{
		Use:         "edit <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/products/{n}"},
		Short:       "Edit a product",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "product")
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("fit") {
				req.Fit = splitAll(fit)
			}
			if cmd.Flags().Changed("ref") {
				req.Refs = splitAll(refs)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.UpdateProduct(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated product #%d: %s\n", p.Number, p.Name)
				return err
			})
		},
	}
	productFlags(cmd, &req, &fit, &refs)
	return cmd
}

func newProductDeleteCmd() *cobra.Command {
	return newCatalogDeleteCmd(catalogDelete{
		Noun: "product", Field: "name",
		Routes: "GET /api/workspaces/{ws}/products/{n},DELETE /api/workspaces/{ws}/products/{n}",
		Fetch: func(c *client.Client, ws string, n int) (string, error) {
			p, err := c.GetProduct(ws, n)
			if err != nil {
				return "", err
			}
			return p.Name, nil
		},
		Delete: func(c *client.Client, ws string, n int, confirm string) (*client.SalesDeleted, error) {
			return c.DeleteProduct(ws, n, confirm)
		},
	})
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

func newTemplateCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "template", Short: "Message templates — how we say it"}
	cmd.AddCommand(
		newTemplateListCmd(), newTemplateShowCmd(), newTemplateCreateCmd(),
		newTemplateEditCmd(), newTemplateDeleteCmd(), newTemplateRenderCmd(),
	)
	return cmd
}

func newTemplateListCmd() *cobra.Command {
	var channel, category, stage, query string
	var limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/templates"},
		Short:       "List templates",
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
			rows, err := c.ListTemplates(ws, channel, category, stage, query, limit)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tCHANNEL\tCATEGORY\tSTAGE\tNAME\tVARIABLES")
				for _, r := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						r.Number, r.Channel, r.Category, dashIf(r.Stage),
						cmdutil.Truncate(r.Name, 30), dashIf(strings.Join(r.Variables, ", ")))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no templates)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&channel, "channel", "", "Filter by channel — "+vocab("template_channels"))
	cmd.Flags().StringVar(&category, "category", "", "Filter by category — "+vocab("template_categories"))
	cmd.Flags().StringVar(&stage, "stage", "", "Filter by the stage it is for — "+vocab("stages"))
	cmd.Flags().StringVar(&query, "q", "", "Substring match on the name")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max templates to return")
	return cmd
}

func newTemplateShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/templates/{n}"},
		Short:       "Show one template, with its variables",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "template")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			t, err := c.GetTemplate(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, t, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s\n%s\n\n", t.Number, t.Name, t.URN)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "channel\t%s\n", t.Channel)
				fmt.Fprintf(tw, "category\t%s\n", t.Category)
				fmt.Fprintf(tw, "stage\t%s\n", dashIf(t.Stage))
				// Parsed from the body, so this is what `render` will demand.
				fmt.Fprintf(tw, "variables\t%s\n", dashIf(strings.Join(t.Variables, ", ")))
				if err := tw.Flush(); err != nil {
					return err
				}
				if t.Subject != "" {
					fmt.Fprintf(w, "\nSubject: %s\n", t.Subject)
				}
				if t.Body != "" {
					fmt.Fprintf(w, "\n%s\n", t.Body)
				}
				return nil
			})
		},
	}
}

func newTemplateCreateCmd() *cobra.Command {
	var req client.TemplateRequest
	cmd := &cobra.Command{
		Use:         "create --channel <c> --category <c> --name <name>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/templates"},
		Short:       "Add a template",
		Long: `Add a message template.

Placeholders are written {{like_this}} in --body and are PARSED OUT for you:
there is no --variables flag, because a declared list that could disagree with
the body would make "render" validate against something the template does not
contain.`,
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
			t, err := c.CreateTemplate(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, t, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created template #%d: %s (variables: %s)\n",
					t.Number, t.Name, dashIf(strings.Join(t.Variables, ", ")))
				return err
			})
		},
	}
	templateFlags(cmd, &req)
	for _, f := range []string{"channel", "category", "name"} {
		_ = cmd.MarkFlagRequired(f)
	}
	return cmd
}

func newTemplateEditCmd() *cobra.Command {
	var req client.TemplateRequest
	cmd := &cobra.Command{
		Use:         "edit <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/templates/{n}"},
		Short:       "Edit a template",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "template")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			t, err := c.UpdateTemplate(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, t, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated template #%d: %s (variables: %s)\n",
					t.Number, t.Name, dashIf(strings.Join(t.Variables, ", ")))
				return err
			})
		},
	}
	templateFlags(cmd, &req)
	return cmd
}

func templateFlags(cmd *cobra.Command, req *client.TemplateRequest) {
	cmd.Flags().StringVar(&req.Channel, "channel", "", vocab("template_channels", "required"))
	cmd.Flags().StringVar(&req.Category, "category", "", "Template category — "+vocab("template_categories", "required"))
	cmd.Flags().StringVar(&req.Stage, "stage", "", "The pipeline stage this template is for — "+vocab("stages"))
	cmd.Flags().StringVar(&req.Name, "name", "", "Template name (required)")
	cmd.Flags().StringVar(&req.Subject, "subject", "", "Subject line, for an email template")
	cmd.Flags().StringVar(&req.Body, "body", "", "The message, with {{placeholders}}")
}

func newTemplateDeleteCmd() *cobra.Command {
	return newCatalogDeleteCmd(catalogDelete{
		Noun: "template", Field: "name",
		Routes: "GET /api/workspaces/{ws}/templates/{n},DELETE /api/workspaces/{ws}/templates/{n}",
		Fetch: func(c *client.Client, ws string, n int) (string, error) {
			t, err := c.GetTemplate(ws, n)
			if err != nil {
				return "", err
			}
			return t.Name, nil
		},
		Delete: func(c *client.Client, ws string, n int, confirm string) (*client.SalesDeleted, error) {
			return c.DeleteTemplate(ws, n, confirm)
		},
	})
}

func newTemplateRenderCmd() *cobra.Command {
	var vars []string
	cmd := &cobra.Command{
		Use:         "render <n> --var k=v",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/templates/{n}/render"},
		Short:       "Fill a template in",
		Long: `Substitute the {{placeholders}} in a template and print the result.

A MISSING VARIABLE IS A FAILURE, not a gap left in the output: a rendered message
still containing a literal {{first_name}} is one you would paste into an email,
and the mistake would be visible only to the recipient. The error names each
missing variable AND the full declared set.

Nothing is sent and nothing is recorded — rendering is a pure read.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "template")
			if err != nil {
				return err
			}
			kv := map[string]string{}
			for _, v := range vars {
				parts := strings.SplitN(v, "=", 2)
				if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" {
					return fmt.Errorf("--var must be key=value, got %q", v)
				}
				kv[strings.TrimSpace(parts[0])] = parts[1]
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			out, err := c.RenderTemplate(ws, n, kv)
			if err != nil {
				return err
			}
			return output.Render(format, out, func(w io.Writer) error {
				if out.Subject != "" {
					fmt.Fprintf(w, "Subject: %s\n\n", out.Subject)
				}
				fmt.Fprintln(w, out.Body)
				if len(out.Unused) > 0 {
					// Silence here is how somebody spends ten minutes wondering
					// why the name did not appear.
					fmt.Fprintf(cmd.ErrOrStderr(),
						"note: %s not used by this template — check the spelling\n",
						strings.Join(out.Unused, ", "))
				}
				return nil
			})
		},
	}
	cmd.Flags().StringArrayVar(&vars, "var", nil, "A placeholder value, key=value (repeatable)")
	return cmd
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

func newDocCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "doc", Short: "The document library — files and links"}
	cmd.AddCommand(
		newDocListCmd(), newDocShowCmd(), newDocAddCmd(), newDocEditCmd(),
		newDocRemoveCmd(), newDocLinkCmd(false), newDocLinkCmd(true),
		newDocRecheckCmd(),
	)
	return cmd
}

func newDocListCmd() *cobra.Command {
	var kind, query string
	var tags []string
	var prospect, product, template, limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/documents"},
		Short:       "List documents",
		Long: `List the library.

--prospect and --product FILTER it rather than listing a separate per-prospect or
per-product set: a document attached to three prospects is one row with three
links, never three copies.

--tag matches a document carrying ANY of the tags given, not all of them, and it
is case-insensitive. Tags are free text with no vocabulary behind them — whatever
was written with "bk sales doc add --tag" — so an unknown one is not an error,
just a filter that matches nothing. Run "bk sales doc list --json" to see which
tags are in use.`,
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
			rows, err := c.ListDocuments(ws, client.ListDocsOpts{
				Kind:     kind,
				Query:    query,
				Prospect: prospect,
				Product:  product,
				Template: template,
				Tags:     splitAll(tags),
				Limit:    limit,
			})
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tKIND\tSOURCE\tTITLE\tLINKED TO\tADDED BY")
				restricted := 0
				for _, r := range rows {
					linked := fmt.Sprintf("%dp %dpr %ds %dt",
						len(r.Prospects), len(r.Products), len(r.Strategies), len(r.Templates))
					if r.File.PreviewStatus == "restricted" {
						restricted++
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						r.Number, r.Kind, sourceCell(r), cmdutil.Truncate(r.Title, 30), linked,
						cmdutil.Truncate(dashIf(r.AddedBy), 16))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				// AGENT EDUCATION, on the command an agent already ran. A
				// restricted link renders as a card rather than a preview and
				// nothing else would say so.
				if restricted > 0 {
					fmt.Fprintf(cmd.ErrOrStderr(),
						"note: %d document(s) marked ! are NOT viewable without access — share them\n"+
							"      \"anyone with the link\" at the provider, then `bk sales doc recheck all`\n",
						restricted)
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no documents — two ways to add one:\n"+
							"   a file:  bk sales upload <file>   then  bk sales doc add --title T --upload <url>\n"+
							"   a link:  bk sales doc add --title T --url https://drive.google.com/file/d/<id>/view\n"+
							" `bk guide platform/files` explains when to use which)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&kind, "kind", "", "Filter by kind — "+vocab("document_kinds"))
	cmd.Flags().StringVar(&query, "q", "", "Substring match on the title")
	// `--prospect` and `--product` are `int` here and `ints` on `doc add` /
	// `doc link`, and that difference is correct rather than an oversight: there
	// they name things to ATTACH TO and repeat; here they name one thing to
	// FILTER BY. Unifying them would make `doc list --prospect 3 --prospect 7`
	// look meaningful, and the route has no answer for it.
	cmd.Flags().IntVar(&prospect, "prospect", 0, "Only documents linked to this prospect (its #number)")
	cmd.Flags().IntVar(&product, "product", 0, "Only documents linked to this product (its #number)")
	cmd.Flags().IntVar(&template, "template", 0, "Only documents linked to this template (its #number)")
	cmd.Flags().StringSliceVar(&tags, "tag", nil,
		"Only documents carrying any of these tags (repeatable; case-insensitive)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max documents to return")
	return cmd
}

// sourceCell renders WHERE a document lives, in one narrow column.
//
// A `!` marks a file the provider will not show to an anonymous viewer, and a
// `?` one we could not check. Two characters rather than a whole column, because
// the answer is "fine" for almost every row and a column of "public" teaches
// nothing — the exceptions are the information.
func sourceCell(d client.SalesDocument) string {
	name := d.File.Label
	if name == "" {
		name = dashIf(d.File.Provider)
	}
	switch d.File.PreviewStatus {
	case "restricted":
		return "! " + name
	case "unknown":
		return "? " + name
	default:
		return name
	}
}

func newDocShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/documents/{n}"},
		Short:       "Show one document and what it is linked to",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "document")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			d, err := c.GetDocument(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, d, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s\n%s\n\n", d.Number, d.Title, d.URN)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "kind\t%s\n", d.Kind)
				fmt.Fprintf(tw, "url\t%s\n", d.URL())
				fmt.Fprintf(tw, "stored\t%s\n", storedWhere(*d))
				if d.File.MediaKind != "" && d.File.MediaKind != "other" {
					fmt.Fprintf(tw, "type\t%s\n", d.File.MediaKind)
				}
				// Preview is a WEB affordance — there is nothing to render in a
				// terminal — but its STATUS is exactly what an agent needs, since
				// the agent is the one who can go and fix the sharing.
				if d.File.PreviewStatus != "" {
					fmt.Fprintf(tw, "preview\t%s\n", d.File.PreviewStatus)
				}
				if d.File.ExternalID != "" {
					fmt.Fprintf(tw, "provider id\t%s\n", d.File.ExternalID)
				}
				fmt.Fprintf(tw, "added by\t%s\n", dashIf(d.AddedBy))
				fmt.Fprintf(tw, "prospects\t%s\n", numbersOrDash(d.Prospects))
				fmt.Fprintf(tw, "products\t%s\n", numbersOrDash(d.Products))
				fmt.Fprintf(tw, "strategies\t%s\n", numbersOrDash(d.Strategies))
				fmt.Fprintf(tw, "templates\t%s\n", numbersOrDash(d.Templates))
				if err := tw.Flush(); err != nil {
					return err
				}
				if note := previewAdvice(*d); note != "" {
					fmt.Fprintf(cmd.ErrOrStderr(), "note: %s\n", note)
				}
				if d.Description != "" {
					fmt.Fprintf(w, "\n%s\n", d.Description)
				}
				return nil
			})
		},
	}
}

// storedWhere says which of the two locations a document has, because it
// decides something real: only an uploaded file is covered by the blob
// reference index, and only that file can be lost by a purge elsewhere.
// storedWhere answers "whose bytes are these", which is the question with
// consequences: we may delete our own and must never delete anybody else's.
//
// It reads the DERIVED `File` block rather than testing `UploadURL != ""` as it
// used to. Both answer correctly today, but only one of them knows the
// difference between Google Drive and a random link — and that difference is
// what decides whether the web can preview it.
func storedWhere(d client.SalesDocument) string {
	if d.File.Internal {
		return d.File.Label + " (ours — covered by the delete gate)"
	}
	if d.File.Label != "" {
		return d.File.Label + " (external — we reference it, never delete it)"
	}
	return "external link"
}

// previewAdvice turns a preview verdict into the next command to run.
//
// CLAUDE.md: "a dead end must name its own exit". A `restricted` file is a dead
// end for the WEB — the page will show a card instead of the video somebody
// expected — and the exit is at the provider, not here. So the advice names both
// halves: what to change in Drive, and how to confirm it afterwards.
func previewAdvice(d client.SalesDocument) string {
	// A folder has no preview at any permission level, so advising a share
	// change would be advising a fix that changes nothing. Same ordering as the
	// web fallback, for the same reason.
	if d.File.MediaKind == "folder" {
		return ""
	}
	switch d.File.PreviewStatus {
	case "restricted":
		return fmt.Sprintf("this file is NOT viewable without access, so the app cannot preview it — "+
			"share it \"anyone with the link\" at %s, then `bk sales doc recheck %d`",
			dashIf(d.File.Label), d.Number)
	case "unknown":
		return fmt.Sprintf("could not check whether this is viewable — it will not be previewed "+
			"until a check succeeds; retry with `bk sales doc recheck %d`", d.Number)
	default:
		return ""
	}
}

func numbersOrDash(ns []int) string {
	if len(ns) == 0 {
		return "—"
	}
	parts := make([]string, 0, len(ns))
	for _, n := range ns {
		parts = append(parts, fmt.Sprintf("#%d", n))
	}
	return strings.Join(parts, ", ")
}

func newDocAddCmd() *cobra.Command {
	var req client.DocumentRequest
	var tags []string
	var prospects, products, templates, strategies []int
	cmd := &cobra.Command{
		Use: "add --title <t> (--url <u> | --upload <u>)",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/documents," +
			"POST /api/workspaces/{ws}/documents/{n}/links"},
		Short: "Add a document to the library",
		Long: `Add a file or a link to the one library.

EXACTLY ONE location, and the choice matters:

  --upload <url>   OUR storage. Upload the file first with "bk sales upload
                   <file>" and pass the URL it prints. We hold the bytes, so the
                   cross-app delete gate protects them and the web previews them
                   for anyone who can see the record.

  --url <url>      SOMEBODY ELSE'S. A Google Drive link, or any other url. We
                   store a reference and never a copy — so we never delete it,
                   and we can only preview it if the provider will show it to a
                   viewer who is not signed in to our app.

Putting a stored file's URL in --url would hide it from the index that stops it
being deleted while still in use, which is why they are different flags.

GOOGLE DRIVE. A Drive link is recognised automatically — file, Doc, Sheet,
Slides or folder — and this command tells you whether it can actually be
previewed. It cannot be if the file is private: WE HOLD NO GOOGLE CREDENTIALS
AND CANNOT GRANT ACCESS. Share it "anyone with the link" in Drive first, or run
"bk sales doc recheck <n>" after you do.

--kind is OPTIONAL. Give it when you know better (a "deck" is a judgement no
recogniser can make); leave it out and the type is derived from the url.

--prospect / --product / --template attach it as it is created, each repeatable.
They are the same links "bk sales doc link" writes, done in one call; that
command remains the way to attach a document that already exists.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req.Tags = splitAll(tags)
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			d, err := c.AddDocument(ws, req)
			if err != nil {
				return err
			}
			// The document EXISTS from here on, and every later failure has to say
			// so. A caller told only "failed" adds it a second time — and this
			// command's whole point is that it is two writes behind one call.
			linked, err := linkNewDocument(c, ws, d, prospects, products, templates, strategies)
			if err != nil {
				return fmt.Errorf("document #%d (%s) WAS created; %w — attach the rest with "+
					"`bk sales doc link %d …`, do not re-add it", d.Number, d.Title, err, d.Number)
			}
			return output.Render(format, linked, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "added document #%d: %s\n%s\n", linked.Number, linked.Title, linked.URN)
				if err != nil {
					return err
				}
				// WHAT WE WORKED OUT, said back. An agent that passed a Drive url
				// and got only "added document #7" has no idea whether we
				// recognised it, what type we think it is, or whether the thing
				// will ever render. All three are decided here and all three are
				// printed here.
				if d.File.Provider != "" {
					fmt.Fprintf(cmd.ErrOrStderr(), "  source: %s", d.File.Label)
					if d.File.MediaKind != "" && d.File.MediaKind != "other" {
						fmt.Fprintf(cmd.ErrOrStderr(), " · %s", d.File.MediaKind)
					}
					if d.Kind != "" {
						fmt.Fprintf(cmd.ErrOrStderr(), " · kind=%s", d.Kind)
					}
					fmt.Fprintln(cmd.ErrOrStderr())
				}
				if d.PreviewNote != "" {
					fmt.Fprintf(cmd.ErrOrStderr(), "  preview: %s\n", d.PreviewNote)
				}
				if n := len(prospects) + len(products) + len(templates); n > 0 {
					_, err = fmt.Fprintf(w, "linked to prospects %s and products %s\n",
						numbersOrDash(linked.Prospects), numbersOrDash(linked.Products))
				}
				return err
			})
		},
	}
	cmd.Flags().IntSliceVar(&prospects, "prospect", nil, "Attach to this prospect as it is created (repeatable)")
	cmd.Flags().IntSliceVar(&products, "product", nil, "Attach to this product as it is created (repeatable)")
	cmd.Flags().IntSliceVar(&templates, "template", nil, "Attach to this template as it is created (repeatable)")
	cmd.Flags().StringVar(&req.Title, "title", "", "What the document is (required)")
	cmd.Flags().StringVar(&req.Kind, "kind", "", "Your label — "+vocab("document_kinds", "optional: derived from the url when omitted"))
	cmd.Flags().StringVar(&req.UploadURL, "upload", "", "URL of a file uploaded to OUR storage (this OR --url, exactly one)")
	cmd.Flags().StringVar(&req.ExternalURL, "url", "", "A link somebody else hosts — e.g. Google Drive (this OR --upload, exactly one)")
	cmd.Flags().StringVar(&req.Description, "description", "", "What it is for")
	cmd.Flags().StringSliceVar(&tags, "tag", nil, "Tags (repeatable)")
	cmd.Flags().IntSliceVar(&strategies, "strategy", nil, "Attach to this strategy as it is created (repeatable)")
	// `kind` left the required list on 2026-08-17: the server derives it from
	// the url. It was a question an agent had to answer about a Drive link it
	// could not open.
	_ = cmd.MarkFlagRequired("title")
	return cmd
}

// linkNewDocument attaches a freshly created document to everything `doc add`
// was given, one call per target because the route takes exactly one.
//
// It returns the LAST document state the server sent, so the confirmation
// reports the links that actually landed rather than the ones that were asked
// for. On the first failure it stops and reports which target failed — the
// caller is mid-way through a partial attach, and "3 of 5" with no names is not
// something anybody can act on.
func linkNewDocument(c *client.Client, ws string, d *client.SalesDocument,
	prospects, products, templates, strategies []int) (*client.SalesDocument, error) {
	type target struct {
		noun string
		n    int
	}
	var targets []target
	for _, n := range prospects {
		targets = append(targets, target{"prospect", n})
	}
	for _, n := range products {
		targets = append(targets, target{"product", n})
	}
	for _, n := range templates {
		targets = append(targets, target{"template", n})
	}
	for _, n := range strategies {
		targets = append(targets, target{"strategy", n})
	}

	out := d
	for _, t := range targets {
		n := t.n
		req := client.DocumentLinkRequest{}
		switch t.noun {
		case "prospect":
			req.Prospect = &n
		case "product":
			req.Product = &n
		case "template":
			req.Template = &n
		case "strategy":
			req.Strategy = &n
		}
		next, err := c.LinkDocument(ws, d.Number, req)
		if err != nil {
			return out, fmt.Errorf("linking it to %s #%d failed: %w", t.noun, n, err)
		}
		out = next
	}
	return out, nil
}

func newDocEditCmd() *cobra.Command {
	var req client.DocumentRequest
	var tags []string
	cmd := &cobra.Command{
		Use:         "edit <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/documents/{n}"},
		Short:       "Edit a document's title, kind, description or tags",
		Long: `Edit the metadata. THE LOCATION IS NOT EDITABLE: a stored file and a link
are different documents, and swapping one for the other would silently change
whether the delete gate covers it. Remove this one and add the other.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "document")
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("tag") {
				req.Tags = splitAll(tags)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			d, err := c.UpdateDocument(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, d, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated document #%d: %s\n", d.Number, d.Title)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Title, "title", "", "What the document is")
	cmd.Flags().StringVar(&req.Kind, "kind", "", "Document kind — "+vocab("document_kinds"))
	cmd.Flags().StringVar(&req.Description, "description", "", "What it is for")
	cmd.Flags().StringSliceVar(&tags, "tag", nil, "Tags (repeatable; replaces the set)")
	return cmd
}

func newDocRemoveCmd() *cobra.Command {
	return newCatalogDeleteCmd(catalogDelete{
		Noun: "doc", Field: "title", Verb: "rm", Type: "document",
		Routes: "GET /api/workspaces/{ws}/documents/{n},DELETE /api/workspaces/{ws}/documents/{n}",
		Fetch: func(c *client.Client, ws string, n int) (string, error) {
			d, err := c.GetDocument(ws, n)
			if err != nil {
				return "", err
			}
			return d.Title, nil
		},
		Delete: func(c *client.Client, ws string, n int, confirm string) (*client.SalesDeleted, error) {
			return c.DeleteDocument(ws, n, confirm)
		},
		Note: "\n\nThis bins the RECORD. The file itself goes when nothing anywhere still\n" +
			"references it — that is the storage layer's decision, not this command's.",
	})
}

func newDocLinkCmd(unlink bool) *cobra.Command {
	var prospect, product, template, strategy int
	verb, short := "link", "Attach a document to a prospect, product, template or strategy"
	routes := "POST /api/workspaces/{ws}/documents/{n}/links"
	if unlink {
		verb, short = "unlink", "Detach a document from a prospect, product, template or strategy"
		routes = "DELETE /api/workspaces/{ws}/documents/{n}/links"
	}
	cmd := &cobra.Command{
		Use:         verb + " <n> (--prospect <n> | --product <n> | --template <n> | --strategy <n>)",
		Annotations: map[string]string{"routes": routes},
		Short:       short,
		Long: `Exactly one target per call.

A document lives in ONE library and is linked to many things; linking it to a
second prospect does not copy it, and unlinking it from one leaves it attached
to the others.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "document")
			if err != nil {
				return err
			}
			req := client.DocumentLinkRequest{}
			given := 0
			for name, target := range map[string]*int{"prospect": &prospect, "product": &product, "template": &template, "strategy": &strategy} {
				if cmd.Flags().Changed(name) {
					given++
					v := *target
					switch name {
					case "prospect":
						req.Prospect = &v
					case "product":
						req.Product = &v
					case "template":
						req.Template = &v
					case "strategy":
						req.Strategy = &v
					}
				}
			}
			if given != 1 {
				return fmt.Errorf("exactly one of --prospect, --product, --template or --strategy is required")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			var d *client.SalesDocument
			if unlink {
				d, err = c.UnlinkDocument(ws, n, req)
			} else {
				d, err = c.LinkDocument(ws, n, req)
			}
			if err != nil {
				return err
			}
			return output.Render(format, d, func(w io.Writer) error {
				_, err := fmt.Fprintf(w,
					"%sed document #%d (%s)\n  prospects %s · products %s · strategies %s · templates %s\n",
					verb, d.Number, d.Title,
					numbersOrDash(d.Prospects), numbersOrDash(d.Products),
					numbersOrDash(d.Strategies), numbersOrDash(d.Templates))
				return err
			})
		},
	}
	cmd.Flags().IntVar(&prospect, "prospect", 0, "A prospect's #number")
	cmd.Flags().IntVar(&product, "product", 0, "A product's #number")
	cmd.Flags().IntVar(&template, "template", 0, "A template's #number")
	cmd.Flags().IntVar(&strategy, "strategy", 0, "A segment strategy's #number")
	return cmd
}

// `bk sales doc recheck` — ask the provider again whether a file is viewable.
//
// The closing half of the attach→warn→share→recheck loop. Without it an agent
// that fixed the sharing in Drive has no way to confirm it took, and the next
// thing anybody learns is a human seeing a request-access screen on a customer
// record.
func newDocRecheckCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "recheck <n|all>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/documents/{n}/recheck"},
		Short:       "Re-ask whether an external file is viewable",
		Long: `Ask the provider again whether an attached file can be opened by somebody
who is not signed in, and record the answer.

Run it after sharing a Google Drive file "anyone with the link" — the app cannot
preview a file it cannot fetch, and WE HOLD NO GOOGLE CREDENTIALS, so sharing is
the only thing that changes the answer.

"recheck all" sweeps the whole library. Use it once after upgrading: documents
added before this feature have no recorded source, and the sweep fills it in.
It is deliberately sequential — firing hundreds of requests at a provider in
parallel gets an IP rate-limited, which would report every file as uncheckable
and look like the files were the problem.

Our OWN uploads are never probed. They are always viewable by anyone who can see
the record; there is no external permission system in the way.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			ref := strings.TrimSpace(args[0])
			if ref != "all" {
				if _, err := entityNumber(ref, "document"); err != nil {
					return err
				}
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			res, err := c.RecheckDocument(ws, ref)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				if ref == "all" {
					fmt.Fprintf(w, "checked %d document(s); %d changed\n", res.Checked, res.Changed)
					for _, r := range res.Results {
						if r.Now == "restricted" || r.Now == "unknown" {
							fmt.Fprintf(w, "  !  #%d  %s — %s\n", r.Number, r.Provider, r.Now)
						}
					}
					if len(res.Restricted) > 0 {
						fmt.Fprintf(cmd.ErrOrStderr(),
							"note: %d document(s) cannot be previewed. Share each one \"anyone with the\n"+
								"      link\" at its provider, then run this again.\n", len(res.Restricted))
					}
					return nil
				}
				if res.Recheck == nil {
					// The server answered without the block this command exists to
					// print. Loud rather than a blank line: a silent success here
					// would read as "checked, all fine".
					return fmt.Errorf("the server did not report a recheck result — it may predate this command")
				}
				fmt.Fprintf(w, "#%d  %s\n", res.Number, res.Title)
				fmt.Fprintf(w, "  preview: %s", dashIf(res.Recheck.Now))
				if res.Recheck.Changed {
					fmt.Fprintf(w, "  (was %s)", dashIf(res.Recheck.Was))
				}
				fmt.Fprintln(w)
				if res.Recheck.Note != "" {
					fmt.Fprintf(cmd.ErrOrStderr(), "note: %s\n", res.Recheck.Note)
				}
				return nil
			})
		},
	}
	return cmd
}

// ---------------------------------------------------------------------------
// One delete, three catalog nouns
// ---------------------------------------------------------------------------

// catalogDelete describes a catalog entity's irreversible command. Products,
// templates and documents differ only in the noun and in which field is
// repeated back — writing the delete three times would be three places for the
// confirmation to be forgotten, which is the one place it must not be.
type catalogDelete struct {
	Noun   string // the command group: product | template | doc
	Type   string // the entity name, when it differs from Noun (doc → document)
	Verb   string // the command name; "delete" unless given
	Field  string // what --confirm repeats back: name | title
	Routes string
	Note   string
	Fetch  func(*client.Client, string, int) (string, error)
	Delete func(*client.Client, string, int, string) (*client.SalesDeleted, error)
}

func newCatalogDeleteCmd(d catalogDelete) *cobra.Command {
	verb := d.Verb
	if verb == "" {
		verb = "delete"
	}
	typ := d.Type
	if typ == "" {
		typ = d.Noun
	}
	var confirm string
	var yes bool
	cmd := &cobra.Command{
		Use:         verb + " <n> --confirm <" + d.Field + ">",
		Annotations: map[string]string{"routes": d.Routes},
		Short:       "Move a " + typ + " to the recycle bin",
		Long: "Bin a " + typ + ".\n\n--confirm must be the " + typ + "'s " + d.Field +
			", not the number you already typed. It is required even with --yes and\n" +
			"even under BK_NO_PROMPT=1, and it is checked by the server as well as here." + d.Note,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], typ)
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the %s of %s #%d "+
					"— run `bk sales %s show %d` to see it", d.Field, typ, n, d.Noun, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Read before the delete: this is what gets reported, and it is how
			// the confirmation is checked against the row that would really go.
			label, err := d.Fetch(c, ws, n)
			if err != nil {
				return err
			}
			if confirm != label {
				return fmt.Errorf("--confirm is required to match %s #%d, which is %q — got %q; nothing was deleted",
					typ, n, label, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Bin %s #%d (%s)?", typ, n, label), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := d.Delete(c, ws, n, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "binned %s #%d: %s\n", done.Type, done.Number, done.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "",
		"Repeat the "+d.Field+" to authorise (required, even with --yes)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}
