// The scaffold app's command group: `bk scaffold …`.
//
// ---------------------------------------------------------------------------
// WHY THIS SHIPS IN THE REAL BINARY
// ---------------------------------------------------------------------------
// It is visible, not hidden, and that is a deliberate trade-off worth stating.
//
// `CollectRoutes` skips hidden subtrees (aliases would otherwise double-claim
// every route), so a hidden group declares nothing — and a template that cannot
// be parity-checked is exactly the "builds but is not real" failure this scaffold
// exists to prevent. The plan's bar is that it passes parity ON DAY ONE, which
// requires its commands to be part of the advertised surface.
//
// The cost is one extra group in `bk --help`. It is mitigated by the leading
// underscore, by the Short line below, and by the fact that running it against a
// real deployment fails cleanly: `template` has no row in `platform.apps`, so
// `resolveWorkspace` denies app access with an actionable hint rather than
// half-working.
//
// If that cost is ever judged too high, the alternative is a `//go:build
// template` tag — which keeps the binary clean at the price of a second build
// configuration that nothing runs by default, and therefore rots.
package scaffold

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// NewCmd builds `bk scaffold`. Registered from commands/root.go, exactly as an
// app's group should be.
func NewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "scaffold",
		Short:   "Scaffold app — the worked example behind docs/adding-an-app.md (not deployed)",
		Aliases: []string{},
		Long: `The scaffold app's commands.

This app is not deployed. It exists so that docs/adding-an-app.md describes
something real and so the repo's cross-app guardrails have a second app to check
against. Copy apps/_scaffold and cli/internal/commands/scaffold/ to start a real
one; see docs/adding-an-app.md.`,
	}
	cmd.AddCommand(newNoteCmd())
	// The app-owned platform verbs this scaffold actually serves (Phase 4).
	//
	// Two, not eleven, and the shortness is the lesson: `appverbs.Config` is a
	// DECLARATION OF WHAT `app/api/**` HAS, never a wish list. This app mounts
	// `GET /api/workspaces`, `GET /api/workspaces/{ws}` and
	// `GET …/{ws}/members`, so it declares `Workspace` and `Members` and nothing
	// else. Turn on `Uploads` here and `lib/cli-parity.test.ts` immediately
	// reports a claim on `POST /api/upload`, which this app has no file for.
	//
	// `WorkspaceAdmin` is off because this app serves GET on /api/workspaces and
	// no other method; `MemberLeave` because there is no /leave route.
	cmd.AddCommand(appverbs.New(appverbs.Config{
		App:       Slug,
		Workspace: true,
		Members:   true,
	}).All()...)
	return cmd
}

// Slug is this app's name — the first segment of `bk scaffold …` and the key in
// the CLI's app registry. One spelling, used everywhere.
const Slug = "scaffold"

func newNoteCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "note",
		Short: "The scaffold's one entity",
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
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			notes, err := c.ListScaffoldNotes(ws, limit)
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
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			note, err := c.CreateScaffoldNote(ws, client.CreateScaffoldNoteRequest{Title: title, Body: body})
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
