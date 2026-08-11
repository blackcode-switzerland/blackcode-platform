package appverbs

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newInviteCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "invite",
		Short: "Manage workspace invitations",
	}
	// The owner's half — always present when Invites is set. Three routes, all
	// workspace-scoped and all served by whichever app owns the workspace.
	cmd.AddCommand(
		newInviteSendCmd(acfg),
		newInviteListCmd(acfg),
		newInviteRevokeCmd(acfg),
	)
	if acfg.InviteCandidates {
		cmd.AddCommand(newInviteCandidatesCmd(acfg))
	}
	// The invitee's half. Separate because it is a different capability and its
	// routes are not workspace-scoped: somebody redeeming a link is not yet a
	// member of anything.
	if acfg.InviteAccept {
		cmd.AddCommand(
			newInviteShowCmd(acfg),
			newInviteAcceptCmd(acfg),
			newInviteDeclineCmd(acfg),
			newInvitePendingCmd(acfg),
		)
	}
	return cmd
}

func newInviteCandidatesCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "candidates",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invite-candidates"},
		Short:       "List people you can invite to the active workspace (owner only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			if _, err := cmdutil.RequireActiveWorkspace(cfg); err != nil {
				return err
			}
			rows, err := c.ListInviteCandidates()
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tEMAIL\tSTATUS")
				for _, cand := range rows {
					name := ""
					if cand.Name != nil {
						name = *cand.Name
					}
					status := "—"
					if cand.AlreadyMember {
						status = "member"
					} else if cand.Invited {
						status = "invited"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n",
						cand.ID, name, cand.Email, status)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no invite candidates)")
				}
				return nil
			})
		},
	}
}

