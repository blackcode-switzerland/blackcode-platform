package issues

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newIssueCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "issue",
		Short: "Manage issues",
	}
	cmd.AddCommand(
		newIssueListCmd(),
		newIssueViewCmd(),
		newIssueCreateCmd(),
		newIssueEditCmd(),
		newIssueDeleteCmd(),
		newIssueAssignCmd(),
		newIssueUnassignCmd(),
		newIssueCommentCmd(),
		newIssueCommentsCmd(),
		newIssueEditCommentCmd(),
		newIssueDeleteCommentCmd(),
		newIssueActivityCmd(),
		newIssueAttachCmd(),
		newIssueDetachCmd(),
		newIssueAttachmentsCmd(),
		newIssueWatchCmd(),
		newIssueUnwatchCmd(),
	)
	return cmd
}

type issueListFlags struct {
	projectID int
	status    string
	assignee  string
	mine      bool
	search    string
}

func newIssueListCmd() *cobra.Command {
	var f issueListFlags
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues,GET /api/users"},
		Short:       "List issues",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runIssueList(cmd, f)
		},
	}
	cmd.Flags().IntVar(&f.projectID, "project", 0, "Filter by project id")
	cmd.Flags().StringVar(&f.status, "status", "", "Filter by status (client-side)")
	cmd.Flags().StringVar(&f.assignee, "assignee", "", "Filter by assignee id, email, or 'me' (client-side)")
	cmd.Flags().BoolVar(&f.mine, "mine", false, "Show only issues assigned to the current user")
	cmd.Flags().StringVar(&f.search, "search", "", "Search title/description, or the #id (e.g. 123 or #123); server-side")
	return cmd
}

func runIssueList(cmd *cobra.Command, f issueListFlags) error {
	format, err := output.Resolve(cmd)
	if err != nil {
		return err
	}
	c, cfg, err := cmdutil.NewClientAndConfig()
	if err != nil {
		return err
	}

	// The issues endpoint returns every matching issue in one response (no
	// pagination); total is the server-side count for the current filter (before
	// client-side --status/--assignee/--mine filtering).
	page, err := c.ListIssues(client.ListIssuesOpts{ProjectID: f.projectID, Search: f.search})
	if err != nil {
		return err
	}
	total := page.Total

	filtered, err := filterIssues(c, cfg, page.Data, f)
	if err != nil {
		return err
	}

	out := any(filtered)
	if format != output.FormatTable {
		out = struct {
			Data  []client.Issue `json:"data" yaml:"data"`
			Total *int           `json:"total,omitempty" yaml:"total,omitempty"`
		}{filtered, total}
	}

	return output.Render(format, out, func(w io.Writer) error {
		tw := output.Tabwriter(w)
		fmt.Fprintln(tw, "#\tPRIORITY\tSTATUS\tTITLE\tASSIGNEE")
		for _, i := range filtered {
			fmt.Fprintf(tw, "%s\tP%d\t%s\t%s\t%s\n",
				issueRef(&i), i.Priority, i.Status, cmdutil.Truncate(i.Title, 60), issueAssigneeLabel(i.Assignees))
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(filtered) == 0 {
			fmt.Fprintln(cmd.ErrOrStderr(), "(no issues)")
		}
		if total != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "showing %d of %d\n", len(filtered), *total)
		}
		return nil
	})
}

