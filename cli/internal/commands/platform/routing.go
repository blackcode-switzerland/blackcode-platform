package platform

import (
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
)

// The app address book (D-1): learning it, showing it, and switching the home
// app.
//
// The registry is LEARNED, never configured. `/api/meta` reports every app the
// platform knows and its `base_url`, so `bk login` and `bk meta` write that into
// the config and nobody types a URL twice. What the CLI must never do is invent
// an address — see cmdutil.ServerForApp.

// applyAppRegistry records what a server reported about every app, and pins the
// home app to the server we are actually talking to.
//
// **THE SERVER YOU REACHED WINS FOR ITS OWN APP.** If the platform's registered
// `base_url` for the current app disagrees with the host that just answered —
// a vanity domain versus a deployment URL, a preview deployment, a self-hosted
// instance — the one that answered is the one that has proven it serves this
// token. Taking the declared value instead would move every subsequent
// `bk <app> …` to a host the user never authenticated against, on the strength
// of a database column. Other apps have nothing better than their declared
// address, so they keep it.
//
// ---------------------------------------------------------------------------
// …AND THE RULE MUST NOT BE SILENT, WHICH IT WAS UNTIL 2026-08-11
// ---------------------------------------------------------------------------
// "Reached wins" is right, but combined with a stale ADDRESS it is permanent and
// invisible, and that combination shipped. `bk login`'s default server was
// `https://bc-issues.vercel.app` — Vercel's generated hostname for the issues
// project — so everyone who ran `bk login` without `--server` pinned it. And
// then `bk meta`, THE COMMAND WHOSE JOB IS TO REFRESH THE REGISTRY, re-pinned it
// on every run, discarding the registry's `https://issues.blackcode.ch` without
// a word. There was no sequence of documented commands that fixed it, because
// the one command a user would reach for was the one re-applying it.
//
// It surfaced as agents emitting links like
// `https://bc-issues.vercel.app/<workspace>/issue/18` — the base URL out of the
// config, glued to a URN tail. Nothing in this repo builds that string; an agent
// built it out of the two things it had, and one of them was wrong.
//
// So the disagreement is now REPORTED. The reached host still wins — a preview
// deployment or a self-hosted instance must keep working — but the caller is
// told what the platform declares and given the one line that switches.
type registryMismatch struct {
	App      string
	Reached  string
	Declared string
}

// effectiveReached is the origin that ANSWERED, which is not always the one we
// asked for.
//
// THIS IS THE HALF THAT HEALS ITSELF. If the host we asked redirected us, it
// named its own canonical address, and adopting that needs no notice and no
// command from the user — it is the deployment's own answer, arriving on the
// same connection that served the token. A vanity domain placed over a project
// hostname produces exactly this; a preview deployment and a self-hosted
// instance produce nothing, and keep the address they were reached at.
//
// So a stale address book repairs on the next `bk login` or `bk meta`, and the
// notice below is the fallback for the case nothing can repair automatically:
// two hosts that both answer, neither pointing at the other.
func effectiveReached(configured string) string {
	if o := strings.TrimSpace(client.RedirectedOrigin); o != "" {
		return o
	}
	return configured
}

// applyAppRegistry returns the mismatch for the CURRENT app, or nil. Only the
// current app can have one: it is the only app whose address is taken from
// anywhere other than the registry.
func applyAppRegistry(cfg *config.Config, meta *client.Meta, reachedURL string) *registryMismatch {
	servers := map[string]string{}
	current := ""
	declared := ""
	for slug, app := range meta.Apps {
		if app.IsCurrent {
			current = slug
			if app.BaseURL != nil {
				declared = strings.TrimRight(strings.TrimSpace(*app.BaseURL), "/")
			}
		}
		if app.BaseURL != nil {
			servers[slug] = *app.BaseURL
		}
	}
	reachedURL = strings.TrimRight(strings.TrimSpace(effectiveReached(reachedURL)), "/")

	var mismatch *registryMismatch
	if current != "" && reachedURL != "" {
		if declared != "" && !strings.EqualFold(declared, reachedURL) {
			mismatch = &registryMismatch{App: current, Reached: reachedURL, Declared: declared}
		}
		servers[current] = reachedURL
	}
	cfg.SetAppServers(servers)
	if current != "" {
		cfg.HomeApp = current
	}
	if reachedURL != "" {
		cfg.HomeServer = reachedURL
	}
	return mismatch
}

