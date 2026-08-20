package platform

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
)

// THE REGISTRY WIPE, 2026-08-20.
//
// `bk meta` is the command every routing failure's hint points at, and against a
// server that answered with no `apps` block it REPLACED the address book with an
// empty one. The next `bk books …` then failed with "no app registry yet, so
// `bk books …` has no address to use", whose own hint is "run `bk meta`" — a
// closed loop that an agent escaped only by hand-editing config.json, which
// routing.go's header says should never be necessary.
//
// It is reachable because `apps/books` serves `/api/meta` to anonymous callers
// (its vocabularies are public), so a stale or revoked token gets a 200 with
// `user: null` and `apps: null` instead of a 401.
//
// Reproduced with the real binary before the fix:
//
//	$ BK_CONFIG_DIR=… bk meta          # token edited to a dead one
//	app registry updated: (empty)
//	user:    <> (id 0, via )
//	$ bk books workspace list
//	error: no app registry yet, so `bk books …` has no address to use

func populatedConfig() *config.Config {
	cfg := &config.Config{HomeApp: "books", HomeServer: "https://books.blackcode.ch"}
	cfg.SetAppServers(map[string]string{
		"books":  "https://books.blackcode.ch",
		"issues": "https://issues.blackcode.ch",
	})
	return cfg
}

// An answer with no apps must change NOTHING. "The platform reported nothing"
// and "the platform reports no apps" are different claims, and only the first
// one is reachable.
func TestAnEmptyAppsAnswerLeavesTheRegistryAlone(t *testing.T) {
	cfg := populatedConfig()
	applyAppRegistry(cfg, &client.Meta{}, "https://books.blackcode.ch")

	if got := cfg.AppServers["books"]; got != "https://books.blackcode.ch" {
		t.Fatalf("books = %q — the registry was wiped by an answer that carried no "+
			"address book, and `bk books …` now has no address to use", got)
	}
	if got := cfg.AppServers["issues"]; got != "https://issues.blackcode.ch" {
		t.Errorf("issues = %q, want the entry that was already there", got)
	}
	if cfg.HomeApp != "books" || cfg.HomeServer != "https://books.blackcode.ch" {
		t.Errorf("home moved to %s/%s from an answer with no apps block", cfg.HomeApp, cfg.HomeServer)
	}
}

// THE POSITIVE HALF, and it is the half that matters (finding #16): a guard that
// only ever asserts "nothing was written" is satisfied by a function that never
// writes. A server that DOES report apps still replaces the registry wholesale —
// a stale address is repaired and an app the platform has retired disappears.
func TestAPopulatedAnswerStillReplacesTheRegistry(t *testing.T) {
	cfg := populatedConfig()
	cfg.SetAppServers(map[string]string{
		"books":   "https://books.blackcode.ch",
		"issues":  "https://stale.example",
		"retired": "https://retired.example",
	})
	books := "https://books.blackcode.ch"
	issues := "https://issues.blackcode.ch"
	applyAppRegistry(cfg, &client.Meta{Apps: map[string]client.MetaApp{
		"books":  {BaseURL: &books, IsCurrent: true},
		"issues": {BaseURL: &issues},
	}}, books)

	if got := cfg.AppServers["issues"]; got != issues {
		t.Fatalf("issues = %q, want %q — a stale address is no longer repairable, "+
			"which is worse than the wipe this guard exists for", got, issues)
	}
	if _, still := cfg.AppServers["retired"]; still {
		t.Errorf("an app the platform no longer reports survived the refresh")
	}
}

// Nothing to learn is not nothing to say. A run that refreshed nothing must not
// be indistinguishable from one that refreshed everything.
func TestRefreshSaysSoWhenItLearnedNothing(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	cfg := populatedConfig()
	cmd := &cobra.Command{}
	var errb bytes.Buffer
	cmd.SetErr(&errb)
	refreshRegistry(cmd, cfg, &client.Meta{}, "https://books.blackcode.ch")

	out := errb.String()
	for _, want := range []string{"reported no app registry", "left as it is", "books → https://books.blackcode.ch"} {
		if !strings.Contains(out, want) {
			t.Errorf("the notice does not contain %q, so a caller cannot tell a "+
				"no-op refresh from a successful one:\n%s", want, out)
		}
	}
}

