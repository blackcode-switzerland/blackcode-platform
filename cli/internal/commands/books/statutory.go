// The statutory reads and the two structural writes — phase 1.
//
// ===========================================================================
// WHY THE CLI CARRIES THE WRITE PATH
// ===========================================================================
// b/books' web surface is read-mostly by design: thirteen screens and four write
// affordances. Everything structural — creating a book, opening a fiscal year —
// happens here, because agents drive this app from outside and the human surface
// is visibility, history and intervention.
//
// A form that lets somebody retype a balance is a form that lets somebody break
// the books.
//
// ===========================================================================
// EVERY AMOUNT IS PRINTED AS THE STRING THE SERVER SENT
// ===========================================================================
// No parsing, no rounding, no re-formatting into a float. `internal/client/books.go`
// explains why at length. If a figure looks wrong here it is wrong in the
// database, which is exactly the property an accounting CLI needs.
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

// scopeFlags adds `--entity` and `--exercice` to a command.
//
// Both optional: the server falls back to the first book and its latest year and
// REPORTS which it chose in the payload. That is why guessing is acceptable — a
// silent default on a statutory statement would not be.
func scopeFlags(cmd *cobra.Command, s *client.BooksScope) {
	cmd.Flags().StringVar(&s.Entity, "entity", "", "Book slug (default: the first book)")
	cmd.Flags().IntVar(&s.Exercice, "exercice", 0, "Fiscal year (default: the most recent)")
}

// ---------------------------------------------------------------------------
// entity
// ---------------------------------------------------------------------------

func newEntityCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "entity",
		Short: "Books — a workspace holds any number of them",
	}
	cmd.AddCommand(newEntityListCmd(), newEntityCreateCmd(), newEntityEditCmd())
	return cmd
}

func newEntityListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/entities"},
		Short:       "List the books in the active workspace",
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
			rows, err := c.ListBooksEntities(ws)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tSLUG\tNAME\tFORM\tREGIME\tVAT")
				for _, e := range rows {
					vat := "not registered"
					if e.Vat.Registered {
						vat = e.Vat.Method + "/" + e.Vat.Filing
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						e.Number, e.Slug, cmdutil.Truncate(e.Name, 28), e.LegalForm, e.BookkeepingRegime, vat)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no books — create one with `bk books entity create`)")
				}
				return nil
			})
		},
	}
	return cmd
}

func newEntityCreateCmd() *cobra.Command {
	var req client.CreateBooksEntityRequest
	cmd := &cobra.Command{
		Use:         "create --slug <slug> --name <name> --legal-form <SA|RI>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entities"},
		Short:       "Create a book",
		Long: "Create a book.\n\n" +
			"The bookkeeping regime follows from the legal form unless you state it: a capital\n" +
			"company is always double-entry (art. 957 al. 1 ch. 2 CO, no exceptions at any\n" +
			"turnover) and a sole proprietorship defaults to simplified. The server refuses a\n" +
			"simplified SA with a database constraint rather than a warning.\n\n" +
			"The book arrives with the Swiss PME chart of accounts already in it, because a\n" +
			"book with no accounts cannot take a posting. Those accounts are then this book's\n" +
			"own: editing them affects no other book. It still needs a fiscal year before\n" +
			"anything can be posted — see `bk books exercice create`.",
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
			e, err := c.CreateBooksEntity(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, e, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "created book #%d: %s (%s, %s)\n",
					e.Number, e.Slug, e.LegalForm, e.BookkeepingRegime); err != nil {
					return err
				}
				// Say what is still missing. The book has a chart and no fiscal
				// year, so nothing can be posted to it yet, and a reader who is
				// not told that reads "created" as "ready".
				_, err := fmt.Fprintf(w, "chart of accounts installed. Next: bk books exercice create --entity %s --year <yyyy>\n", e.Slug)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Slug, "slug", "", "URL-safe handle, e.g. blackcode (required)")
	cmd.Flags().StringVar(&req.Name, "name", "", "Legal name (required)")
	cmd.Flags().StringVar(&req.LegalForm, "legal-form", "", "SA or RI (required)")
	cmd.Flags().StringVar(&req.BookkeepingRegime, "regime", "", "double_entry or simplified (default: from legal form)")
	cmd.Flags().StringVar(&req.Seat, "seat", "", "Registered seat")
	_ = cmd.MarkFlagRequired("slug")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("legal-form")
	return cmd
}

// ---------------------------------------------------------------------------
// exercice
// ---------------------------------------------------------------------------

func newExerciceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "exercice",
		Short: "Fiscal years",
	}
	cmd.AddCommand(newExerciceListCmd(), newExerciceCreateCmd(), newExerciceCloseCmd())
	return cmd
}

func newExerciceListCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/exercices"},
		Short:       "List fiscal years",
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
			rows, err := c.ListBooksExercices(ws, entity)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "YEAR\tFROM\tTO\tSTATUS")
				for _, x := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n", x.Year, x.StartsOn, x.EndsOn, x.Status)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug (default: all books)")
	return cmd
}

func newExerciceCreateCmd() *cobra.Command {
	var req client.CreateBooksExerciceRequest
	cmd := &cobra.Command{
		Use:         "create --entity <slug> --year <yyyy>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/exercices"},
		Short:       "Open a fiscal year",
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
			x, err := c.CreateBooksExercice(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, x, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "opened exercice %d (%s to %s)\n", x.Year, x.StartsOn, x.EndsOn)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().IntVar(&req.Year, "year", 0, "Four-digit year (required)")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("year")
	return cmd
}

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

func newAccountCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "account",
		Short: "The chart of accounts",
	}
	cmd.AddCommand(newAccountListCmd(), newAccountCreateCmd())
	return cmd
}

func newAccountListCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/accounts"},
		Short:       "List a book's chart of accounts",
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
			rows, err := c.ListBooksAccounts(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "NO\tCL\tLABEL\tSTATEMENT\tPOSITION")
				for _, a := range rows {
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n",
						a.No, a.Class, cmdutil.Truncate(a.Label.Fr, 34), a.Statement, a.StatementPosition)
				}
				return tw.Flush()
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

func newEntryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "entry",
		Short: "The grand livre — écritures",
	}
	cmd.AddCommand(newEntryListCmd(), newEntryShowCmd(), newEntryPostCmd(), newEntryDeclareCmd())
	return cmd
}

func newEntryListCmd() *cobra.Command {
	var scope client.BooksScope
	var status, recognition, account string
	var limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/entries"},
		Short:       "List écritures",
		Long: "List écritures.\n\n" +
			"`--account` returns WHOLE entries that touch the account rather than only the\n" +
			"matching line: the other side is what says where the money went.\n\n" +
			"`--recognition unrecognized` is the worklist — money that moved with nobody\n" +
			"having said yet what it was for.",
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
			rows, err := c.ListBooksEntries(ws, scope, status, recognition, account, limit)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				// The route serves BOTH journals; an RI row carries a direction
				// and no status. The caller named the book, so the shape is known.
				ri := len(rows) > 0 && rows[0].Direction != ""
				if ri {
					fmt.Fprintln(tw, "#\tDATE\tDIRECTION\tAMOUNT\tTIER\tRECOGNITION\tLABEL")
					for _, e := range rows {
						fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
							e.Number, e.Date, e.Direction, e.Amount, e.EvidenceTier, e.Recognition,
							cmdutil.Truncate(e.RawLabel, 30))
					}
				} else {
					fmt.Fprintln(tw, "#\tNO\tDATE\tSTATUS\tTIER\tRECOGNITION\tLABEL")
					for _, e := range rows {
						fmt.Fprintf(tw, "%d\t%d\t%s\t%s\t%s\t%s\t%s\n",
							e.Number, e.EntryNo, e.Date, e.Status, e.EvidenceTier, e.Recognition,
							cmdutil.Truncate(e.RawLabel, 30))
					}
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no entries)")
				}
				return nil
			})
		},
	}
	scopeFlags(cmd, &scope)
	cmd.Flags().StringVar(&status, "status", "", "posted or staged")
	cmd.Flags().StringVar(&recognition, "recognition", "", "known_recurring, known_one_off, inferred, unrecognized")
	cmd.Flags().StringVar(&account, "account", "", "Only entries touching this account")
	cmd.Flags().IntVar(&limit, "limit", 100, "Max entries to return (1-500)")
	return cmd
}

func newEntryShowCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "show <number>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/entries/{number}"},
		Short:       "Show one écriture with its lines",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			// The workspace #number. `strconv.Atoi` and an explicit range check
			// rather than a helper, because the failure worth naming is somebody
			// passing a row id or a journal number and getting a confusing 404.
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not an entry number: pass the # from `bk books entry list`", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			e, err := c.GetBooksEntry(ws, n, entity)
			if err != nil {
				return err
			}
			return output.Render(format, e, func(w io.Writer) error {
				if e.Direction != "" {
					// An RI journal row: no lines, no posting status.
					fmt.Fprintf(w, "entry #%d · %s · %d  (recettes-dépenses)\n", e.Number, e.Entity, e.Exercice)
					fmt.Fprintf(w, "  date         %s\n", e.Date)
					fmt.Fprintf(w, "  direction    %s\n", e.Direction)
					fmt.Fprintf(w, "  amount       %s\n", e.Amount)
					fmt.Fprintf(w, "  raw label    %s\n", e.RawLabel)
					if e.Counterparty != "" {
						fmt.Fprintf(w, "  counterparty %s\n", e.Counterparty)
					}
					fmt.Fprintf(w, "  recognition  %s\n", e.Recognition)
					fmt.Fprintf(w, "  evidence     %s\n", e.EvidenceTier)
					if e.Piece != nil {
						fmt.Fprintf(w, "  pièce        %s (captured %s)\n", e.Piece.DriveRef, e.Piece.Captured)
					} else {
						fmt.Fprintf(w, "  pièce        none on record\n")
					}
					if e.Fx != nil {
						fmt.Fprintf(w, "  fx           %s\n", fxLine(e.Fx))
					}
					return nil
				}
				fmt.Fprintf(w, "entry #%d · %s · %d  (journal no. %d)\n", e.Number, e.Entity, e.Exercice, e.EntryNo)
				fmt.Fprintf(w, "  date         %s\n", e.Date)
				fmt.Fprintf(w, "  status       %s\n", e.Status)
				fmt.Fprintf(w, "  raw label    %s\n", e.RawLabel)
				if e.Counterparty != "" {
					fmt.Fprintf(w, "  counterparty %s\n", e.Counterparty)
				}
				fmt.Fprintf(w, "  recognition  %s\n", e.Recognition)
				// The two consequences of the tier are independent, so both are shown.
				fmt.Fprintf(w, "  evidence     %s", e.EvidenceTier)
				if e.EvidenceTier != "full" {
					fmt.Fprintf(w, "  (input VAT not recoverable, art. 26 LTVA)")
				}
				fmt.Fprintln(w)
				if e.Piece != nil {
					fmt.Fprintf(w, "  pièce        %s (captured %s)\n", e.Piece.DriveRef, e.Piece.Captured)
				} else {
					fmt.Fprintf(w, "  pièce        none on record\n")
				}
				if e.Fx != nil {
					fmt.Fprintf(w, "  fx           %s\n", fxLine(e.Fx))
				}
				fmt.Fprintln(w)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "  ACCOUNT\tDEBIT\tCREDIT")
				for _, l := range e.Lines {
					acct := l.Account
					if acct == "" {
						acct = "(unresolved)"
					}
					fmt.Fprintf(tw, "  %s\t%s\t%s\n", acct, l.Debit, l.Credit)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "A SIMPLIFIED book's slug: read its recettes-dépenses journal")
	return cmd
}

// ---------------------------------------------------------------------------
// the statements
// ---------------------------------------------------------------------------

func newBilanCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "bilan",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/bilan"},
		Short:       "Balance sheet, art. 959a, in statutory order",
		Long: "Balance sheet in the order art. 959a CO prescribes.\n\n" +
			"Every legal line is printed, including the ones at zero: a statutory line still\n" +
			"exists at zero, and hiding it hides the thing worth noticing.\n\n" +
			"A sole proprietorship keeping simplified books has no bilan, ever (art. 957\n" +
			"al. 2 CO). The server says so rather than returning an empty one.",
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
			b, err := c.GetBooksBilan(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, b, func(w io.Writer) error {
				fmt.Fprintf(w, "BILAN — %s, exercice %d\n\n", b.Entity, b.Exercice)
				tw := output.Tabwriter(w)
				for _, g := range b.Groups {
					fmt.Fprintf(tw, "%s\t\n", g.Group.Fr)
					for _, l := range g.Lines {
						mark := ""
						if l.Related {
							// art. 959a al. 4: shown separately, and still counted.
							mark = " *"
						}
						fmt.Fprintf(tw, "  %s%s\t%s\n", l.Pos, mark, l.Amount)
					}
				}
				fmt.Fprintf(tw, "\t\n")
				fmt.Fprintf(tw, "TOTAL ACTIF\t%s\n", b.TotalActif)
				fmt.Fprintf(tw, "TOTAL PASSIF\t%s\n", b.TotalPassif)
				fmt.Fprintf(tw, "Résultat de l'exercice\t%s\n", b.Resultat)
				if err := tw.Flush(); err != nil {
					return err
				}
				fmt.Fprintln(w)
				if b.Balanced {
					fmt.Fprintln(w, "actif = passif")
				} else {
					// Loud, and it names the amount. A bilan that does not balance is
					// the one thing that must never be reported quietly.
					fmt.Fprintf(w, "DOES NOT BALANCE — écart %s\n", b.Ecart)
				}
				fmt.Fprintln(w, "* presented separately per art. 959a al. 4 (related party)")
				return nil
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

func newCrCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "cr",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/compte-resultat"},
		Short:       "Compte de résultat par nature, art. 959b",
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
			r, err := c.GetBooksCr(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "COMPTE DE RÉSULTAT — %s, exercice %d\n\n", r.Entity, r.Exercice)
				tw := output.Tabwriter(w)
				for _, l := range r.Lines {
					kind := "charge"
					if l.Sign == 1 {
						kind = "produit"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\n", l.Pos, kind, l.Amount)
				}
				fmt.Fprintf(tw, "\t\t\n")
				fmt.Fprintf(tw, "RÉSULTAT\t\t%s\n", r.Resultat)
				return tw.Flush()
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

func newOverviewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "overview",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/overview"},
		Short:       "Every book, with whichever statement its legal form has",
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
			books, err := c.GetBooksOverview(ws)
			if err != nil {
				return err
			}
			return output.Render(format, books, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "SLUG\tFORM\tYEAR\tRESULT\tBALANCE\tENTRIES\tTO RESOLVE")
				for _, b := range books {
					result, balance := "—", "—"
					if b.Bilan != nil {
						result = b.Bilan.Resultat
						balance = b.Bilan.Actif
						if !b.Bilan.Balanced {
							balance = "UNBALANCED"
						}
					} else if b.Ri != nil {
						result = b.Ri.Resultat
						balance = "n/a (art. 957 al. 2)"
					}
					fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%s\t%d\t%d\n",
						b.Slug, b.LegalForm, b.Exercice, result, balance, b.Entries, b.Worklist)
				}
				return tw.Flush()
			})
		},
	}
	return cmd
}

func newPatrimoineCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "patrimoine",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/patrimoine"},
		Short:       "Net-worth statement for a sole proprietorship, art. 957 al. 2",
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
			rows, err := c.ListBooksPatrimoine(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				for _, p := range rows {
					fmt.Fprintf(w, "PATRIMOINE au %s (compiled %s)\n", p.AsOf, p.Compiled)
					tw := output.Tabwriter(w)
					for _, i := range p.Items {
						fmt.Fprintf(tw, "  %s\t%s\n", i.Label.Fr, i.Amount)
					}
					fmt.Fprintf(tw, "  TOTAL\t%s\n", p.Total)
					if err := tw.Flush(); err != nil {
						return err
					}
					fmt.Fprintln(w)
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no patrimoine snapshots — only a sole proprietorship has these)")
				}
				return nil
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

// fxLine renders the original-currency story: the amount column is CHF (what
// the card was actually charged); this is where "it was USD 5.00" survives.
func fxLine(fx *client.BooksFx) string {
	s := fx.Original
	if fx.Rate != "" {
		s += " at " + fx.Rate
	}
	if fx.Source != "" {
		s += " (" + fx.Source + ")"
	}
	return s
}

func newEntryPostCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "post <number>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entries/{number}/post"},
		Short:       "Post a staged écriture — after review, it becomes immutable",
		Long: "Staged -> posted, after review. The database has the last word: a posted\n" +
			"entry must balance, carry at least two lines, and have every line mapped to\n" +
			"an account — resolve it first if it does not. Posted is immutable; from here\n" +
			"on, a correction is a reversing entry. Posting a posted entry is a no-op that\n" +
			"says so, because a retry is not an error.",
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
			r, err := c.PostBooksEntry(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				if r.Already {
					_, err := fmt.Fprintf(w, "entry #%d was already posted (journal no. %d)\n", r.Number, r.EntryNo)
					return err
				}
				_, err := fmt.Fprintf(w, "posted entry #%d (journal no. %d) — now immutable; corrections are reversing entries\n", r.Number, r.EntryNo)
				return err
			})
		},
	}
	return cmd
}

