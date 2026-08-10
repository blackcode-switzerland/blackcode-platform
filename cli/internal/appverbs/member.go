package appverbs

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newMemberCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "member",
		Short: "Manage members of this app's active workspace",
	}
	cmd.AddCommand(newMemberListCmd(acfg))
	if acfg.MemberRemove {
		cmd.AddCommand(newMemberRemoveCmd(acfg))
	}
	if acfg.MemberLeave {
		cmd.AddCommand(newMemberLeaveCmd(acfg))
	}
	return cmd
}

func newMemberListCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/members"},
		Short:       "List members of the active workspace",
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
			members, err := c.ListWorkspaceMembers(ws)
			if err != nil {
				return err
			}
			return output.Render(format, members, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "USER ID\tEMAIL\tNAME\tROLE")
				for _, m := range members {
					name := "—"
					if m.Name != nil {
						name = *m.Name
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n", m.UserID, m.Email, name, m.Role)
				}
				return tw.Flush()
			})
		},
	}
}

func newMemberRemoveCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "remove <user_id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/members/{userId}"},
		Short:       "Remove a member from the active workspace (owner only)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			userID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid user_id %q", args[0])
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.RemoveWorkspaceMember(ws, userID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed user %d from %s\n", userID, ws)
			return nil
		},
	}
}

func newMemberLeaveCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "leave",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/leave"},
		Short:       "Leave the active workspace (not allowed for owner)",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.LeaveWorkspace(ws); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "left %s\n", ws)
			return nil
		},
	}
}
