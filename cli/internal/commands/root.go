package commands

import (
	"fmt"
	"os"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/platform"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/sales"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/scaffold"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// The --ws override and the -v flag are bound to cmdutil.WSOverride /
// cmdutil.VerboseFlag below. They live in cmdutil rather than here because both
// command packages (platform and issues) read them, and those two must not
// import each other — docs/platform-architecture.md §7.1.

// rootLong is deliberately thin. It used to duplicate the web manifest's
// "conventions for agents" block, which meant every convention lived in two
// places and drifted. All of that now lives in the embedded guide
// (internal/guide/topics), which ships with the binary and is served by
// `bk guide`. What stays here: what bk is, the first run, the global flags, the
// exit codes, the command groups, and one loud pointer.
//
// ORGANISED BY TIER, and there are TWO of them since 2.1.0
// (multiAppFinalRefactor Phase 4). This is the first text an agent reads, and
// the question it has to answer on the first pass is not "what verbs exist?" but
// "which app is this command talking to?". A flat list cannot answer that; two
// named groups can, and the split is the same idea the guide, the error hints
// and `bk meta`'s routing block all repeat.
//
// The third tier — CROSS-APP — is gone, and its absence is the headline. It
// existed because the apps shared a database; they no longer do.
const rootLong = `bk is the CLI for the Blackcode platform — one login, one token,
and one command group per app.

It is the ONLY supported interface. The HTTP API behind it is private plumbing
with no public contract.

Agents: run "bk guide" first — it is the complete, always-current usage guide
for THIS binary. Then "bk meta" to see where each command will go.

First run:
  bk login --server URL           # opens browser, captures token
  bk skill install                # write the agent skill file for this project
  bk guide                        # how to use this binary (offline, no auth)
  bk meta                         # who am I + every app + where each goes
  bk <app> workspace use <slug>   # set THAT APP's active workspace

Global flags:
  -o table|json|yaml|yml   output format (default: table)
  --json / --yaml / --yml  shortcuts; piping to jq/yq is intended
  --ws <slug|id>           target ONE command at another workspace
  -v / --verbose           log each HTTP request/response to stderr

Exit codes (stable; for branching in scripts/agents):
  0 ok   1 generic   2 usage   3 auth(401)   4 perm(403)
  5 not-found(404)   6 validation(400/422)   7 user-aborted
  8 client too old   9 update available

TWO TIERS OF VERB, and the spelling tells you which — run "bk guide
platform/apps" for the rule and the reasoning.

  1. BARE — your ACCOUNT and this BINARY. One login and one token are valid
     against every app, so no app can be the wrong one to ask.
       login       authenticate (--server names ANY app's url)
       logout      remove stored credentials
       whoami      the account this token belongs to
       token       list, create, delete
       profile     view, edit
       meta        who am I + every app + where each command will go
       app         the address book: which apps exist and where they live
       guide       the embedded usage guide (--list, <topic>, --json)
       skill       install / check / sync the agent skill file
       changelog   the dated record of what changed
       version     print the version of this binary
       super-admin users, whitelist, errors (super admins only; platform-wide)

  2. APP-OWNED — "bk <app> <verb>", because the answer depends on the app.
     Each app has its OWN workspaces, members, labels, files and history.
       bk <app> workspace  list, show, use (+ create/edit/transfer/delete
                           where the app serves them)
       bk <app> member     list, remove, leave
       bk <app> invite     send, list, revoke, candidates; show, accept, decline,
                           pending (redeeming one addressed to you)
       bk <app> upload     store a file against that app
       bk <app> trash      that app's recycle bin: list, restore, purge, empty
       bk <app> label      list, view, create, edit, delete, attach, detach
       bk <app> search     find things in that app
       bk <app> activity   that app's history (--since)
       …plus that app's own nouns.

     EACH APP REMEMBERS ITS OWN ACTIVE WORKSPACE. "bk sales workspace use x"
     does not move "bk issues". They are different tables that happen to share
     some ids, so a slug only means something against the app it came from.

     Not every app serves every verb: "bk <app> --help" is the list for that
     app, and a verb it does not serve is simply absent rather than a 404.

APPS — every app verb sits behind its app name:
  issues      issue, task, project, attachment, move, copy, analytics
  sales       prospect, contact, meeting, comm, product, template, doc, …

CHANGED 2026-08-10 (2.1.0), and it is a breaking change for anything scripted:
"workspace", "member", "invite", "user", "inbox", "storage", "search" and
"activity" moved behind the app name, and "link" was REMOVED. The apps stopped
sharing a database, so a bare spelling had no correct answer — only a default,
taken from whichever app you were last homed on, with nothing in the command
saying which. Every old spelling exits non-zero and names its replacement.
Run "bk changelog".

Discover flags before calling: bk <group> --help, then bk <group> <cmd> --help.`

func NewRoot() *cobra.Command {
	root := &cobra.Command{
		Use:          "bk",
		Short:        "Blackcode platform command-line interface",
		Long:         rootLong,
		SilenceUsage: true,
		// main.go owns error output: it prints `error: <msg>` and, when the
		// failure is one an agent can recover from, a `hint:` line under it.
		// Letting cobra print too gave every failure two lines saying the same
		// thing on the channel agents parse.
		SilenceErrors: true,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			// Verbose can be turned on per-invocation (--verbose) or via env.
			if cmdutil.VerboseFlag || os.Getenv("BK_DEBUG") == "1" {
				client.Verbose = true
			}
		},
	}
	output.RegisterFlags(root)
	root.PersistentFlags().StringVar(&cmdutil.WSOverride, "ws", "", "Target workspace (slug or id) for this command only; does not change the active workspace")
	root.PersistentFlags().BoolVarP(&cmdutil.VerboseFlag, "verbose", "v", false, "Log each HTTP request/response to stderr (or set BK_DEBUG=1)")
	// --app-server, NOT --app. `--app` is already a FILTER on six commands
	// (`bk activity --app`, `bk search --app`, `bk storage list --app`,
	// `bk changelog --app`, `bk guide --app`, `bk invite send --app`), and a
	// persistent root flag of the same name does not collide loudly: cobra lets
	// the local flag shadow it, so `bk --app sales storage list` would silently
	// have FILTERED by sales instead of routing to it, and `bk storage list
	// --app issues` would have routed instead of filtering. Both read as working.
	// Found by the two-server routing test, which is the only thing that could
	// have found it. This name says which of the two it is.
	root.PersistentFlags().StringVar(&cmdutil.AppOverride, "app-server", "",
		"Send this invocation's BARE (identity) verbs to <app>'s server (`bk <app> …` ignores it — it pins its own app; `bk app use` changes it permanently)")
	// Tiers 1 and 2 (D-11): the verbs that stay bare because no app can be the
	// wrong one to ask, and the ones whose job is to cross the boundary.
	root.AddCommand(platform.NewCommands()...)
	root.AddCommand(newRoutesCmd())

	// One entry per app. Adding an app is adding a line here plus its package —
	// which is the whole point of the migration.
	//
	// Tier 3 is NOT wired here: each app group mounts the app-owned verbs itself,
	// in one line, from internal/appverbs — see issues.NewGroup(). Doing
	// it there rather than here is what lets an app add its own entity-specific
	// subcommands to those groups (`bk issues label attach`) without this file
	// knowing any app's nouns.
	for _, group := range []*cobra.Command{issues.NewGroup(), sales.NewGroup(), scaffold.NewCmd()} {
		pinApp(group, group.Name())
		root.AddCommand(group)
	}

	// The pre-1.10.0 spellings (`bk issue …`, `bk task …`, …) were registered
	// here as working, warning aliases from 1.10.0. **Removed in 1.12.0**, on the
	// two-minor schedule promised when they were introduced.
	//
	// The rows in deprecations.go deliberately STAY for one more release. Cobra
	// now answers `bk issue create` with `unknown command "issue" for "bk"`, and
	// hintFor() turns that into the new spelling — so the removal still names its
	// own exit instead of dead-ending an agent mid-run. A hint outliving the
	// thing it replaces is the point.

	rejectUnknownSubcommands(root)
	return root
}

