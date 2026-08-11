package commands

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

// `bk login --token` is a SWITCH, and every wrong guess at it must say so.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------------
// A real first run on Windows hit four failures before one successful login
// (Todo/issues-app-feedback.md item 5). Two of them are this flag: `--token
// <value>` and `--token=<value>` are the natural readings of a flag whose name
// is a noun, and both failed describing something else —
//
//	--token=<v>   invalid argument … strconv.ParseBool: parsing "bk_live_…"
//	--token <v>   Server: …↵ read token: EOF
//
// — a Go stdlib function and an I/O condition, neither of which is the caller's
// mistake and neither of which names the working line.
//
// The flag stays a switch: the token is read from stdin so it never enters a
// shell history, a process list, or a CI log. That is worth keeping and worth
// SAYING, which is what these assertions pin.
//
// ---------------------------------------------------------------------------
// WHAT IS ASSERTED, AND WHY IT IS NOT JUST "IT ERRORS"
// ---------------------------------------------------------------------------
// "these three spellings fail" was already true before the fix — that is the
// bug report. So failing is not the property. Each case asserts:
//
//   - the message contains the RUNNABLE recovery, `| bk login --token`, and
//   - the error carries the usage exit code (2), not the generic 1, because
//     cmd/bk/main.go's documented table promises 2 for arg/flag mistakes and a
//     hand-written check phrased as a sentence silently fell through to 1.
//
// The `--token=<value>` case is deliberately NOT here: cobra rejects it inside
// its own flag parser, so the recovery lives in cmd/bk/main.go's hintFor() and
// is asserted in TestTokenValueHintNamesTheStdinForm below against that
// function's real input.
func TestLoginTokenMisusesNameTheWorkingInvocation(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	cases := []struct {
		name string
		args []string
	}{
		{"value as a positional after --token", []string{"login", "--token", "bk_live_ABCDEF0123456789"}},
		{"a token-shaped positional with no --token", []string{"login", "bk_live_ABCDEF0123456789"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root := NewRoot()
			root.SetOut(io.Discard)
			root.SetErr(io.Discard)
			root.SetArgs(tc.args)

			err := root.Execute()
			if err == nil {
				t.Fatalf("`bk %s` unexpectedly succeeded", strings.Join(tc.args, " "))
			}
			if !strings.Contains(err.Error(), "| bk login") ||
				!strings.Contains(err.Error(), "--token") {
				t.Fatalf("error does not name the working invocation.\ngot: %v", err)
			}
			// The exit code is the contract, and it is the half that regressed
			// silently: a readable message matches none of main.go's string
			// tests for "usage".
			var use *cmdutil.UsageError
			if !errors.As(err, &use) {
				t.Fatalf("error is not a UsageError, so `bk` will exit 1 (runtime fault) "+
					"instead of the documented 2 for a flag mistake.\ngot %T: %v", err, err)
			}
		})
	}
}

// The premise of the file: `bk login` with no arguments at all must NOT be
// caught by the Args hook above.
//
// Without this, every assertion in this file is satisfied by an Args hook that
// rejects everything — including the browser login, which is the default and
// most common way anyone runs this command. CLAUDE.md finding #21: a guard
// built only from refusals cannot tell a working check from a broken subject.
//
// It reaches an unconfigured-credentials error, which is proof it got PAST arg
// validation and into RunE — the same technique as invite_token_cobra_test.go.
func TestLoginWithNoArgsIsNotRejected(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	root := NewRoot()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	// --server so the test never resolves the real default host, and --token so
	// it never tries to open a browser. Stdin under `go test` is not a terminal
	// and is empty, so this lands on the no-token-on-stdin path — past Args.
	root.SetArgs([]string{"login", "--server", "http://127.0.0.1:1", "--token"})

	err := root.Execute()
	if err == nil {
		t.Fatal("expected the empty-stdin error; got success")
	}
	if strings.Contains(err.Error(), "unexpected argument") ||
		strings.Contains(err.Error(), "takes no value") {
		t.Fatalf("arg validation rejected a legitimate invocation: %v", err)
	}
	// And that path names the fix too, rather than reporting `read token: EOF`.
	if !strings.Contains(err.Error(), "| bk login") {
		t.Fatalf("empty-stdin error does not name the working invocation: %v", err)
	}
}
