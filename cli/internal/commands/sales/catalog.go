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
				if err := tw.Flush(); err != nil {
					return err
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
	cmd.Flags().StringSliceVar(refs, "ref", nil, "Reference customers, by name (repeatable)")
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
	)
	return cmd
}

func newDocListCmd() *cobra.Command {
	var kind, query string
	var tags []string
	var prospect, product, limit int
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
				Tags:     splitAll(tags),
				Limit:    limit,
			})
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tKIND\tTITLE\tLINKED TO\tADDED BY")
				for _, r := range rows {
					linked := fmt.Sprintf("%d prospect(s), %d product(s)", len(r.Prospects), len(r.Products))
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.Number, r.Kind, cmdutil.Truncate(r.Title, 34), linked,
						cmdutil.Truncate(dashIf(r.AddedBy), 18))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no documents)")
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
	cmd.Flags().StringSliceVar(&tags, "tag", nil,
		"Only documents carrying any of these tags (repeatable; case-insensitive)")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max documents to return")
	return cmd
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
				fmt.Fprintf(tw, "added by\t%s\n", dashIf(d.AddedBy))
				fmt.Fprintf(tw, "prospects\t%s\n", numbersOrDash(d.Prospects))
				fmt.Fprintf(tw, "products\t%s\n", numbersOrDash(d.Products))
				if err := tw.Flush(); err != nil {
					return err
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
func storedWhere(d client.SalesDocument) string {
	if d.UploadURL != "" {
		return "uploaded to this app"
	}
	return "external link"
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
	var prospects, products, templates []int
	cmd := &cobra.Command{
		Use: "add --title <t> --kind <k> (--url <u> | --upload <u>)",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/documents," +
			"POST /api/workspaces/{ws}/documents/{n}/links"},
		Short: "Add a document to the library",
		Long: `Add a file or a link to the one library.

EXACTLY ONE location:
  --upload <url>   a file already stored against this app — upload it first with
                   "bk sales upload <file>" and pass the URL it prints
  --url <url>      an external link (a Drive folder, a recording)

The difference is not cosmetic: only an uploaded file is covered by the
cross-app delete gate, and putting a stored file's URL in --url would hide it
from the index that stops it being deleted while still in use.

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
			linked, err := linkNewDocument(c, ws, d, prospects, products, templates)
			if err != nil {
				return fmt.Errorf("document #%d (%s) WAS created; %w — attach the rest with "+
					"`bk sales doc link %d …`, do not re-add it", d.Number, d.Title, err, d.Number)
			}
			return output.Render(format, linked, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "added document #%d: %s\n%s\n", linked.Number, linked.Title, linked.URN)
				if err != nil {
					return err
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
	cmd.Flags().StringVar(&req.Kind, "kind", "", vocab("document_kinds", "required"))
	cmd.Flags().StringVar(&req.UploadURL, "upload", "", "URL of a file uploaded to this app (this OR --url, exactly one)")
	cmd.Flags().StringVar(&req.ExternalURL, "url", "", "An external link (this OR --upload, exactly one)")
	cmd.Flags().StringVar(&req.Description, "description", "", "What it is for")
	cmd.Flags().StringSliceVar(&tags, "tag", nil, "Tags (repeatable)")
	for _, f := range []string{"title", "kind"} {
		_ = cmd.MarkFlagRequired(f)
	}
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
	prospects, products, templates []int) (*client.SalesDocument, error) {
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
	var prospect, product, template int
	verb, short := "link", "Attach a document to a prospect, product or template"
	routes := "POST /api/workspaces/{ws}/documents/{n}/links"
	if unlink {
		verb, short = "unlink", "Detach a document from a prospect, product or template"
		routes = "DELETE /api/workspaces/{ws}/documents/{n}/links"
	}
	cmd := &cobra.Command{
		Use:         verb + " <n> (--prospect <n> | --product <n> | --template <n>)",
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
			for name, target := range map[string]*int{"prospect": &prospect, "product": &product, "template": &template} {
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
					}
				}
			}
			if given != 1 {
				return fmt.Errorf("exactly one of --prospect, --product or --template is required")
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
				_, err := fmt.Fprintf(w, "%sed document #%d (%s) — now on %s and %s\n",
					verb, d.Number, d.Title, numbersOrDash(d.Prospects), numbersOrDash(d.Products))
				return err
			})
		},
	}
	cmd.Flags().IntVar(&prospect, "prospect", 0, "A prospect's #number")
	cmd.Flags().IntVar(&product, "product", 0, "A product's #number")
	cmd.Flags().IntVar(&template, "template", 0, "A template's #number")
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
