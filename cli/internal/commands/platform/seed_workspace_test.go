package platform

import (
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// A FRESH LOGIN MUST BE ABLE TO RUN AN APP COMMAND.
//
// The active workspace is per app — two apps' workspace tables have overlapping
// ids, so one shared field meant `bk sales workspace use x` retargeted
// `bk issues …`. Nothing seeded it, so after `bk login` every
// `bk sales prospect list` failed with "no active workspace for the sales app"
// until the caller ran a command nothing had told them about, for a value the
// server had already computed and published in `/api/meta`.

func metaWithActive(active *client.MetaActiveWorkspace) *client.Meta {
	base := "https://sales.blackcode.ch"
	other := "https://issues.blackcode.ch"
	return &client.Meta{
		Apps: map[string]client.MetaApp{
			"sales":  {BaseURL: &base, IsCurrent: true},
			"issues": {BaseURL: &other},
		},
		ActiveWorkspace: active,
	}
}

// THE POSITIVE CASE FIRST: an empty config is filled from the server.
func TestActiveWorkspaceIsSeededWhenAbsent(t *testing.T) {
	cfg := &config.Config{}
	applyAppRegistry(cfg, metaWithActive(&client.MetaActiveWorkspace{ID: 7, Slug: "acme"}),
		"https://sales.blackcode.ch")

	got := cfg.ActiveWorkspaceFor("sales")
	if got.Slug != "acme" || got.ID != 7 {
		t.Fatalf("sales active workspace = %+v, want {7 acme} — a fresh login still "+
			"cannot run `bk sales prospect list`", got)
	}
	// ...and ONLY for the app that answered. `/api/meta` reports one
	// active_workspace, the current app's; attributing it to another app is the
	// cross-app mixup the per-app store exists to prevent.
	if other := cfg.ActiveWorkspaceFor("issues"); other.Slug != "" || other.ID > 0 {
		t.Errorf("the issues app was given %+v from a SALES meta response", other)
	}
}

// THE ONE THAT MATTERS: a deliberate choice outranks the server's default.
//
// `bk meta` runs this on every invocation. Without the guard, a person who ran
// `bk sales workspace use b` is silently moved back to the server's default by
// the next unrelated `bk meta` — and every command after it writes to a
// workspace they did not choose, which is the failure the whole per-app store
// exists to prevent.
func TestASeededWorkspaceNeverOverwritesAChoice(t *testing.T) {
	cfg := &config.Config{}
	cfg.SetActiveWorkspaceFor("sales", config.ActiveWorkspace{ID: 99, Slug: "chosen-by-hand"})

	applyAppRegistry(cfg, metaWithActive(&client.MetaActiveWorkspace{ID: 7, Slug: "server-default"}),
		"https://sales.blackcode.ch")

	got := cfg.ActiveWorkspaceFor("sales")
	if got.Slug != "chosen-by-hand" || got.ID != 99 {
		t.Fatalf("`bk meta` moved the active workspace to %+v — a decision was "+
			"overwritten by a default", got)
	}
}

// A server with no active workspace to report leaves the config alone rather
// than writing an empty one, which would look like a choice to every later read.
func TestNoActiveWorkspaceInMetaSeedsNothing(t *testing.T) {
	cfg := &config.Config{}
	applyAppRegistry(cfg, metaWithActive(nil), "https://sales.blackcode.ch")

	if got := cfg.ActiveWorkspaceFor("sales"); got.Slug != "" || got.ID > 0 {
		t.Fatalf("seeded %+v from a meta response that carried no active workspace", got)
	}
}
