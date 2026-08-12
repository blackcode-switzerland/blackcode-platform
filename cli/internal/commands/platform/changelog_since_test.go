package platform

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
)

// `bk changelog --since <date>` — the half that makes an upgrade notice useful.
//
// The notice added on 2026-08-12 tells a caller their binary moved and hands
// them a date. Without a filter that accepts one, the advice is "read the whole
// changelog and work out where you came in", which is what nobody did and why
// six fixed behaviours were reported as broken.

func entries(dates ...string) []client.ChangelogEntry {
	out := make([]client.ChangelogEntry, 0, len(dates))
	for _, d := range dates {
		out = append(out, client.ChangelogEntry{Date: d, Title: "entry " + d})
	}
	return out
}

func dates(es []client.ChangelogEntry) []string {
	out := make([]string, 0, len(es))
	for _, e := range es {
		out = append(out, e.Date)
	}
	return out
}

// THE POSITIVE CASE, and the boundary. Inclusive on purpose: the date a caller
// is handed is the day they STARTED on the version they are leaving, so an
// entry from that day is one they were present for but had no reason to read.
func TestSinceKeepsTheBoundaryDay(t *testing.T) {
	got := mustSince(t, entries("2026-08-12", "2026-08-11", "2026-08-10"), "2026-08-11")
	want := []string{"2026-08-12", "2026-08-11"}
	if strings.Join(dates(got), ",") != strings.Join(want, ",") {
		t.Fatalf("kept %v, want %v — the boundary day must be INCLUDED", dates(got), want)
	}
}

// An entry with no date is KEPT. Dropping it would hide it from every filtered
// view, and "carries no date" is a property of the entry rather than evidence
// that it is old.
func TestSinceKeepsUndatedEntries(t *testing.T) {
	got := mustSince(t, entries("2026-08-12", "", "2026-08-01"), "2026-08-10")
	if len(got) != 2 {
		t.Fatalf("kept %v, want the dated-recent one AND the undated one", dates(got))
	}
}

// THE ONE THAT MATTERS FOR USABILITY. `--since 2.3.0` is the spelling everyone
// reaches for, and it cannot be honoured — entries are dated and nothing maps a
// version to a day. It must say so, not fail as an unparseable date.
func TestSinceRefusesAVersionWithAUsefulMessage(t *testing.T) {
	for _, v := range []string{"2.3.0", "v3.0.0", "2.3"} {
		_, err := entriesSince(entries("2026-08-12"), v)
		if err == nil {
			t.Fatalf("--since %s was accepted; it cannot be honoured", v)
		}
		if !strings.Contains(err.Error(), "DATE") || !strings.Contains(err.Error(), v) {
			t.Errorf("--since %s: the error does not name the problem or the value: %v", v, err)
		}
	}
}

// Nonsense gets its own, shorter message — a caller who typed a version and one
// who typed rubbish need different things said to them.
func TestSinceRefusesNonsense(t *testing.T) {
	_, err := entriesSince(entries("2026-08-12"), "last tuesday")
	if err == nil {
		t.Fatal("--since 'last tuesday' was accepted")
	}
	if !strings.Contains(err.Error(), "YYYY-MM-DD") {
		t.Errorf("the error does not name the format: %v", err)
	}
}

func mustSince(t *testing.T, es []client.ChangelogEntry, since string) []client.ChangelogEntry {
	t.Helper()
	got, err := entriesSince(es, since)
	if err != nil {
		t.Fatalf("entriesSince(%q): %v", since, err)
	}
	return got
}
