package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/guide"
	"github.com/spf13/cobra"
)

// The `routes` annotation every leaf command carries.
//
// This is the replacement for the deleted OpenAPI spec's job. We no longer care
// that a hand-written document describes every route; we care that every route
// is REACHABLE FROM `bk` — because the CLI is now the only supported interface,
// a route with no command is a capability an agent cannot use.
//
// Format: comma-separated "METHOD /api/path" entries, path params in braces
// exactly as the route file names them ({ws}, {id}, …). The literal "none" means
// the command makes no HTTP call (guide, skill install, version, logout).
// "none" is required rather than allowed-to-be-empty so an oversight is visible:
// a missing annotation fails the Go test, an explicit "none" states intent.
const routesAnnotation = "routes"

// RouteEntry is one method+path pair claimed by the CLI.
type RouteEntry struct {
	Method  string `json:"method"`
	Path    string `json:"path"`
	Command string `json:"command"`
	// App is which app's surface this command belongs to: an app slug, or
	// "platform" for the bare verbs every app shares.
	//
	// Added in Phase 8, when a second app made parity a PER-APP question. Before
	// it, "the CLI claims a route that does not exist" could be answered against
	// one app's app/api/** tree. With two, `bk scaffold note list` legitimately
	// claims a route that exists only in apps/_scaffold, and checking it against
	// apps/issues would report drift that is not drift — or, worse, be silenced
	// by an exclusion and stop checking anything.
	App string `json:"app"`
}

// appForCommand decides which app a command path belongs to.
//
// The authority is the GUIDE's section list, not a hardcoded slice here: the
// topics directory is already the list of apps (guide.AppSections()), and one
// list that two things read cannot disagree with itself. A new app that adds its
// guide topics gets correct route attribution for free; one that does not is
// already failing the guide test.
func appForCommand(path string) string {
	fields := strings.Fields(path)
	if len(fields) < 2 {
		return guide.PlatformSection
	}
	for _, app := range guide.AppSections() {
		if fields[1] == app {
			return app
		}
	}
	return guide.PlatformSection
}

// newRoutesCmd is the hidden `bk __routes`: it walks the command tree and prints
// the union of every declared route as JSON. lib/cli-parity.test.ts shells out to
// it and diffs the result against app/api/**, failing the build on either gap.
func newRoutesCmd() *cobra.Command {
	var missingOnly bool
	cmd := &cobra.Command{
		Use:    "__routes",
		Short:  "Print the API routes this CLI covers (internal; used by the parity test)",
		Hidden: true,
		Args:   cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			entries, missing := CollectRoutes(cmd.Root())
			if missingOnly {
				for _, m := range missing {
					fmt.Fprintln(os.Stdout, m)
				}
				if len(missing) > 0 {
					return fmt.Errorf("%d leaf command(s) have no `routes` annotation", len(missing))
				}
				return nil
			}
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(map[string]any{
				"routes":               entries,
				"commands_unannotated": missing,
			})
		},
	}
	cmd.Flags().BoolVar(&missingOnly, "missing", false, "List leaf commands with no routes annotation and fail if any")
	return cmd
}

// CollectRoutes walks the command tree and returns every declared route plus the
// full paths of any leaf commands missing the annotation. Exported so the Go test
// can assert the annotation never rots.
func CollectRoutes(root *cobra.Command) ([]RouteEntry, []string) {
	seen := map[string]RouteEntry{}
	missing := []string{}

	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		// cobra generates `help` and `completion` (with per-shell children).
		// They are machinery, not product surface — don't descend into them.
		if c.Name() == "help" || c.Name() == "completion" {
			return
		}
		// Nor into anything hidden, and that now means whole subtrees rather
		// than single commands.
		//
		// Phase 5 registers every pre-namespace spelling as a hidden alias
		// carrying a second copy of the same leaves — so `DELETE
		// /api/workspaces/{ws}/issues/{id}` was claimed by both `bk issue delete`
		// and `bk issues issue delete`. They dedupe to one entry, but WHICH name
		// landed in the artifact depended on cobra's alphabetical ordering
		// ("issue" before "issues"), i.e. on a coincidence. One rename away, the
		// parity artifact would have started advertising deprecated spellings as
		// the way to reach a route.
		//
		// Hidden means "not the advertised surface", which is exactly the
		// question this function answers. Coverage is unaffected: an alias is a
		// copy of a canonical command, never the only path to a route.
		if c.Hidden && c.HasParent() {
			return
		}
		children := c.Commands()
		// A "leaf" is a command that actually runs something. A pure group
		// (`bk issue`) has no Run and only dispatches, so it declares nothing.
		isLeaf := c.Runnable() && !hasRunnableChildren(children)
		if isLeaf && !c.Hidden && c.Name() != "help" && c.Name() != "completion" {
			raw := strings.TrimSpace(c.Annotations[routesAnnotation])
			if raw == "" {
				missing = append(missing, c.CommandPath())
			} else if raw != "none" {
				for _, part := range strings.Split(raw, ",") {
					part = strings.TrimSpace(part)
					if part == "" {
						continue
					}
					fields := strings.Fields(part)
					if len(fields) != 2 {
						missing = append(missing, c.CommandPath()+" (malformed: "+part+")")
						continue
					}
					e := RouteEntry{
						Method:  strings.ToUpper(fields[0]),
						Path:    fields[1],
						Command: c.CommandPath(),
						App:     appForCommand(c.CommandPath()),
					}
					// Keyed by APP + method + path, not method + path.
					//
					// Two apps are two deployments, so `GET /api/workspaces/{ws}/notes`
					// on one is a different route from the same path on the other.
					// Deduping without the app silently dropped the second app's
					// entry — and because the parity guard then found NO commands
					// for that app, its "discovers both sides" assertion was the
					// only thing standing between that and a vacuous green.
					//
					// Found by walking docs/adding-an-app.md: the new app copied
					// the scaffold's route path, and its parity test reported that
					// no bk command belonged to it.
					//
					// WITHIN one app, several commands legitimately claim one route
					// — `issue view` and `issue attachments` both read
					// `…/issues/{id}/attachments`. This used to keep the LAST
					// writer, so which name landed in routes.json depended on
					// cobra's alphabetical ordering, and the other command showed
					// no routes at all in docs/cli-inventory.md. That is CLAUDE.md
					// finding #5's mechanism exactly ("the second appeared to have
					// no commands"), one level down: coverage was never wrong, the
					// ATTRIBUTION was, and the artefact reads as attribution.
					//
					// So claimants accumulate. `command` is a comma-separated list
					// in route order, and the parity test's "claimed by" message
					// now names every command that would break.
					key := e.App + " " + e.Method + " " + e.Path
					if prior, ok := seen[key]; ok && prior.Command != e.Command {
						e.Command = prior.Command + ", " + e.Command
					}
					seen[key] = e
				}
			}
		}
		for _, sub := range children {
			walk(sub)
		}
	}
	walk(root)

	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]RouteEntry, 0, len(keys))
	for _, k := range keys {
		out = append(out, seen[k])
	}
	sort.Strings(missing)
	return out, missing
}

// hasRunnableChildren reports whether any non-help child can run — i.e. whether
// this command is a group rather than a leaf.
func hasRunnableChildren(children []*cobra.Command) bool {
	for _, c := range children {
		if c.Name() == "help" || c.Name() == "completion" {
			continue
		}
		if c.Runnable() || hasRunnableChildren(c.Commands()) {
			return true
		}
	}
	return false
}
