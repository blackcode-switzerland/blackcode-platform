package platform

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk meta` mirrors GET /api/meta — the single bootstrap call an agent should
// make first. It answers "who am I, which workspaces can I write to, and which
// one is active", so an agent can pick its target BY NAME/SLUG instead of an
// opaque numeric id (the most common cause of writing to the wrong workspace).
func newMetaCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "meta",
		Annotations: map[string]string{"routes": "GET /api/meta"},
		Short:       "Bootstrap context: who am I + every workspace I can write to",
		Long: `Print the agent bootstrap context (GET /api/meta): the authenticated
user, the active workspace, and EVERY workspace you belong to.

Pick the workspace you write to by its NAME/SLUG from the list below — not by the
numeric id (ids are opaque and easy to confuse). Then target it with
` + "`bk <app> workspace use <slug>`" + ` or a per-command ` + "`--ws <slug>`" + `. The active
workspace is only a default, not necessarily where you mean to write.

Use --ws <slug|id> to preview another workspace's context without switching.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			meta, err := c.Meta(cmdutil.ClientWorkspaceSlug(cfg))
			if err != nil {
				return err
			}

			// Re-learn the app address book (D-1). `bk meta` is the command every
			// agent runs first and the one every routing failure's hint points
			// at, so it is where the registry becomes current — and the reason a
			// stale address is always one documented command from being fixed.
			refreshRegistry(cmd, cfg, meta, c.BaseURL)

			// Machine formats print the server's payload verbatim, so every
			// dynamic block it carries (limits, media, cli, vocabulary, and
			// anything added later) reaches the agent without a CLI release.
			// Re-serialising the typed struct would silently drop them.
			var payload any = meta
			if len(meta.Raw) > 0 && (format == output.FormatJSON || format == output.FormatYAML) {
				var passthrough any
				if err := json.Unmarshal(meta.Raw, &passthrough); err == nil {
					payload = passthrough
				}
			}

			// The `routing` block is LOCAL state merged into the server's
			// payload: which server each verb tier will reach next. The server
			// cannot see it, and an agent that cannot see it either has to
			// discover a wrong-host answer by running into one.
			//
			// MERGED into the passthrough map, never replacing it, so the
			// "machine formats print the server's payload verbatim" property
			// above still holds for everything the server sent.
			if m, ok := payload.(map[string]any); ok {
				m["routing"] = buildRoutingBlock(cfg)
			}

			return output.Render(format, payload, func(w io.Writer) error {
				name := ""
				if meta.User.Name != nil {
					name = *meta.User.Name
				}
				fmt.Fprintf(w, "user:   %s <%s> (id %d, via %s)\n", name, meta.User.Email, meta.User.ID, meta.User.Via)
				if meta.ActiveWorkspace != nil {
					fmt.Fprintf(w, "active: %s (slug %s, id %d, role %s)\n",
						meta.ActiveWorkspace.Name, meta.ActiveWorkspace.Slug, meta.ActiveWorkspace.ID, meta.ActiveWorkspace.Role)
				} else {
					fmt.Fprintln(w, "active: (none — run `bk <app> workspace use <slug>`)")
				}
				fmt.Fprintln(w)

				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE")
				for _, ws := range meta.Workspaces {
					mark := " "
					if ws.IsActive {
						mark = "*"
					}
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n", mark, ws.ID, ws.Name, ws.Slug, ws.Role)
				}
				if err := tw.Flush(); err != nil {
					return err
				}

				// The apps block only appears from a Phase 4 server. Skipped rather
				// than printed empty, so an older deployment reads as "this server
				// doesn't report apps" instead of "you have no apps".
				if len(meta.Apps) > 0 {
					fmt.Fprintln(w)
					at := output.Tabwriter(w)
					fmt.Fprintln(at, "\tAPP\tNAME\tCOMMANDS\tWORKSPACES")
					for _, slug := range sortedAppSlugs(meta.Apps) {
						a := meta.Apps[slug]
						mark := " "
						if a.IsCurrent {
							mark = "*"
						}
						// "not asked" for another app, NOT "—".
						//
						// Since 2026-08-10 the server populates `workspaces` only
						// for the app answering the request: each app's membership
						// lives in its own schema and no deployment can read
						// another's. An em dash reads as "you have none there",
						// which is a different claim and one this output cannot
						// make. An agent that believes it would skip an app it can
						// actually use.
						workspaces := "not asked"
						if a.IsCurrent {
							workspaces = "—"
						}
						if len(a.Workspaces) > 0 {
							workspaces = strings.Join(a.Workspaces, ",")
						}
						fmt.Fprintf(at, "%s\t%s\t%s\t%s\t%s\n", mark, slug, a.Name, "bk "+slug+" …", workspaces)
					}
					if err := at.Flush(); err != nil {
						return err
					}
					if len(meta.Apps) > 1 {
						fmt.Fprintln(cmd.ErrOrStderr(),
							"\n\"not asked\" = this server does not know that app's workspaces, which is not the "+
								"same as you having none. Ask it: `bk <app> workspace list`.")
					}

					// Where the vocabulary lives now. The table cannot usefully
					// print an enum list, and an agent reading only this view
					// would otherwise still reach for the deprecated top-level
					// `vocabulary` key.
					//
					// Do NOT name a version here. This line used to promise the
					// top-level keys "go away in 1.12.0"; 1.12.0 shipped, the
					// keys are still served — correctly, because CLI_MIN_VERSION
					// is 1.9.1 and every binary from 1.9.1 up reads them. A
					// removal date in a string that ships inside the binary
					// cannot be corrected once it is wrong on the installed
					// copies. The server decides when they go; this only says
					// where to read instead.
					for _, slug := range sortedAppSlugs(meta.Apps) {
						if a := meta.Apps[slug]; a.IsCurrent && len(a.Vocabulary) > 0 {
							fmt.Fprintf(cmd.ErrOrStderr(),
								"\nThis app's statuses, priorities and limits: `bk meta --json` → apps.%s\n"+
									"(the top-level vocabulary/limits/media keys are deprecated — still served for older binaries)\n",
								slug)
							break
						}
					}
				}

				printRouting(w, cfg)

				if len(meta.Workspaces) == 0 {
					if len(meta.Apps) > 0 {
						// Membership without access is the quiet failure of Phase 4:
						// nothing errored, the list is just empty. Say which it is.
						fmt.Fprintln(cmd.ErrOrStderr(),
							"(no workspaces you can use this app in — run `bk <app> workspace list --all` to see "+
								"every workspace you are a member of, then ask an owner for access)")
					} else {
						fmt.Fprintln(cmd.ErrOrStderr(), "(no workspaces)")
					}
				} else {
					fmt.Fprintln(cmd.ErrOrStderr(), "\nPick your target by SLUG (e.g. `bk <app> workspace use <slug>` or `--ws <slug>`), not the id.")
				}
				return nil
			})
		},
	}
}

// sortedAppSlugs keeps `bk meta` output stable: Go map iteration is randomised,
// and an agent diffing two runs must not see a reordered list as a change.
func sortedAppSlugs(apps map[string]client.MetaApp) []string {
	slugs := make([]string, 0, len(apps))
	for slug := range apps {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	return slugs
}