func newEntryDeclareCmd() *cobra.Command {
	var req client.DeclareBooksEntryRequest
	var explanation string
	var debits, credits []string
	cmd := &cobra.Command{
		Use:         "declare --entity <book> --date <yyyy-mm-dd> --amount <chf> --label <text> --explanation <text>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/entries"},
		Short:       "Declare money no feed will deliver — a cash expense, the owner's note",
		Long: "Declare an entry directly: cash and private payments never cross a bank line,\n" +
			"so no import will ever bring them. The declarer IS the explanation — the entry\n" +
			"arrives known_one_off with your words attached, and your name in its history.\n\n" +
			"It still lands STAGED and passes the same posting gate as imported money.\n" +
			"A double-entry book needs both sides: --account (the charge) and --contra\n" +
			"(what settles it, e.g. the owner's compte courant — there is no caisse, on\n" +
			"purpose). A simplified book needs --direction recette|depense|neutral.\n\n" +
			"VAT: pass --tva-rate and the amount is derived from the TTC total. Pass\n" +
			"--tva-amount too and the invoice's own figure is kept, unless it disagrees\n" +
			"with the arithmetic by more than a rappen. Claiming input tax needs the\n" +
			"pièce on file: --tva-input-claimed --evidence-tier full.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if explanation == "" {
				return fmt.Errorf("--explanation is required: a declaration IS an explanation")
			}
			req.Explanation = map[string]any{"en": explanation}
			lines, err := declareLines(debits, credits)
			if err != nil {
				return err
			}
			req.Lines = lines
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.DeclareBooksEntry(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				if r.Journal == "recettes_depenses" {
					// No "(staged)" here: an RI journal has no posting lifecycle.
					_, err := fmt.Fprintf(w, "declared entry #%d in the recettes-dépenses journal\n", r.Number)
					return err
				}
				no := 0
				if r.EntryNo != nil {
					no = *r.EntryNo
				}
				_, err := fmt.Fprintf(w, "declared entry #%d (journal no. %d, staged) — post it after review: bk books entry post %d\n", r.Number, no, r.Number)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().StringVar(&req.Date, "date", "", "Booking date, YYYY-MM-DD (required)")
	cmd.Flags().StringVar(&req.Amount, "amount", "", "Amount in CHF, e.g. 45.00 (required, unless --debit/--credit give the lines)")
	cmd.Flags().StringVar(&req.Label, "label", "", "The journal line's text (required)")
	cmd.Flags().StringVar(&explanation, "explanation", "", "What this money was (required)")
	cmd.Flags().StringVar(&req.Counterparty, "counterparty", "", "Who was paid, or who paid")
	cmd.Flags().StringVar(&req.Direction, "direction", "", "RI books: recette, depense or neutral")
	cmd.Flags().StringVar(&req.Account, "account", "", "Double-entry books: the charge account")
	cmd.Flags().StringVar(&req.Contra, "contra", "", "Double-entry books: the settling account")
	cmd.Flags().StringArrayVar(&debits, "debit", nil, "A debit line, repeatable: 5000=11600.00 (more than two sides)")
	cmd.Flags().StringArrayVar(&credits, "credit", nil, "A credit line, repeatable: 1020=13350.00")
	cmd.Flags().StringVar(&req.TvaRate, "tva-rate", "", "VAT rate as written on the invoice: 8.1, 3.8, 2.6 or 0")
	cmd.Flags().StringVar(&req.TvaAmount, "tva-amount", "", "VAT in CHF (default: derived from the TTC amount at that rate)")
	cmd.Flags().BoolVar(&req.TvaInputClaimed, "tva-input-claimed", false, "Claim the input tax (art. 28 LTVA; needs --evidence-tier full)")
	cmd.Flags().StringVar(&req.EvidenceTier, "evidence-tier", "", "full, partial or bare — full means the pièce is on file")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("date")
	_ = cmd.MarkFlagRequired("label")
	return cmd
}

// declareLines turns repeated --debit/--credit pairs into posting lines.
//
// The two-line shorthand (--account/--contra) stays the common case and this
// returns nil for it. A SALARY is not two lines and never was — the mockup's
// own January payroll is 5000 salaires and 5700 charges sociales against 1020 —
// and an agent running a company with employees meets that every month.
//
// Debits first, then credits, which is the order a journal is read in.
func declareLines(debits, credits []string) ([]client.BooksDeclareLine, error) {
	if len(debits) == 0 && len(credits) == 0 {
		return nil, nil
	}
	out := make([]client.BooksDeclareLine, 0, len(debits)+len(credits))
	for _, side := range []struct {
		pairs   []string
		isDebit bool
	}{{debits, true}, {credits, false}} {
		for _, p := range side.pairs {
			account, amount, ok := strings.Cut(p, "=")
			if !ok || strings.TrimSpace(account) == "" || strings.TrimSpace(amount) == "" {
				flag := "--credit"
				if side.isDebit {
					flag = "--debit"
				}
				return nil, fmt.Errorf("%s %q is not account=amount, e.g. 5000=11600.00", flag, p)
			}
			line := client.BooksDeclareLine{Account: strings.TrimSpace(account)}
			if side.isDebit {
				line.Debit = strings.TrimSpace(amount)
			} else {
				line.Credit = strings.TrimSpace(amount)
			}
			out = append(out, line)
		}
	}
	return out, nil
}
