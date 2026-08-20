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
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newSourceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "source",
		Short: "The sources register — every place money data comes from",
		Long: "A source is any place money data comes from: a bank, a card, a processor, a\n" +
			"Drive folder. THREE DIFFERENT THINGS live under this noun, and knowing which\n" +
			"you are setting is most of using it:\n\n" +
			"  the REGISTER   create, edit, list, show — that the feed exists, what account\n" +
			"                 it IS, and how often it should arrive\n" +
			"  the RUNBOOK    runbook-set — how a human fetches it, as structured JSON,\n" +
			"                 with a credential REFERENCE and never a credential\n" +
			"  the DOOR       mapping-set, import, record-pull — how a delivered file is\n" +
			"                 read, and the delivery itself\n\n" +
			"A source's completeness STATUS is computed from its cadence against its last\n" +
			"import and stored nowhere, so nothing can mark a late feed green by hand.\n\n" +
			"A registered source that has never been imported from has produced nothing.\n" +
			"The register is not the money.",
	}
	cmd.AddCommand(newSourceListCmd(), newSourceShowCmd(), newSourceImportCmd(),
		newSourceCreateCmd(), newSourceEditCmd(), newSourceRecordPullCmd(), newSourceRunbookSetCmd(),
		newSourceMappingSetCmd())
	return cmd
}

