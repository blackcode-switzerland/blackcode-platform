package platform

import (
	"fmt"
	"io"
	"sort"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk app` — THE ADDRESS BOOK. Which apps exist, where each one lives, and
// whether this binary can reach it.
//
// A BARE verb, and one of the few that genuinely is: it answers questions about
// this binary's routing, not about any app's data. Two deployments answer alike.
//
// ---------------------------------------------------------------------------
// IT USED TO BE A GATE MANAGER, AND STOPPED BEING ONE ON 2026-08-10 (Phase 5)
// ---------------------------------------------------------------------------
// This group had six more commands — `enable`, `disable`, `default-access`, and
// `access list|grant|revoke` — over `platform.workspace_apps` and
// `platform.app_access`. They made a distinction legible:
//
//	workspace member  you are in this organisation
//	app access        you may open this app inside it
//
// That distinction required one workspace shared by several apps. Apps own their
// workspaces now, so a workspace belongs to exactly one app and the second line
// has no subject. Both tables are dropped; all six commands are removed, with
// deprecation rows naming what replaced them (`bk <app> member …`).
//
// ---------------------------------------------------------------------------
// `list` NO LONGER ASKS A WORKSPACE, AND THAT FIXES A REAL 404
// ---------------------------------------------------------------------------
// It called `GET /api/workspaces/{ws}/apps` — a route only `apps/issues` ever
// mounted — so from a sales-homed CLI `bk app list` simply 404'd (agent 5 §4.5
// flagged it for this phase). It also required an ACTIVE WORKSPACE to answer a
// question that has nothing to do with workspaces.
//
// It reads the learned registry in `~/.config/bk/config.json` instead. That is
// where the address book already lived: `bk login` and `bk meta` write it from
// `/api/meta`, which since Phase 5 reports every enabled row of `platform.apps`.
// So this command makes no HTTP call of its own beyond the reachability probe —
// which is the honest shape, because "can I reach it" is answered by asking, and
// nothing else here can be answered by a server at all.
func newAppCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "The apps in the suite, their servers, and which one is home",
		Long: `The app address book: which Blackcode apps exist, the server this
binary sends each one's commands to, and whether that server answers for you.

  bk app list          apps, their servers, reachability
  bk app use <slug>    switch the home app (where the bare identity verbs go)

The registry is LEARNED, never typed: ` + "`bk login`" + ` and ` + "`bk meta`" + ` write it from
the platform, so nobody enters a URL twice.

Being listed here means the app EXISTS and this binary knows its address. It
does not mean you have a workspace in it — that is answered by the app itself,
and ` + "`bk <app> workspace list`" + ` is the question. Each app keeps its own
workspaces and its own active one.`,
	}
	cmd.AddCommand(
		newAppListCmd(),
		newAppUseCmd(),
	)
	return cmd
}

func newAppListCmd() *cobra.Command {
	var noProbe bool
	cmd := &cobra.Command{
		Use: "list",
		// "none" is the literal required by routes_test.go for a command that
		// makes no API call. The reachability probe is not an API contract — it
		// is a liveness check against whatever address the registry holds, and
		// claiming a route for it would put a path in cli-parity that no app
		// promises to serve.
		Annotations: map[string]string{"routes": "none"},
		Short:       "List the apps in the suite, the server each answers on, and whether you can reach it",
		Long: `List every app this binary knows, with the address it will send that
app's commands to and whether that address answers for you.

Two separate things have to be true before "bk <app> …" works, and they fail in
ways that look alike from inside a command that just errors:

  SERVER      this binary knows the app's address (learned by "bk login" / "bk meta")
  REACHABLE   that address answers, and accepts this token

A REACHABLE app you have no workspace in is a normal state, not an error: you can
sign in there and it will tell you so in its own words. Run "bk meta" to refresh
the registry if an app is missing or its address has moved.

--no-probe skips the reachability check (no network calls at all).`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			cfg, err := config.Load()
			if err != nil {
				return err
			}

			type row struct {
				Slug      string `json:"slug" yaml:"slug"`
				Server    string `json:"server" yaml:"server"`
				Reachable string `json:"reachable,omitempty" yaml:"reachable,omitempty"`
				IsHome    bool   `json:"is_home" yaml:"is_home"`
			}

			slugs := make([]string, 0, len(cfg.AppServers))
			for slug := range cfg.AppServers {
				slugs = append(slugs, slug)
			}
			// Sorted so two runs against the same config print the same thing —
			// Go randomises map iteration, and a listing that reorders itself is
			// unreadable as a diff.
			sort.Strings(slugs)

			probes := map[string]string{}
			if !noProbe {
				probes = probeAll(cfg, slugs)
			}

			rows := make([]row, 0, len(slugs))
			for _, slug := range slugs {
				r := row{Slug: slug, Server: cfg.AppServers[slug], IsHome: slug == cfg.HomeApp}
				if p, ok := probes[slug]; ok {
					r.Reachable = p
				}
				rows = append(rows, r)
			}

			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tAPP\tSERVER\tREACHABLE")
				for _, a := range rows {
					home := " "
					if a.IsHome {
						home = "*"
					}
					reach := a.Reachable
					if reach == "" {
						reach = "—"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", home, a.Slug, a.Server, reach)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					// An EMPTY registry is a real state with a real cause — a
					// config this binary has never logged in with — and it needs
					// to name the fix rather than print nothing.
					fmt.Fprintln(cmd.ErrOrStderr(),
						"(no apps in the registry — run `bk login` or `bk meta` to learn it)")
					return nil
				}
				fmt.Fprintf(cmd.ErrOrStderr(),
					"\n* = home app: where the bare identity verbs go (`bk app use <slug>` to switch).\n"+
						"`bk <app> …` always pins its own app, whatever the home app is.\n")
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&noProbe, "no-probe", false, "Skip the reachability check (no requests at all)")
	return cmd
}
