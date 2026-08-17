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
	var vocabKey string
	var contractOnly bool
	cmd := &cobra.Command{
		Use:         "meta",
		Annotations: map[string]string{"routes": "GET /api/meta"},
		Short:       "Bootstrap context: who am I + every app + where each command goes",
		Long: `Print the agent bootstrap context (GET /api/meta): the authenticated
user, the active workspace, and every workspace you belong to IN THE APP THAT
ANSWERED — which is your home app, or whichever one ` + "`--app-server`" + ` names.

ONE DEPLOYMENT CANNOT ANSWER FOR ANOTHER. Since 2026-08-10 each app keeps its
own workspaces and membership in its own schema, and no app holds a grant on
another's. So:

  - ` + "`apps`" + ` is the ADDRESS BOOK — which apps exist and where they are
    deployed. It is not a grant list, and being in it does not mean you have a
    workspace there.
  - ` + "`workspaces`" + ` is populated ONLY for the app that answered. An empty
    array under another app means "NOT KNOWN HERE" — never "you have none
    there". To find out, ask that app: ` + "`bk <app> workspace list`" + `.

Pick the workspace you write to by its NAME/SLUG from the list below — not by the
numeric id (ids are opaque and easy to confuse). Then target it with
` + "`bk <app> workspace use <slug>`" + ` or a per-command ` + "`--ws <slug>`" + `. The active
workspace is only a default, not necessarily where you mean to write.

Use --ws <slug|id> to preview another workspace's context without switching.

--contract-version prints ONE line: a short fingerprint of this app's
vocabularies, limits and type lists. Poll it instead of re-reading this whole
document and the --help tree behind it — if it has not moved since your last
run, nothing in this app's contract has. It is derived from the contract itself,
so it cannot be forgotten the way a hand-bumped number can, and it does NOT
change on a redeploy that changed nothing.

--vocab <key> prints ONE vocabulary as a flat list — the values, one per line,
and a plain array under --json so it pipes. It is the answer to "what are the
valid stages?" without a parser, and it is the AUTHORITY: a flag's --help may
enumerate the values it knew when the binary was built, this reads the server.

  bk meta --vocab            list the keys this server serves
  bk meta --vocab stages     the values, with their labels
  bk meta                    unchanged

An unknown key is an error naming the keys that exist.`,
		// A positional is accepted ONLY as `--vocab`'s argument. pflag hands a
		// bare `--vocab` its NoOptDefVal and leaves the next word in args, which
		// is what makes `--vocab stages` and `--vocab=stages` both work; without
		// this check `bk meta stages` would be silently ignored, as it was.
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return nil
			}
			if !cmd.Flags().Changed("vocab") || len(args) > 1 {
				return cmdutil.Usagef("unexpected argument %q — `bk meta` takes none, and a "+
					"vocabulary key goes to `bk meta --vocab <key>`", args[0])
			}
			return nil
		},
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

			if contractOnly {
				return renderContractVersion(cmd, format, meta)
			}

			if cmd.Flags().Changed("vocab") {
				return renderVocab(cmd, format, meta, vocabKeyFrom(vocabKey, args))
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
	cmd.Flags().BoolVar(&contractOnly, "contract-version", false,
		"Print ONLY this app's contract fingerprint — poll it to detect drift cheaply")
	cmd.Flags().StringVar(&vocabKey, "vocab", "",
		"Print ONE vocabulary as a flat list; pass no key to list the keys this server serves")
	// Makes a bare `bk meta --vocab` legal. The cost is that `--vocab stages`
	// leaves "stages" as a positional, which the Args validator above expects and
	// RunE reads back — see the note there.
	cmd.Flags().Lookup("vocab").NoOptDefVal = vocabAsked
	return cmd
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

// renderContractVersion prints the current app's contract fingerprint (#31).
//
// One line on stdout and nothing else, because the whole value of this command
// is that it is cheap to run and trivial to compare:
//
//	prev=$(cat .bk-contract); now=$(bk meta --contract-version)
//	[ "$prev" = "$now" ] || bk guide   # only then pay for the full re-read
//
// An EMPTY value from an older server is an error rather than an empty line.
// "" and "unchanged" must not look alike to a caller diffing two runs — that is
// the one way this command could silently tell somebody their contract is
// stable when it has no idea.
func renderContractVersion(cmd *cobra.Command, format output.Format, meta *client.Meta) error {
	app, ok := meta.Apps[meta.CurrentApp]
	if !ok || app.ContractVersion == "" {
		return fmt.Errorf(
			"this server does not serve a contract version — it predates the field; " +
				"re-read `bk meta` in full, and `bk guide` for current usage")
	}
	return output.Render(format, map[string]string{
		"app":              meta.CurrentApp,
		"contract_version": app.ContractVersion,
	}, func(w io.Writer) error {
		_, err := fmt.Fprintln(w, app.ContractVersion)
		return err
	})
}
