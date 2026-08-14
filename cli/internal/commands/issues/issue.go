package issues

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

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
	project   string
	status    string
	assignee  string
	createdBy string
	mine      bool
	search    string
	label     []string
	priority  string
	dueBefore string
	task      string
}

// ---------------------------------------------------------------------------
// EVERY FILTER ON THIS COMMAND IS SERVER-SIDE (2026-08-12)
// ---------------------------------------------------------------------------
// `--status`, `--assignee` and `--mine` used to fetch every issue in the
// workspace and filter locally. That was never a route limitation: `GET
// /api/workspaces/{ws}/issues` has read `status`, `assignee_id`/`assignee_ids`,
// `priority` and `task_id` since it was written. The CLIENT was the only thing
// not sending them, and `ListIssuesOpts` had a `Status` field that proved it —
// set by nothing, sent by nothing, and read by the next person as evidence the
// filter was already remote.
//
// So the four new filters are not three more local ones plus a route change;
// they are one change of mind about where filtering happens, and the two old
// ones came along. `--search` was already server-side and is unchanged.
//
// The only thing that survives locally is nothing at all — `filterIssues` is
// gone. If you are about to add a filter here, add it to `ListIssuesOpts` and to
// the route. A local filter on a listing with no pagination is a cliff with a
// polite label on it.
func newIssueListCmd() *cobra.Command {
	var f issueListFlags
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues,GET /api/users,GET /api/workspaces/{ws}/projects,GET /api/workspaces/{ws}/tasks"},
		Short:       "List issues (by project, task, status, assignee, creator, label, priority, due date)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runIssueList(cmd, f)
		},
	}
	addIssueFilterFlags(cmd, &f)
	cmd.Flags().StringVar(&f.project, "project", "", "Filter by project — "+projectFlagHelp)
	cmd.Flags().StringVar(&f.search, "search", "", "Search title/description, or the #id (e.g. 123 or #123)")
	return cmd
}