func newSourceListCmd() *cobra.Command {
	var entity string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/sources"},
		Short:       "List sources with their computed completeness status",
		Long: "Every place money data comes from, for one book or for all of them.\n\n" +
			"STATUS IS COMPUTED AND STORED NOWHERE. It is this source's cadence measured\n" +
			"against its last import, so nothing can mark a late feed green by hand and a\n" +
			"source nobody has imported from reads as the gap it is.\n" +
			"`bk meta --app-server books` carries the status values; `bk books source show <n>`\n" +
			"prints the day windows this source uses to reach one.\n\n" +
			"The `#` column is the argument every other source verb takes — import,\n" +
			"mapping-set, runbook-set, record-pull, manifest and `rule create --source`. It\n" +
			"is a workspace #number and not a database id.\n\n" +
			"A source with no LEDGER ACCOUNT cannot be imported from in a double-entry book:\n" +
			"the account is what the feed IS. Set it with `bk books source edit`.",
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
		Long: "One source, whole: its register row, the windows behind its computed status,\n" +
			"every pull on record, the runbook for fetching it, and a RECONCILIATION.\n\n" +
			"THE RECONCILIATION IS THE POINT. It sets the ledger balance for this feed's\n" +
			"account against what the bank last said it was. It reports and never refuses —\n" +
			"a drift is usually a payment posted before it cleared — but it distinguishes a\n" +
			"drift from an UNKNOWN, because a source that has never stated a closing balance\n" +
			"agrees with nothing, and printing that as agreement would be the reassuring\n" +
			"wrong answer.\n\n" +
			"Staged money is excluded from the ledger side and said so explicitly: staged is\n" +
			"money nobody has judged, and counting it would hide the judgement that is owed.\n\n" +
			"The runbook prints its credential REFERENCE, never a credential — the door\n" +
			"refuses anything that is not a vault address.",
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
				// The bank reconciliation. It REPORTS and never refuses: a drift is
				// usually something ordinary — a payment posted before it clears —
				// and the point is that the question is asked at all, because until
				// this existed a posting the bank never saw looked exactly the same.
				if r := s.Reconciliation; r != nil {
					fmt.Fprintf(w, "\n  RECONCILIATION\n")
					if !r.Known {
						fmt.Fprintf(w, "  not possible: %s\n", strOr(r.Note, "no closing balance on record"))
					} else {
						fmt.Fprintf(w, "  bank said     %s at %s\n",
							strOr(r.StatementClosing, "—"), strOr(r.StatementClosedOn, "—"))
						fmt.Fprintf(w, "  ledger says   %s\n", strOr(r.LedgerBalance, "—"))
						if r.Agrees != nil && *r.Agrees {
							fmt.Fprintf(w, "  drift         none — the books agree with the bank\n")
						} else {
							fmt.Fprintf(w, "  drift         %s\n", strOr(r.Drift, "—"))
							if r.StagedOnAccount != nil && *r.StagedOnAccount != "0.00" {
								fmt.Fprintf(w, "  staged        %s not counted — staged money is money nobody has judged\n",
									*r.StagedOnAccount)
							}
						}
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
	var file, opening, closing, closingOn string
	cmd := &cobra.Command{
		Use: "import <source-number> --file <statement.xml|export.csv>",
		// The GET names the BOOK this feed belongs to, which the next-step line
		// needs: `bk books worklist` without --entity answers about whichever
		// book sorts first, and that reads exactly like an answer.
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/sources/{number}/import, GET /api/workspaces/{ws}/sources/{number}"},
		Short:       "Import one bank or card statement through the door",
		Long: "Deliver one camt.053 statement to this source's book. Every booked line\n" +
			"lands STAGED — whole file or nothing: the statement must reconcile against\n" +
			"itself (opening + lines = closing, to the rappen) or it is refused with the\n" +
			"arithmetic shown.\n\n" +
			"Rules run at arrival: a clean hit lands `inferred` and waits on the worklist\n" +
			"for a human to confirm — the machine suggests, it never applies. Re-importing\n" +
			"an overlapping statement converges on the bank's own references and duplicates\n" +
			"nothing. `--file -` reads stdin, which is how the Companion pipes.\n\n" +
			"TWO FORMATS. camt.053 XML needs nothing else — ISO 20022 states its own\n" +
			"opening and closing balances. A DELIMITED export (the CSV a card or a\n" +
			"processor issues) needs two things: an import mapping on the source, set once\n" +
			"from a real export with `bk books source mapping-set`, and --opening/--closing,\n" +
			"because the file almost never carries balances and without them nothing can\n" +
			"tell a whole file from half of one.\n\n" +
			"A CARD NEEDS ITS OWN ACCOUNT. If the source settles into another (set with\n" +
			"`source edit --draws-from`), it may not name that one's ledger account: the\n" +
			"card's four purchases and the bank's single settlement are the same money, and\n" +
			"booking both against the bank counts it twice on a bilan that balances either\n" +
			"way. Give the card a class 2 account; purchases credit it, the settlement\n" +
			"debits it, and it nets to what is outstanding.",
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

			// The FILE decides, not a flag: a camt.053 announces itself in its
			// first element, and anything else is delimited. Asking the caller
			// to declare a format they can see would be a flag that is only
			// ever wrong.
			body := string(raw)
			var r *client.BooksImportSummary
			if strings.Contains(body, "<BkToCstmrStmt") {
				if opening != "" || closing != "" {
					return fmt.Errorf("a camt.053 states its own balances — drop --opening/--closing, they are for delimited exports")
				}
				r, err = c.ImportBooksSource(ws, n, name, body)
			} else {
				if opening == "" || closing == "" {
					return fmt.Errorf("a delimited export needs --opening and --closing: read them off the statement.\n" +
						"Without them nothing can tell a whole file from half of one, which is the check a camt.053 gets from its own balances")
				}
				if file == "-" {
					name = "stdin.csv"
				}
				r, err = c.ImportBooksDelimited(ws, n, name, body, opening, closing, closingOn)
			}
			if err != nil {
				return err
			}
			// Which book this feed belongs to, for the next-step line. Best
			// effort: a failed read costs the --entity, never the import.
			var entity string
			if d, e := c.GetBooksSource(ws, r.Source); e == nil && d.Entity != nil {
				entity = *d.Entity
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
				// The worklist is scoped to ONE book and defaults to the first
				// one in the workspace. Printing the bare form sent this
				// phase's cold run at a different book's work, which reads as
				// an answer — so the step carries the book this import landed
				// in. `entityFlag` degrades to the bare form if the lookup
				// below failed, which is correct for a single-book workspace.
				if r.Unrecognized > 0 {
					nextStep(w, "bk books worklist%s", entityFlag(entity))
				} else if r.Inferred > 0 {
					also(w, "every new line matched a rule and landed `inferred` — a suggestion, never applied:")
					nextStep(w, "bk books worklist%s", entityFlag(entity))
				} else if r.Imported > 0 {
					nextStep(w, "bk books entry list%s", entityFlag(entity))
				} else {
					also(w, "nothing new — this statement was already imported.")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the camt.053 XML or delimited export, or - for stdin (required)")
	cmd.Flags().StringVar(&opening, "opening", "", "Delimited only: the balance this file opens at, e.g. 0.00")
	cmd.Flags().StringVar(&closing, "closing", "", "Delimited only: the balance it must reconcile to")
	cmd.Flags().StringVar(&closingOn, "closing-on", "", "Delimited only: the date that closing balance is stated as of (default: the last line's date)")
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
				if _, err := fmt.Fprintf(w, "created source #%d: %s (%s)\n", r.Number, r.Name, r.Type); err != nil {
					return err
				}
				if len(ledger) == 0 {
					also(w, "it names no ledger account, so a double-entry book cannot import from it yet:")
					nextStep(w, "bk books source edit %d --ledger-account <no>", r.Number)
					return nil
				}
				// A registered source that has never been imported from has
				// produced nothing. Which door depends on what the feed emits:
				// a bank states its own balances in camt.053, anything else is
				// read as a delimited export and needs a mapping first.
				if r.Type == "bank" {
					nextStep(w, "bk books source import %d --file <statement.xml>", r.Number)
				} else {
					also(w, "a non-camt export is read as delimited — teach its columns once:")
					nextStep(w, "bk books source mapping-set %d --file <mapping.json>", r.Number)
					also(w, "  then: bk books source import %d --file <export.csv> --opening <chf> --closing <chf>", r.Number)
				}
				return nil
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
	var drawsFrom int
	var noDrawsFrom bool
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
			// The chain: which feed this one settles into (DATA-MODEL §10). By
			// SOURCE NUMBER, the thing `source list` shows.
			if cmd.Flags().Changed("draws-from") {
				patch["draws_from"] = drawsFrom
			}
			if cmd.Flags().Changed("no-draws-from") && noDrawsFrom {
				patch["draws_from"] = nil
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
				if _, err := fmt.Fprintf(w, "updated source #%d: %s%s\n", r.Number, r.Name, state); err != nil {
					return err
				}
				// `source show` is the only read that ends with the
				// RECONCILIATION — the ledger against what the bank last
				// reported — which is what an edit to the ledger accounts or
				// the cadence changes.
				nextStep(w, "bk books source show %d", r.Number)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&expected, "expected", "", "New cadence: daily, weekly, monthly, quarterly")
	cmd.Flags().StringVar(&method, "method", "", "New method line")
	cmd.Flags().StringSliceVar(&ledger, "ledger-account", nil, "Replace the ledger accounts (repeatable)")
	cmd.Flags().BoolVar(&retire, "retire", false, "Retire the source")
	cmd.Flags().BoolVar(&unretire, "unretire", false, "Bring a retired source back")
	cmd.Flags().IntVar(&drawsFrom, "draws-from", 0, "Source #number this one settles into — a card settles into its bank")
	cmd.Flags().BoolVar(&noDrawsFrom, "no-draws-from", false, "Clear the chain: this feed settles nowhere")
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
				if _, err := fmt.Fprintf(w, "%s %s\n", verb, r.File); err != nil {
					return err
				}
				// A recorded pull moves the source's computed status; it does
				// NOT book anything. The statement still has to come through
				// the door before the money exists in the ledger.
				also(w, "a pull is provenance, not money — the statement still has to be imported:")
				nextStep(w, "bk books source import %d --file <statement.xml>", n)
				return nil
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

func newSourceMappingSetCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:         "mapping-set <source-number> --file <mapping.json>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/sources/{number}"},
		Short:       "Say how to READ this source's delimited export",
		Long: "The runbook says how to FETCH a file; this says how to read what comes back.\n" +
			"Only delimited exports need it — a camt.053 needs none, because ISO 20022 is\n" +
			"the mapping.\n\n" +
			"There is no \"CSV format\": every issuer names its columns differently, so this\n" +
			"is established ONCE per source by a human looking at a real export, and kept\n" +
			"as data rather than code.\n\n" +
			"  {\n" +
			"    \"delimiter\": \",\", \"header\": true,\n" +
			"    \"columns\": {\"date\": \"Date\", \"label\": \"Merchant\", \"amount\": \"Amount\"},\n" +
			"    \"date_format\": \"YYYY-MM-DD\", \"decimal\": \".\",\n" +
			"    \"positive_means\": \"credit\"\n" +
			"  }\n\n" +
			"`positive_means` is the one nobody can infer: a statement of CHARGES may write\n" +
			"purchases positive, and getting it backwards inverts every line. The\n" +
			"opening/closing check at import is what catches that, which is why those\n" +
			"balances are required.\n\n" +
			"Instead of `amount`, name a `debit`/`credit` pair when the issuer splits them.\n" +
			"`--file -` reads stdin.",
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
				return fmt.Errorf("reading the mapping: %w", err)
			}
			var mapping map[string]any
			if err := json.Unmarshal(raw, &mapping); err != nil {
				return fmt.Errorf("the mapping is not JSON: %w", err)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			r, err := c.EditBooksSource(ws, n, map[string]any{"import_mapping": mapping})
			if err != nil {
				return err
			}
			return output.Render(format, r, func(w io.Writer) error {
				if _, err := fmt.Fprintf(w, "mapping set on source #%d (%s) — delimited files can now be imported\n", r.Number, r.Name); err != nil {
					return err
				}
				nextStep(w, "bk books source import %d --file <export.csv> --opening <chf> --closing <chf>", r.Number)
				also(w, "  --opening/--closing are required for a delimited file: it carries no balances,")
				also(w, "  so nothing else can tell a whole export from half of one.")
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the mapping JSON, or - for stdin (required)")
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
				if _, err := fmt.Fprintf(w, "runbook set on source #%d (version %v)\n", n, r["version"]); err != nil {
					return err
				}
				nextStep(w, "bk books source show %d", n)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to the runbook JSON, or - for stdin (required)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}
