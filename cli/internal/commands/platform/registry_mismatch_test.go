package platform

import (
	"bytes"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
)

// THE STALE HOST THAT COULD NOT BE CLEARED.
//
// `bk login`'s default server was `https://bc-issues.vercel.app` until
// 2026-08-11, so everyone who logged in without `--server` pinned it. The
// "reached wins" rule in applyAppRegistry then made it PERMANENT: `bk meta`,
// the command whose whole job is to refresh the address book, re-applied the
// reached host on every run and discarded the registry's declared
// `https://issues.blackcode.ch` without a word.
//
// It surfaced as agents emitting links like
// `https://bc-issues.vercel.app/<workspace>/issue/18` — the config's base URL
// glued to a URN tail.
//
// "Reached wins" is still correct (a preview deployment or a self-hosted
// instance must keep working) so the fix is the NOTICE, not the precedence.

func metaWith(t *testing.T, currentBase, salesBase string) *client.Meta {
	t.Helper()
	return &client.Meta{Apps: map[string]client.MetaApp{
		"issues": {BaseURL: &currentBase, IsCurrent: true},
		"sales":  {BaseURL: &salesBase},
	}}
}

// Precedence is unchanged: the host that answered is the host that is used.
func TestReachedHostStillWins(t *testing.T) {
	cfg := &config.Config{}
	applyAppRegistry(cfg, metaWith(t, "https://issues.blackcode.ch", "https://sales.blackcode.ch"),
		"https://issues-git-preview.vercel.app")

	if got := cfg.AppServers["issues"]; got != "https://issues-git-preview.vercel.app" {
		t.Fatalf("issues = %q — the reached host must win, or a preview deployment "+
			"redirects itself to production", got)
	}
	// Another app has nothing better than its declared address.
	if got := cfg.AppServers["sales"]; got != "https://sales.blackcode.ch" {
		t.Errorf("sales = %q, want the declared address", got)
	}
}

// The disagreement is reported, and the notice names the DECLARED host and a
// command that switches to it.
func TestMismatchIsReportedWithARunnableFix(t *testing.T) {
	cfg := &config.Config{}
	m := applyAppRegistry(cfg, metaWith(t, "https://issues.blackcode.ch", "https://sales.blackcode.ch"),
		"https://bc-issues.vercel.app")
	if m == nil {
		t.Fatal("no mismatch reported — the stale host is applied in silence, which is " +
			"the state this whole guard exists for")
	}

	var buf bytes.Buffer
	reportMismatch(&buf, m)
	out := buf.String()
	for _, want := range []string{
		"https://bc-issues.vercel.app",                  // what you are on
		"https://issues.blackcode.ch",                   // what the platform says
		"bk login --server https://issues.blackcode.ch", // the runnable fix
	} {
		if !strings.Contains(out, want) {
			t.Errorf("the notice does not contain %q, so the caller cannot act on it:\n%s", want, out)
		}
	}
}

// AND IT MUST NOT CRY WOLF. When the reached host is the declared one — the
// normal case for every correctly-configured user — there is no notice at all.
// A notice on every run is one nobody reads.
func TestNoNoticeWhenTheHostsAgree(t *testing.T) {
	cfg := &config.Config{}
	for _, reached := range []string{
		"https://issues.blackcode.ch",
		"https://issues.blackcode.ch/", // a trailing slash is not a disagreement
		"https://Issues.Blackcode.CH",  // nor is case
	} {
		if m := applyAppRegistry(cfg, metaWith(t, "https://issues.blackcode.ch", "https://sales.blackcode.ch"), reached); m != nil {
			t.Errorf("reached %q raised a mismatch against the same host: %+v", reached, m)
		}
	}
}

// A registry with no address for the current app is not a disagreement — there
// is nothing to disagree with, and claiming one would send the user to "".
func TestNoNoticeWhenTheRegistryHasNoAddress(t *testing.T) {
	sales := "https://sales.blackcode.ch"
	meta := &client.Meta{Apps: map[string]client.MetaApp{
		"issues": {BaseURL: nil, IsCurrent: true},
		"sales":  {BaseURL: &sales},
	}}
	cfg := &config.Config{}
	if m := applyAppRegistry(cfg, meta, "https://bc-issues.vercel.app"); m != nil {
		t.Errorf("a null base_url raised a mismatch: %+v", m)
	}
	if got := cfg.AppServers["issues"]; got != "https://bc-issues.vercel.app" {
		t.Errorf("issues = %q — the reached host is all there is", got)
	}
}

// THE ONE THAT MATTERS FOR THE ORIGINAL BUG: the notice must reach STDERR on a
// run that changes NOTHING.
//
// refreshRegistry returns early when the config is unchanged, and a stale
// address is by definition stable — it was already applied. A notice wired
// after that early return fires once, on the login that created the problem,
// and never again on the `bk meta` runs where the user is trying to fix it.
//
// THIS TEST DRIVES refreshRegistry, NOT applyAppRegistry, AND THAT IS THE WHOLE
// POINT. The first version called applyAppRegistry twice and asserted it still
// returned a mismatch — which it always does, because the early return is not
// in it. Moving `reportMismatch` below the early return left that version
// GREEN: it was inert against the single mistake it was written to catch, in
// the shape its own comment describes. Found by making that move and watching
// nothing go red.
func TestNoticeReachesStderrOnASecondUnchangedRun(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir()) // config.Save writes; never touch the real one
	meta := metaWith(t, "https://issues.blackcode.ch", "https://sales.blackcode.ch")
	cfg := &config.Config{}

	run := func() string {
		cmd := &cobra.Command{}
		var errBuf bytes.Buffer
		cmd.SetErr(&errBuf)
		refreshRegistry(cmd, cfg, meta, "https://bc-issues.vercel.app")
		return errBuf.String()
	}

	first := run()
	if !strings.Contains(first, "issues.blackcode.ch") {
		t.Fatalf("the login that pins the stale host said nothing about it:\n%s", first)
	}
	before := cfg.AppServers["issues"]

	second := run()
	if cfg.AppServers["issues"] != before {
		t.Fatalf("the address changed between identical runs (%q → %q)", before, cfg.AppServers["issues"])
	}
	if !strings.Contains(second, "issues.blackcode.ch") {
		t.Fatalf("the SECOND run — the `bk meta` a user runs to fix this — said nothing. "+
			"A stale host is stable, so a notice that only fires on CHANGE never fires "+
			"again:\n%q", second)
	}
}
