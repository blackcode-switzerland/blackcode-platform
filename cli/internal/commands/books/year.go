// Starting a book and ending a year: account create, opening list/set,
// exercice close.
//
// These three landed together on 2026-08-20 because they are one story. Until
// then the CLI could run the year it was already inside — import a statement,
// work the list, post, read the statements — and could neither START a book
// from a real client's balance sheet nor END one. A workspace clone made it
// obvious: every cloned book opened at zero, because opening balances had no
// door, and every cloned year opened `open`, because closing had none either.
//
// The split between typed and produced openings is the design, and it is
// spelled out in `apps/books/lib/db/queries/openings.ts`:
//
//   the book's FIRST year is typed  — a migration from whatever kept the books
//                                     before, done once
//   every later year is produced    — by closing the year before it
//
// `account create` is here rather than beside `account list` because it is part
// of the same change: the declare and resolve doors now refuse a posting to an
// account the chart does not carry, and a refusal with no way to answer it
// would be a trap. The PME template is 24 accounts; a company's own chart is
// its own.

package books

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// ---------------------------------------------------------------------------
// account create
// ---------------------------------------------------------------------------

func newAccountCreateCmd() *cobra.Command {
	var req client.CreateBooksAccountRequest
	cmd := &cobra.Command{
		Use:         "create --entity <book> --no <number> --class <1-9> --label-fr <text> --position <line>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/accounts"},
		Short:       "Add an account this book keeps and the template does not",
		Long: "The chart a new book starts with is the Swiss PME template, and it belongs to\n" +
			"the book from then on. A company with a second bank, a WIR account or a card\n" +
			"the template never heard of adds it here.\n\n" +
			"--position is the statutory line the account reports on (art. 959a for the\n" +
			"bilan, 959b for the compte de résultat). `bk books account list` shows the\n" +
			"positions this book already uses. Class and position must agree: classes 1\n" +
			"and 2 are bilan lines, 3 and above are compte de résultat lines.\n\n" +
			"There is no edit and no delete. Entries point at an account by number, and\n" +
			"renumbering one would rewrite an audit trail (art. 958f).",
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
			a, err := c.CreateBooksAccount(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, a, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "added account %s (class %d, %s) — %s\n",
					a.No, a.Class, a.StatementPosition, a.Label.Fr)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().StringVar(&req.No, "no", "", "Account number, e.g. 1021 (required)")
	cmd.Flags().IntVar(&req.Class, "class", 0, "1 actif, 2 passif, 3 produits, 4-6 charges (required)")
	cmd.Flags().StringVar(&req.LabelFr, "label-fr", "", "French label — the statutory wording (required)")
	cmd.Flags().StringVar(&req.LabelEn, "label-en", "", "English label")
	cmd.Flags().StringVar(&req.StatementPosition, "position", "", "Statutory statement line, e.g. tresorerie (required)")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("no")
	_ = cmd.MarkFlagRequired("class")
	_ = cmd.MarkFlagRequired("label-fr")
	_ = cmd.MarkFlagRequired("position")
	return cmd
}

// ---------------------------------------------------------------------------
// opening
// ---------------------------------------------------------------------------

func newOpeningCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "opening",
		Short: "Opening balances — what a book starts from",
	}
	cmd.AddCommand(newOpeningListCmd(), newOpeningSetCmd())
	return cmd
}

func newOpeningListCmd() *cobra.Command {
	var scope client.BooksScope
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/openings"},
		Short:       "The balances a fiscal year opened with",
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
			rows, err := c.ListBooksOpenings(ws, scope)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				if len(rows) == 0 {
					_, err := fmt.Fprintln(w, "(no opening balances — every account starts this year at zero)")
					return err
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ACCOUNT\tAMOUNT")
				for _, r := range rows {
					fmt.Fprintf(tw, "%s\t%s\n", r.Account, r.Amount)
				}
				return tw.Flush()
			})
		},
	}
	scopeFlags(cmd, &scope)
	return cmd
}