// reportMismatch writes the notice to stderr. Stderr, not stdout, so it cannot
// corrupt `--json`; and it names the exact command rather than describing the
// situation, because "your address book disagrees with the platform" is not
// something a caller can execute.
func reportMismatch(w io.Writer, m *registryMismatch) {
	if m == nil {
		return
	}
	fmt.Fprintf(w,
		"note: you are talking to %s, but the platform publishes %s for the %s app.\n"+
			"      Both work; links you build from this address will carry the one you used.\n"+
			"      To switch: bk login --server %s\n",
		m.Reached, m.Declared, m.App, m.Declared)
}

// refreshRegistry re-learns the address book from a meta response and saves it,
// reporting on stderr only when something changed.
//
// Best-effort by design: a failed save must not fail the command the user
// actually ran. What it must not do is fail SILENTLY when the registry is what
// the user is trying to fix, so the error is printed.
func refreshRegistry(cmd *cobra.Command, cfg *config.Config, meta *client.Meta, reachedURL string) {
	before := fmt.Sprint(cfg.AppServers, cfg.HomeApp, cfg.HomeServer)
	mismatch := applyAppRegistry(cfg, meta, reachedURL)
	// BEFORE the early return. A stale address is STABLE — nothing changes, so
	// the unchanged-check below returns — and stable is exactly the state that
	// needs saying out loud. Reporting only on change would have kept this
	// invisible for every run after the first.
	reportMismatch(cmd.ErrOrStderr(), mismatch)
	if before == fmt.Sprint(cfg.AppServers, cfg.HomeApp, cfg.HomeServer) {
		return
	}
	if err := config.Save(cfg); err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: could not save the refreshed app registry: %v\n", err)
		return
	}
	fmt.Fprintf(cmd.ErrOrStderr(), "app registry updated: %s\n", strings.Join(registryPairs(cfg), ", "))
}

