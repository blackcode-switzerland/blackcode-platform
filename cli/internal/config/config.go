package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The stored credentials, and — since 3.0.0 — the APP ADDRESS BOOK (D-1).
//
// ---------------------------------------------------------------------------
// WHY ONE `server` FIELD STOPPED BEING ENOUGH
// ---------------------------------------------------------------------------
// There is more than one deployment: issues.blackcode.ch, sales.blackcode.ch.
// With a single address, `bk sales prospect list` would be sent to the issues
// host and come back 404 with nothing on screen naming the cause. That failure
// is invisible, and an invisible failure inside an agent run is one it cannot
// recover from.
//
// So the config carries a per-app map, LEARNED rather than configured:
// `bk login` and `bk meta` read `apps.<slug>.base_url` out of /api/meta and
// write it here. Nobody types a URL twice, and the registry cannot drift from
// what the platform actually serves for longer than one `bk meta`.
//
// One login, one token, one binary, one version floor — all unchanged. This is
// an address book, not a second account.
type Config struct {
	// Server is the LEGACY single address, kept written for two reasons: a
	// config touched by 3.x must still work if the user rolls back to 2.x, and
	// Load() migrates it forward when HomeServer is absent. It always mirrors
	// HomeServer after a Save.
	Server string `json:"server"`
	Token  string `json:"token"`

	// HomeApp is the app whose server answers the BARE verbs — the ones about
	// your ACCOUNT and this BINARY: `bk meta`, `bk whoami`, `bk profile`,
	// `bk token`, `bk changelog`, `bk version`. Set by `bk app use <slug>`, and
	// learned on login from the app the login server says it is. Empty is legal:
	// it means "no lens", and those verbs simply go to HomeServer.
	//
	// This comment named `bk workspace list` and `bk search` until 2026-08-11.
	// Both moved: there are TWO tiers now, not three, and anything touching an
	// app's DATA is spelled `bk <app> <verb>` — D-11's NEUTRAL tier assumed one
	// `platform.workspaces` and its CROSS-APP tier assumed one entity index, and
	// multiAppFinalRefactor Phases 2 and 3 ended both. A bare data verb had no
	// answer left, only a default taken from this field.
	HomeApp string `json:"home_app,omitempty"`
	// HomeServer is where those verbs go.
	HomeServer string `json:"home_server,omitempty"`
	// AppServers maps an app slug to its base URL. An app-owned verb
	// (`bk <app> upload|trash|label`) and every command inside `bk <app> …`
	// resolves through this map and NEVER falls back — see cmdutil.ServerForApp.
	AppServers map[string]string `json:"app_servers,omitempty"`

	UserID int    `json:"user_id,omitempty"`
	Email  string `json:"email,omitempty"`

	// ActiveWorkspaceID / ActiveWorkspaceSlug are the LEGACY single active
	// workspace, kept written for the home app so a config touched by 4.x still
	// works if the user rolls back to 3.x. Read ActiveWorkspaces instead —
	// `ActiveWorkspaceFor` is the only supported accessor.
	ActiveWorkspaceID   int    `json:"active_workspace_id,omitempty"`
	ActiveWorkspaceSlug string `json:"active_workspace_slug,omitempty"`

	// ActiveWorkspaces is the active workspace PER APP, keyed by app slug.
	//
	// ── WHY THIS STOPPED BEING ONE FIELD (multiAppFinalRefactor Phase 4) ─────
	// One field was correct while every app read one `platform.workspaces`
	// table. Since Phase 2 it is two tables, so a slug is only meaningful
	// against the app it was resolved in — and the two id spaces OVERLAP by
	// construction, because migration 0004 mirrored ids.
	//
	// MEASURED before this field existed, against two local dev servers:
	// `bk workspace use balathanusan-1` (a workspace only issues has) left
	// `bk sales prospect list` failing `workspace not found (404)`, with a hint
	// suggesting the surface had changed. One command silently broke another
	// app's, and nothing in either command said which workspace it meant.
	//
	// Phase 4 makes `workspace use` app-owned (`bk sales workspace use`), which
	// would have made that permanent rather than incidental: two commands that
	// name different apps writing one field. So the store is keyed by app. It
	// is the same property the command spelling now has — no hidden state
	// decides where a command lands.
	ActiveWorkspaces map[string]ActiveWorkspace `json:"active_workspaces,omitempty"`
	// LastUpdateCheck is the unix timestamp (seconds) of the last time the CLI
	// printed the "update available" soft notice. Throttles it to once/24h.
	LastUpdateCheck int64 `json:"last_update_check,omitempty"`
}

// ActiveWorkspace is one app's remembered workspace.
type ActiveWorkspace struct {
	ID   int    `json:"id,omitempty"`
	Slug string `json:"slug,omitempty"`
}

// ActiveWorkspaceFor returns the workspace remembered for an app.
//
// The empty app slug means "no app lens" — a bare verb on a config with no home
// app — and reads the legacy fields, which is what a pre-4.x config has and what
// a 3.x binary would still write.
func (c *Config) ActiveWorkspaceFor(app string) ActiveWorkspace {
	app = strings.TrimSpace(app)
	if app == "" {
		return ActiveWorkspace{ID: c.ActiveWorkspaceID, Slug: c.ActiveWorkspaceSlug}
	}
	return c.ActiveWorkspaces[app]
}