func filterIssues(c *client.Client, cfg *config.Config, issues []client.Issue, f issueListFlags) ([]client.Issue, error) {
	status := strings.ToLower(strings.TrimSpace(f.status))
	assignee := strings.TrimSpace(f.assignee)

	var assigneeID int
	var assigneeEmail string
	resolveAssignee := assignee != "" || f.mine
	if resolveAssignee {
		ref := assignee
		if f.mine || strings.EqualFold(assignee, "me") {
			assigneeID = cfg.UserID
			ref = ""
		}
		if ref != "" {
			if id, err := strconv.Atoi(ref); err == nil {
				assigneeID = id
			} else if strings.Contains(ref, "@") {
				assigneeEmail = strings.ToLower(ref)
				users, err := c.ListUsers()
				if err != nil {
					return nil, fmt.Errorf("resolve assignee email: %w", err)
				}
				for _, u := range users {
					if strings.EqualFold(u.Email, assigneeEmail) {
						assigneeID = u.ID
						break
					}
				}
				if assigneeID == 0 {
					return nil, fmt.Errorf("no user found with email %q", ref)
				}
			} else {
				users, err := c.ListUsers()
				if err != nil {
					return nil, fmt.Errorf("resolve assignee name: %w", err)
				}
				for _, u := range users {
					if u.Name != nil && strings.EqualFold(*u.Name, ref) {
						assigneeID = u.ID
						break
					}
				}
				if assigneeID == 0 {
					return nil, fmt.Errorf("no user found matching %q", ref)
				}
			}
		}
	}

	var out []client.Issue
	for _, i := range issues {
		if status != "" && !strings.EqualFold(i.Status, status) {
			continue
		}
		if resolveAssignee {
			found := false
			for _, a := range i.Assignees {
				if a.ID == assigneeID {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		out = append(out, i)
	}
	return out, nil
}

func newIssueViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id}"},
		Short:       "Show a single issue by its #number (the id shown in the app)",
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
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			iss, err := c.GetIssue(id)
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "Issue:       %s\n", issueRef(iss))
				fmt.Fprintf(w, "Title:       %s\n", iss.Title)
				fmt.Fprintf(w, "Project:     #%d %s\n", iss.ProjectID, cmdutil.DerefOr(iss.ProjectName, ""))
				fmt.Fprintf(w, "Status:      %s\n", iss.Status)
				fmt.Fprintf(w, "Priority:    P%d\n", iss.Priority)
				fmt.Fprintf(w, "Assignees:   %s\n", issueAssigneeLabel(iss.Assignees))
				// ALWAYS printed, empty or not. It used to be hidden when the
				// list was empty, and a reporter who could not find a Labels
				// line concluded the response had no such field and that
				// labeling was UI-only (Todo/issues-app-feedback.md item 1).
				// The route has always returned `labels`; only this line was
				// conditional. An absent row and an empty row look identical,
				// and only one of them is true — so a caller checking whether
				// an attach stuck now gets an answer either way.
				fmt.Fprintf(w, "Labels:      %s\n", issueLabelLabel(iss.Labels))
				if iss.TaskName != nil {
					fmt.Fprintf(w, "Task:   %s\n", *iss.TaskName)
				}
				if iss.DueDate != nil {
					fmt.Fprintf(w, "Due:         %s\n", *iss.DueDate)
				}
				if iss.Description != nil && *iss.Description != "" {
					fmt.Fprintf(w, "\nDescription:\n%s\n", *iss.Description)
				}
				return nil
			})
		},
	}
}

func newIssueCreateCmd() *cobra.Command {
	var projectID, priority int
	var title, description, descriptionFile, status, attach string
	var assignee, task, startDate, dueDate string
	var labels, files []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues"},
		Short:       "Create an issue",
		RunE: func(cmd *cobra.Command, args []string) error {
			if projectID == 0 || title == "" {
				return fmt.Errorf("--project and --title are required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			body, err := cmdutil.ReadBody(description, descriptionFile)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}

			body, err = cmdutil.ResolveBodyMedia(c, body)
			if err != nil {
				return err
			}
			body, err = cmdutil.EmbedFiles(c, body, files)
			if err != nil {
				return err
			}

			req := client.CreateIssueRequest{
				ProjectID:   projectID,
				Title:       title,
				Description: body,
				Status:      status,
				Priority:    priority,
			}
			if assignee != "" && !strings.EqualFold(assignee, "none") {
				uid, err := ResolveUserID(assignee, c, cfg)
				if err != nil {
					return err
				}
				if uid > 0 {
					req.AssigneeIDs = []int{uid}
				}
			}
			if task != "" {
				raw, err := cmdutil.PlainIntOrNullJSON(task)
				if err != nil {
					return err
				}
				req.TaskID = raw
			}
			if startDate != "" {
				req.StartDate = &startDate
			}
			if dueDate != "" {
				req.DueDate = &dueDate
			}
			if len(labels) > 0 {
				req.Labels = labels
			}

			iss, err := c.CreateIssue(req)
			if err != nil {
				return err
			}

			if attach != "" {
				up, err := c.UploadFile(attach)
				if err != nil {
					return fmt.Errorf("upload failed: %w", err)
				}
				if _, err := c.AttachToIssue(iss.ID, up); err != nil {
					return fmt.Errorf("attach failed: %w", err)
				}
				fmt.Fprintf(os.Stderr, "attached %s -> %s\n", up.Filename, up.URL)
			}

			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "created %s %q\n", issueRef(iss), iss.Title)
				return nil
			})
		},
	}
	cmd.Flags().IntVar(&projectID, "project", 0, "Project id (required)")
	cmd.Flags().StringVar(&title, "title", "", "Issue title (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description — Markdown or HTML (use \"-\" for stdin; --description-file for multi-line to avoid escaping newlines)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description (Markdown or HTML) from file")
	cmd.Flags().StringVar(&status, "status", "", "Status (backlog/todo/in_progress/done/cancelled)")
	cmd.Flags().IntVar(&priority, "priority", 0, "Priority 1-5 (1=urgent)")
	cmd.Flags().StringVar(&attach, "attach", "", "Path to a file to add to the issue's attachments list (separate from the body; --file embeds inline instead)")
	cmdutil.AddFileFlag(cmd, &files)
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, or 'me')")
	cmd.Flags().StringVar(&task, "task", "", "Task id")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	cmd.Flags().StringArrayVar(&labels, "label", nil, "Label name (repeatable); existing labels matched, unknown ones created")
	return cmd
}

