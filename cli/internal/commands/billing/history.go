// `bk billing history …` — the imported archive (phase 5).
package billing

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newHistoryCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "history",
		Short: "Bills issued before this app existed — read-only",
		Long: `The imported archive: bills from the systems this app replaces.

AN ARCHIVE, NOT MORE INVOICES. Each row keeps the number it was issued with, in
its own namespace — it never enters an issuing company's sequence, and its
number is not unique (two systems, two companies), so rows are addressed by
their #number. A row is written once and never edited or deleted; the database
refuses both.

YOU MAP, THE APP STORES. There is no importer and no mapping engine here. Read
the export, map each bill onto the row shape, and import the rows. Whatever you
could not resolve — a possible duplicate across a migration window, an issuing
company inferred from a bank account, a missing VAT amount — goes in the row's
import flag, in words, in both languages. It is shown on every surface and
never cleared.

THE ARCHIVED PDF STAYS ON DRIVE. A row stores its path or id there, or nothing
when the export had no PDF, and says so.

Sources, statuses and the per-import row limit: "bk meta --app-server billing".`,
	}
	cmd.AddCommand(newHistoryListCmd(), newHistoryShowCmd(), newHistoryImportCmd())
	return cmd
}

func newHistoryListCmd() *cobra.Command {
	var o client.ListBillingHistoryOptions
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/history"},
		Short:       "The archive, newest bill first",
		Long: `Imported bills, newest issue date first.

--flagged lists only the rows carrying an import flag — the ones somebody still
has to look at. --year, --source, --currency and --company narrow it. A filter
the server does not understand is refused, never ignored.

The FLAG column shows the English text, shortened; "bk billing history show"
prints it in full in both languages.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			page, err := c.ListBillingHistory(ws, o)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				if len(page.Data) == 0 {
					fmt.Fprintln(w, "Nothing in the archive matches.")
					nextStep(w, "bk billing history import --file rows.json")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tISSUED\tSOURCE\tSOURCE REF\tNUMBER\tCOMPANY\tCLIENT\tTOTAL\tSTATUS\tPDF\tFLAG")
				for _, h := range page.Data {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\t%s %s\t%s\t%s\t%s\n",
						h.Number, h.IssueDate, h.Source, quoteIfPadded(h.SourceRef), h.Ref, h.Company,
						cmdutil.Truncate(h.ClientName, 22), h.Currency, h.Total, h.Status,
						pdfCell(h.DrivePath), flagCell(h.Flag, 36))
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
	f.StringVar(&o.Source, "source", "", "Only this source (bk meta for the values)")
	f.StringVar(&o.Currency, "currency", "", "Only this currency")
	f.StringVar(&o.Company, "company", "", "Only this company's bills")
	f.IntVar(&o.Year, "year", 0, "Only bills issued in this calendar year")
	f.BoolVar(&o.Flagged, "flagged", false, "Only rows carrying an import flag")
	f.IntVar(&o.Limit, "limit", 0, "How many (bk meta for the ceiling)")
	f.IntVar(&o.Cursor, "cursor", 0, "Continue from the cursor the last page returned")
	return cmd
}

func newHistoryShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <#>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/history/{seq}"},
		Args:        cobra.ExactArgs(1),
		Short:       "One imported bill, its flag in both languages, where its PDF is",
		Long: `One imported bill by its #number — the number "history list" shows in its
first column. The historical number is not unique, so it is not accepted here.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			seq, err := strconv.Atoi(strings.TrimPrefix(args[0], "#"))
			if err != nil || seq < 1 {
				return fmt.Errorf("%q is not a #number — run \"bk billing history list\" for them", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			h, err := c.GetBillingHistory(ws, seq)
			if err != nil {
				return err
			}
			return output.Render(format, h, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s  (imported from %s)\n", h.Number, h.Ref, h.Source)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "Source ref:\t%s\n", quoteIfPadded(h.SourceRef))
				fmt.Fprintf(tw, "Company:\t%s\n", h.Company)
				fmt.Fprintf(tw, "Client:\t%s\n", h.ClientName)
				fmt.Fprintf(tw, "Issued:\t%s\n", h.IssueDate)
				fmt.Fprintf(tw, "Total:\t%s %s\n", h.Currency, h.Total)
				fmt.Fprintf(tw, "Status:\t%s\n", h.Status)
				if h.DrivePath != nil {
					fmt.Fprintf(tw, "PDF:\t%s\n", *h.DrivePath)
				} else {
					fmt.Fprintf(tw, "PDF:\tno PDF in the export\n")
				}
				who := h.ImportedBy.Email
				if who == "" {
					who = "(account removed)"
				}
				fmt.Fprintf(tw, "Imported:\t%s by %s via %s\n", h.ImportedAt[:19], who, h.ImportedBy.Via)
				if err := tw.Flush(); err != nil {
					return err
				}
				if h.Flag != nil {
					fmt.Fprintf(w, "\nFLAG (en): %s\nFLAG (fr): %s\n", h.Flag.En, h.Flag.Fr)
				} else {
					fmt.Fprintln(w, "\nNo import flag: the row mapped cleanly.")
				}
				return nil
			})
		},
	}
	return cmd
}

func newHistoryImportCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:         "import --file rows.json",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/history"},
		Short:       "Import mapped rows — all of them, or none",
		Long: `Import bills you have mapped from an export.

--file is a JSON array of rows, or an object {"rows": [...]}. "--file -" reads
it from stdin, which is how to pipe a mapped batch without quoting JSON through
a shell.

ONE ROW:

  {
    "source": "zoho",
    "source_ref": "ZB-000178",
    "company": "blackcode",
    "number": "2023-011",
    "client_name": "Transports Junod SA",
    "issue_date": "2023-12-01",
    "currency": "CHF",
    "total": "21500.00",
    "status": "paid",
    "import_flag": {"fr": "…", "en": "…"},
    "drive_path": "Archive/Zoho/2023/ZB-000178.pdf"
  }

"total" is a STRING. A JSON number is refused: it has been through a float by
the time it arrives. "source_ref" is stored exactly as given — not trimmed, not
reformatted — because it is the only way back to the source. "import_flag" is
both languages or omitted; "drive_path" is omitted or null when the export had
no PDF. A key the row shape does not have is refused, so a typo cannot drop a
field on the way in.

ALL OR NOTHING. Every row is checked and every problem is reported at once; if
any row is refused, nothing is written. A row already in the archive — same
source, same source ref — refuses the import and names the #number it already
has. Importing the same file twice therefore changes nothing and says which
rows were there. It is a refusal rather than a skip on purpose: if the export
now says something different about a bill, a person should look.

The output names every row written, with its new #number.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			if file == "" {
				return fmt.Errorf("--file is required: a JSON file of mapped rows, or \"-\" for stdin")
			}
			var raw string
			if file == "-" {
				raw, err = cmdutil.ReadBody("-", "")
			} else {
				raw, err = cmdutil.ReadBody("", file)
			}
			if err != nil {
				return err
			}
			rows, err := rowsFromFile([]byte(raw))
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			res, err := c.ImportBillingHistory(ws, rows)
			if err != nil {
				return err
			}
			return output.Render(format, res, func(w io.Writer) error {
				fmt.Fprintf(w, "Imported %d bill%s as %s: %d flagged, %d without a PDF.\n",
					res.Imported, plural(res.Imported), numberRange(res.Rows), res.Flagged, res.WithoutPdf)
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tSOURCE\tSOURCE REF\tNUMBER\tISSUED\tTOTAL\tFLAG")
				for _, h := range res.Rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s %s\t%s\n",
						h.Number, h.Source, quoteIfPadded(h.SourceRef), h.Ref, h.IssueDate,
						h.Currency, h.Total, flagCell(h.Flag, 36))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if res.Flagged > 0 {
					nextStep(w, "bk billing history list --flagged")
				} else {
					nextStep(w, "bk billing history list")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", `JSON array of rows, or {"rows": [...]}; "-" reads stdin`)
	return cmd
}

// rowsFromFile accepts a bare array or {"rows": [...]} and returns the array as
// RAW JSON — never decoded into Go structs, so a key the mapper misspelled
// reaches the server and is refused there, rather than being dropped here.
func rowsFromFile(b []byte) (json.RawMessage, error) {
	trimmed := strings.TrimSpace(string(b))
	if strings.HasPrefix(trimmed, "[") {
		var probe []json.RawMessage
		if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
			return nil, fmt.Errorf("the file is not a JSON array: %v", err)
		}
		return json.RawMessage(trimmed), nil
	}
	var wrapped struct {
		Rows json.RawMessage `json:"rows"`
	}
	if err := json.Unmarshal([]byte(trimmed), &wrapped); err != nil {
		return nil, fmt.Errorf("the file is neither a JSON array of rows nor {\"rows\": [...]}: %v", err)
	}
	if len(wrapped.Rows) == 0 || !strings.HasPrefix(strings.TrimSpace(string(wrapped.Rows)), "[") {
		return nil, fmt.Errorf("the file is an object without a \"rows\" array")
	}
	return wrapped.Rows, nil
}

// quoteIfPadded shows a source ref in quotes when it has leading or trailing
// whitespace, which a table would otherwise make invisible. The value itself is
// never changed.
func quoteIfPadded(s string) string {
	if s != strings.TrimSpace(s) {
		return strconv.Quote(s)
	}
	return s
}

func pdfCell(drivePath *string) string {
	if drivePath == nil {
		return "none"
	}
	return "drive"
}

func flagCell(f *client.BillingImportFlag, n int) string {
	if f == nil {
		return "—"
	}
	return "⚑ " + cmdutil.Truncate(f.En, n)
}

// numberRange is "#15", or "#1–#14" for a block. An import's numbers are
// contiguous — one allocation for the whole batch — so a range names them all.
func numberRange(rows []client.BillingHistoryEntry) string {
	if len(rows) == 0 {
		return "nothing"
	}
	first, last := rows[0].Number, rows[len(rows)-1].Number
	if first == last {
		return fmt.Sprintf("#%d", first)
	}
	return fmt.Sprintf("#%d–#%d", first, last)
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
