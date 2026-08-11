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
		Uploads:    true,
		Trash:      true,
		Labels:     true,

		// This app serves the WHOLE shared surface, and it is the only one that
		// does. Every flag below is the honest reading of `app/api/**`: issues
		// has /workspaces (all four methods), /transfer, /leave, /invitations,
		// /users, /search, /me/inbox and /storage. Its own
		// lib/cli-parity.test.ts checks that claim against the filesystem.
		Workspace:        true,
		WorkspaceAdmin:   true,
		Members:          true,
		MemberRemove:     true,
		MemberLeave:      true,
		Invites:          true,
		InviteCandidates: true,
		InviteAccept:     true,
		Users:            true,
		Search:           true,
		Activity:         true,
		Inbox:            true,
		Storage:          true,
	})
	set.Label.AddCommand(newLabelAttachCmd(), newLabelDetachCmd())
	return set.All()
}

// THE SECOND ARGUMENT TAKES A NAME OR AN ID, AND THAT IS THE WHOLE FIX.
//
// `bk issues issue create --label urgent` has always taken a NAME, creating it
// if it did not exist. `label attach` took two IDs and needed a `label list`
// first. The two shapes describe one operation and only one of them is
// guessable, which is what produced Todo/issues-app-feedback.md item 1: the
// reporter, and then an agent, concluded from the friction that labelling was
// not exposed at all.
//
// **The server never required an id.** `POST …/issues/{id}/labels` accepts
// `{"label_id": n}` OR `{"name": "…"}` and has since it was written. The
// restriction was one `strconv.Atoi` in this file with no counterpart on the
// route — a CLI that was stricter than its own API.
//
// A bare integer still means an ID. That is deliberate and it is the one
// ambiguity here: a label literally named "58" cannot be attached by name. It is
// the right way round, because every id in this binary is an integer and every
// script that already passes one keeps working, whereas a numeric label name is
// a thing nobody has.
func labelTargetArg(arg string) (id int, name string) {
	if n, err := strconv.Atoi(arg); err == nil {
		return n, ""
	}
	return 0, arg
}

func newLabelAttachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attach <issue_id> <label>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/labels,GET /api/workspaces/{ws}/issues/{id}/labels"},
		Short:       "Attach a label to an issue (by name or id)",
		Long: `<label> is a NAME or an id. A name is matched case-insensitively and
CREATED if it does not exist yet — the same resolution ` + "`bk issues issue create --label`" + `
uses, so no ` + "`label list`" + ` is needed first. A bare integer is read as an id.`,
		Example: `  bk issues label attach 189 urgent
  bk issues label attach 189 58`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			labelID, name := labelTargetArg(args[1])
			if name != "" {
				if err := c.AttachIssueLabelByName(ws, issueID, name); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "attached label %q to issue %d\n", name, issueID)
				return nil
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
		Use:         "detach <issue_id> <label>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid},GET /api/workspaces/{ws}/issues/{id}/labels"},
		Short:       "Detach a label from an issue (by name or id)",
		Long: `<label> is a NAME or an id. A name is resolved against the labels this
issue actually carries, and a miss is an error naming what it does have —
never a silent success. A bare integer is read as an id.`,
		Example: `  bk issues label detach 189 urgent
  bk issues label detach 189 58`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			issueID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid issue_id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			labelID, name := labelTargetArg(args[1])
			if name != "" {
				if err := c.DetachIssueLabelByName(ws, issueID, name); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "detached label %q from issue %d\n", name, issueID)
				return nil
			}
			if err := c.DetachIssueLabel(ws, issueID, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "detached label %d from issue %d\n", labelID, issueID)
			return nil
		},
	}
}