// `--app` was removed on 2026-08-10 (multiAppFinalRefactor Phase 5). It named an
// app to also grant on accept, which is how you invited somebody into an app
// whose access mode was invite_only — there the invitation WAS the grant. Both
// the modes and the grants went with `platform.app_access`: this invitation is
// into THIS app's workspace, and accepting it makes them a member of this app.
func newInviteSendCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:         "send <email>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/invitations"},
		Short:       "Invite a teammate to the active workspace by email",
		Long: `Invite someone to this app's active workspace by email.

On accept they become a member of that workspace, which is what using this app
means. To give somebody access to a DIFFERENT app, invite them from that app:
` + "`bk <other-app> invite send <email>`" + ` — each app has its own workspaces and
its own members.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			res, err := c.SendInvitation(ws, args[0])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Invitation sent to %s.\n", res.Invitation.Email)
			if res.InviteeHasAccount {
				fmt.Fprintln(cmd.OutOrStdout(), "They'll see it in their inbox immediately.")
			} else {
				// The link a human clicks. It must point at THIS app's server, not
				// the home one: the invitation is into this app's workspace, and
				// the accept page resolves the token against the deployment that
				// holds it. Built from the home server until 2026-08-10, when an
				// invitation stopped being platform-level.
				server, err := cmdutil.ServerForApp(cfg, acfg.App)
				if err != nil {
					return err
				}
				inviteURL := fmt.Sprintf("%s/invitations/%s",
					strings.TrimRight(server, "/"), res.Invitation.Token)
				fmt.Fprintf(cmd.OutOrStdout(), "Share this link:\n  %s\n", inviteURL)
			}
			fmt.Fprintf(cmd.OutOrStdout(),
				"On accept they become a member of this %s workspace.\n", acfg.App)
			return nil
		},
	}
	return cmd
}

func newInviteListCmd(acfg Config) *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/invitations"},
		Short:       "List invitations for the active workspace (owner only)",
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
			rows, err := c.ListInvitations(ws, all)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tEMAIL\tSTATUS\tEXPIRES\tCREATED")
				for _, inv := range rows {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						inv.ID, inv.Email, inv.Status, inv.ExpiresAt, inv.CreatedAt)
				}
				return tw.Flush()
			})
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "Include accepted/revoked/expired (not just pending)")
	return cmd
}

func newInviteRevokeCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "revoke <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/invitations/{id}"},
		Short:       "Revoke a pending invitation",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.RevokeInvitation(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "invitation %d revoked\n", id)
			return nil
		},
	}
}

// Invitation tokens are base64url, so roughly 1 in 32 begins with `-`. With
// cobra's normal flag parsing that token is unusable: pflag reads it as a flag
// and the command dies with `unknown shorthand flag: 'J'` before RunE ever runs.
// It was hit for real during Phase 4 verification.
//
// Both ends of this are fixed. The server no longer mints such tokens
// (generateInvitationToken in apps/issues/lib/db/queries/invitations.ts), which
// stops *already-installed* binaries from ever meeting the case; and these two
// commands disable flag parsing so that *this* binary can still redeem the
// tokens already sitting in people's inboxes. Fixing only one end would have
// left one of those two populations broken.
//
// DisableFlagParsing means cobra hands us the raw argv, so the few flags that
// make sense here are handled by tokenArg below rather than by pflag.
const inviteTokenLong = `Tokens are base64url and may begin with "-". This command reads its
argument literally, so no "--" separator or quoting is needed.`

// tokenArg extracts the single token argument from a command whose flag parsing
// is disabled. It honours the two global flags that are meaningful here (-h and
// -v) and rejects anything else by name, so an unsupported flag is still a loud
// usage error rather than being silently swallowed into the token.
func tokenArg(cmd *cobra.Command, args []string) (string, error) {
	var token string
	var seen bool
	for _, a := range args {
		switch a {
		case "-h", "--help":
			return "", cmd.Help()
		case "-v", "--verbose":
			client.Verbose = true
		default:
			if seen {
				return "", fmt.Errorf("accepts 1 arg(s), received %d", len(args))
			}
			token, seen = a, true
		}
	}
	if !seen {
		return "", fmt.Errorf("accepts 1 arg(s), received 0")
	}
	return token, nil
}

func newInviteAcceptCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:                "accept <token>",
		Annotations:        map[string]string{"routes": "POST /api/invitations/accept"},
		Short:              "Accept an invitation by its token",
		Long:               "Accept an invitation by its token.\n\n" + inviteTokenLong,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			token, err := tokenArg(cmd, args)
			if err != nil || token == "" {
				return err
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			if err := c.AcceptInvitation(token); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "accepted")
			return nil
		},
	}
}

func newInviteDeclineCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:                "decline <token>",
		Annotations:        map[string]string{"routes": "POST /api/invitations/decline"},
		Short:              "Decline an invitation by its token",
		Long:               "Decline an invitation by its token.\n\n" + inviteTokenLong,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			token, err := tokenArg(cmd, args)
			if err != nil || token == "" {
				return err
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			if err := c.DeclineInvitation(token); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "declined")
			return nil
		},
	}
}

func newInvitePendingCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "pending",
		Annotations: map[string]string{"routes": "GET /api/me/pending-invitations"},
		Short:       "List invitations pending for your email",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			rows, err := c.ListPendingInvitationsForMe()
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WORKSPACE\tEMAIL\tEXPIRES\tTOKEN")
				for _, inv := range rows {
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						inv.WorkspaceName, inv.Email, inv.ExpiresAt, inv.Token)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no pending invitations)")
				}
				return nil
			})
		},
	}
}

// `show` exists because the WEB could preview an invitation and the CLI could
// not: `/invitations/{token}` renders who invited you and to which workspace
// before you commit, while an agent handed a raw token could only accept it
// blind. The 2026-08-11 web⇄CLI parity audit found this and nothing else — it
// was the only real capability gap in either direction.
//
// `pending` answers the same question for the normal path, where the invitation
// was issued to your own address. `show` is for a token pasted in from
// elsewhere, and it refuses unless you are the person it was issued to.
func newInviteShowCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "show <token>",
		Annotations: map[string]string{"routes": "GET /api/invitations/{token}"},
		Short:       "Preview an invitation without accepting it",
		Long: "Preview an invitation without accepting it.\n\n" +
			"Shows who invited you and to which workspace. You must be signed in as the\n" +
			"address the invitation was sent to; a token alone is not enough.\n\n" +
			"Prints plain text only — see the note in the source on why `--json` is not\n" +
			"available on the token verbs; `invite pending -o json` is the structured form.\n\n" + inviteTokenLong,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			token, err := tokenArg(cmd, args)
			if err != nil || token == "" {
				return err
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			inv, err := c.ShowInvitation(token)
			if err != nil {
				return err
			}
			// No `--json` here, and that is inherited rather than chosen:
			// `accept`, `decline` and `show` all set DisableFlagParsing so a
			// token beginning with `-` is not read as a flag, which means the
			// output flags cannot parse either. For machine-readable output use
			// `invite pending -o json`, which covers the normal path (an
			// invitation issued to your own address).
			out := cmd.OutOrStdout()
			by := inv.InvitedBy.Name
			if by == "" {
				by = inv.InvitedBy.Email
			} else {
				by = fmt.Sprintf("%s <%s>", by, inv.InvitedBy.Email)
			}
			fmt.Fprintf(out, "workspace:  %s (%s)\n", inv.Workspace.Name, inv.Workspace.Slug)
			fmt.Fprintf(out, "invited by: %s\n", by)
			fmt.Fprintf(out, "sent to:    %s\n", inv.Email)
			fmt.Fprintf(out, "expires:    %s\n", inv.ExpiresAt)
			fmt.Fprintf(out, "\naccept with: bk %s invite accept %s\n", acfg.App, inv.Token)
			return nil
		},
	}
}