func newOpeningSetCmd() *cobra.Command {
	var req client.SetBooksOpeningsRequest
	var file string
	var balances []string
	cmd := &cobra.Command{
		Use:         "set --entity <book> --file <balances.json>",
		Annotations: map[string]string{"routes": "PUT /api/workspaces/{ws}/openings"},
		Short:       "Type the balance sheet a book starts from (first year only)",
		Long: "The figures a book begins with, copied from whatever kept the books before\n" +
			"this app. This is a migration and it happens once per book: only the book's\n" +
			"FIRST fiscal year may be typed. Every later year's openings are produced by\n" +
			"closing the year before it — `bk books exercice close`.\n\n" +
			"It replaces the whole set, not one line, because a balance sheet is one\n" +
			"statement that must balance: actif = passif. An unbalanced set is refused\n" +
			"here, on the day it is typed, rather than at the first close.\n\n" +
			"Amounts are in the account's natural direction — a class 1 asset positive\n" +
			"when the book owns something, a class 2 liability positive when it owes.\n" +
			"Account 2970 (bénéfice / perte reporté(e)) goes negative for a carried loss.\n\n" +
			"  --file  JSON: [{\"account\": \"1020\", \"amount\": \"15000.00\"}, …], or - for stdin\n" +
			"  --balance  repeatable shorthand: --balance 1020=15000.00",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			lines, err := readOpeningLines(file, balances)
			if err != nil {
				return err
			}
			req.Balances = lines
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.SetBooksOpenings(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				_, err := fmt.Fprintf(w,
					"%s %d opens with %d balance(s) — actif %s = passif %s\n",
					r.Entity, r.Exercice, r.Written, r.TotalActif, r.TotalPassif)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().IntVar(&req.Exercice, "exercice", 0, "Fiscal year (default: the most recent)")
	cmd.Flags().StringVar(&file, "file", "", "Path to the balances JSON, or - for stdin")
	cmd.Flags().StringArrayVar(&balances, "balance", nil, "Shorthand, repeatable: 1020=15000.00")
	_ = cmd.MarkFlagRequired("entity")
	return cmd
}

// readOpeningLines takes the balance sheet from --file or from repeated
// --balance pairs. Exactly one of the two, so a caller cannot half-specify a
// statement and wonder which half the server saw.
func readOpeningLines(file string, pairs []string) ([]client.BooksOpeningLine, error) {
	if file != "" && len(pairs) > 0 {
		return nil, fmt.Errorf("pass --file or --balance, not both: the set replaces the year and there can only be one of it")
	}
	if file == "" && len(pairs) == 0 {
		return nil, fmt.Errorf("pass --file <balances.json> or repeated --balance 1020=15000.00")
	}

	if len(pairs) > 0 {
		out := make([]client.BooksOpeningLine, 0, len(pairs))
		for _, p := range pairs {
			account, amount, ok := strings.Cut(p, "=")
			if !ok || strings.TrimSpace(account) == "" || strings.TrimSpace(amount) == "" {
				return nil, fmt.Errorf("--balance %q is not account=amount, e.g. 1020=15000.00", p)
			}
			out = append(out, client.BooksOpeningLine{
				Account: strings.TrimSpace(account),
				Amount:  strings.TrimSpace(amount),
			})
		}
		return out, nil
	}

	var raw []byte
	var err error
	if file == "-" {
		raw, err = io.ReadAll(os.Stdin)
	} else {
		raw, err = os.ReadFile(file)
	}
	if err != nil {
		return nil, err
	}
	var out []client.BooksOpeningLine
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("%s is not a balances JSON array: %w", file, err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// exercice close
// ---------------------------------------------------------------------------

func newExerciceCloseCmd() *cobra.Command {
	var entity string
	var year int
	cmd := &cobra.Command{
		Use:         "close --entity <book> --year <yyyy>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/exercices/{year}/close"},
		Short:       "Close a fiscal year and carry its balance sheet into the next",
		Long: "The statutory routine that ends a year. It refuses before it writes anything:\n\n" +
			"  * the year must not already be closed\n" +
			"  * nothing may still be staged — a staged entry is money nobody has judged\n" +
			"  * the bilan must balance\n" +
			"  * next year must exist and hold no openings yet\n\n" +
			"Then it carries every bilan account's closing balance into next year, adds\n" +
			"this year's result to account 2970 (bénéfice / perte reporté(e)), and marks\n" +
			"the year closed. Compte de résultat accounts do NOT carry: a fiscal year\n" +
			"reports its own result (art. 958 al. 2).\n\n" +
			"There is no reopen. A closed year has been filed and art. 958f keeps it for\n" +
			"ten years as it was, so something found afterwards is corrected in the\n" +
			"current year with a reversing entry.",
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
			r, err := c.CloseBooksExercice(ws, year, entity)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				_, err := fmt.Fprintf(w,
					"closed %s %d — résultat %s carried into %d across %d opening balance(s); 2970 now %s\n",
					r.Entity, r.Year, r.Resultat, r.CarriedInto, r.Carried, r.RetainedEarnings)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug (required)")
	cmd.Flags().IntVar(&year, "year", 0, "The fiscal year to close (required)")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("year")
	return cmd
}
