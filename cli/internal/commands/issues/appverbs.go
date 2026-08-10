package issues

import (
	"fmt"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/spf13/cobra"
)

// What THIS app adds to the app-owned platform verbs (D-11).
//
// `internal/appverbs` builds `upload`, `trash` and `label` for every app. One of
// those groups has subcommands that name an ENTITY rather than a workspace, and
// an entity belongs to one app:
//
//	label attach|detach   takes an issue and posts to /api/workspaces/{ws}/issues/{id}/labels
//
// They live here, not in the shared package, and that is the split that keeps
// the parity guard honest: `bk __routes` tags them with this app, so the claim
// is checked against apps/issues — the tree that actually serves them. Put them
// in the shared package and every app would claim an issues route.
//
// The workspace-wide attachments view is NOT here: it is `bk issues attachment
// list`, a noun of this app (attachment.go), because it was never a platform
// verb wearing an app hat — it lists issue attachments and nothing else. See
// D-28: one noun must not straddle two tiers.
func appOwnedVerbs() []*cobra.Command {
	set := appverbs.New(appverbs.Config{
		App: Slug,
		// This app's binnable entity types. Declared here because they are this
		// app's vocabulary — see the Config field's comment.
		TrashTypes: []string{"issue", "project", "task"},

		// This app serves the WHOLE shared surface, and it is the only one that
		// does. Every flag below is the honest reading of `app/api/**`: issues
		// has /workspaces (all four methods), /transfer, /leave, /invitations,
		// /users, /search, /me/inbox and /storage. Its own
		// lib/cli-parity.test.ts checks that claim against the filesystem.
		Workspace:      true,
		WorkspaceAdmin: true,
		Members:        true,
		MemberLeave:    true,
		Invites:        true,
		Users:          true,
		Search:         true,
		Activity:       true,
		Inbox:          true,
		Storage:        true,
	})
	set.Label.AddCommand(newLabelAttachCmd(), newLabelDetachCmd())
	return set.All()
}

func newLabelAttachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attach <issue_id> <label_id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/labels,GET /api/workspaces/{ws}/issues/{id}/labels"},
		Short:       "Attach a label to an issue",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.AttachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "attached label %d to issue %d\n", labelID, issueID)
			return nil
		},
	}
}

func newLabelDetachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "detach <issue_id> <label_id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid}"},
		Short:       "Detach a label from an issue",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid label_id %q", args[1])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.DetachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "detached label %d from issue %d\n", labelID, issueID)
			return nil
		},
	}
}