// AND THE OTHER HALF OF THE SAME BUG: the run reported SUCCESS.
//
// `bk meta` only ever sends a token, so a 200 carrying `user: null` is a
// rejected credential — not a context. It printed `user:  <> (id 0, via )` and
// exited 0, which is a bootstrap that established nothing and said it worked.
func TestMetaRefusesALoggedOutReply(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Exactly what `apps/books`' /api/meta serves an unrecognised token.
		_ = json.NewEncoder(w).Encode(map[string]any{
			"app": "books", "user": nil, "apps": nil,
			"vocabularies": map[string]any{},
		})
	}))
	defer srv.Close()

	dir := t.TempDir()
	writeConfig(t, dir, srv.URL)

	cmd := newMetaCmd()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs(nil)
	err := cmd.Execute()
	if err == nil {
		t.Fatal("`bk meta` exited 0 on a logged-out reply — the bootstrap command " +
			"reports success while having established nothing")
	}
	if !strings.Contains(err.Error(), "did not recognise your credentials") {
		t.Errorf("error = %q, want the logged-out diagnosis", err)
	}
	// And it must not have written anything from that answer.
	after, lErr := config.Load()
	if lErr != nil {
		t.Fatalf("load config: %v", lErr)
	}
	if after.AppServers["books"] != "https://books.blackcode.ch" {
		t.Errorf("app_servers[books] = %q — the logged-out reply reached the registry",
			after.AppServers["books"])
	}
}

func writeConfig(t *testing.T, dir, server string) {
	t.Helper()
	t.Setenv("BK_CONFIG_DIR", dir)
	body := map[string]any{
		"server":      server,
		"token":       "bk_live_dead",
		"home_app":    "books",
		"home_server": server,
		"app_servers": map[string]string{"books": "https://books.blackcode.ch"},
	}
	b, err := json.MarshalIndent(body, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// `--app-server` IS ONE INVOCATION — INCLUDING FOR THE COMMAND THAT WRITES THE
// REGISTRY.
//
// Measured with the real binary on 2026-08-20, homed on issues:
//
//	$ bk meta --app-server books
//	$ grep home_app config.json   →  "books"
//
// The flag's own documentation says "one invocation, home verbs only", and
// `bk app use <slug>` is the command that moves home. This matters more now
// that `bk meta --app-server books` is the spelling books' help points a
// non-books-homed agent at.
func TestAppServerOverrideDoesNotMoveHome(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	cfg := &config.Config{HomeApp: "issues", HomeServer: "https://issues.blackcode.ch"}
	cfg.SetAppServers(map[string]string{"issues": "https://issues.blackcode.ch"})

	cmdutil.AppOverride = "books"
	defer func() { cmdutil.AppOverride = "" }()

	books := "https://books.blackcode.ch"
	cmd := &cobra.Command{}
	cmd.SetErr(&bytes.Buffer{})
	refreshRegistry(cmd, cfg, &client.Meta{Apps: map[string]client.MetaApp{
		"books": {BaseURL: &books, IsCurrent: true},
	}}, books)

	if cfg.HomeApp != "issues" || cfg.HomeServer != "https://issues.blackcode.ch" {
		t.Fatalf("home moved to %s (%s) — a flag documented as \"this invocation only\" "+
			"repointed every bare verb", cfg.HomeApp, cfg.HomeServer)
	}
	// THE POSITIVE HALF: the address book it reported is still learned, which is
	// the reason to run the command at all.
	if got := cfg.AppServers["books"]; got != books {
		t.Errorf("books = %q — the redirected answer taught the registry nothing", got)
	}
}

// …and an UNREDIRECTED refresh still pins home, which is what `bk login` and a
// plain `bk meta` rely on.
func TestAPlainRefreshStillPinsHome(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	cfg := &config.Config{}
	books := "https://books.blackcode.ch"
	cmd := &cobra.Command{}
	cmd.SetErr(&bytes.Buffer{})
	refreshRegistry(cmd, cfg, &client.Meta{Apps: map[string]client.MetaApp{
		"books": {BaseURL: &books, IsCurrent: true},
	}}, books)

	if cfg.HomeApp != "books" || cfg.HomeServer != books {
		t.Fatalf("home = %s (%s), want books — a fresh config never learns where home is",
			cfg.HomeApp, cfg.HomeServer)
	}
}