// addIssueFilterFlags mounts the filters shared by `issue list` and
// `project issues`, so the two cannot drift in what they offer or in what their
// help says. `project issues` pins --project from its positional and mounts the
// rest of these unchanged.
func addIssueFilterFlags(cmd *cobra.Command, f *issueListFlags) {
	cmd.Flags().StringVar(&f.status, "status", "", "Filter by status: "+vocab("issue_statuses"))
	cmd.Flags().StringVar(&f.assignee, "assignee", "", "Filter by assignee id, email, name, 'me', or 'none' for unassigned")
	cmd.Flags().BoolVar(&f.mine, "mine", false, "Only issues assigned to you (same as --assignee me)")
	cmd.Flags().StringVar(&f.createdBy, "created-by", "", "Filter by who CREATED the issue: id, email, name, 'me', or 'none' for issues whose creator was deleted")
	cmd.Flags().StringArrayVar(&f.label, "label", nil, "Filter by label NAME (repeatable; several are an OR — an issue carrying ANY of them matches)")
	cmd.Flags().StringVar(&f.priority, "priority", "", "Filter by priority: "+vocabPriority("issue"))
	cmd.Flags().StringVar(&f.dueBefore, "due-before", "", "Only issues due on or INCLUDING this date, YYYY-MM-DD; issues with no due date are excluded")
	cmd.Flags().StringVar(&f.task, "task", "", "Filter by task — its #number or its exact name")
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

	opts, err := buildIssueListOpts(c, cfg, f)
	if err != nil {
		return err
	}

	// The issues endpoint returns every matching issue in one response (no
	// pagination), and `total` is the count for the filters actually sent — the
	// same set that comes back. It used to be the count BEFORE local filtering,
	// so "showing 3 of 214" was two different questions on one line.
	page, err := c.ListIssues(opts)
	if err != nil {
		return err
	}
	rows := page.Data
	total := page.Total

	out := any(rows)
	if format != output.FormatTable {
		out = struct {
			Data  []client.Issue `json:"data" yaml:"data"`
			Total *int           `json:"total,omitempty" yaml:"total,omitempty"`
		}{rows, total}
	}

	return output.Render(format, out, func(w io.Writer) error {
		tw := output.Tabwriter(w)
		fmt.Fprintln(tw, "#\tPRIORITY\tSTATUS\tTITLE\tASSIGNEE")
		for _, i := range rows {
			fmt.Fprintf(tw, "%s\tP%d\t%s\t%s\t%s\n",
				issueRef(&i), i.Priority, i.Status, cmdutil.Truncate(i.Title, 60), issueAssigneeLabel(i.Assignees))
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(rows) == 0 {
			// "no issues" and "none matched what you asked for" are different
			// facts, and a filtered listing that prints the first reads as an
			// empty workspace. Naming the filters is also the fastest way to see
			// a typo'd label that matched nothing.
			if applied := describeIssueFilters(f); applied != "" {
				fmt.Fprintf(cmd.ErrOrStderr(), "(no issues match %s — drop a filter to widen the search)\n", applied)
			} else {
				fmt.Fprintln(cmd.ErrOrStderr(), "(no issues)")
			}
		}
		if total != nil {
			fmt.Fprintf(cmd.ErrOrStderr(), "showing %d of %d\n", len(rows), *total)
		}
		return nil
	})
}

// buildIssueListOpts turns the flags into the request. Every branch either
// produces a query parameter or returns an error — a filter that is silently not
// sent gives a wider answer than was asked for, with nothing to notice.
func buildIssueListOpts(c *client.Client, cfg *config.Config, f issueListFlags) (client.ListIssuesOpts, error) {
	var opts client.ListIssuesOpts

	projectID, err := resolveProjectRef(c, f.project)
	if err != nil {
		return opts, err
	}
	opts.ProjectID = projectID
	opts.Search = f.search
	opts.Labels = f.label
	opts.Status = strings.ToLower(strings.TrimSpace(f.status))

	if opts.Status != "" && !isKnownVocabValue("issue_statuses", opts.Status) {
		return opts, cmdutil.Usagef("invalid --status %q — use one of %s",
			f.status, strings.Join(vocabularies["issue_statuses"], " | "))
	}

	priority, err := parseIssuePriority(f.priority)
	if err != nil {
		return opts, err
	}
	opts.Priority = priority

	if d := strings.TrimSpace(f.dueBefore); d != "" {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return opts, cmdutil.Usagef("invalid --due-before %q — use YYYY-MM-DD (it is inclusive: 2026-08-14 includes issues due ON the 14th)", f.dueBefore)
		}
		opts.DueBefore = d
	}

	if strings.TrimSpace(f.task) != "" {
		taskID, err := resolveTaskRef(c, f.task)
		if err != nil {
			return opts, err
		}
		opts.TaskID = taskID
	}

	assignee := strings.TrimSpace(f.assignee)
	if f.mine {
		if assignee != "" && !strings.EqualFold(assignee, "me") {
			return opts, cmdutil.Usagef("--mine and --assignee %q disagree — --mine is --assignee me", f.assignee)
		}
		assignee = "me"
	}
	switch {
	case assignee == "":
		// no assignee filter
	case strings.EqualFold(assignee, "none"), strings.EqualFold(assignee, "unassigned"):
		opts.Unassigned = true
	default:
		uid, err := ResolveUserID(assignee, c, cfg)
		if err != nil {
			return opts, err
		}
		if uid <= 0 {
			return opts, cmdutil.Usagef("could not resolve --assignee %q to a user", f.assignee)
		}
		opts.AssigneeIDs = []int{uid}
	}

	// --created-by takes the same vocabulary as --assignee (id, email, name,
	// 'me', 'none') so the two read alike; 'none' means the author's account is
	// gone, not "unassigned".
	switch createdBy := strings.TrimSpace(f.createdBy); {
	case createdBy == "":
		// no creator filter
	case strings.EqualFold(createdBy, "none"), strings.EqualFold(createdBy, "nobody"):
		opts.NoReporter = true
	default:
		uid, err := ResolveUserID(createdBy, c, cfg)
		if err != nil {
			return opts, err
		}
		if uid <= 0 {
			return opts, cmdutil.Usagef("could not resolve --created-by %q to a user", f.createdBy)
		}
		opts.ReporterIDs = []int{uid}
	}

	return opts, nil
}

