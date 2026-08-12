package issues

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/spf13/cobra"
)

// "Which project?" — answered by an id OR a name, everywhere `--project` is a
// flag.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// `--project` took an id and only an id, so creating a project and immediately
// putting an issue in it meant capturing the id out of the create output, or
// running `project list` again to find it. Two separate reports raised it. The
// name is what the caller has; the id is what the caller has to go and get.
//
// THE RULE IS THE ONE `label attach` ALREADY USES (2026-08-11): a bare integer
// is an ID, anything else is a NAME. It carries the same ambiguity, and the
// same answer — a project literally named "12" cannot be reached by name, and
// the help says so.
//
// ---------------------------------------------------------------------------
// WHERE A NAME IS AMBIGUOUS IT IS AN ERROR, AND THAT IS NOT THE LABEL RULE
// ---------------------------------------------------------------------------
// Two labels cannot share a name; two projects can, and nothing stops it. So a
// name matching more than one project is refused with every match and its id,
// never resolved by "pick the first" — silently acting on one of two records
// the caller did not distinguish is the failure this file exists to avoid, and
// it would land a write on the wrong project with a success message.

// projectFlagHelp is the shared tail of every --project description, so the
// twelve places that take one describe it identically.
const projectFlagHelp = "id or NAME (a bare integer is an id; a name must match exactly one project)"

// resolveProjectRef turns a --project value into a project id.
//
// An empty value returns 0 — every caller reads that as "not given" and either
// omits the filter or raises its own "required" error, which keeps the "which
// flags are required" message where it already was.
//
// The client is fetched lazily by the caller and passed in: a bare integer must
// NOT cost an HTTP call, because that is what every existing script passes.
func resolveProjectRef(c *client.Client, ref string) (int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return 0, nil
	}
	if n, err := strconv.Atoi(ref); err == nil {
		return n, nil
	}

	// `search` is server-side and matches name/description, so it narrows the
	// list; it does NOT decide. The exact, case-insensitive name match below is
	// what decides, because a substring hit on a description is not the project
	// the caller named.
	projects, err := c.ListProjects(ref)
	if err != nil {
		return 0, fmt.Errorf("resolve project %q: %w", ref, err)
	}
	var matches []client.Project
	for _, p := range projects {
		if strings.EqualFold(strings.TrimSpace(p.Name), ref) {
			matches = append(matches, p)
		}
	}

	switch len(matches) {
	case 1:
		return matches[0].ID, nil
	case 0:
		return 0, cmdutil.Usagef(
			"no project named %q — run `bk issues project list` to see them, or pass the id", ref)
	default:
		sort.Slice(matches, func(i, j int) bool { return matches[i].ID < matches[j].ID })
		ids := make([]string, 0, len(matches))
		for _, p := range matches {
			ids = append(ids, fmt.Sprintf("#%d", p.ID))
		}
		// Both (all) values named, so a caller that built the name from a
		// variable can see WHICH records collided. Exit 2, like every other
		// "you typed this wrong": a usage mistake must not read as a runtime
		// fault to an agent branching on the code.
		return 0, cmdutil.Usagef(
			"%d projects are named %q (%s) — pass the id instead; nothing was changed",
			len(matches), ref, strings.Join(ids, ", "))
	}
}

// ---------------------------------------------------------------------------
// `project updates add` — the project as a FLAG as well as a positional
// ---------------------------------------------------------------------------
// `issue create` takes `--project`; this command takes a positional, and an
// agent that had just created an issue typed `--project 12` here and paid a
// round trip to be told it is not a flag. Both shapes now resolve and NOTHING
// IS RENAMED: the canonical spelling — the one in `Use`, and therefore in
// `--help` — is still the positional.
//
// This is `resolveProspect`'s shape (cli/internal/commands/sales/prospectref.go),
// reimplemented rather than imported: `boundaries_test.go` forbids one app's
// command package importing another's, and that boundary is worth more than
// twenty shared lines.

// addProjectFlag registers the alternative spelling on a command whose
// canonical shape is positional.
func addProjectFlag(cmd *cobra.Command, target *string) {
	cmd.Flags().StringVar(target, "project", "",
		"The project — "+projectFlagHelp+" (an alternative to giving it as the first argument)")
}

// resolveProjectPositionalOrFlag answers "which project?" for a command whose
// project is normally the first argument, and returns the remaining arguments.
//
// `tailCount` is how many arguments the command takes AFTER the project. It is
// what keeps the leading positional optional without the two shapes becoming
// ambiguous: with N+1 arguments the first is the project, with N it must come
// from `--project`. Callers pair it with
// `Args: cobra.RangeArgs(tailCount, tailCount+1)`, so a wrong COUNT is refused
// by cobra before this runs.
func resolveProjectPositionalOrFlag(cmd *cobra.Command, c *client.Client, args []string, flagValue string, tailCount int) (int, []string, error) {
	fromFlag := cmd.Flags().Changed("project")

	positional := ""
	tail := args
	switch len(args) {
	case tailCount + 1:
		positional, tail = args[0], args[1:]
	case tailCount:
		// The project has to come from the flag.
	default:
		// Unreachable behind RangeArgs, kept so a caller that forgets the
		// validator fails loudly instead of indexing past the slice.
		return 0, nil, cmdutil.Usagef("wrong number of arguments — %s", cmd.UseLine())
	}

	if positional == "" && !fromFlag {
		return 0, nil, cmdutil.Usagef(
			"which project? give it first (%s), or pass --project <id-or-name>", cmd.UseLine())
	}

	if positional == "" {
		id, err := resolveProjectRef(c, flagValue)
		if err != nil {
			return 0, nil, err
		}
		if id <= 0 {
			return 0, nil, cmdutil.Usagef(
				"invalid project %q for --project — run `bk issues project list` to see them", flagValue)
		}
		return id, tail, nil
	}

	id, err := resolveProjectRef(c, positional)
	if err != nil {
		return 0, nil, err
	}
	if fromFlag {
		flagID, err := resolveProjectRef(c, flagValue)
		if err != nil {
			return 0, nil, err
		}
		if flagID != id {
			// Both values named, so an agent that built one of them from a
			// variable can see WHICH one it got wrong.
			return 0, nil, cmdutil.Usagef(
				"two different projects: the argument says #%d and --project says #%d "+
					"— pass one, not both; nothing was changed", id, flagID)
		}
	}
	return id, tail, nil
}
