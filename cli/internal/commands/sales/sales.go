// Package sales holds the command tree for the sales app — everything under
// `bk sales …`.
//
// One Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1, enforced by commands/boundaries_test.go).
// Anything two apps need lives in internal/cmdutil or internal/appverbs; anything
// only this app needs lives here. Reading this package's import block is meant to
// be enough to answer "does sales reach into another app?".
//
// ---------------------------------------------------------------------------
// THE GROUP PINS ITS APP (D-1)
// ---------------------------------------------------------------------------
// `bk sales …` always talks to `app_servers["sales"]`. It is not affected by
// `bk app use`, by `--app-server`, or by whatever the previous command did — the
// pin is applied to the whole subtree in commands/root.go, so there is no
// spelling under this group that can reach the wrong deployment. An app with no
// entry in the registry is a hard failure naming itself and the command that
// fixes it, never a request quietly sent home.
package sales

import "github.com/spf13/cobra"

// Slug is this app's name — the first segment of `bk sales …`, the key in
// `bk meta`'s apps object, the Postgres schema, and the primary key in
// platform.apps. One spelling, used everywhere.
const Slug = "sales"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Business development — prospects, the pipeline, meetings and the catalog"

const long = `The sales app: the business-development pipeline.

  bk sales today      what is owed today, and who you are meeting
  bk sales pipeline   deal count and value by stage
  bk sales metrics    how the last N days went (--period 30d)
  bk sales search     full text INSIDE this app's records

  bk sales prospect   the core object — a company AND its deal in one:
                      list, show, create, edit, assign, stage, next, delete
  bk sales contact    decision makers at a prospect
  bk sales journey    the deal ladder — one step per stage
  bk sales meeting    the meetings ledger: list, show, schedule, log, outcome,
                      cancel, rm
  bk sales comm       the communications log: list, log, show, rm
  bk sales objection  what they pushed back on, and our counter

  bk sales product    what we sell
  bk sales template   how we say it (with render)
  bk sales doc        the one document library, and its links
  bk sales match      triangulation: which product and message fit which prospect

  bk sales preferences  your own display settings for the web app. NOT a
                      permission — the server does not consult them, and bk
                      writes the same either way

APP-OWNED PLATFORM VERBS — the same verbs every app has, each answering for ITS
app. An app serves only the ones it has routes for, so this is a SUBSET of what
"bk issues" offers, and deliberately so:

  bk sales upload     store a file against this app
  bk sales trash      this app's recycle bin: list, restore, purge, empty
  bk sales label      labels, and attaching them to this app's prospects

THE DOCTRINE, because it explains what is missing: the agent operates the
funnel and the human supervises. Nothing here decides — matches and next actions
are WRITTEN, by you, through these commands. The app never sends an email; it
records that one was sent. The aggregate views are the exception and are
computed, because arithmetic over rows is not judgement.

Vocabularies (stages, channels, meeting types, ...) and every limit are served
live by "bk meta". They change without a release of this binary, so this help
text does not list them.

THIS APP'S OWN TENANCY — the same verbs every app has, answering for THIS one:

  bk sales workspace  list, show, use. There is no create/edit/delete here: a
                      workspace is the COMPANY (D-3), and you are granted one
  bk sales member     list, remove
  bk sales invite     send, list, revoke, candidates; show, accept, decline,
                      pending (redeeming one addressed to you)
  bk sales activity   this app's history (--since 24h)

"bk sales workspace use x" sets THIS app's active workspace and no other's.

Bare verbs are identity and this binary only: login, logout, whoami, token,
profile, meta, app, guide, skill, changelog, version, super-admin. Run
"bk guide platform/apps" for the rule.

There is no "bk sales inbox", "bk sales storage" or "bk sales user": this app
serves no route for them, and a command that could only 404 is a dead end with a
help page. "bk sales member list" is who is in your workspace.`

// NewGroup returns the `bk sales` command group. Registered from
// commands/root.go, exactly as an app's group should be.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	// The app-owned platform verbs, pinned to this app (D-11). One line, and the
	// app-specific subcommands are added inside — see appverbs.go.
	cmd.AddCommand(appOwnedVerbs()...)
	return cmd
}

// nouns is this app's surface — what `bk sales` offers today.
//
// There is no `LegacyTopLevel` counterpart to the issues package's: no sales
// verb has ever had a bare spelling, so there is no migration to keep a
// deprecation hint for. Adding one would assert a rename that never happened.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		// The three aggregate views first: they are what an agent runs to find
		// out where to start, and `bk sales --help` is read top to bottom.
		newTodayCmd(),
		newPipelineCmd(),
		newMetricsCmd(),
		newSearchCmd(),

		newProspectCmd(),
		newContactCmd(),
		newJourneyCmd(),
		newMeetingCmd(),
		newCommCmd(),
		newObjectionCmd(),

		newProductCmd(),
		newTemplateCmd(),
		newDocCmd(),
		newMatchCmd(),

		// Last, and deliberately so: it is the only noun here that changes
		// nothing about the pipeline. `bk sales --help` is read top to bottom.
		newPreferencesCmd(),
	}
}