// describeIssueFilters renders the filters in play for the empty-result line.
// Empty string means "no filter was applied", which is the one case where "(no
// issues)" is the honest message.
func describeIssueFilters(f issueListFlags) string {
	var parts []string
	add := func(name, value string) {
		if strings.TrimSpace(value) != "" {
			parts = append(parts, name+"="+value)
		}
	}
	add("project", f.project)
	add("task", f.task)
	add("status", f.status)
	add("priority", f.priority)
	add("due-before", f.dueBefore)
	add("search", f.search)
	if f.mine {
		parts = append(parts, "mine")
	} else {
		add("assignee", f.assignee)
	}
	add("created-by", f.createdBy)
	for _, l := range f.label {
		add("label", l)
	}
	return strings.Join(parts, " ")
}

// isClearWord: the four spellings this app has always accepted for "unset this
// field". Extracted from `edit --assignee`, which is where they were established,
// so `--project` clears with the same words rather than a fifth opinion.
func isClearWord(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "none", "null", "clear", "unset":
		return true
	}
	return false
}

func isKnownVocabValue(key, value string) bool {
	for _, v := range vocabularies[key] {
		if v == value {
			return true
		}
	}
	return false
}

func newIssueViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues/{id},GET /api/workspaces/{ws}/issues/{id}/attachments"},
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
				fmt.Fprintf(w, "Project:     %s\n", projectRefLabel(iss))
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
				// ALWAYS printed, for the reason the Labels line above is: an
				// absent row and an empty row look identical and only one of them
				// is true. Attaching a file worked and `issue view` said nothing
				// about it, so the only way to learn a file was there was to guess
				// that `issue attachments` exists.
				fmt.Fprintf(w, "Attachments: %s\n", issueAttachmentLabel(c, iss))
				// ALWAYS printed, and it NAMES THE COMMAND. Same reasoning as the
				// two lines above, one step further: three reports concluded there
				// was no way to edit or delete a comment, and
				// `bk issues issue edit-comment` / `delete-comment` have both
				// existed the whole time. Nothing on this page mentioned comments
				// at all, so there was nothing to lead a reader to them.
				fmt.Fprintf(w, "Comments:    %s\n", issueCommentLabel(iss))
				// Unconditional, like the three rows above and for the same
				// reason. It used to vanish when the issue was in no task, so
				// "not grouped" and "this app has no such concept" printed
				// identically — and `issue edit --project` makes the ungrouped
				// state something a caller reaches on purpose now.
				fmt.Fprintf(w, "Task:        %s\n", taskRefLabel(iss))
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
	var project, priority string
	var title, description, bodyAlias, descriptionFile, status, attach string
	var assignee, task, startDate, dueDate string
	var labels, files []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/issues,GET /api/workspaces/{ws}/projects"},
		Short:       "Create an issue",
		RunE: func(cmd *cobra.Command, args []string) error {
			if project == "" || title == "" {
				return fmt.Errorf("--project and --title are required")
			}
			description, err := mergeAlias(cmd, "description", description, "body", bodyAlias)
			if err != nil {
				return err
			}
			priorityValue, err := parseIssuePriority(priority)
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

			req := client.CreateIssueRequest{
				ProjectID:   projectID,
				Title:       title,
				Description: body,
				Status:      status,
				Priority:    priorityValue,
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
	cmd.Flags().StringVar(&project, "project", "", "Project — "+projectFlagHelp+" (required)")
	cmd.Flags().StringVar(&title, "title", "", "Issue title (required)")
	cmd.Flags().StringVar(&description, "description", "", "Description — Markdown or HTML (use \"-\" for stdin; --description-file for multi-line to avoid escaping newlines). --body is an alias")
	cmd.Flags().StringVar(&bodyAlias, "body", "", "Alias for --description (issue comment and project updates add call it --body)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description (Markdown or HTML) from file")
	cmd.Flags().StringVar(&status, "status", "", "Status: "+vocab("issue_statuses"))
	cmd.Flags().StringVar(&priority, "priority", "", "Priority: "+vocabPriority("issue"))
	cmd.Flags().StringVar(&attach, "attach", "", "Path to a file to add to the issue's attachments list (separate from the body; --file embeds inline instead)")
	cmdutil.AddFileFlag(cmd, &files)
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, or 'me')")
	cmd.Flags().StringVar(&task, "task", "", "Task id")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	cmd.Flags().StringArrayVar(&labels, "label", nil, "Label name (repeatable); existing labels matched, unknown ones created")
	return cmd
}

