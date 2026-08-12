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

// `bk sales meeting` and `bk sales comm` — the two ledgers.
//
// NEITHER COMMAND SENDS ANYTHING. They record that something happened, or is
// going to. Google Calendar owns scheduling and Gmail owns mail; integration
// with either is an explicit non-goal, and the app having an opinion about it
// would be the first step towards one.
//
// `schedule` and `log` are the same call with a different moment attached, which
// is why they claim the same route: one is a meeting that will happen, the other
// one that did.

func newMeetingCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "meeting",
		Short: "The meetings ledger — past and upcoming",
		// Three commands, one workflow. Which of them to reach for is decided by
		// WHEN the meeting is, and the group listing alone does not say so — an
		// agent choosing between "log" and "schedule" reads this page and gets a
		// list of verbs with no relation between them.
		Long: `The meetings ledger — past and upcoming.

Which verb depends on when the meeting is:

  log       a meeting that already happened — --outcome required up front
  schedule  a future meeting — its outcome is recorded later, with "outcome"
  outcome   fill in how a scheduled meeting went (and mark it as having happened)

NOTHING HERE SENDS OR SCHEDULES ANYTHING. The app records meetings; it creates
no calendar event and invites nobody, and that is a deliberate non-goal.

"cancel" keeps the record and marks it cancelled — a meeting that was arranged
and did not happen is a fact about the deal. "rm" bins the record itself.`,
	}
	cmd.AddCommand(
		newMeetingListCmd(),
		newMeetingShowCmd(),
		newMeetingScheduleCmd(),
		newMeetingLogCmd(),
		newMeetingOutcomeCmd(),
		newMeetingCancelCmd(),
		newMeetingRemoveCmd(),
	)
	return cmd
}

func newMeetingListCmd() *cobra.Command {
	var prospect int
	var statuses []string
	var from, to string
	var limit, cursor int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/meetings"},
		Short:       "List meetings, most recent first",
		Long: `List meetings across the workspace, most recent first — which includes the
ones that have not happened yet, because "what is next" and "what just happened"
are both at that end of the list.

--from / --to take ISO 8601 timestamps. Run "bk meta" for the status values.`,
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
			page, err := c.ListMeetings(ws, client.ListMeetingsOpts{
				Prospect: prospect,
				Statuses: splitAll(statuses),
				From:     from,
				To:       to,
				Limit:    limit,
				Cursor:   cursor,
			})
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tWHEN\tTYPE\tSTATUS\tTITLE\tPROSPECT")
				for _, m := range page.Data {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s (#%d)\n",
						m.Number, dateOnly(m.StartsAt), m.Type, m.Status,
						cmdutil.Truncate(m.Title, 30),
						cmdutil.Truncate(m.ProspectName, 18), m.ProspectNumber)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no meetings)")
				}
				if page.NextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "more results: --cursor %d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&prospect, "prospect", 0, "Only this prospect's meetings (its #number)")
	cmd.Flags().StringSliceVar(&statuses, "status", nil, "Filter by status — "+vocab("meeting_statuses", "repeatable"))
	cmd.Flags().StringVar(&from, "from", "", "Only meetings at or after this ISO timestamp")
	cmd.Flags().StringVar(&to, "to", "", "Only meetings at or before this ISO timestamp")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max meetings to return")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Continue from the cursor of the previous page")
	return cmd
}

func newMeetingShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/meetings/{n}"},
		Short:       "Show one meeting",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "meeting")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.GetMeeting(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s\n", m.Number, m.Title)
				if m.URN != "" {
					fmt.Fprintln(w, m.URN)
				}
				fmt.Fprintln(w)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "when\t%s\n", m.StartsAt)
				fmt.Fprintf(tw, "type\t%s\n", m.Type)
				fmt.Fprintf(tw, "status\t%s\n", m.Status)
				fmt.Fprintf(tw, "prospect\t%s (#%d)\n", m.ProspectName, m.ProspectNumber)
				if len(m.Attendees) > 0 {
					fmt.Fprintf(tw, "attendees\t%s\n", strings.Join(m.Attendees, ", "))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if m.Agenda != "" {
					fmt.Fprintf(w, "\nAGENDA\n%s\n", m.Agenda)
				}
				if m.Outcome != "" {
					fmt.Fprintf(w, "\nOUTCOME\n%s\n", m.Outcome)
				}
				return nil
			})
		},
	}
}