func newIssueEditCmd() *cobra.Command {
	var status, title, description, descriptionFile string
	var priority int
	var assignee, task, startDate, dueDate string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/issues/{id}"},
		Short:       "Edit an issue (status, title, priority, description, assignee, task, dates)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req := client.UpdateIssueRequest{}
			if cmd.Flags().Changed("status") {
				req.Status = &status
			}
			if cmd.Flags().Changed("title") {
				req.Title = &title
			}
			if cmd.Flags().Changed("description") || cmd.Flags().Changed("description-file") {
				body, err := cmdutil.ReadBody(description, descriptionFile)
				if err != nil {
					return err
				}
				req.Description = &body
			}
			if cmd.Flags().Changed("priority") {
				req.Priority = &priority
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			if req.Description != nil {
				resolved, err := cmdutil.ResolveBodyMedia(c, *req.Description)
				if err != nil {
					return err
				}
				req.Description = &resolved
			}
			if cmd.Flags().Changed("assignee") {
				if strings.EqualFold(assignee, "none") || strings.EqualFold(assignee, "null") || strings.EqualFold(assignee, "clear") || strings.EqualFold(assignee, "unset") {
					req.AssigneeIDs = []byte("[]")
				} else {
					uid, err := ResolveUserID(assignee, c, cfg)
					if err != nil {
						return err
					}
					encoded, _ := json.Marshal([]int{uid})
					req.AssigneeIDs = encoded
				}
			}
			if cmd.Flags().Changed("task") {
				raw, err := cmdutil.PlainIntOrNullJSON(task)
				if err != nil {
					return err
				}
				req.TaskID = raw
			}
			if cmd.Flags().Changed("start-date") {
				req.StartDate = cmdutil.StringOrNullJSON(startDate)
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = cmdutil.StringOrNullJSON(dueDate)
			}
			iss, err := c.UpdateIssue(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "updated %s (status=%s priority=P%d)\n", issueRef(iss), iss.Status, iss.Priority)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "New status (backlog/todo/in_progress/done/cancelled)")
	cmd.Flags().StringVar(&title, "title", "", "New title")
	cmd.Flags().StringVar(&description, "description", "", "New description — Markdown or HTML (\"-\" for stdin; --description-file for multi-line)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description (Markdown or HTML) from file")
	cmd.Flags().IntVar(&priority, "priority", 0, "New priority (1-5)")
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, 'me', or 'none' to clear)")
	cmd.Flags().StringVar(&task, "task", "", "Task id (or 'none' to clear)")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD (or 'none')")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD (or 'none')")
	return cmd
}

func newIssueDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}"},
		Short:       "Delete an issue (project owners/admins only)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Delete issue %s?", strings.TrimPrefix(args[0], "#")), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.DeleteIssue(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted issue #%d\n", id)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueAssignCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "assign <id> <user>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/issues/{id},GET /api/users"},
		Short:       "Assign an issue (user is id, email, name, or 'me')",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			uid, err := ResolveUserID(args[1], c, cfg)
			if err != nil {
				return err
			}
			// Fetch current assignees and append the new one.
			current, err := c.GetIssue(id)
			if err != nil {
				return err
			}
			ids := make([]int, 0, len(current.Assignees)+1)
			for _, a := range current.Assignees {
				ids = append(ids, a.ID)
			}
			alreadyAssigned := false
			for _, existing := range ids {
				if existing == uid {
					alreadyAssigned = true
					break
				}
			}
			if !alreadyAssigned {
				ids = append(ids, uid)
			}
			encoded, _ := json.Marshal(ids)
			iss, err := c.UpdateIssue(id, client.UpdateIssueRequest{AssigneeIDs: encoded})
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "issue %s assigned: %s\n", issueRef(iss), issueAssigneeLabel(iss.Assignees))
				return nil
			})
		},
	}
	return cmd
}

func newIssueUnassignCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "unassign <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/issues/{id}"},
		Short:       "Clear the assignee on an issue",
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
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			iss, err := c.UpdateIssue(id, client.UpdateIssueRequest{AssigneeIDs: []byte("[]")})
			if err != nil {
				return err
			}
			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "issue %s unassigned\n", issueRef(iss))
				return nil
			})
		},
	}
}

func newIssueCommentCmd() *cobra.Command {
	var body, bodyFile string
	var replyTo int
	var files []string
	cmd := &cobra.Command{
		Use:         "comment <id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/comments"},
		Short:       "Post a comment on an issue (use --body \"-\" for stdin; --reply-to to reply; --file to attach)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			content, err := cmdutil.ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			content, err = cmdutil.ResolveBodyMedia(c, content)
			if err != nil {
				return err
			}
			content, err = cmdutil.EmbedFiles(c, content, files)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
				return fmt.Errorf("comment body is empty (provide --body or --file)")
			}
			cm, err := c.CreateComment(id, client.CreateCommentRequest{Content: content, ParentCommentID: replyTo})
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d posted on issue %s\n", cm.ID, strings.TrimPrefix(args[0], "#"))
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "Comment text (use \"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from a file")
	cmd.Flags().IntVar(&replyTo, "reply-to", 0, "Reply under an existing comment id (creates a threaded reply)")
	cmdutil.AddFileFlag(cmd, &files)
	return cmd
}

func newIssueEditCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:         "edit-comment <issue-id> <comment-id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/comments/{id}"},
		Short:       "Edit a comment on an issue (author only)",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			// args[0] (the issue ref) is accepted for symmetry but the API
			// addresses comments by their own id, so it isn't resolved here.
			commentID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid comment id: %w", err)
			}
			content, err := cmdutil.ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			if strings.TrimSpace(content) == "" {
				return fmt.Errorf("comment body is empty")
			}
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
			cm, err := c.EditComment(ws, commentID, content)
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d updated\n", cm.ID)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "New comment text (\"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	return cmd
}

func newIssueDeleteCommentCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete-comment <issue-id> <comment-id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/comments/{id}"},
		Short:       "Delete a comment (author only)",
		Long: "Permanently delete a comment (author only). Any files the comment\n" +
			"embedded are automatically removed from storage if nothing else in the\n" +
			"workspace references them.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			// args[0] (the issue ref) is accepted for symmetry but the API
			// addresses comments by their own id, so it isn't resolved here.
			commentID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid comment id: %w", err)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Delete comment #%d?", commentID), yes) {
				return fmt.Errorf("aborted")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if err := c.DeleteComment(ws, commentID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted comment #%d\n", commentID)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueWatchCmd() *cobra.Command {
	var status bool
	cmd := &cobra.Command{
		Use:         "watch <id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/watch,GET /api/workspaces/{ws}/issues/{id}/watch"},
		Short:       "Subscribe to notifications on an issue (--status to just report the current state)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			// --status is a read: report whether you are watching, change nothing.
			// Lets a script check before toggling instead of blind-writing.
			if status {
				watching, err := c.GetWatchStatus(ws, id)
				if err != nil {
					return err
				}
				format, err := output.Resolve(cmd)
				if err != nil {
					return err
				}
				return output.Render(format, map[string]any{"id": id, "watching": watching},
					func(w io.Writer) error {
						fmt.Fprintf(w, "watching: %t\n", watching)
						return nil
					})
			}
			if err := c.WatchIssue(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "watching issue %s\n", strings.TrimPrefix(args[0], "#"))
			return nil
		},
	}
	cmd.Flags().BoolVar(&status, "status", false, "Report whether you are watching this issue, without changing it")
	return cmd
}

func newIssueUnwatchCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "unwatch <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}/watch"},
		Short:       "Unsubscribe from notifications on an issue",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			if err := c.UnwatchIssue(ws, id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "no longer watching issue %s\n", strings.TrimPrefix(args[0], "#"))
			return nil
		},
	}
}

