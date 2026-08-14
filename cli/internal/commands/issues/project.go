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

func newProjectCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "project",
		Short: "Manage projects",
	}
	cmd.AddCommand(
		newProjectListCmd(),
		newProjectViewCmd(),
		newProjectMembersCmd(),
		newProjectIssuesCmd(),
		newProjectTasksCmd(),
		newProjectCreateCmd(),
		newProjectEditCmd(),
		newProjectDeleteCmd(),
		newProjectAddMemberCmd(),
		newProjectRemoveMemberCmd(),
		newProjectUpdatesCmd(),
		newProjectCommentCmd(),
		newProjectCommentsCmd(),
	)
	return cmd
}

func newProjectListCmd() *cobra.Command {
	var search string
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/projects"},
		Short:       "List projects you are a member of",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			// The projects endpoint returns every project in one response.
			projects, err := c.ListProjects(search)
			if err != nil {
				return err
			}

			return output.Render(format, projects, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tSTATUS\tROLE\tISSUES (OPEN/TOTAL)")
				for _, p := range projects {
					status := cmdutil.DerefOr(p.Status, "—")
					role := cmdutil.DerefOr(p.MemberRole, "—")
					open := cmdutil.IntOr(p.OpenIssues, 0)
					total := cmdutil.IntOr(p.IssueCount, 0)
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%d/%d\n", p.ID, p.Name, status, role, open, total)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(projects) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no projects)")
				}
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&search, "search", "", "Search name/description, or the #id (e.g. 123 or #123); server-side")
	return cmd
}

func newProjectViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "view <id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/projects/{id}"},
		Short:       "Show a single project",
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
			p, err := c.GetProject(id)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:          %d\n", p.ID)
				fmt.Fprintf(w, "Name:        %s\n", p.Name)
				fmt.Fprintf(w, "Status:      %s\n", cmdutil.DerefOr(p.Status, "—"))
				fmt.Fprintf(w, "Description: %s\n", cmdutil.DerefOr(p.Description, "—"))
				if p.CreatedAt != nil {
					fmt.Fprintf(w, "Created:     %s\n", *p.CreatedAt)
				}
				return nil
			})
		},
	}
}

func newProjectMembersCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "members <project-id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/projects/{id}/members"},
		Short:       "List members of a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			members, err := c.ListProjectMembers(id)
			if err != nil {
				return err
			}
			return output.Render(format, members, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "USER ID\tNAME\tEMAIL\tROLE")
				for _, m := range members {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\n",
						m.UserID, cmdutil.DerefOr(m.Name, "—"), m.Email, m.Role)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(members) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no members)")
				}
				return nil
			})
		},
	}
}

func newProjectIssuesCmd() *cobra.Command {
	var f issueListFlags
	cmd := &cobra.Command{
		Use:         "issues <project>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/issues,GET /api/users,GET /api/workspaces/{ws}/projects,GET /api/workspaces/{ws}/tasks"},
		Short:       "List issues for a project, by id or name (same filters as `issue list`)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			// The positional is handed to runIssueList as-is: it resolves it
			// through resolveProjectRef, so `project issues "Website relaunch"`
			// works here for the same reason `issue list --project` does.
			f.project = args[0]
			return runIssueList(cmd, f)
		},
	}
	// The SAME flags as `issue list`, from one constructor. They used to be a
	// hand-copied subset of two, which is how this command kept a "CLIENT-SIDE"
	// label describing a mechanism `issue list` had already left behind.
	addIssueFilterFlags(cmd, &f)
	cmd.Flags().StringVar(&f.search, "search", "", "Search title/description, or the #id (e.g. 123 or #123)")
	return cmd
}

func newProjectTasksCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "tasks <project>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/tasks,GET /api/workspaces/{ws}/projects"},
		Short:       "List tasks for a project, by id or name",
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
			id, err := resolveProjectRef(c, args[0])
			if err != nil {
				return err
			}
			ms, err := c.ListTasks(id, "")
			if err != nil {
				return err
			}
			return output.Render(format, ms, taskTable(ms, cmd.ErrOrStderr()))
		},
	}
}

