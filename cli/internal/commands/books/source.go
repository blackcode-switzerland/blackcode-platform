// The sources register: `bk books source list` and `source show`.
//
// The register answers "do I have everything". STATUS is computed server-side
// from cadence against the last import and stored nowhere, so nothing an agent
// or a hurried human does can flip a late source green — the only hand-set
// lifecycle fact is retirement. `source show` prints the runbook too, because
// the register is also the answer to "how do I pull this again".
package books

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newSourceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "source",
		Short: "The sources register — every place money data comes from",
	}
	cmd.AddCommand(newSourceListCmd(), newSourceShowCmd(), newSourceImportCmd(),
		newSourceCreateCmd(), newSourceEditCmd(), newSourceRecordPullCmd(), newSourceRunbookSetCmd())
	return cmd
}

func newSourceListCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sources"},
		Short:       "List sources with their computed completeness status",
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
			rows, err := c.ListBooksSources(ws, entity)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tNAME\tTYPE\tENTITY\tEXPECTED\tLAST IMPORT\tSTATUS")
				for _, s := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",
						s.Number, cmdutil.Truncate(s.Name, 30), s.Type,
						strOr(s.Entity, "—"), strOr(s.Expected, "—"), strOr(s.LastImport, "never"), s.Status)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&entity, "entity", "", "Book slug (default: every book's sources)")
	return cmd
}

func newSourceShowCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "show <number>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sources/{number}"},
		Short:       "One source in full: status, pulls, and the runbook",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			s, err := c.GetBooksSource(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, s, func(w io.Writer) error {
				fmt.Fprintf(w, "source #%d  %s (%s)\n", s.Number, s.Name, s.Type)
				fmt.Fprintf(w, "  status       %s  (stale after %dd, gap after %dd)\n",
					s.Status, s.Windows.StaleAfterDays, s.Windows.GapAfterDays)
				fmt.Fprintf(w, "  expected     %s, last import %s\n", strOr(s.Expected, "nothing"), strOr(s.LastImport, "never"))
				if len(s.LedgerAccounts) > 0 {
					fmt.Fprintf(w, "  ledger       %v\n", s.LedgerAccounts)
				}
				if len(s.Pulls) > 0 {
					fmt.Fprintf(w, "\n  PULLS (%d, newest first)\n", len(s.Pulls))
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "  FILE\tPERIOD\tFORMAT\tPULLED")
					for _, p := range s.Pulls {
						fmt.Fprintf(tw, "  %s\t%s\t%s\t%s\n",
							cmdutil.Truncate(p.File, 44), strOr(p.Period, "—"), strOr(p.Format, "—"), strOr(p.Pulled, "—"))
					}
					if err := tw.Flush(); err != nil {
						return err
					}
				}
				if s.Runbook != nil {
					fmt.Fprintf(w, "\n  RUNBOOK v%s (updated %s)\n", s.Runbook.Version, strOr(s.Runbook.Updated, "—"))
					if s.Runbook.CredentialRef != nil {
						// A REFERENCE. If a real secret ever prints here, the bug is
						// upstream in whoever wrote the runbook, and the fix is rotation.
						fmt.Fprintf(w, "  credentials  %s\n", *s.Runbook.CredentialRef)
					}
					for i, step := range s.Runbook.Steps {
						fmt.Fprintf(w, "  %d. %s\n", i+1, step)
					}
				}
				return nil
			})
		},
	}
	return cmd
}

func strOr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return *s
}

func newSourceImportCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:         "import <source-number> --file <statement.xml>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/sources/{number}/import"},
		Short:       "Import one camt.053 bank statement through the door",
		Long: "Deliver one camt.053 statement to this source's book. Every booked line\n" +
			"lands STAGED — whole file or nothing: the statement must reconcile against\n" +
			"itself (opening + lines = closing, to the rappen) or it is refused with the\n" +
			"arithmetic shown.\n\n" +
			"Rules run at arrival: a clean hit lands `inferred` and waits on the worklist\n" +
			"for a human to confirm — the machine suggests, it never applies. Re-importing\n" +
			"an overlapping statement converges on the bank's own references and duplicates\n" +
			"nothing. `--file -` reads stdin, which is how the Companion pipes.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			var raw []byte
			name := filepath.Base(file)
			if file == "-" {
				raw, err = io.ReadAll(os.Stdin)
				name = "stdin.camt053.xml"
			} else {
				raw, err = os.ReadFile(file)
			}
			if err != nil {
				return fmt.Errorf("reading the statement: %w", err)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.ImportBooksSource(ws, n, name, string(raw))
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				fmt.Fprintf(w, "imported %s into source #%d (%s)\n", r.File, r.Source, r.Journal)
				fmt.Fprintf(w, "  period      %s -> %s\n", strOr(r.Period.From, "?"), strOr(r.Period.To, "?"))
				fmt.Fprintf(w, "  statement   %s -> %s (reconciles)\n", r.Opening, r.Closing)
				fmt.Fprintf(w, "  lines       %d booked: %d new (%d inferred by rules, %d for the worklist), %d already known\n",
					r.LinesTotal, r.Imported, r.Inferred, r.Unrecognized, r.AlreadyKnown)
				if r.WithFx > 0 {
					fmt.Fprintf(w, "  fx          %d line(s) carry an original-currency story\n", r.WithFx)
				}
				if r.Unrecognized > 0 {
					fmt.Fprintln(w, "next: bk books worklist")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the camt.053 XML, or - for stdin (required)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func newSourceCreateCmd() *cobra.Command {
	var req client.CreateBooksSourceRequest
	var ledger []string
	cmd := &cobra.Command{
		Use:         "create --entity <book> --name <name> --type <type>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/sources"},
		Short:       "Add a feed to the register",
		Long: "A new feed exists in the world, so a row for it exists here. `--ledger-account`\n" +
			"names the account this feed IS (1020 for the main bank) — a double-entry book\n" +
			"cannot import from a source that does not know its account.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req.LedgerAccounts = ledger
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.CreateBooksSource(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created source #%d: %s (%s)\n", r.Number, r.Name, r.Type)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.Entity, "entity", "", "Book slug (required)")
	cmd.Flags().StringVar(&req.Name, "name", "", "Human name, e.g. 'BCV compte courant' (required)")
	cmd.Flags().StringVar(&req.Type, "type", "", "bank, card, stripe, drive_folder, … (required)")
	cmd.Flags().StringVar(&req.Expected, "expected", "", "Cadence: daily, weekly, monthly, quarterly")
	cmd.Flags().StringSliceVar(&ledger, "ledger-account", nil, "Account this feed IS (repeatable)")
	cmd.Flags().StringVar(&req.Method, "method", "", "How it is pulled, one line")
	_ = cmd.MarkFlagRequired("entity")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.MarkFlagRequired("type")
	return cmd
}

func newSourceEditCmd() *cobra.Command {
	var name, expected, method string
	var retire, unretire bool
	var ledger []string
	cmd := &cobra.Command{
		Use:         "edit <source-number>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/sources/{number}"},
		Short:       "Edit a source's register row — cadence, method, retirement",
		Long: "Register upkeep. Only the flags you pass change; the pulls under the source\n" +
			"are records and stay untouched. `--retire` stops the completeness clock and\n" +
			"refuses new files; `--unretire` resumes.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			patch := map[string]any{}
			if cmd.Flags().Changed("name") {
				patch["name"] = name
			}
			if cmd.Flags().Changed("expected") {
				patch["expected"] = expected
			}
			if cmd.Flags().Changed("method") {
				patch["method"] = method
			}
			if cmd.Flags().Changed("ledger-account") {
				patch["ledger_accounts"] = ledger
			}
			if retire {
				patch["retired"] = true
			}
			if unretire {
				patch["retired"] = false
			}
			if len(patch) == 0 {
				return fmt.Errorf("nothing to change — pass at least one flag")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.EditBooksSource(ws, n, patch)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				state := ""
				if r.Retired {
					state = " (retired)"
				}
				_, err := fmt.Fprintf(w, "updated source #%d: %s%s\n", r.Number, r.Name, state)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&expected, "expected", "", "New cadence: daily, weekly, monthly, quarterly")
	cmd.Flags().StringVar(&method, "method", "", "New method line")
	cmd.Flags().StringSliceVar(&ledger, "ledger-account", nil, "Replace the ledger accounts (repeatable)")
	cmd.Flags().BoolVar(&retire, "retire", false, "Retire the source")
	cmd.Flags().BoolVar(&unretire, "unretire", false, "Bring a retired source back")
	return cmd
}

func newSourceRecordPullCmd() *cobra.Command {
	var req client.RecordBooksPullRequest
	cmd := &cobra.Command{
		Use:         "record-pull <source-number> --file <name>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/sources/{number}/pulls"},
		Short:       "Record a pull the import door did not make itself",
		Long: "The Stripe CSV, the PDF parked in Drive: camt.053 imports record their own\n" +
			"pull, this records every other format. Idempotent on the file name — the\n" +
			"first delivery is the record. `last_import` moves, so the completeness\n" +
			"status goes green without anyone touching it.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.RecordBooksPull(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				verb := "recorded pull"
				if !r.Created {
					verb = "already recorded — converged on"
				}
				_, err := fmt.Fprintf(w, "%s %s\n", verb, r.File)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&req.File, "file", "", "The pulled file's name (required; the idempotency key)")
	cmd.Flags().StringVar(&req.Period, "period", "", "Human period label, e.g. 01-07.08.2026")
	cmd.Flags().StringVar(&req.Format, "format", "", "csv, camt.053, pdf, …")
	cmd.Flags().StringVar(&req.Hash, "hash", "", "Hash of OUR copy, taken at download")
	cmd.Flags().StringVar(&req.DriveRef, "drive-ref", "", "Where our copy lives")
	cmd.Flags().StringVar(&req.Pulled, "pulled", "", "Pull date, YYYY-MM-DD (default today)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func newSourceRunbookSetCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:         "runbook-set <source-number> --file <runbook.json>",
		Annotations: map[string]string{"routes": "PUT /api/workspaces/{ws}/sources/{number}/runbook"},
		Short:       "Set a source's runbook — how to pull it, without its secrets",
		Long: "One runbook per source, versioned in place; history belongs to git. The JSON\n" +
			"shape: {version, login_url, credential_ref, steps: [\"...\"], output}.\n" +
			"`credential_ref` must be a REFERENCE (vault://…) — the server refuses\n" +
			"anything that does not look like one, because this table must never hold a\n" +
			"secret. `--file -` reads stdin.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(args[0])
			if err != nil || n < 1 {
				return fmt.Errorf("%q is not a source number", args[0])
			}
			var raw []byte
			if file == "-" {
				raw, err = io.ReadAll(os.Stdin)
			} else {
				raw, err = os.ReadFile(file)
			}
			if err != nil {
				return fmt.Errorf("reading the runbook: %w", err)
			}
			var body map[string]any
			if err := json.Unmarshal(raw, &body); err != nil {
				return fmt.Errorf("the runbook is not JSON: %w", err)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.SetBooksRunbook(ws, n, body)
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "runbook set on source #%d (version %v)\n", n, r["version"])
				return err
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the runbook JSON, or - for stdin (required)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}
