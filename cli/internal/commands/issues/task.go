package issues

import (
	"fmt"
	"io"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newTaskCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "task",
		Aliases: []string{"tasks"},
		Short:   "Manage tasks",
	}
	cmd.AddCommand(
		newTaskListCmd(),
		newTaskViewCmd(),
		newTaskCreateCmd(),
		newTaskEditCmd(),
		newTaskDeleteCmd(),
		newTaskCommentCmd(),
		newTaskCommentsCmd(),
	)
	return cmd
}

func newTaskListCmd() *cobra.Command {
	var project string
	var search string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tasks,GET /api/workspaces/{ws}/projects"},
		Short:       "List tasks (optionally filter by --project)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			projectID, err := resolveProjectRef(c, project)
			if err != nil {
				return err
			}
			ms, err := c.ListTasks(projectID, search)
			if err != nil {
				return err
			}
			return output.Render(format, ms, taskTable(ms, cmd.ErrOrStderr()))
		},
	}
	cmd.Flags().StringVar(&project, "project", "", "Filter by project — "+projectFlagHelp)
	cmd.Flags().StringVar(&search, "search", "", "Search name/description, or the #id (e.g. 123 or #123); server-side")
	return cmd
}

func newTaskViewCmd() *cobra.Command {
	var includeIssues bool
	cmd := &cobra.Command{
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tasks/{id}"},
		Short:       "Show a task",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			m, err := c.GetTask(id, includeIssues)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", m.ID)
				fmt.Fprintf(w, "Name:        %s\n", m.Name)
				fmt.Fprintf(w, "Project:     #%d %s\n", m.ProjectID, cmdutil.DerefOr(m.ProjectName, ""))
				fmt.Fprintf(w, "Description: %s\n", cmdutil.DerefOr(m.Description, "—"))
				fmt.Fprintf(w, "Due:         %s\n", cmdutil.DerefOr(m.DueDate, "—"))
				fmt.Fprintf(w, "Issues:      %d completed / %d total\n",
					cmdutil.IntOr(m.CompletedIssues, 0), cmdutil.IntOr(m.IssueCount, 0))
				if includeIssues && len(m.Issues) > 0 {
					fmt.Fprintln(w, "\nIssues:")
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "  ID\tPRIORITY\tSTATUS\tTITLE")
					for _, i := range m.Issues {
						fmt.Fprintf(tw, "  %d\tP%d\t%s\t%s\n",
							i.ID, i.Priority, i.Status, cmdutil.Truncate(i.Title, 60))
					}
					return tw.Flush()
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&includeIssues, "include-issues", false, "Embed the task's issues")
	return cmd
}

func newTaskCreateCmd() *cobra.Command {
	var project string
	var name, description, bodyAlias, descriptionFile, dueDate string
	var files []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/tasks,GET /api/workspaces/{ws}/projects"},
		Short:       "Create a task",
		RunE: func(cmd *cobra.Command, args []string) error {
			if project == "" || name == "" {
				return fmt.Errorf("--project and --name are required")
			}
			description, err := mergeAlias(cmd, "description", description, "body", bodyAlias)
			if err != nil {
				return err
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			body, err := cmdutil.ReadBody(description, descriptionFile)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			projectID, err := resolveProjectRef(c, project)
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
			req := client.CreateTaskRequest{
				ProjectID:   projectID,
				Name:        name,
				Description: body,
			}
			if dueDate != "" {
				req.DueDate = &dueDate
			}
			m, err := c.CreateTask(req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "created task #%d %q\n", m.ID, m.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&project, "project", "", "Project — "+projectFlagHelp+" (required)")
	cmd.Flags().StringVar(&name, "name", "", "Task name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description (\"-\" for stdin). --body is an alias")
	cmd.Flags().StringVar(&bodyAlias, "body", "", "Alias for --description (`issue comment` and `project updates add` call it --body)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	cmdutil.AddFileFlag(cmd, &files)
	return cmd
}

func newTaskEditCmd() *cobra.Command {
	var name, description, descriptionFile, dueDate string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/tasks/{id}"},
		Short:       "Edit a task (name, description, due date; use 'none' to clear due date)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			req := client.UpdateTaskRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("description") || cmd.Flags().Changed("description-file") {
				body, err := cmdutil.ReadBody(description, descriptionFile)
				if err != nil {
					return err
				}
				req.Description = &body
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = cmdutil.StringOrNullJSON(dueDate)
			}
			c, err := cmdutil.NewClient()
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
			m, err := c.UpdateTask(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "updated task #%d %q\n", m.ID, m.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&description, "description", "", "New description (\"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "New due date YYYY-MM-DD (or 'none')")
	return cmd
}

func newTaskDeleteCmd() *cobra.Command {
	var yes, cascade, detach bool
	cmd := &cobra.Command{
		Use:         "delete <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/tasks/{id}"},
		Short:       "Move a task to the Trash",
		Long: "Move a task to the recycle bin. Restore it later with `bk issues trash restore`.\n\n" +
			"Attached issues: by default they stay active and are unlinked from the\n" +
			"task (--detach). Pass --cascade to move them to the Trash too so they\n" +
			"can be restored as a group.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid id: %w", err)
			}
			if cascade && detach {
				return fmt.Errorf("--cascade and --detach are mutually exclusive")
			}
			mode := ""
			if cascade {
				mode = "cascade"
			} else if detach {
				mode = "detach"
			}
			prompt := fmt.Sprintf("Move task #%d to Trash?", id)
			if cascade {
				prompt = fmt.Sprintf("Move task #%d and its issues to Trash?", id)
			}
			if !cmdutil.Confirm(prompt, yes) {
				return fmt.Errorf("aborted")
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if err := c.DeleteTask(id, mode); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "moved task #%d to Trash\n", id)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	cmd.Flags().BoolVar(&cascade, "cascade", false, "Also move attached issues to Trash")
	cmd.Flags().BoolVar(&detach, "detach", false, "Keep attached issues active, unlinked (default)")
	return cmd
}

func newTaskCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:         "comment <task-id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/tasks/{id}/comments"},
		Short:       "Post a comment on a task",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
			}
			content, err := cmdutil.ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			if content == "" {
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
			content, err = cmdutil.ResolveBodyMedia(c, content)
			if err != nil {
				return err
			}
			cm, err := c.CreateTaskComment(ws, id, content)
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d posted on task #%d\n", cm.ID, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "Comment text (\"-\" for stdin). @mention someone by EMAIL (@ana@blackcode.ch) to notify them")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	return cmd
}

func newTaskCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "comments <task-id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tasks/{id}/comments"},
		Short:       "List comments on a task",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
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
			comments, err := c.ListTaskComments(ws, id)
			if err != nil {
				return err
			}
			return output.Render(format, comments, cmdutil.RenderCommentList(comments, cmd.ErrOrStderr()))
		},
	}
}

func taskTable(ms []client.Task, stderr io.Writer) func(io.Writer) error {
	return func(w io.Writer) error {
		tw := output.Tabwriter(w)
		fmt.Fprintln(tw, "ID\tNAME\tPROJECT\tDUE\tISSUES (DONE/TOTAL)")
		for _, m := range ms {
			fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d/%d\n",
				m.ID, m.Name, cmdutil.DerefOr(m.ProjectName, fmt.Sprintf("#%d", m.ProjectID)),
				cmdutil.DerefOr(m.DueDate, "—"),
				cmdutil.IntOr(m.CompletedIssues, 0), cmdutil.IntOr(m.IssueCount, 0))
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(ms) == 0 {
			fmt.Fprintln(stderr, "(no tasks)")
		}
		return nil
	}
}