func newProjectCreateCmd() *cobra.Command {
	var name, summary, description, descriptionFile string
	var icon, iconURL, bannerURL, lead string
	var priority, visibility, color, startDate, dueDate string
	var files []string
	cmd := &cobra.Command{
		Use:         "create",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/projects"},
		Short:       "Create a new project",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
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
			req := client.CreateProjectRequest{
				Name:        name,
				Summary:     summary,
				Description: body,
			}
			if cmd.Flags().Changed("priority") {
				code, err := parseProjectPriority(priority)
				if err != nil {
					return err
				}
				req.Priority = &code
			}
			if cmd.Flags().Changed("visibility") {
				req.Visibility = &visibility
			}
			if cmd.Flags().Changed("color") {
				req.Color = &color
			}
			if cmd.Flags().Changed("icon") {
				req.Icon = cmdutil.StringOrNullJSON(icon)
			}
			if cmd.Flags().Changed("logo") {
				req.IconURL = cmdutil.StringOrNullJSON(iconURL)
			}
			if cmd.Flags().Changed("banner") {
				req.BannerURL = cmdutil.StringOrNullJSON(bannerURL)
			}
			if cmd.Flags().Changed("lead") {
				req.LeadUserID, err = cmdutil.IntOrNullJSON(lead, c, cfg)
				if err != nil {
					return err
				}
			}
			if cmd.Flags().Changed("start-date") {
				req.StartDate = &startDate
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = &dueDate
			}
			p, err := c.CreateProject(req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "created #%d %q\n", p.ID, p.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Project name (required)")
	cmd.Flags().StringVar(&summary, "summary", "", "Short plain-text summary (shown in kanban cards)")
	cmd.Flags().StringVar(&description, "description", "", "Project description (use \"-\" to read stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from a file")
	cmd.Flags().StringVar(&priority, "priority", "", "Priority: "+vocabPriority("project"))
	cmd.Flags().StringVar(&visibility, "visibility", "", "Visibility (public/private/secret)")
	cmd.Flags().StringVar(&color, "color", "", "Hex color e.g. #5E6AD2")
	cmd.Flags().StringVar(&icon, "icon", "", "Icon key, e.g. Rocket — run bk meta for the set")
	cmd.Flags().StringVar(&iconURL, "logo", "", "Logo image URL (from bk issues upload); shown instead of the icon")
	cmd.Flags().StringVar(&bannerURL, "banner", "", "Banner image URL (from bk issues upload)")
	cmd.Flags().StringVar(&lead, "lead", "",
		"Project lead — id, email, display name, or 'me'. Defaults to you; 'none' for no lead")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	cmdutil.AddFileFlag(cmd, &files)
	return cmd
}

func newProjectEditCmd() *cobra.Command {
	var name, summary, description, descriptionFile, status string
	var priority, visibility, color, startDate, dueDate string
	var icon, iconURL, bannerURL, lead string
	cmd := &cobra.Command{
		Use:         "edit <id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/projects/{id}"},
		Short:       "Edit a project (name, description, status, priority, lead, icon, logo, color, dates)",
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
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			req := client.UpdateProjectRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("summary") {
				req.Summary = &summary
			}
			if cmd.Flags().Changed("description") || cmd.Flags().Changed("description-file") {
				body, err := cmdutil.ReadBody(description, descriptionFile)
				if err != nil {
					return err
				}
				req.Description = &body
			}
			if cmd.Flags().Changed("status") {
				req.Status = &status
			}
			if cmd.Flags().Changed("priority") {
				code, err := parseProjectPriority(priority)
				if err != nil {
					return err
				}
				req.Priority = &code
			}
			if cmd.Flags().Changed("visibility") {
				req.Visibility = &visibility
			}
			if cmd.Flags().Changed("color") {
				req.Color = &color
			}
			if cmd.Flags().Changed("icon") {
				req.Icon = cmdutil.StringOrNullJSON(icon)
			}
			if cmd.Flags().Changed("logo") {
				req.IconURL = cmdutil.StringOrNullJSON(iconURL)
			}
			if cmd.Flags().Changed("banner") {
				req.BannerURL = cmdutil.StringOrNullJSON(bannerURL)
			}
			if cmd.Flags().Changed("lead") {
				req.LeadUserID, err = cmdutil.IntOrNullJSON(lead, c, cfg)
				if err != nil {
					return err
				}
			}
			if cmd.Flags().Changed("start-date") {
				req.StartDate = &startDate
			}
			if cmd.Flags().Changed("due-date") {
				req.DueDate = &dueDate
			}
			if req.Description != nil {
				resolved, err := cmdutil.ResolveBodyMedia(c, *req.Description)
				if err != nil {
					return err
				}
				req.Description = &resolved
			}
			p, err := c.UpdateProject(id, req)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "updated #%d %q\n", p.ID, p.Name)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New name")
	cmd.Flags().StringVar(&summary, "summary", "", "Short plain-text summary (shown in kanban cards)")
	cmd.Flags().StringVar(&description, "description", "", "New description (use \"-\" for stdin)")
	cmd.Flags().StringVar(&descriptionFile, "description-file", "", "Read description from file")
	cmd.Flags().StringVar(&status, "status", "", "New status: "+vocab("project_statuses"))
	cmd.Flags().StringVar(&priority, "priority", "", "Priority: "+vocabPriority("project"))
	cmd.Flags().StringVar(&visibility, "visibility", "", "Visibility (public/private/secret)")
	cmd.Flags().StringVar(&color, "color", "", "Hex color e.g. #5E6AD2")
	cmd.Flags().StringVar(&icon, "icon", "", "Icon key, e.g. Rocket; 'none' clears it")
	cmd.Flags().StringVar(&iconURL, "logo", "", "Logo image URL (from bk issues upload); shown instead of the icon. 'none' removes it")
	cmd.Flags().StringVar(&bannerURL, "banner", "", "Banner image URL (from bk issues upload); 'none' removes it")
	cmd.Flags().StringVar(&lead, "lead", "", "Project lead — id, email, display name, 'me', or 'none' to clear")
	cmd.Flags().StringVar(&startDate, "start-date", "", "Start date YYYY-MM-DD")
	cmd.Flags().StringVar(&dueDate, "due-date", "", "Due date YYYY-MM-DD")
	return cmd
}

func newProjectDeleteCmd() *cobra.Command {
	var yes, cascade, detach bool
	cmd := &cobra.Command{
		Use:         "delete <id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/projects/{id}"},
		Short:       "Move a project to the Trash",
		Long: "Move a project to the recycle bin. Restore it later with `bk issues trash restore`.\n\n" +
			"Attached issues and tasks: by default they stay active and are\n" +
			"unlinked from the project (--detach). Pass --cascade to move them to the\n" +
			"Trash along with the project so they can be restored as a group.",
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
			prompt := fmt.Sprintf("Move project #%d to Trash?", id)
			if cascade {
				prompt = fmt.Sprintf("Move project #%d and its issues/tasks to Trash?", id)
			}
			if !cmdutil.Confirm(prompt, yes) {
				return fmt.Errorf("aborted")
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if err := c.DeleteProject(id, mode); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "moved project #%d to Trash\n", id)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	cmd.Flags().BoolVar(&cascade, "cascade", false, "Also move attached issues/tasks to Trash")
	cmd.Flags().BoolVar(&detach, "detach", false, "Keep attached issues/tasks active, unlinked (default)")
	return cmd
}

func newProjectAddMemberCmd() *cobra.Command {
	var email, role string
	cmd := &cobra.Command{
		Use:         "add-member <project-id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/projects/{id}/members"},
		Short:       "Add a member to a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			if email == "" {
				return fmt.Errorf("--email is required")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			m, err := c.AddProjectMember(id, client.AddMemberRequest{Email: email, Role: role})
			if err != nil {
				return err
			}
			return output.Render(format, m, func(w io.Writer) error {
				fmt.Fprintf(w, "added %s as %s to project #%d\n", m.Email, m.Role, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&email, "email", "", "Email of the user to add (must already be registered)")
	cmd.Flags().StringVar(&role, "role", "member", "owner | admin | member | viewer")
	return cmd
}

func newProjectRemoveMemberCmd() *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "remove-member <project-id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/projects/{id}/members"},
		Short:       "Remove a member from a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			if userRef == "" {
				return fmt.Errorf("--user is required (id, email, or name)")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			uid, err := cmdutil.ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Remove user #%d from project #%d?", uid, id), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.RemoveProjectMember(id, uid); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "removed user #%d from project #%d\n", uid, id)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "user", "", "User to remove (id, email, or name)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newProjectUpdatesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "updates",
		Short: "Manage project health/status updates",
	}
	cmd.AddCommand(
		newProjectUpdatesListCmd(),
		newProjectUpdatesAddCmd(),
		newProjectUpdatesDeleteCmd(),
	)
	return cmd
}

func newProjectUpdatesListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list <project-id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/projects/{id}/updates"},
		Short:       "List health updates for a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
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
			updates, err := c.ListProjectUpdates(ws, id)
			if err != nil {
				return err
			}
			return output.Render(format, updates, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tSTATUS\tAUTHOR\tWHEN\tBODY")
				for _, u := range updates {
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						u.ID, u.Status, cmdutil.DerefOr(u.AuthorName, "—"),
						cmdutil.DerefOr(u.CreatedAt, ""), cmdutil.Truncate(cmdutil.DerefOr(u.Body, ""), 60))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(updates) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no updates)")
				}
				return nil
			})
		},
	}
}

func newProjectUpdatesAddCmd() *cobra.Command {
	var status, health, body, bodyFile, projectFlag string
	cmd := &cobra.Command{
		Use:         "add <project>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/projects/{id}/updates,GET /api/workspaces/{ws}/projects"},
		Short:       "Post a health update on a project (--status, aka --health)",
		Args:        cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			status, err := mergeAlias(cmd, "status", status, "health", health)
			if err != nil {
				return err
			}
			if status == "" {
				return fmt.Errorf("--status is required: %s", vocab("project_update_health"))
			}
			content, err := cmdutil.ReadBody(body, bodyFile)
			if err != nil {
				return err
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			id, _, err := resolveProjectPositionalOrFlag(cmd, c, args, projectFlag, 0)
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
			req := client.CreateProjectUpdateRequest{Status: status}
			if content != "" {
				req.Body = &content
			}
			upd, err := c.CreateProjectUpdate(ws, id, req)
			if err != nil {
				return err
			}
			return output.Render(format, upd, func(w io.Writer) error {
				fmt.Fprintf(w, "update #%d posted on project #%d (status: %s)\n", upd.ID, id, upd.Status)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&status, "status", "", vocab("project_update_health", "required")+". --health is an alias")
	// The alias names the values TOO. A caller reading `--help` stops at the
	// first flag that answers their question, and "see the other flag" is a
	// second lookup for a flag that exists to save one.
	cmd.Flags().StringVar(&health, "health", "", vocab("project_update_health")+
		". Alias for --status — this posts a HEALTH update, and that is the word most callers reach for")
	cmd.Flags().StringVar(&body, "body", "", "Optional message (\"-\" for stdin)")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	addProjectFlag(cmd, &projectFlag)
	return cmd
}

func newProjectUpdatesDeleteCmd() *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete <project-id> <update-id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/projects/{id}/updates/{updateId}"},
		Short:       "Delete a project health update (author only)",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			projectID, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
			}
			updateID, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("invalid update id: %w", err)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Delete update #%d on project #%d?", updateID, projectID), yes) {
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
			if err := c.DeleteProjectUpdate(ws, projectID, updateID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted update #%d\n", updateID)
			return nil
		},
	}
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newProjectCommentCmd() *cobra.Command {
	var body, bodyFile string
	cmd := &cobra.Command{
		Use:         "comment <project-id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/projects/{id}/comments"},
		Short:       "Post a comment on a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
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
			cm, err := c.CreateProjectComment(ws, id, content)
			if err != nil {
				return err
			}
			return output.Render(format, cm, func(w io.Writer) error {
				fmt.Fprintf(w, "comment #%d posted on project #%d\n", cm.ID, id)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&body, "body", "", "Comment text (\"-\" for stdin). @mention someone by EMAIL (@ana@blackcode.ch) to notify them")
	cmd.Flags().StringVar(&bodyFile, "body-file", "", "Read body from file")
	return cmd
}

func newProjectCommentsCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "comments <project-id>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/projects/{id}/comments"},
		Short:       "List comments on a project",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.Atoi(args[0])
			if err != nil {
				return fmt.Errorf("invalid project id: %w", err)
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
			comments, err := c.ListProjectComments(ws, id)
			if err != nil {
				return err
			}
			return output.Render(format, comments, cmdutil.RenderCommentList(comments, cmd.ErrOrStderr()))
		},
	}
}