func newMeetingScheduleCmd() *cobra.Command {
	return newMeetingCreateCmd("schedule", "upcoming",
		`Record a meeting that is going to happen.

This does NOT create a calendar event and does not invite anybody — the app
records meetings, it does not schedule them. Use "bk sales meeting log" for one
that already happened.`)
}

func newMeetingLogCmd() *cobra.Command {
	return newMeetingCreateCmd("log", "done",
		`Record a meeting that already happened, with its outcome.

The same call as "schedule" with a different moment attached, which is why both
claim the same route: one is a meeting that will happen, the other one that did.`)
}

// newMeetingCreateCmd builds `schedule` and `log` from one definition. The two
// differ in a default and in their help text; writing them twice would be two
// places for a flag to be added to.
func newMeetingCreateCmd(use, defaultStatus, long string) *cobra.Command {
	var req client.CreateMeetingRequest
	var attendees []string
	cmd := &cobra.Command{
		Use:         use + " --prospect <n> --at <when> --type <type> --title <title>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/meetings"},
		Short:       map[string]string{"schedule": "Record an upcoming meeting", "log": "Record a meeting that happened"}[use],
		Long:        long,
		Args:        cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			// Either shape: `meeting schedule 8 …` or `--prospect 8`. This
			// command's canonical spelling is the flag, and the positional is
			// accepted because the prospect-first families next door taught it.
			n, _, err := resolveProspect(cmd, args, req.Prospect, 0)
			if err != nil {
				return err
			}
			req.Prospect = n
			req.Status = defaultStatus
			req.Attendees = splitAll(attendees)
			if use == "log" && strings.TrimSpace(req.Outcome) == "" {
				return fmt.Errorf("--outcome is required when logging a meeting that happened " +
					"— use `bk sales meeting schedule` for one that has not")
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.CreateMeeting(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "recorded meeting #%d (%s) with %s (#%d): %s\n%s\n",
					m.Number, m.Status, m.ProspectName, m.ProspectNumber, m.Title, m.URN)
				return err
			})
		},
	}
	cmd.Flags().IntVar(&req.Prospect, "prospect", 0,
		"The prospect's #number (required, unless given as the first argument)")
	cmd.Flags().StringVar(&req.At, "at", "", "When, ISO 8601 (required)")
	cmd.Flags().StringVar(&req.Type, "type", "", "Meeting type — "+vocab("meeting_types", "required"))
	cmd.Flags().StringVar(&req.Title, "title", "", "What the meeting is (required)")
	cmd.Flags().StringSliceVar(&attendees, "attendee", nil, "Who was there (repeatable; plain names)")
	cmd.Flags().StringVar(&req.Agenda, "agenda", "", "What it is for")
	if use == "log" {
		cmd.Flags().StringVar(&req.Outcome, "outcome", "", "What came of it (required)")
	}
	// "prospect" is NOT marked required here: it may arrive as the first
	// argument instead, and cobra's check runs before RunE can see that.
	// resolveProspect refuses the genuinely-missing case, naming both spellings.
	for _, f := range []string{"at", "type", "title"} {
		_ = cmd.MarkFlagRequired(f)
	}
	return cmd
}

func newMeetingOutcomeCmd() *cobra.Command {
	var outcome string
	cmd := &cobra.Command{
		Use:         "outcome <n> --outcome <text>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/meetings/{n}"},
		Short:       "Record how a meeting went",
		Long: `Write the outcome of a meeting.

Recording an outcome also marks the meeting as having happened, because an
outcome is EVIDENCE that it did. (That is the opposite of an objection, where a
counter is not evidence the objection is settled — see "bk sales objection".)`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "meeting")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.UpdateMeeting(ws, n, client.UpdateMeetingRequest{Outcome: client.Set(outcome)})
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "meeting #%d is now %s\n", m.Number, m.Status)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&outcome, "outcome", "", "What came of the meeting (required)")
	_ = cmd.MarkFlagRequired("outcome")
	return cmd
}

func newMeetingCancelCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "cancel <n>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/meetings/{n}"},
		Short:       "Mark a meeting as cancelled",
		Long: `Mark a meeting cancelled. The record stays — a cancelled meeting is a fact
about the deal, and removing it would lose that the conversation was arranged
and did not happen. To bin the record itself, use "bk sales meeting rm".`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "meeting")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.UpdateMeeting(ws, n, client.UpdateMeetingRequest{Status: "cancelled"})
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "meeting #%d is now %s\n", m.Number, m.Status)
				return err
			})
		},
	}
}

func newMeetingRemoveCmd() *cobra.Command {
	var confirm string
	var yes bool
	cmd := &cobra.Command{
		Use:         "rm <n> --confirm <title>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/meetings/{n},DELETE /api/workspaces/{ws}/meetings/{n}"},
		Short:       "Move a meeting to the recycle bin",
		Long: `Bin a meeting record.

--confirm must be the meeting's TITLE, not the number you already typed. To
record that a meeting did not take place, use "bk sales meeting cancel" instead —
that keeps the fact.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "meeting")
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the title of meeting #%d "+
					"— run `bk sales meeting show %d` to see it", n, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			target, err := c.GetMeeting(ws, n)
			if err != nil {
				return err
			}
			if confirm != target.Title {
				return fmt.Errorf("--confirm is required to match meeting #%d, which is %q — got %q; nothing was deleted",
					n, target.Title, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Bin meeting #%d (%s)?", n, target.Title), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := c.DeleteMeeting(ws, n, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "binned %s #%d: %s\n", done.Type, done.Number, done.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the meeting TITLE to authorise (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// ---------------------------------------------------------------------------
// communications
// ---------------------------------------------------------------------------

func newCommCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "comm",
		Short: "The communications log — email, WhatsApp, calls, notes",
	}
	cmd.AddCommand(newCommListCmd(), newCommLogCmd(), newCommShowCmd(), newCommRemoveCmd())
	return cmd
}

func newCommListCmd() *cobra.Command {
	var prospect int
	var channels []string
	var dir, from, to string
	var limit, cursor int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/communications"},
		Short:       "List logged communications, most recent first",
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
			page, err := c.ListComms(ws, client.ListCommsOpts{
				Prospect:  prospect,
				Channels:  splitAll(channels),
				Direction: dir,
				From:      from,
				To:        to,
				Limit:     limit,
				Cursor:    cursor,
			})
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tWHEN\tCHANNEL\tDIR\tSUBJECT\tPROSPECT\tBY")
				for _, m := range page.Data {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s (#%d)\t%s\n",
						m.Number, dateOnly(m.OccurredAt), m.Channel, m.Direction,
						cmdutil.Truncate(dashIf(m.Subject), 28),
						cmdutil.Truncate(m.ProspectName, 16), m.ProspectNumber,
						cmdutil.Truncate(dashIf(m.LoggedBy), 16))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(nothing logged)")
				}
				if page.NextCursor != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "more results: --cursor %d\n", *page.NextCursor)
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&prospect, "prospect", 0, "Only this prospect's log (its #number)")
	cmd.Flags().StringSliceVar(&channels, "channel", nil, "Filter by channel — "+vocab("channels", "repeatable"))
	cmd.Flags().StringVar(&dir, "dir", "", "Filter by direction — "+vocab("comm_directions"))
	cmd.Flags().StringVar(&from, "from", "", "At or after this ISO timestamp")
	cmd.Flags().StringVar(&to, "to", "", "At or before this ISO timestamp")
	cmd.Flags().IntVar(&limit, "limit", 0, "Max rows to return")
	cmd.Flags().IntVar(&cursor, "cursor", 0, "Continue from the cursor of the previous page")
	return cmd
}

func newCommLogCmd() *cobra.Command {
	var req client.LogCommRequest
	var contact int
	cmd := &cobra.Command{
		Use:         "log --prospect <n> --channel <ch> --dir <in|out>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/communications"},
		Short:       "Record that a message was sent or received",
		Long: `Log a communication.

THIS DOES NOT SEND ANYTHING. It records that something was sent or received —
the app has no mail, no WhatsApp and no integration with either, and that is a
deliberate non-goal rather than a gap.

An internal note about a prospect is a communication too: use the note channel.
This app has no comment threads, so that is where a note lives.

--at defaults to now. Run "bk meta" for the channels and directions.

The prospect may be given as --prospect <n> or as the first argument.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, req.Prospect, 0)
			if err != nil {
				return err
			}
			req.Prospect = n
			if cmd.Flags().Changed("contact") {
				req.Contact = &contact
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.LogComm(ws, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "logged %s #%d (%s %s) against %s (#%d)\n%s\n",
					"communication", m.Number, m.Channel, m.Direction,
					m.ProspectName, m.ProspectNumber, m.URN)
				return err
			})
		},
	}
	cmd.Flags().IntVar(&req.Prospect, "prospect", 0,
		"The prospect's #number (required, unless given as the first argument)")
	cmd.Flags().StringVar(&req.Channel, "channel", "", "Channel — "+vocab("channels", "required"))
	cmd.Flags().StringVar(&req.Direction, "dir", "", "Which way — "+vocab("comm_directions", "required"))
	cmd.Flags().StringVar(&req.At, "at", "", "When it happened, ISO 8601 (default now)")
	cmd.Flags().StringVar(&req.Subject, "subject", "", "Subject line, where there is one")
	cmd.Flags().StringVar(&req.Body, "body", "", "What was said")
	cmd.Flags().IntVar(&contact, "contact", 0, "Which contact (the ID from `bk sales contact list`)")
	// See the note on `meeting schedule`: "prospect" may arrive positionally, so
	// resolveProspect enforces it rather than cobra.
	for _, f := range []string{"channel", "dir"} {
		_ = cmd.MarkFlagRequired(f)
	}
	return cmd
}

func newCommShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show <n>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/communications/{n}"},
		Short:       "Show one logged communication in full",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "communication")
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			m, err := c.GetComm(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "#%d  %s %s — %s\n", m.Number, m.Channel, m.Direction, dashIf(m.Subject))
				if m.URN != "" {
					fmt.Fprintln(w, m.URN)
				}
				fmt.Fprintln(w)
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "when\t%s\n", m.OccurredAt)
				fmt.Fprintf(tw, "prospect\t%s (#%d)\n", m.ProspectName, m.ProspectNumber)
				if m.Contact != "" {
					fmt.Fprintf(tw, "contact\t%s\n", m.Contact)
				}
				fmt.Fprintf(tw, "logged by\t%s\n", dashIf(m.LoggedBy))
				if err := tw.Flush(); err != nil {
					return err
				}
				if m.Body != "" {
					fmt.Fprintf(w, "\n%s\n", m.Body)
				}
				return nil
			})
		},
	}
}

func newCommRemoveCmd() *cobra.Command {
	var confirm string
	var yes bool
	cmd := &cobra.Command{
		Use:         "rm <n> --confirm <prospect-name>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/communications/{n},DELETE /api/workspaces/{ws}/communications/{n}"},
		Short:       "Move a logged communication to the recycle bin",
		Long: `Bin a logged communication.

--confirm is the PROSPECT'S NAME, not the number and not the subject: a call or
a note often has no subject at all, and "which company is this against" is the
fact you must have checked before removing a record of contact with them.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, err := entityNumber(args[0], "communication")
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the prospect name on communication #%d "+
					"— run `bk sales comm show %d` to see it", n, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			target, err := c.GetComm(ws, n)
			if err != nil {
				return err
			}
			if confirm != target.ProspectName {
				return fmt.Errorf("--confirm is required to match the prospect on #%d, which is %q — got %q; nothing was deleted",
					n, target.ProspectName, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Bin communication #%d against %s?", n, target.ProspectName), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := c.DeleteComm(ws, n, confirm)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "binned %s #%d: %s\n", done.Type, done.Number, done.Name)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the PROSPECT NAME to authorise (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}