func registryPairs(cfg *config.Config) []string {
	out := make([]string, 0, len(cfg.AppServers))
	for _, slug := range sortedKeys(cfg.AppServers) {
		out = append(out, slug+" → "+cfg.AppServers[slug])
	}
	if len(out) == 0 {
		return []string{"(empty)"}
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// routingBlock is the local half of `bk meta`: where each verb tier will send
// its next request. It answers "where will this command go?" without an agent
// having to run one and find out.
//
// It is CLIENT state, not server state — the whole reason it is worth printing
// is that the server cannot see it.
type routingBlock struct {
	HomeApp    string            `json:"home_app" yaml:"home_app"`
	HomeServer string            `json:"home_server" yaml:"home_server"`
	AppServers map[string]string `json:"app_servers" yaml:"app_servers"`
	Tiers      map[string]string `json:"tiers" yaml:"tiers"`
	Note       string            `json:"note" yaml:"note"`
}

func buildRoutingBlock(cfg *config.Config) routingBlock {
	home := cfg.HomeServer
	if home == "" {
		home = "(not set — run `bk login`)"
	}
	return routingBlock{
		HomeApp:    cfg.HomeApp,
		HomeServer: cfg.HomeServer,
		AppServers: cfg.AppServers,
		Tiers: map[string]string{
			"neutral":   home,
			"cross_app": home,
			"app_owned": "app_servers[<app>] — `bk <app> …` always resolves through the map, never falls back",
		},
		Note: "local to this machine (~/.config/bk/config.json); refreshed by `bk login` and `bk meta`, " +
			"switched by `bk app use <slug>`, overridden for one command by `--app-server <slug>`",
	}
}

func printRouting(w io.Writer, cfg *config.Config) {
	fmt.Fprintln(w)
	fmt.Fprintf(w, "routing: bare (identity) verbs → %s", cfg.HomeServer)
	if cfg.HomeApp != "" {
		fmt.Fprintf(w, "  (home app: %s)", cfg.HomeApp)
	}
	fmt.Fprintln(w)
	for _, slug := range sortedKeys(cfg.AppServers) {
		mark := " "
		if slug == cfg.HomeApp {
			mark = "*"
		}
		fmt.Fprintf(w, "       %s bk %s …  → %s\n", mark, slug, cfg.AppServers[slug])
	}
	if len(cfg.AppServers) == 0 {
		fmt.Fprintln(w, "         (no app registry yet — this `bk meta` run has just written one)")
	}
}

// newAppUseCmd — `bk app use <slug>` switches the HOME app: which server the
// remaining BARE verbs talk to. It does not affect `bk <app> …`, which is pinned
// by its own name.
//
// Phase 4 shrank what this does, on purpose. It used to decide where
// `bk workspace list`, `bk search`, `bk trash purge` and a dozen other commands
// landed — a piece of hidden state that changed what a command DID without
// changing what it SAID. Those verbs all name their app now, so what is left is
// which deployment answers questions about the account. Kept because
// `bk app list --app-server issues` is still a reasonable thing to want, and
// removing a flag agents may have learned is a deprecation for no gain.
func newAppUseCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "use <app>",
		Annotations: map[string]string{"routes": "none"},
		Short:       "Switch the home app: which server the bare identity verbs talk to",
		Long: `Set the home app.

The BARE verbs — login, token, profile, meta, app, changelog, super-admin — go to
the home app's server. They answer questions about your ACCOUNT, which every
deployment answers the same way, so the home app decides only who is asked.

Everything else names its app and is unaffected: "bk issues upload" always talks
to the issues app, whatever the home app is, because its name says so. That is
the point of the 2.1.0 verb move — no hidden state decides where a command lands,
and each app remembers its own active workspace.

This is local state, written to ~/.config/bk/config.json. Run "bk app list" to
see every app and its server, or "bk meta" to refresh the registry from the
platform. Use "--app-server <slug>" to redirect a single command instead.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			app := strings.TrimSpace(args[0])
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			// Resolving through the same function every command uses means
			// `bk app use` cannot set a home the rest of the CLI would then
			// refuse to route to.
			server, err := cmdutil.ServerForApp(cfg, app)
			if err != nil {
				return err
			}
			cfg.HomeApp = app
			cfg.HomeServer = server
			if err := config.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "home app is now %s (%s)\n", app, server)
			fmt.Fprintln(cmd.ErrOrStderr(),
				"the bare identity verbs now talk to that server; `bk <app> …` is unaffected — "+
					"it always pins its own app, and each app keeps its own active workspace")
			return nil
		},
	}
}

// probeApp reports whether this token can actually reach an app's server.
//
// `bk app list` answers "which apps could I use", and before D-1 that question
// stopped at the workspace. It now has a second half — an app can be enabled for
// the workspace, granted to you, and still unreachable because its address is
// stale or its deployment is down — and those two failures look identical from
// inside a command that just 404s.
func probeApp(cfg *config.Config, app string) string {
	c, err := cmdutil.ClientForApp(cfg, app)
	if err != nil {
		return "no server"
	}
	c.HTTP.Timeout = 4 * time.Second
	if _, err := c.Whoami(); err != nil {
		var oe *client.OutdatedError
		var ae *client.APIError
		switch {
		case errors.As(err, &oe):
			return "bk too old"
		case errors.As(err, &ae):
			if ae.Status == 401 || ae.Status == 403 {
				return "no (auth)"
			}
			return fmt.Sprintf("no (%d)", ae.Status)
		default:
			return "unreachable"
		}
	}
	return "yes"
}

// probeAll runs the probes concurrently — two deployments should not cost two
// round-trip timeouts in a diagnostic command.
func probeAll(cfg *config.Config, apps []string) map[string]string {
	out := make(map[string]string, len(apps))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, app := range apps {
		wg.Add(1)
		go func(app string) {
			defer wg.Done()
			res := probeApp(cfg, app)
			mu.Lock()
			out[app] = res
			mu.Unlock()
		}(app)
	}
	wg.Wait()
	return out
}
