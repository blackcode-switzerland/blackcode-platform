package cmdutil

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// Construction of the API client, and the two questions every command answers
// before it makes a request: WHICH WORKSPACE, and — since 3.0.0 — WHICH SERVER.
//
// This lives in cmdutil rather than in a command package because the command
// tree is split by app (internal/commands/platform, internal/commands/issues)
// and those packages must not import each other — docs/platform-architecture.md §7.1.
// Anything two of them need is shared here, which is also what keeps "does app A
// reach into app B?" answerable by reading the import block.
//
// ---------------------------------------------------------------------------
// WHICH SERVER (D-1) — the rule, in three lines
// ---------------------------------------------------------------------------
//
//	inside `bk <app> …`   →  app_servers[<app>]    the group PINS its app
//	--app-server <slug>   →  app_servers[<slug>]   one invocation, home verbs only
//	otherwise             →  home_server           neutral + cross-app verbs
//
// **There is no fallback.** An app with no entry in the registry is a hard
// failure naming itself, never a request sent somewhere else. That is the whole
// of D-1: a wrong-server 404 has no visible cause and an agent cannot recover
// from it, while a named failure is recoverable inside the same run.

// WSOverride is the per-invocation workspace target set by the persistent --ws
// flag; root.go binds it. When non-empty it overrides cfg.ActiveWorkspaceSlug
// for that command only — a read must never mutate the active workspace.
// VerboseFlag backs -v. AppOverride backs the persistent --app-server flag —
// named that way because --app is already a FILTER on six commands, and a
// persistent flag of the same name would silently shadow them rather than
// collide (see root.go).
var (
	WSOverride  string
	VerboseFlag bool
	AppOverride string
)

// PinnedApp is the app whose server this invocation must reach, set by the
// wrapper root.go puts around every command inside an app group.
//
// It is set at RUN time by the command tree rather than passed to each call
// site, and that is the point: with ~60 commands under `bk issues …`, threading
// a slug through every one of them means the first command someone adds without
// it silently talks to the home server. There is no spelling of `bk issues …`
// that can miss the pin, because the pin is applied to the subtree, not to the
// command.
//
// It OUTRANKS AppOverride: `bk --app-server sales issues issue list` still talks to
// issues, because the group's app is not a preference. D-1: "an app command
// group pins its own app. It is not affected by any mode, default or previous
// command."
var PinnedApp string

// PinApp is called by the app-group wrapper before a command runs.
func PinApp(app string) { PinnedApp = app }

// ClientWorkspaceSlug returns the workspace slug/id the client should target:
// the --ws override when set, otherwise THIS INVOCATION'S APP's active
// workspace.
//
// Per app since Phase 4, and it has to be: a slug identifies a row in the app's
// own workspace table, and since Phase 2 there is one such table per app with
// OVERLAPPING ids. Reading one shared field meant `bk sales workspace use …`
// silently retargeted `bk issues …` — measured, see config.ActiveWorkspaces.
func ClientWorkspaceSlug(cfg *config.Config) string {
	if strings.TrimSpace(WSOverride) != "" {
		return WSOverride
	}
	app, _ := TargetApp(cfg)
	return cfg.ActiveWorkspaceFor(app).Slug
}

// TargetApp reports which app this invocation is talking to, and why, for the
// routing block in `bk meta` and for error messages. An empty slug means the
// home server with no app lens.
func TargetApp(cfg *config.Config) (app, reason string) {
	switch {
	case PinnedApp != "":
		return PinnedApp, "pinned by the `bk " + PinnedApp + " …` command group"
	case strings.TrimSpace(AppOverride) != "":
		return strings.TrimSpace(AppOverride), "--app-server override, this invocation only"
	case cfg.HomeApp != "":
		return cfg.HomeApp, "home app (`bk app use` changes it)"
	default:
		return "", "home server (no home app set)"
	}
}

// UnknownAppError is "this invocation must reach app X and I have no address for
// it". A typed error rather than a formatted string because cmd/bk/main.go turns
// it into a `hint:` line, and matching on message text is how that stops working
// quietly.
//
// NoRegistry distinguishes the two causes, which need the same command but read
// very differently: an empty registry means this config predates the address
// book (upgraded from 2.x, never refreshed), while a populated one missing an
// entry means the platform does not publish that app — or it is spelled wrong.
type UnknownAppError struct {
	App        string
	Known      []string
	Reason     string
	NoRegistry bool
}

func (e *UnknownAppError) Error() string {
	var b strings.Builder
	if e.NoRegistry {
		fmt.Fprintf(&b, "no app registry yet, so `bk %s …` has no address to use "+
			"(this config predates bk 3.0.0)", e.App)
	} else {
		fmt.Fprintf(&b, "no server known for app %q (registry has: %s)",
			e.App, strings.Join(e.Known, ", "))
	}
	if e.Reason != "" {
		fmt.Fprintf(&b, " — %s", e.Reason)
	}
	return b.String()
}