func newIssueAttachCmd() *cobra.Command {
	var file string
	cmd := &cobra.Command{
		Use:         "attach <id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues/{id}/attachments"},
		Short:       "Upload and attach a file to an issue",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if file == "" {
				return fmt.Errorf("--file is required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			up, err := c.UploadFile(file)
			if err != nil {
				return fmt.Errorf("upload failed: %w", err)
			}
			att, err := c.AttachToIssue(id, up)
			if err != nil {
				return fmt.Errorf("attach failed: %w", err)
			}
			return output.Render(format, att, func(w io.Writer) error {
				fmt.Fprintf(w, "attached %s (#%d) -> %s\n", att.Filename, att.ID, att.FileURL)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "Path to file to upload (required)")
	return cmd
}

func newIssueDetachCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "detach <id> <attachment-id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/issues/{id}/attachments/{attachmentId}"},
		Short:       "Delete an attachment from an issue",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			attID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid attachment id: %w", err)
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			issueID, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Delete attachment #%d on issue %s?", attID, strings.TrimPrefix(args[0], "#")), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.DeleteAttachment(issueID, attID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted attachment #%d\n", attID)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newIssueCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "comments <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id}/comments"},
		Short:       "List comments on an issue",
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
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			comments, err := c.ListIssueComments(id)
			if err != nil {
				return err
			}
			return output.Render(format, comments, func(w io.Writer) error {
				if len(comments) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no comments)")
					return nil
				}
				for _, cm := range comments {
					author := cmdutil.DerefOr(cm.AuthorName, "—")
					ts := cmdutil.DerefOr(cm.CreatedAt, "")
					fmt.Fprintf(w, "── %s · %s ─────\n%s\n\n", author, ts, cm.Content)
				}
				return nil
			})
		},
	}
}

func newIssueActivityCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "activity <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id}/activity"},
		Short:       "Show activity (comments + changes) on an issue",
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
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			items, err := c.ListIssueActivity(id)
			if err != nil {
				return err
			}
			return output.Render(format, items, func(w io.Writer) error {
				if len(items) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no activity)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "WHEN\tWHO\tTYPE\tDETAIL")
				for _, a := range items {
					detail := ""
					switch a.Type {
					case "comment":
						detail = cmdutil.Truncate(cmdutil.DerefOr(a.Content, ""), 80)
					case "change":
						detail = cmdutil.DerefOr(a.OperationType, "—")
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n",
						cmdutil.DerefOr(a.CreatedAt, ""), cmdutil.DerefOr(a.UserName, "—"), a.Type, detail)
				}
				return tw.Flush()
			})
		},
	}
}

func newIssueAttachmentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attachments <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id}/attachments"},
		Short:       "List attachments on an issue",
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
			id, err := resolveIssueArg(c, args[0])
			if err != nil {
				return err
			}
			atts, err := c.ListIssueAttachments(id)
			if err != nil {
				return err
			}
			return output.Render(format, atts, func(w io.Writer) error {
				if len(atts) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no attachments)")
					return nil
				}
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tFILENAME\tSIZE\tMIME\tURL")
				for _, a := range atts {
					size := "—"
					if a.FileSize != nil {
						size = cmdutil.HumanBytes(*a.FileSize)
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n", a.ID, a.Filename, size, a.MimeType, a.FileURL)
				}
				return tw.Flush()
			})
		},
	}
}

// resolveIssueArg parses a user-facing issue reference into its id. The id is the
// workspace #number shown everywhere in the app (a leading "#" is accepted, e.g.
// "234" or "#234"). The API addresses items by this number directly, so there is
// no lookup — the number a human reads is the number the CLI and API take.
func resolveIssueArg(_ *client.Client, ref string) (int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return 0, fmt.Errorf("missing issue number")
	}
	n, err := strconv.Atoi(strings.TrimPrefix(ref, "#"))
	if err != nil {
		return 0, fmt.Errorf("invalid issue number %q — pass the #number shown in the app", ref)
	}
	return n, nil
}

// issueRef formats an issue's user-facing identifier: "#<id>" (the workspace number).
func issueRef(iss *client.Issue) string {
	return fmt.Sprintf("#%d", iss.ID)
}

// ResolveUserID resolves a user reference (id, email, display name, or "me")
// to a numeric user ID. Does not accept "none"/"null" — callers handle those.
func ResolveUserID(ref string, c *client.Client, cfg *config.Config) (int, error) {
	return cmdutil.ResolveUserRef(c, cfg, ref)
}

// issueAssigneeLabel formats the assignees list for one-line display.
func issueAssigneeLabel(assignees []client.IssueAssignee) string {
	if len(assignees) == 0 {
		return "—"
	}
	names := make([]string, 0, len(assignees))
	for _, a := range assignees {
		if a.Name != nil && *a.Name != "" {
			names = append(names, *a.Name)
		} else {
			names = append(names, a.Email)
		}
	}
	return strings.Join(names, ", ")
}

// issueLabelLabel formats labels for one-line display.
func issueLabelLabel(labels []client.IssueLabel) string {
	if len(labels) == 0 {
		return "—"
	}
	names := make([]string, 0, len(labels))
	for _, l := range labels {
		names = append(names, l.Name)
	}
	return strings.Join(names, ", ")
}
