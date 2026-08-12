package appverbs

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newInboxCmd(acfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "inbox",
		Short: "Per-user notifications (invitations, mentions, assignments, status changes)",
	}
	cmd.AddCommand(
		newInboxListCmd(acfg),
		newInboxReadCmd(acfg),
		newInboxArchiveCmd(acfg),
		newInboxUnarchiveCmd(acfg),
	)
	return cmd
}

// THE INBOX IS GLOBAL BY DEFAULT AND STAYS THAT WAY, BUT `--ws` NOW NARROWS IT.
//
// ---------------------------------------------------------------------------
// WHY THE GLOBAL FLAG RATHER THAN A NEW ONE
// ---------------------------------------------------------------------------
// "150+ notifications from all workspaces, going back weeks" is what a daily
// `inbox list` returns, and there was no way to narrow it — not because the
// route cannot, but because the CLI never asked: `GET /api/me/inbox` has always
// read `?workspace_id=`, and `listInbox`/`countUnread` have always filtered on
// it.
//
// `--ws` is the persistent root flag, documented as "target workspace for this
// command only". That is precisely what is wanted here, so this command honours
// it instead of growing a second, near-identical `--workspace` beside it — a
// caller who reached for `--ws` and got a silently unfiltered list was not
// wrong, they were ignored.
//
// The DEFAULT is unchanged and deliberate (decision Q3): with no `--ws`, the
// list is every workspace and every app that writes to this user's inbox. An
// inbox that quietly showed one workspace would hide the invitation that
// arrived from another.
//
// `--ws` takes a slug OR an id and the route takes an integer, so a slug costs
// one extra request to `/api/workspaces` to resolve. An id costs nothing.
func newInboxListCmd(acfg Config) *cobra.Command {
	var unread bool
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/me/inbox,GET /api/workspaces"},
		Short:       "List inbox messages (every workspace; --ws narrows it to one)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			workspaceID, err := inboxWorkspaceID(c)
			if err != nil {
				return err
			}
			page, err := c.ListInbox(unread, false, workspaceID)
			if err != nil {
				return err
			}
			return output.Render(format, page, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tTYPE\tWORKSPACE\tTITLE\tSTATE\tWHEN")
				for _, m := range page.Data {
					state := "unread"
					if m.ReadAt != nil {
						state = "read"
					}
					if m.ArchivedAt != nil {
						state = "archived"
					}
					var payload map[string]any
					_ = json.Unmarshal(m.Payload, &payload)
					title, _ := payload["issue_title"].(string)
					if title == "" {
						title, _ = payload["workspace_name"].(string)
					}
					wsName, _ := payload["workspace_name"].(string)
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
						m.ID, m.Type, wsName, truncateInbox(title, 40), state, m.CreatedAt)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(page.Data) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(inbox empty)")
				}
				fmt.Fprintf(cmd.ErrOrStderr(), "Unread: %d\n", page.UnreadCount)
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&unread, "unread", false, "Only show unread messages")
	// --ws is a PERSISTENT ROOT flag, so its own description cannot say what it
	// does here. This is where a caller reading `inbox list --help` is standing.
	cmd.Long = "List this user's notifications.\n\n" +
		"The inbox is GLOBAL by default — every workspace, and every app that\n" +
		"notifies you. Pass the root --ws flag to narrow it to one workspace:\n\n" +
		"  bk issues inbox list --unread --ws my-workspace\n\n" +
		"--ws takes a slug or a workspace id; `bk issues workspace list` shows both."
	return cmd
}

// inboxWorkspaceID turns the --ws override into the workspace id the route
// takes, or 0 for "every workspace".
//
// It reads the OVERRIDE ONLY, never the active workspace. That distinction is
// the whole of decision Q3: an inbox that silently scoped itself to whatever
// `workspace use` last set would hide the invitation that arrived from
// somewhere else, and the caller would have no way to see that it had.
func inboxWorkspaceID(c *client.Client) (int, error) {
	ref := strings.TrimSpace(cmdutil.WSOverride)
	if ref == "" {
		return 0, nil
	}
	if n, err := strconv.Atoi(ref); err == nil {
		return n, nil
	}
	workspaces, err := c.ListMyWorkspaces()
	if err != nil {
		return 0, fmt.Errorf("resolve workspace %q: %w", ref, err)
	}
	for _, w := range workspaces {
		if strings.EqualFold(w.Slug, ref) {
			return w.ID, nil
		}
	}
	// Not a silent fall back to the global list: a caller who named a workspace
	// and got every workspace cannot tell the filter was dropped, and would read
	// the noise as the answer.
	return 0, cmdutil.Usagef(
		"no workspace with slug %q — `bk workspace list` shows yours, or pass its id to --ws", ref)
}

func newInboxReadCmd(acfg Config) *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:         "read [id ...] | --all",
		Annotations: map[string]string{"routes": "POST /api/me/inbox/mark-read"},
		Short:       "Mark inbox messages as read",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !all && len(args) == 0 {
				return fmt.Errorf("provide message IDs or use --all")
			}
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.MarkInboxRead(ids, all)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "marked %d read\n", count)
			return nil
		},
	}
	cmd.Flags().BoolVar(&all, "all", false, "Mark all unread messages as read")
	return cmd
}

func newInboxArchiveCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "archive <id> [id ...]",
		Annotations: map[string]string{"routes": "POST /api/me/inbox/archive"},
		Short:       "Archive inbox messages",
		Args:        cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.ArchiveInbox(ids)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "archived %d\n", count)
			return nil
		},
	}
}

func newInboxUnarchiveCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "unarchive <id> [id ...]",
		Annotations: map[string]string{"routes": "POST /api/me/inbox/unarchive"},
		Short:       "Move archived messages back to inbox",
		Args:        cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, _, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(args))
			for _, a := range args {
				n, err := strconv.Atoi(a)
				if err != nil {
					return fmt.Errorf("invalid id %q", a)
				}
				ids = append(ids, n)
			}
			count, err := c.UnarchiveInbox(ids)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "unarchived %d\n", count)
			return nil
		},
	}
}

func truncateInbox(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
