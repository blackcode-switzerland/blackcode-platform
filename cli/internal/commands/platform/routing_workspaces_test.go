package platform

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// "WHICH WORKSPACE IS EACH APP ON?" — THE QUESTION `bk meta` COULD NOT ANSWER.
//
// The active workspace has been per app since 2026-08-10. Nothing printed more
// than one of them until 2026-08-12: `bk meta`'s `active:` line is the workspace
// of the app that ANSWERED, and no deployment can report another app's, because
// no app's Postgres role holds a grant on another app's schema.
//
// So the answer was one `bk <app> workspace list` per app — N round trips to
// read state that is entirely LOCAL, sitting in ~/.config/bk/config.json. It is
// in `routing` now (and in `bk app list`'s WORKSPACE column), which is why there
// is no `bk status` command.
//
// These tests are about the SHAPE OF THE ANSWER, not about the config accessor.
// Each one distinguishes a correct block from a plausible wrong one:
//
//   - all apps present, not just the home app  (the bug being fixed)
//   - the workspace read PER APP, not one shared slug  (the 2026-08-10 bug)
//   - an app with no workspace ABSENT from the map, and named in the human
//     output — "not chosen" is a real state and must not read as an error
//
// A test that only asserted "the map is non-empty" would pass against a block
// that reported the home app's slug for every app, which is precisely the
// failure the per-app config exists to prevent.

func cfgTwoApps() *config.Config {
	return &config.Config{
		HomeApp:    "issues",
		HomeServer: "https://issues.example.test",
		AppServers: map[string]string{
			"issues":   "https://issues.example.test",
			"sales":    "https://sales.example.test",
			"scaffold": "https://scaffold.example.test",
		},
		ActiveWorkspaces: map[string]config.ActiveWorkspace{
			"issues": {ID: 1, Slug: "acme"},
			"sales":  {ID: 4, Slug: "acme-sales"},
		},
	}
}

// The heart of it: EVERY app's workspace, and each one its own.
func TestRoutingBlockReportsEachAppsOwnWorkspace(t *testing.T) {
	got := buildRoutingBlock(cfgTwoApps()).ActiveWorkspaces

	if got["issues"] != "acme" {
		t.Errorf("issues' active workspace = %q, want \"acme\"", got["issues"])
	}
	// The discriminating assertion. A block that reported the home app's
	// workspace for everything would satisfy every other check in this file.
	if got["sales"] != "acme-sales" {
		t.Errorf("sales' active workspace = %q, want \"acme-sales\" — a block that "+
			"reports one slug for every app is the exact bug per-app workspaces "+
			"were introduced to fix", got["sales"])
	}
}

// An app with no chosen workspace is ABSENT, not present-and-empty. The two are
// different claims and only one of them is reachable.
func TestAppWithNoWorkspaceIsAbsentFromTheMap(t *testing.T) {
	got := buildRoutingBlock(cfgTwoApps()).ActiveWorkspaces

	if _, ok := got["scaffold"]; ok {
		t.Errorf("scaffold has no active workspace but appears in the map as %q — "+
			"an empty string reads as a workspace whose slug is empty", got["scaffold"])
	}
	if len(got) != 2 {
		t.Errorf("active_workspaces has %d entries, want 2 (issues, sales)", len(got))
	}
}

// A pre-2.1.0 config has one active workspace and no per-app map. It belongs to
// the HOME app and to no other — a slug resolved against one app is not a
// workspace in another.
//
// THIS TEST GOES THROUGH `config.Load()` ON PURPOSE, and the first draft did
// not: it built a `config.Config` literal and failed, because the legacy fold
// lives in `migrate()`, which only `Load` calls. A literal is not a config —
// half of what a config means is applied on the way in. Written the wrong way
// this would have "proved" that `bk meta` drops an upgrader's workspace, which
// is a false finding about a real user-visible behaviour.
func TestLegacySingleWorkspaceIsTheHomeAppsOnly(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{
		"server": "https://i.test",
		"token": "t",
		"home_app": "issues",
		"home_server": "https://i.test",
		"app_servers": {"issues": "https://i.test", "sales": "https://s.test"},
		"active_workspace_id": 7,
		"active_workspace_slug": "legacy-ws"
	}`), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}

	got := buildRoutingBlock(cfg).ActiveWorkspaces
	if got["issues"] != "legacy-ws" {
		t.Errorf("the legacy workspace did not come forward as the home app's: %q — "+
			"`bk guide platform/apps` promises an upgrader that it does", got["issues"])
	}
	if _, ok := got["sales"]; ok {
		t.Errorf("the legacy workspace leaked into sales as %q — a slug resolved "+
			"against one app is not a workspace in another", got["sales"])
	}
}

// The human output, which is what an agent reading `bk meta` without --json
// actually sees. Asserting the map alone would let the printer drift from it.
func TestPrintRoutingNamesEachAppsWorkspace(t *testing.T) {
	var buf bytes.Buffer
	printRouting(&buf, cfgTwoApps())
	out := buf.String()

	for _, want := range []string{"ws acme", "ws acme-sales"} {
		if !strings.Contains(out, want) {
			t.Errorf("routing output does not contain %q:\n%s", want, out)
		}
	}
	// "not chosen" must be visible and recoverable, not silently blank.
	if !strings.Contains(out, "bk scaffold workspace use") {
		t.Errorf("an app with no active workspace prints no way to set one:\n%s", out)
	}
}
