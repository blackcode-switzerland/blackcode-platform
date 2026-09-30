package issues

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

func f64(v float64) *float64 { return &v }
func sp(s string) *string    { return &s }

func stats(created, completed, comments, activity int, cycle *float64) client.OverviewPeriodStats {
	return client.OverviewPeriodStats{Created: created, Completed: completed, Comments: comments, Activity: activity, AvgCycleTimeHours: cycle}
}

func overviewFixture() *client.AnalyticsPayload {
	p := &client.AnalyticsPayload{}
	p.Scope.Label = "Acme"
	o := &client.AnalyticsOverview{}
	o.Range.To = "2026-09-30T00:00:00Z"
	o.Range.Interval = "day"
	for _, k := range []struct{ key, label string }{
		{"range", "Last 30 days"}, {"this_week", "This week"}, {"all_time", "All time"},
	} {
		o.Leaderboard.Periods = append(o.Leaderboard.Periods, struct {
			Key   string  `json:"key"`
			Label string  `json:"label"`
			From  *string `json:"from"`
			To    *string `json:"to"`
		}{Key: k.key, Label: k.label})
	}
	type member = struct {
		client.OverviewPerson
		Role         string                                `json:"role"`
		OpenAssigned int                                   `json:"open_assigned"`
		Periods      map[string]client.OverviewPeriodStats `json:"periods"`
		Spark        []int                                 `json:"spark"`
	}
	mk := func(id int, name string, rng, wk, all client.OverviewPeriodStats) member {
		return member{
			OverviewPerson: client.OverviewPerson{UserID: id, Name: sp(name), Email: name + "@x.ch"},
			Periods:        map[string]client.OverviewPeriodStats{"range": rng, "this_week": wk, "all_time": all},
		}
	}
	// Ana and Bo tie on completed (5); Cy has none and no cycle time.
	o.Leaderboard.Members = []member{
		mk(1, "Ana", stats(3, 5, 2, 10, f64(10)), stats(1, 2, 0, 3, nil), stats(9, 20, 4, 30, nil)),
		mk(2, "Bo", stats(7, 5, 2, 8, f64(30)), stats(0, 1, 0, 1, nil), stats(9, 12, 4, 30, nil)),
		mk(3, "Cy", stats(0, 0, 0, 1, nil), stats(0, 0, 0, 0, nil), stats(0, 0, 0, 1, nil)),
	}
	o.Leaderboard.Leaders = map[string]map[string]client.OverviewLeader{
		"range": {
			"completed":     {UserIDs: []int{1, 2}, Value: 5},
			"created":       {UserIDs: []int{2}, Value: 7},
			"fastest_cycle": {UserIDs: []int{1}, Value: 10},
			"comments":      {UserIDs: []int{1, 2}, Value: 2},
			"activity":      {UserIDs: []int{1}, Value: 10},
		},
		"this_week": {"completed": {UserIDs: []int{1}, Value: 2}},
	}
	p.Overview = o
	return p
}

func row(out, prefix string) string {
	for _, l := range strings.Split(out, "\n") {
		if strings.HasPrefix(strings.TrimSpace(l), prefix) {
			return l
		}
	}
	return ""
}

func TestRenderOverviewLeaderMarks(t *testing.T) {
	var buf bytes.Buffer
	if err := renderOverview(&buf, overviewFixture()); err != nil {
		t.Fatal(err)
	}
	out := buf.String()

	tests := []struct {
		name, prefix  string
		want, notWant []string
	}{
		// tie on completed: BOTH starred; Bo leads created only; Ana leads cycle+activity.
		{"ana", "1  Ana", []string{"3  ", "5*", "10h*", "2*", "10*"}, []string{"3*"}},
		{"bo", "2  Bo", []string{"7*", "5*", "30h", "2*"}, []string{"30h*", "8*"}},
		// zero completions / nil cycle: no star anywhere, cycle shows a dash.
		{"cy", "3  Cy", []string{"—"}, []string{"*"}},
	}
	for _, tc := range tests {
		l := row(out, tc.prefix)
		if l == "" {
			t.Fatalf("%s: row not found in:\n%s", tc.name, out)
		}
		for _, w := range tc.want {
			if !strings.Contains(l, w) {
				t.Errorf("%s: %q missing %q", tc.name, l, w)
			}
		}
		for _, n := range tc.notWant {
			if strings.Contains(l, n) {
				t.Errorf("%s: %q must not contain %q", tc.name, l, n)
			}
		}
	}
	// Period matrix: this_week completed leader is Ana only.
	if l := row(out, "Ana  "); !strings.Contains(l, "1/2*") || !strings.Contains(l, "9/20") {
		t.Errorf("matrix row for Ana wrong: %q", l)
	}
	if l := row(out, "Bo  "); !strings.Contains(l, "0/1") || strings.Contains(l, "0/1*") {
		t.Errorf("matrix row for Bo wrong: %q", l)
	}
}

func TestRenderOverviewEmptyWorkspace(t *testing.T) {
	p := &client.AnalyticsPayload{}
	p.Overview = &client.AnalyticsOverview{}
	var buf bytes.Buffer
	if err := renderOverview(&buf, p); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, w := range []string{"No members.", "No active projects.", "Overdue: 0", "Nothing yet.", "No assigned open issues."} {
		if !strings.Contains(out, w) {
			t.Errorf("empty overview missing %q:\n%s", w, out)
		}
	}
}

func TestRenderOverviewMissingBlockIsAnError(t *testing.T) {
	if err := renderOverview(&bytes.Buffer{}, &client.AnalyticsPayload{}); err == nil {
		t.Fatal("expected an error when the server sent no overview block")
	}
}

func TestResolveRange(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		rng, from, to string
		wantFrom      string
		wantTo        string
		usageErr      bool
	}{
		{"", "2026-01-01", "", "2026-01-01", "", false},
		{"30d", "", "", "2026-08-31T12:00:00Z", "2026-09-30T12:00:00Z", false},
		{"7d", "", "", "2026-09-23T12:00:00Z", "2026-09-30T12:00:00Z", false},
		{"all", "", "", "", "", false},
		{"14d", "", "", "", "", true},
		{"30d", "2026-01-01", "", "", "", true},
		{"30d", "", "2026-01-01", "", "", true},
	}
	for _, tc := range tests {
		f, to, err := resolveRange(tc.rng, tc.from, tc.to, now)
		var ue *cmdutil.UsageError
		if tc.usageErr != errors.As(err, &ue) {
			t.Errorf("%+v: err=%v, want usage error=%v", tc, err, tc.usageErr)
			continue
		}
		if err == nil && (f != tc.wantFrom || to != tc.wantTo) {
			t.Errorf("%+v: got %q..%q", tc, f, to)
		}
	}
}

func TestCheckOverviewFlags(t *testing.T) {
	if err := checkOverviewFlags(0, "", false); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		id       int
		interval string
		filters  bool
		mention  string
	}{{5, "", false, "--id"}, {0, "week", false, "--interval"}, {0, "", true, "--status"}} {
		err := checkOverviewFlags(c.id, c.interval, c.filters)
		var ue *cmdutil.UsageError
		if !errors.As(err, &ue) || !strings.Contains(err.Error(), c.mention) {
			t.Errorf("%+v: got %v", c, err)
		}
	}
}
