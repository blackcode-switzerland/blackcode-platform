package issues

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

// whenToMakeATask is the model, in the two lines an agent will actually read.
//
// It is here rather than in a doc because an agent handed a grouping primitive
// with no guidance makes one task per issue, and `bk guide` is a command it has
// to think to run. `--help` is the one it already ran.
const whenToMakeATask = `A task GROUPS RELATED ISSUES inside a project: project → task → issues.

Make issues first. A task earns its existence when SEVERAL of them want
grouping — two or three related issues are fine on their own. Create the
issues, then the task, then attach them:

  bk issues issue create --project 4 --title "Rotate the signing key"
  bk issues issue create --project 4 --title "Re-issue client tokens"
  bk issues task create --project 4 --name "Key rotation"
  bk issues task attach 7 12 13

A task has no priority and no labels — the issues carry those. Its status is
not something you set: it is DERIVED from its issues (see 'bk issues task
view').`

func newTaskCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "task",
		Aliases: []string{"tasks"},
		Short:   "Manage tasks — the grouping layer between a project and its issues",
		Long:    "Manage tasks.\n\n" + whenToMakeATask,
	}
	cmd.AddCommand(
		newTaskListCmd(),
		newTaskViewCmd(),
		newTaskCreateCmd(),
		newTaskEditCmd(),
		newTaskDeleteCmd(),
		newTaskAttachCmd(),
		newTaskDetachCmd(),
		newTaskCommentCmd(),
		newTaskCommentsCmd(),
	)
	return cmd
}

// taskProgress renders the DONE/TOTAL cell.
//
// The empty case is the point: a task with no issues renders "—", never "0/0"
// and never "0%". Those read as "nothing has been done", when the truth is
// "there is nothing here" — and a task with nothing in it is the one a caller
// most needs to notice, because it is usually a task that should have been an
// issue. Cancelled issues are called out separately: they are neither done nor
// outstanding, and folding them into either number makes the ratio a lie.
func taskProgress(m *client.Task) string {
	total := cmdutil.IntOr(m.IssueCount, 0)
	if total == 0 {
		return "—"
	}
	s := fmt.Sprintf("%d/%d", cmdutil.IntOr(m.CompletedIssues, 0), total)
	if n := cmdutil.IntOr(m.CancelledIssues, 0); n > 0 {
		s += fmt.Sprintf(" (+%d cancelled)", n)
	}
	return s
}

func taskLeadLabel(m *client.Task) string {
	if m.LeadName != nil && *m.LeadName != "" {
		return *m.LeadName
	}
	if m.LeadEmail != nil && *m.LeadEmail != "" {
		return *m.LeadEmail
	}
	if m.LeadID != nil {
		return fmt.Sprintf("user %d", *m.LeadID)
	}
	return "—"
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
		Short:       "Show a task and the issues it groups",
		Long: "Show a task.\n\n" +
			"A task IS its group of issues, so they are listed by default — the\n" +
			"grouping is the only thing a task has that an issue does not. Pass\n" +
			"--include-issues=false for the header alone.\n\n" +
			"Status is DERIVED from those issues and cannot be set:\n" +
			"  empty      no issues yet\n" +
			"  active     at least one issue still open\n" +
			"  done       nothing open, at least one issue done\n" +
			"  cancelled  nothing open, and every issue was cancelled\n\n" +
			"A cancelled issue is neither done nor outstanding, so it is counted\n" +
			"separately rather than folded into either side of the ratio.",
		Args: cobra.ExactArgs(1),
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
				fmt.Fprintf(w, "Status:      %s (derived from its issues)\n",
					cmdutil.DerefOr(m.Status, "—"))
				fmt.Fprintf(w, "Lead:        %s\n", taskLeadLabel(m))
				fmt.Fprintf(w, "Description: %s\n", cmdutil.DerefOr(m.Description, "—"))
				fmt.Fprintf(w, "Due:         %s\n", cmdutil.DerefOr(m.DueDate, "—"))
				fmt.Fprintf(w, "Issues:      %s done\n", taskProgress(m))

				if !includeIssues {
					return nil
				}
				if len(m.Issues) == 0 {
					// Not silence: an empty group is the state worth naming,
					// and the recovery is one command away.
					fmt.Fprintf(w, "\nNo issues attached. Attach some:\n"+
						"  bk issues task attach %d <issue-id…>\n", m.ID)
					return nil
				}
				fmt.Fprintln(w, "\nIssues:")
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "  ID\tPRIORITY\tSTATUS\tTITLE")
				for _, i := range m.Issues {
					fmt.Fprintf(tw, "  %d\tP%d\t%s\t%s\n",
						i.ID, i.Priority, i.Status, cmdutil.Truncate(i.Title, 60))
				}
				return tw.Flush()
			})
		},
	}
	// Defaults to TRUE. `issue view` learned the same lesson on 2026-08-12: a
	// separate command to see the thing the record is about is a dead end most
	// callers never find. The issues ride along on the same request the header
	// already costs (?includeIssues=true), so there is nothing to save by
	// leaving it off.
	cmd.Flags().BoolVar(&includeIssues, "include-issues", true, "List the issues this task groups")
	return cmd
}

