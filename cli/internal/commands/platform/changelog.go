package platform

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// defaultChangelogServer is used when the user runs `bk changelog` before ever
// logging in. The changelog is public, and the whole point of the command is to
// help an out-of-date setup get current — so it must work without a config file.
//
// It shares config.DefaultServer rather than repeating an address: the two are
// the same fact ("where does a binary that knows nothing go?"), and they were
// separate long enough to disagree with every doc in the repo.
const defaultChangelogServer = config.DefaultServer

// `bk changelog` mirrors GET /api/changelog: the dated record of what changed.
//
// It no longer has a --reference flag. That printed a server-hosted "Platform
// Reference" — a complete snapshot of the surface — which is precisely the kind
// of copy that drifts (its CLI version was stale before we retired it). The
// current surface is `bk guide`, embedded in THIS binary, so it can never
// describe a version you are not running. The flag is kept as a hidden alias
// that redirects, rather than vanishing into "unknown flag".
func newChangelogCmd() *cobra.Command {
	var full, reference bool
	var serverFlag, app string

	cmd := &cobra.Command{
		Use:         "changelog",
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		Short:       "What's changed in the API and CLI (read this to get up to date)",
		Long: `Print the product changelog (GET /api/changelog).

Default: a table of dated changes, newest first, merged across every app and
the platform, each entry tagged with where it came from.
  --full          print every dated entry in full
  --app <name>    only that section — an app slug, or "platform"

For how the CLI WORKS (rather than what changed), run ` + "`bk guide`" + ` — the
complete usage guide embedded in this binary.

The changelog is public, so this works even before ` + "`bk login`" + `. If a
command that used to work now fails, run ` + "`bk skill sync`" + `, then check here.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}

			// --reference was retired with the Platform Reference it printed.
			// Redirect instead of failing: a hint an agent can act on beats an
			// "unknown flag" it can only give up on.
			if reference {
				fmt.Fprintln(cmd.ErrOrStderr(),
					"hint: --reference was retired — the platform reference is now the embedded guide.\n"+
						"      Run `bk guide` (offline, always matches this binary).")
			}

			c := changelogClient(serverFlag)
			cl, err := c.Changelog(app)
			if err != nil {
				return err
			}

			return output.Render(format, cl, func(w io.Writer) error {
				if full {
					// Whole dated log, in full.
					for i, e := range cl.Entries {
						if i > 0 {
							fmt.Fprintln(w)
						}
						fmt.Fprintf(w, "## %s — %s%s\n\n", e.Date, appTag(e.App), e.Title)
						fmt.Fprintln(w, strings.TrimSpace(e.Markdown))
					}
					return nil
				}

				// Default: a compact table of dated entries. The APP column is
				// omitted against a pre-2026-08-04 server, which sends no `app`
				// at all — a column of dashes would look like missing data
				// rather than an older server.
				scope := "every app"
				if app != "" {
					scope = app
				}
				fmt.Fprintf(w, "Blackcode platform — changelog: %s (CLI latest v%s, min v%s)\n\n",
					scope, cl.CLILatestVersion, cl.CLIMinVersion)
				tw := output.Tabwriter(w)
				if tagged(cl.Entries) {
					fmt.Fprintln(tw, "DATE\tAPP\tCHANGE")
				} else {
					fmt.Fprintln(tw, "DATE\tCHANGE")
				}
				for _, e := range cl.Entries {
					date := e.Date
					if date == "" {
						date = "—"
					}
					if tagged(cl.Entries) {
						fmt.Fprintf(tw, "%s\t%s\t%s\n", date, e.App, e.Title)
					} else {
						fmt.Fprintf(tw, "%s\t%s\n", date, e.Title)
					}
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				hint := "\nRead every entry in full: `bk changelog --full`. How the CLI works: `bk guide`."
				if app == "" && len(cl.Apps) > 1 {
					hint += "\nFilter to one section: `bk changelog --app " + strings.Join(cl.Apps, "|") + "`."
				}
				fmt.Fprintln(cmd.ErrOrStderr(), hint)
				return nil
			})
		},
	}

	cmd.Flags().StringVar(&app, "app", "",
		"Only this section's entries: an app slug, or \"platform\" for shared changes")
	cmd.Flags().BoolVar(&full, "full", false, "Print every dated entry in full")
	cmd.Flags().BoolVar(&reference, "reference", false, "Retired — the platform reference is now `bk guide`")
	_ = cmd.Flags().MarkDeprecated("reference", "the platform reference is now the embedded guide: run `bk guide`")
	cmd.Flags().StringVar(&serverFlag, "server", "", "Server base URL (default: your logged-in server, else "+defaultChangelogServer+")")
	return cmd
}

// tagged reports whether the server tagged its entries with an app — false
// against anything older than 2026-08-04, where the field does not exist.
func tagged(entries []client.ChangelogEntry) bool {
	for _, e := range entries {
		if e.App != "" {
			return true
		}
	}
	return false
}

func appTag(app string) string {
	if app == "" {
		return ""
	}
	return "[" + app + "] "
}

// changelogClient builds a client for the public changelog endpoint. It prefers
// an explicit --server, then the HOME server from config, then the default host
// — so the command works with no config at all.
//
// The home server, not an app's: the changelog is one merged feed covering every
// app (`--app` filters it server-side), so any deployment answers it identically.
// That is the definition of a neutral verb.
func changelogClient(serverFlag string) *client.Client {
	server := strings.TrimSpace(serverFlag)
	token := ""
	if server == "" {
		if cfg, err := config.Load(); err == nil {
			server = cfg.HomeServer
			token = cfg.Token
		}
	}
	if server == "" {
		server = defaultChangelogServer
	}
	return client.New(server, token, "")
}