// LABELS ARE A SUB-RESOURCE, AND `edit --label` IS A CLI CONVENIENCE OVER IT.
//
// `PATCH …/issues/{id}` does not and will not take labels — it rejects the field
// with `labels_not_patchable` (2026-08-11), because label membership lives at
// `…/issues/{id}/labels` where attach and detach are separate, auditable writes.
//
// But `bk issues issue create --label urgent` HAS always accepted labels in one
// call, and that asymmetry is what produced Todo/issues-app-feedback.md item 1:
// someone learned `create --label`, guessed `edit --label`, got "unknown flag",
// and concluded from it that labelling was not exposed at all. Two people
// reached that conclusion while `label attach` sat one `--help` away.
//
// So this flag exists on the CLI and NOT on the route. It takes NAMES, like
// `create --label` does, and fans out to the sub-resource — one extra HTTP call
// per label, no new HTTP surface, and no second opinion about what PATCH means.
// `bk issues label attach|detach` remain the primitive and are what a caller
// wanting one precise write should use.
//
// ORDER MATTERS AND IS DELIBERATE: the PATCH runs FIRST, then removals, then
// additions. If a field update fails, no label has moved yet; and doing removals
// before additions means `--label-remove x --label x` ends with x attached
// rather than depending on flag order.
// MOVING AN ISSUE BETWEEN PROJECTS IS `edit --project`, NOT A `move` VERB.
//
// `bk issues move` already exists and means workspace → workspace ("Move items
// from the active workspace into another workspace you belong to"). A second
// `move` meaning project → project inside one workspace would be one word for
// two operations with different blast radii, which is the shape of mistake that
// only shows up after it has been made.
//
// `project_id` is a field on the issue and the PATCH route has always accepted
// it — this flag is the missing spelling, not a new capability. What IS new is
// the server's refusal when the move would leave the issue in a task belonging
// to the old project; `--task none` in the same call is the recovery, and it
// lands in the same PATCH, so nothing is half-moved.
func newIssueEditCmd() *cobra.Command {
	var status, title, description, descriptionFile string
	var priority string
	var assignee, task, project, startDate, dueDate string
	var addLabels, removeLabels []string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/issues/{id},POST /api/workspaces/{ws}/issues/{id}/labels,DELETE /api/workspaces/{ws}/issues/{id}/labels/{lid},GET /api/workspaces/{ws}/issues/{id}/labels,GET /api/workspaces/{ws}/projects"},
		Short:       "Edit an issue, or move it to another project (--project)",
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
				n, err := parseIssuePriority(priority)
				if err != nil {
					return err
				}
				req.Priority = &n
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
				if isClearWord(assignee) {
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
			if cmd.Flags().Changed("project") {
				if isClearWord(project) {
					req.ProjectID = []byte("null")
				} else {
					pid, err := resolveProjectRef(c, project)
					if err != nil {
						return err
					}
					if pid <= 0 {
						return cmdutil.Usagef("invalid --project %q — run `bk issues project list` to see them", project)
					}
					req.ProjectID = []byte(strconv.Itoa(pid))
				}
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

			// Labels, after the PATCH landed. Removals before additions — see the
			// header. A failure here is returned as-is rather than swallowed: a
			// label that did not move must not be reported as though it had, which
			// is the exact defect (a success that changed nothing) that this whole
			// triage started from.
			if len(addLabels) > 0 || len(removeLabels) > 0 {
				ws, err := cmdutil.RequireActiveWorkspace(cfg)
				if err != nil {
					return err
				}
				for _, name := range removeLabels {
					if err := c.DetachIssueLabelByName(ws, id, name); err != nil {
						return err
					}
				}
				for _, name := range addLabels {
					if err := c.AttachIssueLabelByName(ws, id, name); err != nil {
						return err
					}
				}
				// Re-read so the rendered issue carries the labels just written —
				// `iss` came from the PATCH, which answered before any of them.
				if fresh, err := c.GetIssue(id); err == nil {
					iss = fresh
				}
			}

			return output.Render(format, iss, func(w io.Writer) error {
				fmt.Fprintf(w, "updated %s (status=%s priority=%s)\n",
					issueLabel(iss), iss.Status, issuePriorityLabel(iss.Priority))
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "New status: "+vocab("issue_statuses"))
	cmd.Flags().StringVar(&title, "title", "", "New title")
	cmd.Flags().StringVar(&description, "description", "", "New description — Markdown or HTML (\"-\" for stdin; --description-file for multi-line)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description (Markdown or HTML) from file")
	cmd.Flags().StringVar(&priority, "priority", "", "New priority: "+vocabPriority("issue"))
	cmd.Flags().StringVar(&assignee, "assignee", "", "Assignee (id, email, name, 'me', or 'none' to clear)")
	cmd.Flags().StringVar(&task, "task", "", "Task id (or 'none' to clear)")
	cmd.Flags().StringVar(&project, "project", "", "Move the issue to another project — "+projectFlagHelp+" (or 'none' to unscope it). Refused if the issue's task belongs elsewhere: add --task none to move it out of the task in the same call")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD (or 'none')")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD (or 'none')")
	cmd.Flags().StringArrayVar(&addLabels, "label", nil, "Attach a label by NAME, created if new (repeatable)")
	cmd.Flags().StringArrayVar(&removeLabels, "label-remove", nil, "Detach a label by NAME (repeatable); errors if the issue does not carry it")
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
			// CAPTURED BEFORE THE DELETE, and best-effort. CLAUDE.md's rule for
			// irreversible commands is that they report WHAT they destroyed, not
			// just that they destroyed one — `deleted issue #59` is the difference
			// between a wrong delete somebody catches immediately and one nobody
			// notices for a month. The title cannot be read back afterwards, so it
			// is read now; a failed read falls back to the bare number rather than
			// blocking a delete the caller asked for.
			label := fmt.Sprintf("#%d", id)
			if iss, err := c.GetIssue(id); err == nil {
				label = issueLabel(iss)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Delete issue %s?", label), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.DeleteIssue(id); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted issue %s\n", label)
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
				fmt.Fprintf(w, "issue %s assigned: %s\n", issueLabel(iss), issueAssigneeLabel(iss.Assignees))
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
				fmt.Fprintf(w, "issue %s unassigned\n", issueLabel(iss))
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
		Short:       "Post a comment on an issue (--reply-to threads, --file attaches, @email notifies)",
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
	cmd.Flags().StringVar(&body, "body", "", "Comment text (use \"-\" for stdin). @mention someone by EMAIL (@ana@blackcode.ch) to notify them")
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
	// NOT the same sentence as `comment --body`, and the difference is a fact
	// about the server: lib/db/queries/comments.ts resolves @mentions in
	// createComment() and NOT in updateComment(), so an @mention added by an
	// edit is rendered but notifies nobody. Saying "@mention to notify" here
	// would be help text that is simply untrue.
	cmd.Flags().StringVar(&body, "body", "", "New comment text (\"-\" for stdin). An @mention ADDED by an edit does not notify — post a new comment")
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

// issueLabel NAMES an issue for a confirmation line: `#59 "Fix the login race"`.
//
// ---------------------------------------------------------------------------
// WHY, AND WHY IT COSTS NOTHING
// ---------------------------------------------------------------------------
// `updated #59 (status=done priority=P1)` was the whole of what `issue edit`
// echoed, and a caller working through nineteen issues loses which id was which
// inside a minute — the source report says so about itself. `bk sales` has
// printed `prospect #2 (Nexova AG)` since 2026-08-12 for exactly this reason.
//
// Unlike the sales equivalent this needs NO second request: every command using
// it already holds the issue the route just returned, and `title` is in that
// payload. There is no failure mode to fall back from, which is why this takes
// a *client.Issue rather than an id — a signature that cannot be handed
// something it would have to go and fetch.
//
// It is called from inside the human renderer, so `--json` is unchanged.
func issueLabel(iss *client.Issue) string {
	title := strings.TrimSpace(iss.Title)
	if title == "" {
		return issueRef(iss)
	}
	return fmt.Sprintf("%s %q", issueRef(iss), cmdutil.Truncate(title, 60))
}

// issuePriorityLabel renders a stored priority for a confirmation line, naming
// it when the name is known: `P1 urgent`. A priority outside the vocabulary
// prints as the bare code rather than as a wrong word.
func issuePriorityLabel(n int) string {
	if name := issuePriorityName(n); name != "" {
		return fmt.Sprintf("P%d %s", n, name)
	}
	return fmt.Sprintf("P%d", n)
}

// mergeAlias resolves a flag that has an alternative spelling.
//
// Nothing is renamed: `canonical` is the flag in `Use`/`--help`, `alias` is the
// spelling a caller reasonably guesses from a neighbouring command. Passing
// both with DIFFERENT values is an error naming both, never a silent preference
// — the same rule `resolveProspect` follows in sales, and for the same reason:
// silently picking one writes a value the caller did not name.
func mergeAlias(cmd *cobra.Command, canonical, canonicalValue, alias, aliasValue string) (string, error) {
	usedCanonical := cmd.Flags().Changed(canonical)
	usedAlias := cmd.Flags().Changed(alias)
	switch {
	case usedCanonical && usedAlias && canonicalValue != aliasValue:
		return "", cmdutil.Usagef(
			"--%s and --%s are the same flag and were given different values (%q vs %q) "+
				"— pass one, not both; nothing was changed", canonical, alias, canonicalValue, aliasValue)
	case usedAlias && !usedCanonical:
		return aliasValue, nil
	default:
		return canonicalValue, nil
	}
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

// issueAttachmentLabel formats an issue's attachments for the `view` screen.
//
// ---------------------------------------------------------------------------
// THE COUNT IS FREE; THE NAMES COST ONE REQUEST, AND ONLY WHEN THERE ARE ANY
// ---------------------------------------------------------------------------
// `GET …/issues/{id}` already returns `attachment_count` — verified against a
// running route on 2026-08-12 — so the row costs nothing on the common case of
// an issue with no attachments, which is the case that has to stay cheap.
//
// When the count is non-zero the filenames are worth a second request: "3
// attachments" still leaves the caller running another command to learn
// anything, which is the dead end this row exists to close. A failure to fetch
// them falls back to the count and the command that lists them — a read that
// could not enrich its output must not turn a successful read into an error.
//
// `--json` pays nothing: this runs inside the human renderer only, and the JSON
// payload is the route's, unchanged.
func issueAttachmentLabel(c *client.Client, iss *client.Issue) string {
	n := cmdutil.IntOr(iss.AttachmentCount, 0)
	if n == 0 {
		return "—"
	}
	fallback := fmt.Sprintf("%d (bk issues issue attachments %d)", n, iss.ID)
	atts, err := c.ListIssueAttachments(iss.ID)
	if err != nil || len(atts) == 0 {
		return fallback
	}
	names := make([]string, 0, len(atts))
	for _, a := range atts {
		names = append(names, fmt.Sprintf("%s (#%d)", a.Filename, a.ID))
	}
	return strings.Join(names, ", ")
}

// issueCommentLabel is the count PLUS the command that reads them.
//
// The count alone would repeat the mistake the attachments line was written to
// fix: knowing there are four comments and not knowing how to see them is only
// marginally better than not knowing. It costs no extra request — the listing
// route already returns `comment_count` — and it is the one place a caller
// standing in front of a comment thread will look.
func issueCommentLabel(iss *client.Issue) string {
	n := cmdutil.IntOr(iss.CommentCount, 0)
	if n == 0 {
		return fmt.Sprintf("— (bk issues issue comment %d --body \"…\")", iss.ID)
	}
	return fmt.Sprintf("%d (bk issues issue comments %d — edit-comment / delete-comment to change one)", n, iss.ID)
}

// taskRefLabel prints the task as `#12 name`, the way every other reference in
// this app is printed. It used to be the bare name, which is not something a
// caller can pass to `task view`.
func taskRefLabel(iss *client.Issue) string {
	if iss.TaskID == nil || *iss.TaskID == 0 {
		return "—"
	}
	return strings.TrimSpace(fmt.Sprintf("#%d %s", *iss.TaskID, cmdutil.DerefOr(iss.TaskName, "")))
}

// projectRefLabel is the same for the project, and it exists because of what
// `--project none` made visible: an unscoped issue printed `Project:     #0 `.
// Zero is not a #number in this app — the seq counter starts at 1 — so it was
// a null rendered as a reference, and a caller reading it would go looking for
// project #0.
func projectRefLabel(iss *client.Issue) string {
	if iss.ProjectID == 0 {
		return "— (not in a project)"
	}
	return strings.TrimSpace(fmt.Sprintf("#%d %s", iss.ProjectID, cmdutil.DerefOr(iss.ProjectName, "")))
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