func newTaskCreateCmd() *cobra.Command {
	var project string
	var name, description, bodyAlias, descriptionFile, dueDate, lead string
	var files []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/tasks,GET /api/workspaces/{ws}/projects,GET /api/workspaces/{ws}/members"},
		Short:       "Create a task to group several related issues",
		Long:        "Create a task.\n\n" + whenToMakeATask,
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
			c, cfg, err := cmdutil.NewClientAndConfig()
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
			if cmd.Flags().Changed("lead") {
				// A bare JSON null for 'none' — "explicitly nobody", which the
				// route distinguishes from an omitted field (still defaults to
				// you, mirroring projects).
				req.LeadUserID, err = cmdutil.IntOrNullJSON(lead, c, cfg)
				if err != nil {
					return err
				}
			}
			m, err := c.CreateTask(req)
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "created task #%d %q\n", m.ID, m.Name)
				fmt.Fprintf(w, "attach the issues it groups: bk issues task attach %d <issue-id…>\n", m.ID)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&project, "project", "", "Project — "+projectFlagHelp+" (required)")
	cmd.Flags().StringVar(&name, "name", "", "Task name (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description (\"-\" for stdin). --body is an alias")
	cmd.Flags().StringVar(&bodyAlias, "body", "", "Alias for --description (issue comment and project updates add call it --body)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	cmd.Flags().StringVar(&lead, "lead", "",
		"Task lead — id, email, display name, or 'me'. Defaults to you; 'none' for no lead")
	cmdutil.AddFileFlag(cmd, &files)
	return cmd
}

func newTaskEditCmd() *cobra.Command {
	var name, description, descriptionFile, dueDate, lead string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/tasks/{id},GET /api/workspaces/{ws}/members"},
		Short:       "Edit a task (name, description, due date, lead; 'none' clears due date or lead)",
		Long: "Edit a task.\n\n" +
			"There is no --status: a task's status is derived from its issues.\n" +
			"To move a task forward, move its issues:\n" +
			"  bk issues issue edit <id> --status done\n" +
			"or attach/detach with bk issues task attach|detach.",
		Args: cobra.ExactArgs(1),
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
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("lead") {
				req.LeadUserID, err = cmdutil.IntOrNullJSON(lead, c, cfg)
				if err != nil {
					return err
				}
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
	cmd.Flags().StringVar(&lead, "lead", "",
		"New task lead — id, email, display name, or 'me' (or 'none' to clear)")
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

// ---------------------------------------------------------------------------
// ATTACHING FROM THE TASK SIDE
// ---------------------------------------------------------------------------
// Over `issues.task_id` — the column that already exists. No join table: an
// issue belongs to AT MOST ONE task, which is what makes the derived progress
// count above unambiguous, and a many-to-many would quietly end that.
//
// AN ISSUE ALREADY IN ANOTHER TASK IS AN ERROR, NOT A MOVE.
//
// The choice is between refusing and reparenting-with-a-notice, and refusing
// wins on one argument: attach is a BULK command. `task attach 7 12 13 14` that
// silently pulls #13 out of task #4 has changed two tasks' progress numbers,
// and the caller reading "attached 3 issues" has no way to know. Reports go
// wrong months later. --force is the same operation with the caller saying they
// meant it, and it names what it moved, per-issue, on the way through.
//
// Cost: attach reads each issue before writing it, because "which task is this
// in?" has no batch endpoint. That is one extra GET per issue, and it is what
// makes the refusal possible at all.
func newTaskAttachCmd() *cobra.Command {
	var force bool
	cmd := &cobra.Command{
		Use:         "attach <task-id> <issue-id…>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id},PATCH /api/workspaces/{ws}/issues/{id}"},
		Short:       "Attach one or more issues to a task",
		Long: "Attach issues to a task, from the task side. The same link is\n" +
			"reachable from the issue side with `bk issues issue edit <id> --task`.\n\n" +
			"An issue belongs to at most one task. Attaching an issue that is\n" +
			"ALREADY IN ANOTHER TASK is refused, naming the task it is in —\n" +
			"pass --force to move it, which prints what moved and from where.\n" +
			"Nothing is written until every issue has been checked, so a refusal\n" +
			"leaves all of them where they were.\n\n" +
			"An issue's PROJECT is not touched. A task and its issues can sit in\n" +
			"different projects; nothing here changes that either way.",
		Args: cobra.MinimumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			taskID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
			}
			issueIDs, err := parseIssueIDs(args[1:])
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			// Fail the whole command before writing anything: a partial attach
			// is the state that is hardest to reason about afterwards.
			type move struct {
				id   int
				from int
			}
			var moves []move
			for _, id := range issueIDs {
				iss, err := c.GetIssue(id)
				if err != nil {
					return fmt.Errorf("issue #%d: %w", id, err)
				}
				cur := cmdutil.IntOr(iss.TaskID, 0)
				if cur == taskID {
					continue // already there — not an error, and not a write
				}
				if cur != 0 && !force {
					return fmt.Errorf(
						"issue #%d is already in task #%d; pass --force to move it, "+
							"or detach it first (bk issues task detach %d %d)",
						id, cur, cur, id)
				}
				moves = append(moves, move{id: id, from: cur})
			}
			if len(moves) == 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "nothing to do — all %d issue(s) already in task #%d\n",
					len(issueIDs), taskID)
				return nil
			}
			w := cmd.OutOrStdout()
			for _, mv := range moves {
				req := client.UpdateIssueRequest{TaskID: []byte(strconv.Itoa(taskID))}
				if _, err := c.UpdateIssue(mv.id, req); err != nil {
					return fmt.Errorf("issue #%d: %w", mv.id, err)
				}
				// Name what happened per issue, not a count: a wrong bulk
				// reparent that prints "3 attached" is one nobody catches.
				if mv.from != 0 {
					fmt.Fprintf(w, "moved issue #%d from task #%d to task #%d\n", mv.id, mv.from, taskID)
				} else {
					fmt.Fprintf(w, "attached issue #%d to task #%d\n", mv.id, taskID)
				}
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&force, "force", false,
		"Move issues that are already in another task (prints each move)")
	return cmd
}

func newTaskDetachCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:         "detach <task-id> <issue-id…>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id},PATCH /api/workspaces/{ws}/issues/{id}"},
		Short:       "Detach one or more issues from a task",
		Long: "Remove issues from a task.\n\n" +
			"THE ISSUE STAYS IN ITS PROJECT and stays open — detaching only\n" +
			"un-groups it. Nothing is deleted and nothing is closed.\n\n" +
			"An issue that is not in this task is refused rather than ignored,\n" +
			"so a mistyped task id cannot look like a successful no-op.",
		Args: cobra.MinimumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			taskID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid task id: %w", err)
			}
			issueIDs, err := parseIssueIDs(args[1:])
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			for _, id := range issueIDs {
				iss, err := c.GetIssue(id)
				if err != nil {
					return fmt.Errorf("issue #%d: %w", id, err)
				}
				cur := cmdutil.IntOr(iss.TaskID, 0)
				if cur != taskID {
					if cur == 0 {
						return fmt.Errorf("issue #%d is not in any task", id)
					}
					return fmt.Errorf("issue #%d is in task #%d, not #%d", id, cur, taskID)
				}
			}
			w := cmd.OutOrStdout()
			for _, id := range issueIDs {
				req := client.UpdateIssueRequest{TaskID: []byte("null")}
				if _, err := c.UpdateIssue(id, req); err != nil {
					return fmt.Errorf("issue #%d: %w", id, err)
				}
				fmt.Fprintf(w, "detached issue #%d from task #%d (still in its project)\n", id, taskID)
			}
			return nil
		},
	}
	return cmd
}

// parseIssueIDs accepts `12`, `#12` — the same spellings every other issue
// argument in this binary takes.
func parseIssueIDs(args []string) ([]int, error) {
	ids := make([]int, 0, len(args))
	seen := map[int]bool{}
	for _, a := range args {
		n, err := strconv.Atoi(strings.TrimPrefix(strings.TrimSpace(a), "#"))
		if err != nil {
			return nil, fmt.Errorf("invalid issue id %q", a)
		}
		if seen[n] {
			continue
		}
		seen[n] = true
		ids = append(ids, n)
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("no issue ids given")
	}
	return ids, nil
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
		fmt.Fprintln(tw, "ID\tNAME\tPROJECT\tSTATUS\tDUE\tISSUES (DONE/TOTAL)")
		for _, m := range ms {
			fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\n",
				m.ID, m.Name, cmdutil.DerefOr(m.ProjectName, fmt.Sprintf("#%d", m.ProjectID)),
				cmdutil.DerefOr(m.Status, "—"),
				cmdutil.DerefOr(m.DueDate, "—"),
				taskProgress(&m))
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