// SetActiveWorkspaceFor records an app's workspace.
//
// It also mirrors into the legacy pair when the app is the HOME app, for the
// same reason `server` mirrors `home_server`: a user who rolls back to 3.x finds
// a config that still works. It deliberately does NOT mirror for a non-home app
// — that would reintroduce exactly the cross-app overwrite this field removes.
func (c *Config) SetActiveWorkspaceFor(app string, ws ActiveWorkspace) {
	app = strings.TrimSpace(app)
	if app == "" {
		c.ActiveWorkspaceID, c.ActiveWorkspaceSlug = ws.ID, ws.Slug
		return
	}
	if c.ActiveWorkspaces == nil {
		c.ActiveWorkspaces = map[string]ActiveWorkspace{}
	}
	if ws.ID == 0 && ws.Slug == "" {
		delete(c.ActiveWorkspaces, app)
	} else {
		c.ActiveWorkspaces[app] = ws
	}
}

// mirrorLegacyActiveWorkspace keeps the legacy pair pointed at the HOME app's
// entry. Called from Save, so there is one write path rather than one per call
// site — a mirror maintained at call sites is a mirror the next call site
// forgets.
//
// It deliberately mirrors the home app and NOTHING else: putting a sales slug
// into the field a 3.x binary reads as "the workspace" is the cross-tenant guess
// this refactor removes, and a rollback is exactly when nobody is watching.
func (c *Config) mirrorLegacyActiveWorkspace() {
	if c.HomeApp == "" {
		return
	}
	ws := c.ActiveWorkspaces[c.HomeApp]
	c.ActiveWorkspaceID, c.ActiveWorkspaceSlug = ws.ID, ws.Slug
}

func dir() (string, error) {
	if v := os.Getenv("BK_CONFIG_DIR"); v != "" {
		return v, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "bk"), nil
}

func path() (string, error) {
	d, err := dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

func Load() (*Config, error) {
	p, err := path()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotConfigured
		}
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	c.migrate()
	return &c, nil
}

// migrate brings a config written by an older binary forward, in memory, on
// every read. It never writes: a `bk guide` run must not rewrite credentials.
//
// The only migration so far is the address book. A 2.x config has `server` and
// nothing else, and that address is by definition the home server — the one the
// user logged into. What it does NOT tell us is WHICH APP that server is, so
// `AppServers` stays empty and every app-scoped command fails with a hint
// naming `bk meta`, which populates it. That is a deliberate one-command
// upgrade step rather than a guess: guessing here means guessing which host a
// file gets uploaded to.
func (c *Config) migrate() {
	if c.HomeServer == "" {
		c.HomeServer = c.Server
	}
	if c.AppServers == nil {
		c.AppServers = map[string]string{}
	}
	if c.ActiveWorkspaces == nil {
		c.ActiveWorkspaces = map[string]ActiveWorkspace{}
	}
	// The per-app store arrived in 4.0.0. A 3.x config carries ONE active
	// workspace, and the only app it can have meant is the home app — that is
	// the app whose server answered `bk workspace use`. Adopting it for the home
	// app and for no other is the difference between an upgrade that keeps
	// working and one where `bk issues issue list` says "no active workspace"
	// the first time it is run.
	//
	// It is deliberately NOT copied to every app: a slug resolved against issues
	// is not a sales workspace, and seeding it as one is the cross-tenant guess
	// this whole refactor removes.
	if c.HomeApp != "" {
		if _, ok := c.ActiveWorkspaces[c.HomeApp]; !ok {
			if c.ActiveWorkspaceID != 0 || c.ActiveWorkspaceSlug != "" {
				c.ActiveWorkspaces[c.HomeApp] = ActiveWorkspace{
					ID:   c.ActiveWorkspaceID,
					Slug: c.ActiveWorkspaceSlug,
				}
			}
		}
	}
}

// SetAppServers replaces the registry with what a server reported, keeping the
// home server pointed at the same app it was.
//
// Entries with no base_url are DROPPED rather than stored empty: an app the
// platform has not given an address is one this binary cannot route to, and
// "no entry" is the state that produces the actionable error. A stored empty
// string would produce a request to "/api/…" against no host at all.
func (c *Config) SetAppServers(servers map[string]string) {
	clean := make(map[string]string, len(servers))
	for slug, url := range servers {
		url = strings.TrimRight(strings.TrimSpace(url), "/")
		if slug == "" || url == "" {
			continue
		}
		clean[slug] = url
	}
	c.AppServers = clean
	// Keep the home pointer consistent with the refreshed registry: if the home
	// app moved to a new URL, follow it.
	if c.HomeApp != "" {
		if url, ok := clean[c.HomeApp]; ok {
			c.HomeServer = url
		}
	}
}

func Save(c *Config) error {
	d, err := dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(d, 0o700); err != nil {
		return err
	}
	p, err := path()
	if err != nil {
		return err
	}
	// `server` mirrors `home_server` on every write. A 2.x binary reads only
	// `server`, so a user who rolls back keeps working — and a user who rolls
	// forward again finds the registry still there.
	if c.HomeServer != "" {
		c.Server = c.HomeServer
	}
	c.mirrorLegacyActiveWorkspace()
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o600)
}

func Delete() error {
	p, err := path()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

var ErrNotConfigured = errors.New("not configured: run `bk login` first")
