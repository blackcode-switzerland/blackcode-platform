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

func newUserCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "user",
		Aliases: []string{"users"},
		Short:   "Read users",
	}
	cmd.AddCommand(newUserListCmd(acfg), newUserViewCmd(acfg))
	return cmd
}

func newUserListCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/users"},
		Short:       "List all users",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			users, err := c.ListUsers()
			if err != nil {
				return err
			}
			return output.Render(format, users, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tEMAIL\tROLE")
				for _, u := range users {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n",
						u.ID, cmdutil.DerefOr(u.Name, "—"), u.Email, u.Role)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(users) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no users)")
				}
				return nil
			})
		},
	}
}

func newUserViewCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "view <id|email>",
		Annotations: map[string]string{"routes": "GET /api/users"},
		Short:       "Show a user (by id or email)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			users, err := c.ListUsers()
			if err != nil {
				return err
			}
			ref := strings.TrimSpace(args[0])
			var match *client.User
			if id, err := strconv.Atoi(ref); err == nil {
				for i := range users {
					if users[i].ID == id {
						match = &users[i]
						break
					}
				}
			} else {
				for i := range users {
					if strings.EqualFold(users[i].Email, ref) {
						match = &users[i]
						break
					}
				}
			}
			if match == nil {
				return fmt.Errorf("no user found matching %q", ref)
			}
			return output.Render(format, match, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:    %d\n", match.ID)
				fmt.Fprintf(w, "Name:  %s\n", cmdutil.DerefOr(match.Name, "—"))
				fmt.Fprintf(w, "Email: %s\n", match.Email)
				fmt.Fprintf(w, "Role:  %s\n", match.Role)
				return nil
			})
		},
	}
}