// pinApp makes every command in an app group's subtree talk to THAT app's
// server (D-1), whatever the home app is and whatever `--app` says.
//
// Applied to the subtree rather than passed to each command, and that is the
// whole point. `bk issues …` has around sixty leaves; threading a slug through
// every one of them means the first command someone adds without it silently
// talks to the home server — and "silently talks to the wrong server" is the
// exact failure D-1 exists to remove. There is no spelling under `bk issues`
// that can miss this, because it is applied to the tree, not to a call site.
//
// It wraps Run/RunE rather than using a PersistentPreRun hook: cobra runs only
// the CLOSEST PersistentPreRun up the chain, so a hook here would silently
// disable the root's (which is what turns on --verbose) for every app command.
// Enabling EnableTraverseRunHooks globally to fix that would change the order
// of every hook in the tree to buy nothing this does not.
//
// Nothing is pinned outside an app group: the neutral and cross-app verbs are
// meant to follow the home app, which is what an empty pin means.
func pinApp(cmd *cobra.Command, app string) {
	if run := cmd.RunE; run != nil {
		cmd.RunE = func(c *cobra.Command, args []string) error {
			cmdutil.PinApp(app)
			return run(c, args)
		}
	} else if run := cmd.Run; run != nil {
		cmd.Run = func(c *cobra.Command, args []string) {
			cmdutil.PinApp(app)
			run(c, args)
		}
	}
	for _, sub := range cmd.Commands() {
		pinApp(sub, app)
	}
}

// rejectUnknownSubcommands makes a mistyped subcommand a hard failure instead of
// a silent success.
//
// Cobra's default for a command GROUP (a command that has subcommands but no
// action of its own) is to print help and return nil — so `bk workspace notacmd`
// exited 0. For an agent branching on exit codes that reads as "it worked", and
// it also made the deprecation machinery unreachable: main.go's hintFor() has an
// "unknown command" branch feeding DeprecationHint, and it could never fire for
// a renamed subcommand.
//
// The fix has to be a RunE rather than `Args: cobra.NoArgs`, because cobra
// returns flag.ErrHelp for any non-runnable command BEFORE it validates args —
// so NoArgs on a group never runs. Giving the group a RunE makes it runnable,
// and the RunE does the check itself.
//
// Applied here by walking the tree, so it covers every group that exists now and
// every one added later without anyone remembering to opt in. groups_test.go
// asserts it holds.
func rejectUnknownSubcommands(cmd *cobra.Command) {
	for _, sub := range cmd.Commands() {
		rejectUnknownSubcommands(sub)
	}
	if !cmd.HasSubCommands() || cmd.Runnable() {
		return
	}
	cmd.RunE = func(c *cobra.Command, args []string) error {
		if len(args) > 0 {
			return fmt.Errorf("unknown command %q for %q", args[0], c.CommandPath())
		}
		// No args: `bk workspace` on its own is a legitimate way to ask what a
		// group can do. Print help and succeed.
		return c.Help()
	}
}
