package sales

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `today`, `pipeline`, `metrics` — the three questions that are arithmetic.
//
// ---------------------------------------------------------------------------
// THESE READ; THEY DO NOT DECIDE (D-33)
// ---------------------------------------------------------------------------
// The doctrine forbids the app DECIDING things, not READING them. Which product
// suits a client is judgement and is STORED (`bk sales match set`); summing deal
// values by stage is arithmetic over rows the app already holds, and storing it
// would create a second number that can disagree with the first.
//
// All three are computed server-side per request. None of them takes a
// vocabulary as a flag, and none names a stage in this file: the terminal/open
// split lives in the app's own module, so adding a stage changes these answers
// with no edit here.

func newTodayCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "today",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/today"},
		Short:       "What is owed today, and who you are meeting",
		Long: `The day's queue: prospects whose next action is due, and today's meetings.

An action due LAST week and never done is in this list, marked OVERDUE — a
follow-up queue that drops what was missed is the one thing it must not do.

Closed deals are excluded: a won or lost prospect has no next action, and a
stale one left on a closed record would show up here for ever.`,
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
			day, err := c.SalesToday(ws)
			if err != nil {
				return err
			}
			return output.Render(format, day, func(w io.Writer) error {
				fmt.Fprintf(w, "%s — %d due, %d overdue, %d meeting(s)\n\n",
					day.Date, day.Counts.DueToday, day.Counts.Overdue, day.Counts.MeetingsToday)

				if len(day.DueActions) > 0 {
					fmt.Fprintln(w, "DUE")
					tw := output.Tabwriter(w)
					for _, a := range day.DueActions {
						flag := " "
						if a.Overdue {
							flag = "!"
						}
						when := a.DueLabel
						if strings.TrimSpace(when) == "" {
							when = a.Due
						}
						fmt.Fprintf(tw, "%s #%d\t%s\t%s\t%s\t%s\n",
							flag, a.Number, cmdutil.Truncate(a.Name, 24), a.ActionType, when,
							cmdutil.Truncate(a.Note, 46))
					}
					if err := tw.Flush(); err != nil {
						return err
					}
				}

				if len(day.Meetings) > 0 {
					fmt.Fprintln(w, "\nMEETINGS")
					tw := output.Tabwriter(w)
					for _, m := range day.Meetings {
						fmt.Fprintf(tw, "  #%d\t%s\t%s\t%s (#%d)\n",
							m.Number, timeOnly(m.StartsAt), cmdutil.Truncate(m.Title, 34),
							cmdutil.Truncate(m.ProspectName, 20), m.ProspectNumber)
					}
					if err := tw.Flush(); err != nil {
						return err
					}
				}

				if len(day.DueActions) == 0 && len(day.Meetings) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(nothing due, no meetings)")
				}
				return nil
			})
		},
	}
}

func newPipelineCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "pipeline",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/pipeline"},
		Short:       "Deal count and value by stage",
		Long: `Where the money is, by stage.

EVERY stage is listed, including the empty ones and in pipeline order: a funnel
that omits the stage nobody is in hides the thing worth noticing.

Values are plain decimal strings. Nothing here is stored — it is computed from
the prospects each time you ask, so it cannot go stale.`,
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
			p, err := c.SalesPipeline(ws)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "STAGE\tDEALS\tVALUE")
				for _, s := range p.Stages {
					fmt.Fprintf(tw, "%s\t%d\t%s\n", s.Stage, s.Count, money(s.Value, p.Currency))
				}
				fmt.Fprintf(tw, "\t\t\n")
				fmt.Fprintf(tw, "open\t%d\t%s\n", p.Open.Count, money(p.Open.Value, p.Currency))
				fmt.Fprintf(tw, "won\t%d\t%s\n", p.Won.Count, money(p.Won.Value, p.Currency))
				fmt.Fprintf(tw, "lost\t%d\t%s\n", p.Lost.Count, money(p.Lost.Value, p.Currency))
				return tw.Flush()
			})
		},
	}
}

func newMetricsCmd() *cobra.Command {
	var period string
	cmd := &cobra.Command{
		Use:         "metrics",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/metrics"},
		Short:       "Closed deals, new deals and activity over a period (--period 30d)",
		Long: `Closed deals, new deals and activity over a period.

--period is a shape, not a list: 30d, 12w, 6m all work. It is not a vocabulary,
so there is nothing for "bk meta" to say about it.

The win rate is BLANK rather than 0% when nothing closed. "We closed nothing"
and "we lost everything" are not the same month, and a 0% meaning the first is a
number somebody will act on.`,
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
			m, err := c.SalesMetrics(ws, period)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "period\t%d days (%s → %s)\n",
					m.PeriodDays, dateOnly(m.From), dateOnly(m.To))
				fmt.Fprintf(tw, "won\t%d · %s\n", m.Closed.Won.Count, money(m.Closed.Won.Value, m.Currency))
				fmt.Fprintf(tw, "lost\t%d · %s\n", m.Closed.Lost.Count, money(m.Closed.Lost.Value, m.Currency))
				fmt.Fprintf(tw, "win rate\t%s\n", percentOrDash(m.Closed.WinRate))
				fmt.Fprintf(tw, "average won\t%s\n", moneyPtr(m.Closed.AverageWon, m.Currency))
				fmt.Fprintf(tw, "new deals\t%d · %s\n", m.Created.Count, money(m.Created.Value, m.Currency))
				fmt.Fprintf(tw, "logged\t%d communication(s), %d meeting(s)\n",
					m.Activity.Communications, m.Activity.Meetings)
				return tw.Flush()
			})
		},
	}
	cmd.Flags().StringVar(&period, "period", "", "How far back to look: 30d, 12w, 6m (default 30d)")
	return cmd
}

// percentOrDash renders a nullable win rate. The dash is load-bearing: it says
// "nothing closed", which a 0% would misreport as "everything was lost".
func percentOrDash(p *string) string {
	if p == nil {
		return "— (nothing closed in this period)"
	}
	return *p + "%"
}

func moneyPtr(v *string, currency string) string {
	if v == nil {
		return "—"
	}
	return money(*v, currency)
}

// timeOnly keeps the HH:MM of an ISO timestamp — what a day's schedule needs.
func timeOnly(ts string) string {
	i := strings.IndexByte(ts, 'T')
	if i < 0 || len(ts) < i+6 {
		return ts
	}
	return ts[i+1 : i+6]
}
