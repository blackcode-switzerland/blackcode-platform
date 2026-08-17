// Package books holds the command tree for the b/books app — everything under
// `bk books …`.
//
// One Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1, enforced by commands/boundaries_test.go).
// Anything two apps need lives in internal/cmdutil or internal/appverbs; anything
// only this app needs lives here.
//
// ---------------------------------------------------------------------------
// THE GROUP PINS ITS APP
// ---------------------------------------------------------------------------
// `bk books …` always talks to `app_servers["books"]`. It is not affected by
// `bk app use`, by `--app-server`, or by whatever the previous command did — the
// pin is applied to the whole subtree in commands/root.go, so there is no
// spelling under this group that can reach the wrong deployment.
//
// ---------------------------------------------------------------------------
// WHY THE CLI IS HALF OF THIS APP RATHER THAN A REPORTING TOOL
// ---------------------------------------------------------------------------
// b/books is a tool that agents operate from outside; the web surface is
// read-mostly (docs/books-app-plan/). So the CLI is not a convenience layer over
// a UI-first app — for the whole of week one it carries every write, and the four
// screens read. `bk books entry create` is how books get kept.
//
// That also means the parity guard matters more here than usual: a route with no
// command is a capability the agent that actually does the bookkeeping cannot
// reach.
package books

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// Slug is this app's name — the first segment of `bk books …`, the key in
// `bk meta`'s apps object, the Postgres schema, and the primary key in
// platform.apps. One spelling, used everywhere.
const Slug = "books"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Swiss statutory bookkeeping — books, entries, evidence"

const long = `The b/books app: statutory bookkeeping for any number of books.

A BOOK is one legal entity's set of accounts: a company, or a person's
self-employment activity. A user may have as many as they need, and nothing in
this app assumes a particular number.

  bk books note       placeholder entity, phase 0 only (see below)

THIS APP'S OWN TENANCY — the same verbs every app has, answering for THIS one:

  bk books workspace  list, show, use
  bk books member     list, remove
  bk books invite     send, list, revoke

"bk books workspace use x" sets THIS app's active workspace and no other's.

WHAT IS NOT HERE YET, and deliberately so. Phase 0 has built the app skeleton,
its schema and this command group; the bookkeeping nouns land in phases 1 and 2:

  entry, account, exercice, bilan, cr   phase 1 — the statutory core
  rule, worklist, resolve               phase 2 — recognition
  source, piece                        phase 3
  analyse, tax                         phase 4

"note" is the scaffold's placeholder entity. It is carried so this app has a
route and a command that can be parity-checked while phase 0 is in progress, and
it is REMOVED in phase 1 when the ledger entry replaces it. Do not build anything
on it.

THE DOCTRINE, because it explains the shape: this app holds no intelligence. It
stores legible records and derives statements; the judgement lives in the agent
driving these commands from outside. Nothing here decides what a transaction
means — you tell it, and it remembers so the next one is automatic.

Vocabularies and limits are served live by "bk meta". They change without a
release of this binary, so this help text does not list them.

Bare verbs are identity and this binary only: login, logout, whoami, token,
profile, meta, app, guide, skill, changelog, version, super-admin. Run
"bk guide platform/apps" for the rule.`

// NewGroup returns the `bk books` command group. Registered from
// commands/root.go, exactly as an app's group should be.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	cmd.AddCommand(appOwnedVerbs()...)
	return cmd
}

// nouns is this app's surface — what `bk books` offers today.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		newNoteCmd(),
	}
}

// appOwnedVerbs declares the app-owned platform verbs THIS app serves.
//
// `appverbs.Config` is a DECLARATION OF WHAT `app/api/**` HAS, never a wish
// list. Turn on `Uploads` and lib/cli-parity.test.ts immediately reports a claim
// on `POST /api/upload`, which this app has no file for — and never will:
// supporting documents are Google Drive references, so b/books records no
// uploads at all.
//
// `Trash` and `Label` are off, and for books that is permanent rather than
// pending. Accounting rows have a ten-year retention duty (art. 958f CO), so
// there is no purge path to expose; see docs/books-app-plan/phase-5-compliance.md.
//
// `Invites` is the owner's half only — send, list, revoke — because that is what
// this app serves. `InviteCandidates` and `InviteAccept` are off: there is no
// `/invite-candidates`, no `/api/invitations/accept` and no
// `/api/me/pending-invitations` here. Flipping a flag without its route claims
// something that can only 404.
//
// `WorkspaceAdmin` is off because this app serves GET on /api/workspaces and no
// other method; `MemberLeave` because there is no /leave route.
func appOwnedVerbs() []*cobra.Command {
	return appverbs.New(appverbs.Config{
		App:       Slug,
		Workspace: true,
		Members:   true,
		Invites:   true,
	}).All()
}

// ---------------------------------------------------------------------------
// note — the scaffold's placeholder. Removed in phase 1.
// ---------------------------------------------------------------------------

func newNoteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "note",
		Short: "Placeholder entity (phase 0 only — removed when the ledger lands)",
	}
	cmd.AddCommand(newNoteListCmd(), newNoteCreateCmd())
	return cmd
}

func newNoteListCmd() *cobra.Command {
	var limit int
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/notes"},
		Short:       "List notes in the active workspace",
		Args:        cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			notes, err := c.ListBooksNotes(ws, limit)
			if err != nil {
				return err
			}
			return output.Render(format, notes, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "#\tTITLE\tCREATED")
				for _, n := range notes {
					fmt.Fprintf(tw, "%d\t%s\t%s\n", n.Number, cmdutil.Truncate(n.Title, 48), n.CreatedAt)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(notes) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no notes)")
				}
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 50, "Max notes to return (1-200)")
	return cmd
}

func newNoteCreateCmd() *cobra.Command {
	var title, body string
	cmd := &cobra.Command{
		Use:         "create --title <title>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/notes"},
		Short:       "Create a note",
		Args:        cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			note, err := c.CreateBooksNote(ws, client.CreateBooksNoteRequest{Title: title, Body: body})
			if err != nil {
				return err
			}
			return output.Render(format, note, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "created note #%d: %s\n", note.Number, note.Title)
				return err
			})
		},
	}
	cmd.Flags().StringVar(&title, "title", "", "Note title (required)")
	cmd.Flags().StringVar(&body, "body", "", "Note body")
	_ = cmd.MarkFlagRequired("title")
	return cmd
}

// clientAndWorkspace resolves the credential and THIS app's active workspace.
//
// One helper for every command in this package, because the failure it prevents
// is the same everywhere: a command that silently acted on whichever workspace
// happened to be remembered by another app. The active workspace is keyed by app
// slug in the CLI's own config, so `bk books workspace use` does not disturb
// sales.
func clientAndWorkspace() (*client.Client, string, error) {
	c, cfg, err := cmdutil.NewClientAndConfig()
	if err != nil {
		return nil, "", err
	}
	ws, err := cmdutil.RequireActiveWorkspace(cfg)
	if err != nil {
		return nil, "", err
	}
	return c, ws, nil
}
