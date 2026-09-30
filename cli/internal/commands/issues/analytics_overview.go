package issues

// `bk issues analytics --view overview`: the flag rules and the terminal report.
//
// The data is the ordinary analytics payload plus its `overview` block
// (apps/issues/lib/db/queries/overview.ts owns the counting rules). Nothing here
// recomputes a figure: leaders are marked exactly as the server's `leaders` map
// says, so a tie marks every tied member and a metric nobody leads marks no one.

import (
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// rangeDays maps a --range value to its length in days; 0 means "all time".
var rangeDays = map[string]int{"7d": 7, "30d": 30, "90d": 90, "all": 0}

// resolveRange turns --range into the --from/--to the route understands. It is
// client-side sugar only: the server never sees the word. "all" sends neither
// bound (the overview reads that as all time; other views as their default).
func resolveRange(rng, from, to string, now time.Time) (string, string, error) {
	if rng == "" {
		return from, to, nil
	}
	days, ok := rangeDays[rng]
	if !ok {
		return "", "", cmdutil.Usagef("invalid --range %q — use 7d, 30d, 90d or all", rng)
	}
	if from != "" || to != "" {
		return "", "", cmdutil.Usagef("--range cannot be combined with --from/--to — use one or the other")
	}
	if days == 0 {
		return "", "", nil
	}
	now = now.UTC()
	return now.AddDate(0, 0, -days).Format(time.RFC3339), now.Format(time.RFC3339), nil
}

// checkOverviewFlags rejects flags the overview ignores. Silently dropping a
// filter would hand back an unfiltered report that reads as a filtered one.
func checkOverviewFlags(id int, interval string, hasFilters bool) error {
	var bad []string
	if id > 0 {
		bad = append(bad, "--id")
	}
	if interval != "" {
		bad = append(bad, "--interval")
	}
	if hasFilters {
		bad = append(bad, "--status/--priority/--label/--assignee")
	}
	if len(bad) == 0 {
		return nil
	}
	return cmdutil.Usagef("--view overview does not take %s — it covers the whole workspace and picks its own buckets; narrow it with --range or --from/--to, or drop --view overview", strings.Join(bad, ", "))
}

// leaderMark is "*" when userID is among the server's leaders for the metric.
func leaderMark(o *client.AnalyticsOverview, period, metric string, userID int) string {
	if l, ok := o.Leaderboard.Leaders[period][metric]; ok {
		for _, id := range l.UserIDs {
			if id == userID {
				return "*"
			}
		}
	}
	return ""
}

func personLabel(p *client.OverviewPerson) string {
	if p == nil {
		return "—"
	}
	return cmdutil.DerefOr(p.Name, p.Email)
}

func fmtTrend(t client.AnalyticsTrend) string {
	if t.Pct == nil {
		return ""
	}
	return fmt.Sprintf("%+.1f%% vs start of range", *t.Pct)
}

func periodLabel(o *client.AnalyticsOverview, key string) string {
	for _, p := range o.Leaderboard.Periods {
		if p.Key == key {
			return p.Label
		}
	}
	return key
}

func renderOverview(w io.Writer, p *client.AnalyticsPayload) error {
	if p.Message == "no_active_workspace" {
		fmt.Fprintln(w, "No active workspace. Run `bk issues workspace use <slug>` or pass --ws <slug|id>.")
		return nil
	}
	o := p.Overview
	if o == nil {
		return fmt.Errorf("the server returned no overview block — is it older than this binary? run `bk version`")
	}

	fmt.Fprintf(w, "Overview: %s\n", p.Scope.Label)
	fmt.Fprintf(w, "Range: %s  ·  %s → %s  ·  bucket: %s\n\n", periodLabel(o, "range"),
		cmdutil.DerefOr(o.Range.From, "start"), o.Range.To, o.Range.Interval)

	s := p.Summary
	tw := output.Tabwriter(w)
	fmt.Fprintln(tw, "KPI\tVALUE\tCHANGE")
	fmt.Fprintf(tw, "Total issues\t%d\t%s\n", s.TotalIssues, fmtTrend(o.KPITrends.Total))
	fmt.Fprintf(tw, "Open\t%d\t%s\n", s.Open+s.InProgress, fmtTrend(o.KPITrends.Open))
	fmt.Fprintf(tw, "Completed (range)\t%d\t\n", s.CompletedInPeriod)
	fmt.Fprintf(tw, "Overdue\t%d\t%s\n", s.Overdue, fmtTrend(o.KPITrends.Overdue))
	fmt.Fprintf(tw, "Unassigned\t%d\t%s\n", s.Unassigned, fmtTrend(o.KPITrends.Unassigned))
	fmt.Fprintf(tw, "Completion rate\t%.1f%%\t%s\n", s.CompletionRate, fmtTrend(o.KPITrends.CompletionRate))
	fmt.Fprintf(tw, "Avg cycle time\t%s\t\n", fmtCycle(s.AvgCycleTimeHours))
	if err := tw.Flush(); err != nil {
		return err
	}

	fmt.Fprintf(w, "\nLeaderboard — %s (ranked by completed; * = leads that metric)\n", periodLabel(o, "range"))
	if len(o.Leaderboard.Members) == 0 {
		fmt.Fprintln(w, "  No members.")
	} else {
		lt := output.Tabwriter(w)
		fmt.Fprintln(lt, "  #\tMEMBER\tCREATED\tCOMPLETED\tOPEN\tAVG CYCLE\tCOMMENTS\tACTIVITY")
		for i, m := range o.Leaderboard.Members {
			st := m.Periods["range"]
			id := m.UserID
			fmt.Fprintf(lt, "  %d\t%s\t%d%s\t%d%s\t%d\t%s%s\t%d%s\t%d%s\n",
				i+1, personLabel(&m.OverviewPerson),
				st.Created, leaderMark(o, "range", "created", id),
				st.Completed, leaderMark(o, "range", "completed", id),
				m.OpenAssigned,
				fmtCycle(st.AvgCycleTimeHours), leaderMark(o, "range", "fastest_cycle", id),
				st.Comments, leaderMark(o, "range", "comments", id),
				st.Activity, leaderMark(o, "range", "activity", id))
		}
		if err := lt.Flush(); err != nil {
			return err
		}

		fmt.Fprintln(w, "\nCreated/completed by period (* = leads completed)")
		var keys []string
		for _, per := range o.Leaderboard.Periods {
			if per.Key != "range" {
				keys = append(keys, per.Key)
			}
		}
		mt := output.Tabwriter(w)
		hdr := "  MEMBER"
		for _, k := range keys {
			hdr += "\t" + strings.ToUpper(periodLabel(o, k))
		}
		fmt.Fprintln(mt, hdr)
		for _, m := range o.Leaderboard.Members {
			row := "  " + personLabel(&m.OverviewPerson)
			for _, k := range keys {
				st := m.Periods[k]
				row += fmt.Sprintf("\t%d/%d%s", st.Created, st.Completed, leaderMark(o, k, "completed", m.UserID))
			}
			fmt.Fprintln(mt, row)
		}
		if err := mt.Flush(); err != nil {
			return err
		}
	}

	fmt.Fprintln(w, "\nProject health")
	if len(o.Projects) == 0 {
		fmt.Fprintln(w, "  No active projects.")
	} else {
		pt := output.Tabwriter(w)
		fmt.Fprintln(pt, "  #\tPROJECT\tHEALTH\tPROGRESS\tDONE/TOTAL\tOPEN\tDUE")
		for _, pr := range o.Projects {
			seq := "—"
			if pr.Seq != nil {
				seq = fmt.Sprintf("%d", *pr.Seq)
			}
			fmt.Fprintf(pt, "  %s\t%s\t%s\t%.0f%%\t%d/%d\t%d\t%s\n", seq, pr.Name,
				cmdutil.DerefOr(pr.Health, "—"), pr.ProgressPct, pr.Done, pr.Total, pr.Open,
				cmdutil.DerefOr(pr.DueDate, "—"))
		}
		if err := pt.Flush(); err != nil {
			return err
		}
	}

	fmt.Fprintln(w, "\nAttention")
	groups := []struct {
		label string
		list  client.OverviewAttentionList
	}{
		{"Overdue", o.Attention.Overdue},
		{"Urgent", o.Attention.Urgent},
		{fmt.Sprintf("Open > %d days", o.Attention.OldOpenDays), o.Attention.OldOpen},
		{"Unassigned", o.Attention.Unassigned},
	}
	for _, g := range groups {
		fmt.Fprintf(w, "  %s: %d\n", g.label, g.list.Total)
		for _, it := range g.list.Items {
			seq := "—"
			if it.Seq != nil {
				seq = fmt.Sprintf("#%d", *it.Seq)
			}
			fmt.Fprintf(w, "    %s %s\n", seq, it.Title)
		}
		if g.list.Total > len(g.list.Items) {
			fmt.Fprintf(w, "    … and %d more\n", g.list.Total-len(g.list.Items))
		}
	}

	fmt.Fprintln(w, "\nWorkload (open issues per assignee)")
	if len(o.Workload.Members) == 0 {
		fmt.Fprintf(w, "  No assigned open issues.  Unassigned: %d\n", o.Workload.Unassigned)
	} else {
		wt := output.Tabwriter(w)
		hdr := "  MEMBER\tTOTAL"
		for _, st := range o.Workload.Statuses {
			hdr += "\t" + strings.ToUpper(st)
		}
		fmt.Fprintln(wt, hdr)
		for _, m := range o.Workload.Members {
			row := fmt.Sprintf("  %s\t%d", personLabel(&m.OverviewPerson), m.Total)
			for _, st := range o.Workload.Statuses {
				row += fmt.Sprintf("\t%d", m.ByStatus[st])
			}
			fmt.Fprintln(wt, row)
		}
		if err := wt.Flush(); err != nil {
			return err
		}
		fmt.Fprintf(w, "  Unassigned: %d\n", o.Workload.Unassigned)
	}

	fmt.Fprintln(w, "\nRecent activity")
	if len(o.RecentActivity) == 0 {
		fmt.Fprintln(w, "  Nothing yet.")
	}
	for _, a := range o.RecentActivity {
		subject := a.EntityType
		if a.EntitySeq != nil {
			subject += fmt.Sprintf(" #%d", *a.EntitySeq)
		}
		if a.EntityTitle != nil && *a.EntityTitle != "" {
			subject += " " + *a.EntityTitle
		}
		action := a.Action
		if a.To != nil {
			action += fmt.Sprintf(" → %v", a.To)
		}
		fmt.Fprintf(w, "  %s  %s  %s  %s\n", a.OccurredAt, personLabel(a.Actor), action, subject)
	}
	return nil
}
