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
// ---------------------------------------------------------------------------
// WHAT THE FILTERS ARE, AND WHY THERE ARE NOT MORE OF THEM
// ---------------------------------------------------------------------------
// Decision Q3 kept the inbox global and asked for narrowing by workspace,
// project, task and member. All four are here, plus `--type` (the route already
// read it; only the flag was missing) and `--since`.
//
// Each one is answerable from what an inbox row actually carries — see the
// header on `ListInboxFilter` in apps/issues/lib/db/queries/inbox.ts, which
// writes down the columns and shows which filters are columns and which are a
// reach through `entity_id`. Nothing here filters on the payload blob: a
// notification whose payload happens to mention a name is not a notification
// about it, and a filter that cannot say which it matched is worse than none.
//
// `--project` and `--task` REQUIRE `--ws`, and the server enforces it rather
// than the CLI guessing: a #number is workspace-scoped, so #4 without a
// workspace is four different projects across four memberships.
func newInboxListCmd(acfg Config) *cobra.Command {
	var unread bool
	var msgType, project, task, from, since string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/me/inbox,GET /api/workspaces,GET /api/users"},
		Short:       "List inbox messages (every workspace; --ws narrows it to one)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			workspaceID, err := inboxWorkspaceID(c)
			if err != nil {
				return err
			}
			filters := client.InboxFilters{
				Unread:      unread,
				WorkspaceID: workspaceID,
				Type:        msgType,
				Project:     strings.TrimPrefix(strings.TrimSpace(project), "#"),
				Task:        strings.TrimPrefix(strings.TrimSpace(task), "#"),
				Since:       strings.TrimSpace(since),
			}
			if (filters.Project != "" || filters.Task != "") && workspaceID == 0 {
				return cmdutil.Usagef(
					"--project and --task are workspace #numbers — pass --ws <slug> too (the inbox is global by default, so there is no workspace to read them against)")
			}
			if ref := strings.TrimSpace(from); ref != "" {
				uid, err := cmdutil.ResolveUserRef(c, cfg, ref)
				if err != nil {
					return err
				}
				filters.ActorID = uid
			}
			page, err := c.ListInboxFiltered(filters)
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
					// "YOUR INBOX IS EMPTY" AND "NOTHING MATCHED" ARE DIFFERENT
					// FACTS, and only one of them is alarming. A filtered feed
					// printing "(inbox empty)" is how a `--project` typo reads as
					// a workspace where nothing has happened in three weeks.
					if applied := describeInboxFilters(filters, unread); applied != "" {
						fmt.Fprintf(cmd.ErrOrStderr(),
							"(no messages match %s — `bk %s inbox list` with no filters shows everything)\n",
							applied, acfg.App)
					} else {
						fmt.Fprintln(cmd.ErrOrStderr(), "(inbox empty)")
					}
				}
				// Scoped to the same filters as the list above it — the server
				// applies both from one clause set, so this number always counts
				// the rows this command was asked about.
				fmt.Fprintf(cmd.ErrOrStderr(), "Unread: %d\n", page.UnreadCount)
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&unread, "unread", false, "Only show unread messages")
	cmd.Flags().StringVar(&msgType, "type", "", "Only messages of this kind, e.g. assigned, mentioned, commented, status_changed, invitation")
	cmd.Flags().StringVar(&project, "project", "", "Only messages about this project, its tasks or its issues — the project's #number. Requires --ws")
	cmd.Flags().StringVar(&task, "task", "", "Only messages about this task or its issues — the task's #number. Requires --ws")
	cmd.Flags().StringVar(&from, "from", "", "Only messages caused by this person (id, email, name, or 'me')")
	cmd.Flags().StringVar(&since, "since", "", "Only messages at or after this date/time, YYYY-MM-DD or an ISO-8601 instant")
	// --ws is a PERSISTENT ROOT flag, so its own description cannot say what it
	// does here. This is where a caller reading `inbox list --help` is standing.
	cmd.Long = "List this user's notifications.\n\n" +
		"The inbox is GLOBAL by default — every workspace, and every app that\n" +
		"notifies you. Pass the root --ws flag to narrow it to one workspace:\n\n" +
		"  bk " + acfg.App + " inbox list --unread --ws my-workspace\n\n" +
		"--ws takes a slug or a workspace id; `bk " + acfg.App + " workspace list` shows both.\n\n" +
		"The other filters narrow further, and every one is applied by the SERVER:\n\n" +
		"  --type      the kind of notification\n" +
		"  --from      who caused it\n" +
		"  --since     when\n" +
		"  --project   the project, its tasks and its issues   (needs --ws)\n" +
		"  --task      the task and its issues                 (needs --ws)\n\n" +
		"--project and --task take a #number and need --ws because a #number only\n" +
		"means something inside one workspace.\n\n" +
		"The \"Unread:\" line is scoped to the same filters as the list."
	return cmd
}

// describeInboxFilters renders what was asked for, for the empty-result line.
// Empty means nothing was narrowed — the one case where "(inbox empty)" is the
// truth rather than a guess.
func describeInboxFilters(f client.InboxFilters, unread bool) string {
	var parts []string
	if ref := strings.TrimSpace(cmdutil.WSOverride); ref != "" {
		parts = append(parts, "ws="+ref)
	}
	if unread {
		parts = append(parts, "unread")
	}
	for _, kv := range [][2]string{
		{"type", f.Type},
		{"project", f.Project},
		{"task", f.Task},
		{"since", f.Since},
	} {
		if strings.TrimSpace(kv[1]) != "" {
			parts = append(parts, kv[0]+"="+kv[1])
		}
	}
	if f.ActorID > 0 {
		parts = append(parts, fmt.Sprintf("from=%d", f.ActorID))
	}
	return strings.Join(parts, " ")
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
