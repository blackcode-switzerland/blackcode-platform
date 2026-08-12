package issues

import "testing"

// parseIssueIDs backs `task attach|detach <task> <issue…>`.
//
// The DEDUP is the case worth pinning. `task attach 7 12 12` is a plausible
// typo, and without dedup the second #12 is a second PATCH: the first one
// attaches, the second sees the issue already in task 7 and — because
// "already there" is deliberately not an error — passes. Harmless today, but
// it makes the printed line count disagree with the number of issues moved,
// and that line count is the only record of what an irreversible-ish bulk
// command actually did.
//
// The rest of the surface (the already-in-another-task refusal, --force, and
// batch atomicity) needs a server and is covered end to end against a running
// dev server rather than here — see report-phase-3.md.
func TestParseIssueIDs(t *testing.T) {
	tests := []struct {
		name    string
		in      []string
		want    []int
		wantErr bool
	}{
		{name: "plain", in: []string{"12", "13"}, want: []int{12, 13}},
		{name: "hash prefix, as every other issue arg accepts", in: []string{"#12", "13"}, want: []int{12, 13}},
		{name: "whitespace", in: []string{" 12 ", "#13"}, want: []int{12, 13}},
		{name: "dedup preserves first-seen order", in: []string{"13", "12", "13"}, want: []int{13, 12}},
		{name: "not a number", in: []string{"twelve"}, wantErr: true},
		{name: "empty string", in: []string{""}, wantErr: true},
		// Cobra's MinimumNArgs(2) makes this unreachable from the CLI, but a
		// helper that returned an empty slice would let a caller "succeed" at
		// attaching nothing.
		{name: "no ids at all", in: nil, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseIssueIDs(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("parseIssueIDs(%q) = %v, want an error", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseIssueIDs(%q) errored: %v", tc.in, err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("parseIssueIDs(%q) = %v, want %v", tc.in, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("parseIssueIDs(%q) = %v, want %v", tc.in, got, tc.want)
				}
			}
		})
	}
}
