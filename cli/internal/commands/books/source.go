// The sources register: `bk books source list` and `source show`.
//
// The register answers "do I have everything". STATUS is computed server-side
// from cadence against the last import and stored nowhere, so nothing an agent
// or a hurried human does can flip a late source green — the only hand-set
// lifecycle fact is retirement. `source show` prints the runbook too, because
// the register is also the answer to "how do I pull this again".
package books

import (
	"fmt"
	"io"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newSourceCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "source",
		Short: "The sources register — every place money data comes from",
	}
	cmd.AddCommand(newSourceListCmd(), newSourceShowCmd())
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
