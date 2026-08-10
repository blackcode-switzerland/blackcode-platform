package commands

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// The end-to-end half: a leading-dash token must survive cobra and reach RunE.
// With BK_CONFIG_DIR pointed at an empty directory the command gets as far as
// loading credentials and stops there, so ErrNotConfigured is proof that flag
// parsing was cleared — the old failure never got that far.
func TestInviteTokenSurvivesCobra(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	for _, verb := range []string{"accept", "decline"} {
		t.Run(verb, func(t *testing.T) {
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs([]string{"issues", "invite", verb, "-Jx7QsAbcdefghijklmnopqrstuvwxyz0123456789"})

			err := root.Execute()
			if err == nil {
				t.Fatalf("`bk issues invite %s <token>` unexpectedly succeeded with no credentials", verb)
			}
			if strings.Contains(err.Error(), "unknown shorthand flag") ||
				strings.Contains(err.Error(), "unknown flag") {
				t.Fatalf("`bk issues invite %s` still parses the token as a flag: %v", verb, err)
			}
			if !errors.Is(err, config.ErrNotConfigured) {
				t.Fatalf("`bk issues invite %s` failed with %v; want ErrNotConfigured, "+
					"which is how we know the token reached RunE", verb, err)
			}
		})
	}
}