// ServerForApp resolves an app slug to its base URL, or fails naming the app.
//
// THE ONE THING THIS FUNCTION MUST NEVER DO IS GUESS. Returning the home server
// for an unknown app turns "sales is not in your registry" into a 404 from the
// issues deployment — the same symptom as a deleted record, a typo'd number, or
// a permissions problem, and the agent has no way to tell which. Every branch
// below either returns an address the platform itself reported, or an error that
// names the app and the one command that fixes it.
func ServerForApp(cfg *config.Config, app string) (string, error) {
	app = strings.TrimSpace(app)
	if app == "" {
		if cfg.HomeServer == "" {
			return "", config.ErrNotConfigured
		}
		return cfg.HomeServer, nil
	}
	if url, ok := cfg.AppServers[app]; ok && url != "" {
		return url, nil
	}
	if len(cfg.AppServers) == 0 {
		// A config from before the address book existed (2.x), or one whose
		// registry has never been refreshed. Distinguished from "unknown app"
		// because the fix is the same command but the cause is not, and an
		// agent that reads "no server known for app issues" while issues is
		// plainly the only app would reasonably conclude something worse.
		return "", &UnknownAppError{App: app, NoRegistry: true}
	}
	known := make([]string, 0, len(cfg.AppServers))
	for slug := range cfg.AppServers {
		known = append(known, slug)
	}
	sort.Strings(known)
	return "", &UnknownAppError{App: app, Known: known}
}

// NewClient builds an API client pointed at the server this invocation must
// reach. Every command in the tree goes through this or NewClientAndConfig, so
// the routing rule has exactly one implementation.
func NewClient() (*client.Client, error) {
	c, _, err := NewClientAndConfig()
	return c, err
}

// NewClientAndConfig is NewClient for the commands that also need the config
// itself (the active workspace, the cached user id).
func NewClientAndConfig() (*client.Client, *config.Config, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, nil, err
	}
	c, err := ClientForApp(cfg, "")
	if err != nil {
		return nil, nil, err
	}
	return c, cfg, nil
}

// ClientForApp builds a client for a NAMED app, ignoring the pin and the
// override. Used by `bk app list` to probe every app, and by anything that
// legitimately talks to a server other than this invocation's.
//
// Pass "" to get this invocation's own target (pin, then --app-server, then home) —
// which is what NewClientAndConfig does.
func ClientForApp(cfg *config.Config, app string) (*client.Client, error) {
	reason := ""
	if app == "" {
		app, reason = TargetApp(cfg)
	}
	base, err := ServerForApp(cfg, app)
	if err != nil {
		// Attach WHY we were routing to this app — pinned by the group, an
		// override, or the home app. Without it, "no server known for app
		// sales" leaves the caller wondering where `sales` even came from.
		var uae *UnknownAppError
		if errors.As(err, &uae) && reason != "" {
			uae.Reason = reason
		}
		return nil, err
	}
	c := client.New(base, cfg.Token, ClientWorkspaceSlug(cfg))
	// The client carries the app so a transport failure can say WHICH app's
	// address was wrong, rather than printing a bare dial error and leaving the
	// caller to work out where the URL came from.
	c.App = app
	return c, nil
}

// ResolveWorkspaceRef returns either the slug/id explicitly given as the first
// argument, or this invocation's app's active workspace. Errors if there is no
// argument and no active workspace.
//
// The error NAMES THE APP, and that is the point of the per-app store: "no
// active workspace" used to be answerable by a `bk workspace use` that set the
// wrong app's, and the caller had no way to see that from the message.
func ResolveWorkspaceRef(cfg *config.Config, args []string) (string, error) {
	if len(args) > 0 && args[0] != "" {
		return args[0], nil
	}
	if strings.TrimSpace(WSOverride) != "" {
		return WSOverride, nil
	}
	app, _ := TargetApp(cfg)
	ws := cfg.ActiveWorkspaceFor(app)
	if ws.Slug != "" {
		return ws.Slug, nil
	}
	if ws.ID > 0 {
		return fmt.Sprintf("%d", ws.ID), nil
	}
	if app == "" {
		return "", fmt.Errorf("no active workspace — set one with `bk <app> workspace use <slug>` or pass it explicitly")
	}
	return "", fmt.Errorf(
		"no active workspace for the %s app — set one with `bk %s workspace use <slug>` "+
			"(each app remembers its own; `bk %s workspace list` shows them)", app, app, app)
}

// RequireActiveWorkspace is ResolveWorkspaceRef for commands that take no
// explicit workspace argument.
func RequireActiveWorkspace(cfg *config.Config) (string, error) {
	return ResolveWorkspaceRef(cfg, nil)
}

// DerefOr returns *s, or fallback when s is nil or points at "".
func DerefOr(s *string, fallback string) string {
	if s == nil || *s == "" {
		return fallback
	}
	return *s
}

// IntOr returns *p, or fallback when p is nil.
func IntOr(p *int, fallback int) int {
	if p == nil {
		return fallback
	}
	return *p
}
