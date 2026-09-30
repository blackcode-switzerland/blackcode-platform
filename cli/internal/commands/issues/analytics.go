package issues

// Workspace analytics for the issues app.
//
// Split out of activity.go in Phase 5. `bk activity` reads platform.events and
// stays a bare platform verb (Phase 6 federates it across apps); analytics
// computes throughput and distributions over issue statuses, priorities,
// labels and assignees, which is this app's vocabulary and nobody else's.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newAnalyticsCmd() *cobra.Command {
	var (
		view, ws, from, to, interval, rng string
		id                                int
		status, assignee                  []string
		priority, label                   []int
	)
	cmd := &cobra.Command{
		Use:         "analytics",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/analytics"},
		Short:       "Show workspace analytics (summary, throughput, distributions)",
		Long: `Show analytics for the active workspace (or --ws <slug|id>).

Mirrors the web dashboard: pick a scope with --view (workspace|project|
task|member|overview) and --id, narrow the window with --from/--to/--interval,
and slice with the --status/--priority/--label/--assignee filters. The default
output is a readable summary; --json / --yaml emit the full payload.

--view overview is the workspace overview page: KPIs with change vs the start
of the range, a member leaderboard, project health, attention lists (overdue,
urgent, old open, unassigned), workload and recent activity. It takes only the
window — --id, --interval and the filters are rejected, not ignored.

--range 7d|30d|90d|all is shorthand for --from/--to (now minus N days .. now,
UTC). It works with every view and cannot be combined with --from/--to.`,
		// `bk analytics …` until 2026-08-11 — the bare spelling was removed in
		// the 1.10.0 rename (`deprecations.go`'s `analytics` row) and every one
		// of these four exited 2. This group is `issues`-only, so the app name
		// is a literal here rather than interpolated.
		Example: `  bk issues analytics
  bk issues analytics --view project --id 12 --from 2026-01-01 --interval week
  bk issues analytics --status todo,in_progress --priority 1 --priority 2
  bk issues analytics --view member --id 5 --json
  bk issues analytics --view overview --range 30d
  bk issues analytics --range 7d --json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}

			rFrom, rTo, err := resolveRange(rng, from, to, time.Now())
			if err != nil {
				return err
			}
			overview := view == "overview"
			if overview {
				if err := checkOverviewFlags(id, interval,
					len(status)+len(priority)+len(label)+len(assignee) > 0); err != nil {
					return err
				}
			}

			q := url.Values{}
			if view != "" {
				q.Set("view", view)
			}
			if id > 0 {
				q.Set("id", strconv.Itoa(id))
			}
			if ws != "" {
				q.Set("ws", ws)
			}
			if rFrom != "" {
				q.Set("from", rFrom)
			}
			if rTo != "" {
				q.Set("to", rTo)
			}
			if interval != "" {
				q.Set("interval", interval)
			}
			for _, s := range status {
				q.Add("status", s)
			}
			for _, p := range priority {
				q.Add("priority", strconv.Itoa(p))
			}
			for _, l := range label {
				q.Add("label", strconv.Itoa(l))
			}
			for _, a := range assignee {
				q.Add("assignee", a)
			}

			raw, err := c.AnalyticsRaw(q)
			if err != nil {
				return err
			}

			// Full payload for json/yaml fidelity; typed view for the table.
			var generic any
			if err := json.Unmarshal(raw, &generic); err != nil {
				return fmt.Errorf("decode analytics: %w", err)
			}
			var p client.AnalyticsPayload
			if err := json.Unmarshal(raw, &p); err != nil {
				return fmt.Errorf("decode analytics: %w", err)
			}

			return output.Render(format, generic, func(w io.Writer) error {
				if overview {
					return renderOverview(w, &p)
				}
				return renderAnalyticsSummary(w, &p)
			})
		},
	}
	cmd.Flags().StringVar(&view, "view", "", "Scope: workspace (default) | project | task | member | overview")
	cmd.Flags().IntVar(&id, "id", 0, "Target id (required for project/task/member views)")
	cmd.Flags().StringVar(&ws, "ws", "", "Workspace slug or id (defaults to the active workspace)")
	cmd.Flags().StringVar(&from, "from", "", "Window start (YYYY-MM-DD or ISO timestamp)")
	cmd.Flags().StringVar(&to, "to", "", "Window end (YYYY-MM-DD or ISO timestamp)")
	cmd.Flags().StringVar(&rng, "range", "", "Shorthand for --from/--to: 7d | 30d | 90d | all (any view; not with --from/--to)")
	cmd.Flags().StringVar(&interval, "interval", "", "Time-series bucket: day (default) | week")
	cmd.Flags().StringSliceVar(&status, "status", nil, "Filter by status (repeatable or comma-separated)")
	cmd.Flags().IntSliceVar(&priority, "priority", nil, "Filter by priority 1-5 (repeatable)")
	cmd.Flags().IntSliceVar(&label, "label", nil, "Filter by label id (repeatable)")
	cmd.Flags().StringSliceVar(&assignee, "assignee", nil, "Filter by assignee user id (repeatable)")
	return cmd
}

var analyticsPriorityLabels = map[int]string{1: "Urgent", 2: "High", 3: "Medium", 4: "Low", 5: "None"}

func fmtCycle(h *float64) string {
	if h == nil {
		return "—"
	}
	if *h < 48 {
		return fmt.Sprintf("%.0fh", *h)
	}
	return fmt.Sprintf("%.1fd", *h/24)
}

func renderAnalyticsSummary(w io.Writer, p *client.AnalyticsPayload) error {
	if p.Message == "no_active_workspace" {
		fmt.Fprintln(w, "No active workspace. Run `bk issues workspace use <slug>` or pass --ws <slug|id>.")
		return nil
	}

	period := "all time"
	if p.Period.From != nil {
		period = *p.Period.From
		if p.Period.To != nil {
			period += " → " + *p.Period.To
		}
	}
	fmt.Fprintf(w, "%s: %s\n", p.Scope.Type, p.Scope.Label)
	fmt.Fprintf(w, "Period: %s  ·  bucket: %s\n\n", period, p.Period.Interval)

	s := p.Summary
	tw := output.Tabwriter(w)
	fmt.Fprintln(tw, "METRIC\tVALUE")
	fmt.Fprintf(tw, "Total issues\t%d\n", s.TotalIssues)
	fmt.Fprintf(tw, "Open (backlog+todo+wip)\t%d\n", s.Open+s.InProgress)
	fmt.Fprintf(tw, "In progress\t%d\n", s.InProgress)
	fmt.Fprintf(tw, "Done\t%d\n", s.Done)
	fmt.Fprintf(tw, "Created (period)\t%d\n", s.CreatedInPeriod)
	fmt.Fprintf(tw, "Completed (period)\t%d\n", s.CompletedInPeriod)
	fmt.Fprintf(tw, "Completion rate\t%.1f%%\n", s.CompletionRate)
	fmt.Fprintf(tw, "Avg cycle time\t%s\n", fmtCycle(s.AvgCycleTimeHours))
	fmt.Fprintf(tw, "Median cycle time\t%s\n", fmtCycle(s.MedianCycleTimeHours))
	fmt.Fprintf(tw, "Overdue\t%d\n", s.Overdue)
	fmt.Fprintf(tw, "Unassigned\t%d\n", s.Unassigned)
	fmt.Fprintf(tw, "Active members\t%d of %d\n", s.ActiveMembers, s.TotalMembers)
	if err := tw.Flush(); err != nil {
		return err
	}

	if len(p.ByStatus) > 0 {
		fmt.Fprintln(w, "\nBy status:")
		st := output.Tabwriter(w)
		for _, r := range p.ByStatus {
			fmt.Fprintf(st, "  %s\t%d\n", r.Status, r.Count)
		}
		if err := st.Flush(); err != nil {
			return err
		}
	}

	if len(p.ByPriority) > 0 {
		fmt.Fprintln(w, "\nBy priority:")
		pt := output.Tabwriter(w)
		for _, r := range p.ByPriority {
			lbl := analyticsPriorityLabels[r.Priority]
			if lbl == "" {
				lbl = strconv.Itoa(r.Priority)
			}
			fmt.Fprintf(pt, "  %s\t%d\n", lbl, r.Count)
		}
		if err := pt.Flush(); err != nil {
			return err
		}
	}

	if len(p.ByAssignee) > 0 {
		fmt.Fprintln(w, "\nWorkload by assignee:")
		at := output.Tabwriter(w)
		fmt.Fprintln(at, "  MEMBER\tOPEN\tDONE")
		for _, a := range p.ByAssignee {
			fmt.Fprintf(at, "  %s\t%d\t%d\n", cmdutil.DerefOr(a.Name, a.Email), a.Open, a.Done)
		}
		if err := at.Flush(); err != nil {
			return err
		}
	}
	return nil
}
