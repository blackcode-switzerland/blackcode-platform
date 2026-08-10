package appverbs

import (
	"io"
	"strings"
	"testing"
)

// Invitation tokens are base64url, so ~1 in 32 begins with `-`. Under cobra's
// normal flag parsing those tokens were unredeemable: `bk invite accept -Jx…`
// died with `unknown shorthand flag: 'J'` before RunE ever ran. Found for real
// in Phase 4 verification, fixed in Phase 5 at both ends — the server stopped
// minting them, and these two commands stopped parsing flags.
//
// Two levels are asserted, because either alone would pass while broken:
// tokenArg proves the right STRING reaches the client, and the tree test proves
// cobra hands it over at all.

func TestTokenArgReadsLeadingDashTokens(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		want    string
		wantErr string
	}{
		{"plain", []string{"abc123"}, "abc123", ""},
		{"leading dash", []string{"-Jx7QsA"}, "-Jx7QsA", ""},
		{"leading double dash", []string{"--Jx7QsA"}, "--Jx7QsA", ""},
		{"leading underscore", []string{"_Jx7QsA"}, "_Jx7QsA", ""},
		{"dash inside", []string{"ab-cd"}, "ab-cd", ""},
		// A token that happens to equal a real flag spelling is the one case we
		// cannot serve, and it is unreachable: tokens are 43 characters.
		{"verbose still honoured", []string{"-v", "-Jx7QsA"}, "-Jx7QsA", ""},
		{"verbose after token", []string{"-Jx7QsA", "--verbose"}, "-Jx7QsA", ""},
		{"no token", nil, "", "received 0"},
		{"two tokens", []string{"a", "b"}, "", "accepts 1 arg(s)"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cmd := newInviteAcceptCmd(Config{App: "probe"})
			cmd.SetOut(io.Discard)
			cmd.SetErr(io.Discard)

			got, err := tokenArg(cmd, tc.args)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("tokenArg(%q) error = %v; want one containing %q", tc.args, err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("tokenArg(%q) returned %v; want the token", tc.args, err)
			}
			if got != tc.want {
				t.Fatalf("tokenArg(%q) = %q; want %q", tc.args, got, tc.want)
			}
		})
	}
}
