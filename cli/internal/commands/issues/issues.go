// Package issues holds the command tree for the issues app — everything under
// `bk issues …`.
//
// It is one Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1). Anything two apps need lives in
// internal/cmdutil; anything only this app needs lives here. Reading the import
// block of this package is meant to be enough to answer "does issues reach into
// another app?".
//
// Why the app name is a required segment, when there is exactly one app: it
// removes noun collisions before they can happen. Every app eventually wants
// `report`, `note`, `status` — and `bk sales deal create` says which app it is
// while `bk deal create` does not. Doing it with one app is a rename; doing it
// with three is a migration with N callers.
package issues

import "github.com/spf13/cobra"

// Slug is this app's name — the first segment of `bk issues …`, the key in
// `bk meta`'s apps object, and the primary key in platform.apps. One spelling,
// used everywhere.
const Slug = "issues"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Issue tracker — issues, tasks, projects, analytics"

const long = `The issues app: projects, issues, tasks, their comments and their analytics.

  bk issues issue     list, view, create, edit, delete, assign, watch, comment(s),
                      edit-comment, delete-comment, attach, detach, activity
  bk issues task      list, view, create, edit, delete, comment(s)
  bk issues project   list, view, create, edit, delete, members, updates, comment(s)
  bk issues attachment  files attached to issues, workspace-wide
  bk issues move      move projects/tasks/issues to another workspace (--to)
  bk issues copy      the same, leaving the source in place
  bk issues analytics summary, throughput and distributions for this app

APP-OWNED PLATFORM VERBS — the same three under every app, each answering for
ITS app:

  bk issues workspace  this app's workspaces: list, show, use, create, edit,
                       transfer, delete
  bk issues member     list, remove, leave
  bk issues invite     send, list, accept, decline, revoke, pending, candidates
  bk issues user       the people you share a workspace with, in this app
  bk issues upload     store a file against this app
  bk issues trash      this app's recycle bin: list, restore, purge, empty
  bk issues label      labels, and attaching them to this app's issues
  bk issues search     find an issue, task or project by title (returns URNs)
  bk issues activity   this app's history (--since 24h, --subject <urn>)
  bk issues inbox      your notifications from this app
  bk issues storage    this app's uploaded files and the workspace's usage

THIS APP'S ACTIVE WORKSPACE IS ITS OWN. "bk issues workspace use x" does not
move any other app's — since 2026-08-10 each app has its own workspace table,
and the ids overlap, so a slug only means something against the app it came from.

Bare verbs are now identity and this binary only: login, logout, whoami, token,
profile, meta, app, guide, skill, changelog, version, super-admin. Run
"bk guide platform/apps" for the rule, or "bk --help" for the list.

The old un-namespaced spellings were REMOVED in 1.12.0: "bk issue list" is now
"bk issues issue list". The old form exits non-zero and names its replacement.
See "bk changelog".`

// NewGroup returns the `bk issues` command group — the canonical spelling.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	// The app-owned platform verbs, pinned to this app (D-11). One line per app,
	// and the app-specific subcommands are added inside — see appverbs.go.
	cmd.AddCommand(appOwnedVerbs()...)
	return cmd
}

// LegacyTopLevel returns a SECOND, independent copy of the SIX nouns that had a
// bare spelling before 1.10.0 — `bk issue …`, `bk task …`, and so on.
//
// It is a fresh construction rather than a shared pointer on purpose: cobra
// commands carry per-invocation state (parsed flags, parent links), so the same
// *cobra.Command cannot hang off two parents. It fed the aliases while they
// existed; since 1.12.0 removed them its only reader is
// commands/alias_removal_test.go, which asserts each old spelling now fails AND
// still carries a deprecations.go row naming its replacement.
//
// **THIS LIST IS FROZEN — it is history, not a noun list.** It used to return
// nouns() and must not again: a noun added today (`attachment`, D-28) never had a
// bare spelling, so requiring a deprecation hint for it would be asserting a
// migration that never happened. Adding one here fails the removal test, which is
// the correct outcome and a confusing way to learn this.
func LegacyTopLevel() []*cobra.Command {
	return []*cobra.Command{
		newIssueCmd(),
		newTaskCmd(),
		newProjectCmd(),
		newMoveCmd(),
		newCopyCmd(),
		newAnalyticsCmd(),
	}
}

// nouns is this app's CURRENT surface — what `bk issues` offers today.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		newIssueCmd(),
		newTaskCmd(),
		newProjectCmd(),
		newAttachmentCmd(),
		newMoveCmd(),
		newCopyCmd(),
		newAnalyticsCmd(),
	}
}
