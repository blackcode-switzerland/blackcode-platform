package sales

// `bk sales prospect note` — the research log (#39).
//
// ---------------------------------------------------------------------------
// THERE IS NO `note edit`, AND THAT IS THE COMMAND GROUP'S WHOLE POINT
// ---------------------------------------------------------------------------
// `bk sales prospect edit --summary` is the field you OVERWRITE: "where this
// deal stands" has one answer at a time. This is the other shape — a sequence of
// observations, each true when it was written.
//
// The issue that produced it was filed from a real session: researching a
// prospect, the only free-text field was `--summary`, so recording a new finding
// meant destroying the previous one. An editable log answers "what do we think
// now", which `--summary` already answers, and stops answering "what did we know
// and when", which is the only thing this exists for. The server has no PATCH
// route for it either.
//
// ---------------------------------------------------------------------------
// WHY IT LIVES UNDER `prospect` RATHER THAN AT THE TOP OF `bk sales`
// ---------------------------------------------------------------------------
// A note has no #number and cannot be reached without naming its prospect, so a
// bare `bk sales note …` would be a verb whose first argument is always a
// prospect — which is what `bk sales prospect note …` says out loud. It also
// keeps `note` from colliding with the `note` value of the `channels`
// vocabulary, which `bk sales comm log --channel note` already uses.

import (
	"fmt"
	"io"
	"strings"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

func newProspectNoteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "note",
		Short: "The research log — append findings without destroying the last ones",
		Long: `A prospect's research/intelligence log: site audits, competitor notes,
personnel details, timing signals.

APPEND-ONLY. There is no "note edit" — writing a correction is another note, and
the log is what tells you what was known when. If you want to state the CURRENT
position instead, that is "bk sales prospect edit --summary", which overwrites.`,
	}
	cmd.AddCommand(
		newProspectNoteListCmd(),
		newProspectNoteAddCmd(),
		newProspectNoteRemoveCmd(),
	)
	return cmd
}

func newProspectNoteListCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "list <prospect>",
		Aliases:     []string{"ls"},
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/notes"},
		Short:       "Read a prospect's research log, newest first",
		Args:        cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListProspectNotes(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				// One note per BLOCK rather than one per table row. A research
				// finding is prose that runs to paragraphs, and a tabwriter
				// column would either truncate it or destroy the alignment of
				// every other row — which is the same reason `prospect show`
				// prints the summary below the table instead of inside it.
				for i, r := range rows {
					if i > 0 {
						fmt.Fprintln(w)
					}
					head := fmt.Sprintf("%d", r.ID)
					if strings.TrimSpace(r.Kind) != "" {
						head += "  " + r.Kind
					}
					fmt.Fprintf(w, "%s\t%s  %s\n", head, dateOnly(r.CreatedAt), dashIf(r.Author))
					for _, line := range strings.Split(strings.TrimRight(r.Body, "\n"), "\n") {
						fmt.Fprintf(w, "    %s\n", line)
					}
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(nothing researched yet — `bk sales prospect note add` appends; --summary overwrites)")
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newProspectNoteAddCmd() *cobra.Command {
	var prospect int
	var body, kind string
	cmd := &cobra.Command{
		Use:         "add <prospect> --text <finding>",
		Aliases:     []string{"create", "new", "append"},
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/prospects/{n}/notes"},
		Short:       "Append a finding to the research log",
		Long: `Append one observation. Nothing already in the log is touched.

--kind is a free-text bucket ("site audit", "competitor", "timing"), not a
vocabulary: what is worth categorising about a prospect is not settled, and a
closed list would refuse the first note that did not fit.

The entry records WHO wrote it, from your API token's name. Most of these are
written by an agent, and a research log you cannot attribute is one you cannot
weigh — so name your token for what it is.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.AddProspectNote(ws, n, client.AddProspectNoteRequest{Body: body, Kind: kind})
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "note %d added to prospect %s\n", row.ID, prospectLabel(c, ws, n))
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&body, "text", "", "What you found (required)")
	cmd.Flags().StringVar(&kind, "kind", "", "A free-text bucket (\"site audit\", \"competitor\")")
	_ = cmd.MarkFlagRequired("text")
	return cmd
}

func newProspectNoteRemoveCmd() *cobra.Command {
	var prospect int
	var confirm string
	cmd := &cobra.Command{
		Use:         "rm <prospect> <note-id> --confirm <note-id>",
		Aliases:     []string{"remove", "delete"},
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/notes/{noteId}"},
		Short:       "Destroy a note — permanent, there is no recycle bin",
		Long: `Remove one entry from the log. THIS CANNOT BE UNDONE: the research log has
no recycle bin, so there is nothing for "bk sales trash restore" to take.

--confirm is required and must repeat the note's id back. That is what stops the
command auto-approving under BK_NO_PROMPT=1 and on a non-TTY, which is how
agents run — it does NOT catch a wrong id, since a wrong id is what you would
repeat. What covers that is the output: this prints the whole note it destroyed,
so a mistake is visible in the next line rather than in a month.

The log is append-only, so a note that turned out to be WRONG is better answered
with another note than with this command. Use it for one pasted onto the wrong
prospect.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, id, err := prospectAndChild(cmd, args, prospect, "note")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			gone, err := c.DeleteProspectNote(ws, n, id, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, gone, func(w io.Writer) error {
				// WHAT was destroyed, not just that something was. The row is
				// gone; this is the last copy anybody sees.
				fmt.Fprintf(w, "destroyed note %d%s\n", gone.ID, suffix(gone.Kind))
				for _, line := range strings.Split(strings.TrimRight(gone.Body, "\n"), "\n") {
					fmt.Fprintf(w, "    %s\n", cmdutil.Truncate(line, 100))
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the note's id back (required)")
	_ = cmd.MarkFlagRequired("confirm")
	return cmd
}
