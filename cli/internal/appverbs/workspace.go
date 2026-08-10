package appverbs

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk <app> workspace` — THIS APP's tenancies.
//
// App-owned since Phase 4, and the reason is a table, not a taste: since Phase 2
// each app has its own workspaces (`sales.workspaces`), mirrored from the
// platform table so THE IDS AND SLUGS OVERLAP. A bare `bk workspace use <slug>`
// therefore had no defensible answer to "in which app?", and the one it gave was
// "whichever app you were last homed on" — recorded in a single config field
// that the next app's `use` overwrote.
//
// MEASURED before this moved, on two local dev servers: `bk workspace use
// balathanusan-1` (a workspace only issues has) left `bk sales prospect list`
// answering `workspace not found (404)` with a hint blaming the surface. Each
// app now remembers its own — see config.ActiveWorkspaces.
func newWorkspaceCmd(cfg Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "workspace",
		Short: "Manage this app's workspaces (your current scope)",
		Long: fmt.Sprintf(`Workspaces partition everything this app holds. Pick the active one
once with "bk %s workspace use", and the rest of "bk %s" operates within it.

EACH APP REMEMBERS ITS OWN. Setting this app's active workspace does not touch
any other app's — they are different tables with overlapping ids, so a slug only
means something against the app it was resolved in.`, cfg.App, cfg.App),
	}
	cmd.AddCommand(
		newWorkspaceListCmd(cfg),
		newWorkspaceShowCmd(cfg),
		newWorkspaceUseCmd(cfg),
	)
	if cfg.WorkspaceAdmin {
		cmd.AddCommand(
			newWorkspaceCreateCmd(cfg),
			newWorkspaceEditCmd(cfg),
			newWorkspaceTransferCmd(cfg),
			newWorkspaceDeleteCmd(cfg),
		)
	}
	return cmd
}

// newWorkspaceListCmd lists the workspaces you can use THIS app in.
//
// The default is app-scoped: a workspace where this app is switched off, or
// where you were never granted it, is not a workspace you can write to, and
// offering it would offer a guaranteed 403.
//
// --all is the escape hatch, and it is not optional politeness. Without it, a
// workspace that this app is not enabled in simply vanishes, and "where did my
// workspace go?" would have no answer from inside the app that hid it. --all
// shows every membership plus the apps you can reach in each.
func newWorkspaceListCmd(acfg Config) *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces"},
		Short:       "List workspaces you can use this app in (--all for every membership)",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			activeID := cfg.ActiveWorkspaceFor(acfg.App).ID

			if all {
				workspaces, err := c.ListAllMyWorkspaces()
				if err != nil {
					return err
				}
				return output.Render(format, workspaces, func(w io.Writer) error {
					tw := output.Tabwriter(w)
					fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE\tAPPS")
					for _, ws := range workspaces {
						mark := " "
						if ws.ID == activeID {
							mark = "*"
						}
						apps := "—"
						if len(ws.Apps) > 0 {
							apps = strings.Join(ws.Apps, ",")
						}
						fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\t%s\n",
							mark, ws.ID, ws.Name, ws.Slug, ws.MemberRole, apps)
					}
					if err := tw.Flush(); err != nil {
						return err
					}
					if len(workspaces) == 0 {
						fmt.Fprintln(cmd.ErrOrStderr(), "(no workspaces)")
					} else {
						fmt.Fprintln(cmd.ErrOrStderr(),
							"\nAPPS is what YOU can open there. An empty column means you are a member "+
								"but have no app access — ask an owner, or see `bk app access list`.")
					}
					return nil
				})
			}

			workspaces, err := c.ListMyWorkspaces()
			if err != nil {
				return err
			}

			return output.Render(format, workspaces, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tID\tNAME\tSLUG\tROLE")
				for _, ws := range workspaces {
					mark := " "
					if ws.ID == activeID {
						mark = "*"
					}
					fmt.Fprintf(tw, "%s\t%d\t%s\t%s\t%s\n",
						mark, ws.ID, ws.Name, ws.Slug, ws.MemberRole)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(workspaces) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(),
						fmt.Sprintf("(no workspaces you can use this app in — try `bk %s workspace list --all`)", acfg.App))
				}
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&all, "all", false,
		"Show every workspace you are a member of, with the apps you can reach in each")
	return cmd
}

func newWorkspaceShowCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "show [slug|id]",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}"},
		Short:       "Show details of a workspace (defaults to active)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := cmdutil.ResolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			detail, err := c.GetWorkspace(ref)
			if err != nil {
				return err
			}

			return output.Render(format, detail, func(w io.Writer) error {
				fmt.Fprintf(w, "Name:    %s\n", detail.Workspace.Name)
				fmt.Fprintf(w, "Slug:    %s\n", detail.Workspace.Slug)
				fmt.Fprintf(w, "Role:    %s\n", detail.Role)
				fmt.Fprintf(w, "Members: %d\n", len(detail.Members))
				return nil
			})
		},
	}
}

func newWorkspaceCreateCmd(acfg Config) *cobra.Command {
	var name string
	var useAfter bool
	cmd := &cobra.Command{
		Use:         "create --name NAME",
		Annotations: map[string]string{"routes": "POST /api/workspaces"},
		Short:       "Create a new workspace",
		RunE: func(cmd *cobra.Command, args []string) error {
			if name == "" {
				return fmt.Errorf("--name is required")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := c.CreateWorkspace(name)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Created %s (slug: %s)\n", ws.Name, ws.Slug)
			if useAfter {
				if _, err := c.SetActiveWorkspace(ws.ID); err != nil {
					return err
				}
				cfg.SetActiveWorkspaceFor(acfg.App, config.ActiveWorkspace{ID: ws.ID, Slug: ws.Slug})
				if err := config.Save(cfg); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Active %s workspace set to %s.\n", acfg.App, ws.Slug)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Workspace name")
	cmd.Flags().BoolVar(&useAfter, "use", true, "Set this workspace as active after creation")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newWorkspaceUseCmd(acfg Config) *cobra.Command {
	return &cobra.Command{
		Use:         "use <slug|id>",
		Annotations: map[string]string{"routes": "POST /api/me/active-workspace,GET /api/workspaces"},
		Short:       "Set the active workspace for subsequent commands",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			detail, err := c.GetWorkspace(args[0])
			if err != nil {
				return err
			}
			if _, err := c.SetActiveWorkspace(detail.Workspace.ID); err != nil {
				return err
			}
			cfg.SetActiveWorkspaceFor(acfg.App, config.ActiveWorkspace{
				ID:   detail.Workspace.ID,
				Slug: detail.Workspace.Slug,
			})
			if err := config.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Active %s workspace: %s (%s)\n",
				acfg.App, detail.Workspace.Name, detail.Workspace.Slug)
			fmt.Fprintf(cmd.ErrOrStderr(),
				"this is the %s app's workspace only — every other app keeps its own\n", acfg.App)
			return nil
		},
	}
}

func newWorkspaceEditCmd(acfg Config) *cobra.Command {
	var name, slug string
	cmd := &cobra.Command{
		Use:         "edit [slug|id]",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}"},
		Short:       "Edit workspace settings (name, slug)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := cmdutil.ResolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			req := client.UpdateWorkspaceRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("slug") {
				req.Slug = &slug
			}
			ws, err := c.UpdateWorkspace(ref, req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "updated workspace %q (slug: %s)\n",
				ws.Name, ws.Slug)
			// Refresh config if this app's active workspace was edited.
			if active := cfg.ActiveWorkspaceFor(acfg.App); active.Slug == ref || fmt.Sprint(active.ID) == ref {
				cfg.SetActiveWorkspaceFor(acfg.App, config.ActiveWorkspace{ID: active.ID, Slug: ws.Slug})
				_ = config.Save(cfg)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "New workspace name")
	cmd.Flags().StringVar(&slug, "slug", "", "New URL slug (lowercase, no spaces)")
	return cmd
}

func newWorkspaceTransferCmd(acfg Config) *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "transfer [slug|id]",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/transfer"},
		Short:       "Transfer workspace ownership to another member (owner only)",
		Args:        cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if userRef == "" {
				return fmt.Errorf("--to is required (user id, email, or name)")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ref, err := cmdutil.ResolveWorkspaceRef(cfg, args)
			if err != nil {
				return err
			}
			newOwnerID, err := cmdutil.ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf("Transfer workspace %q to user #%d? You will become a regular member.", ref, newOwnerID), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.TransferOwnership(ref, newOwnerID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "ownership transferred to user #%d\n", newOwnerID)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "to", "", "New owner (id, email, or name)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// newWorkspaceDeleteCmd deletes a workspace and everything inside it.
//
// This is the most destructive call in the CLI, and the usual `--yes` guard is
// not enough on its own: cmdutil.Confirm() auto-approves under BK_NO_PROMPT=1 and on a
// non-TTY, which is exactly how agents run. So the real guard is --confirm: the
// caller must repeat the workspace back, which cannot happen by accident from a
// wrong variable or a mis-scoped loop.
//
// It also takes the target as an explicit argument rather than falling back to
// the active workspace — "delete whatever I happen to be pointed at" is not a
// safe default for an irreversible operation.
func newWorkspaceDeleteCmd(acfg Config) *cobra.Command {
	var confirmRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "delete <slug|id> --confirm <slug|id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}"},
		Short:       "Permanently delete a workspace and everything in it (owner only)",
		Long: fmt.Sprintf(`Permanently delete a workspace and everything this app holds in it.
This is NOT the Trash — there is no restore.

You must be the workspace owner. To transfer it instead, see
"bk %s workspace transfer".

--confirm must repeat the same slug/id you passed as the argument. It is
required even with --yes and even under BK_NO_PROMPT=1.

  bk %s workspace delete scratch-ws --confirm scratch-ws

If the deleted workspace was your active one, this app's active workspace is
cleared — run "bk %s workspace use <slug>" to pick a new one.`,
			acfg.App, acfg.App, acfg.App),
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ref := strings.TrimSpace(args[0])
			if ref == "" {
				return fmt.Errorf("a workspace slug or id is required")
			}
			if strings.TrimSpace(confirmRef) != ref {
				return fmt.Errorf(
					"--confirm is required and must match the workspace being deleted: --confirm %s", ref)
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"Permanently delete workspace %q and everything in it? This cannot be undone.", ref), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.DeleteWorkspace(ref); err != nil {
				return err
			}
			// Clear the active workspace if we just deleted it, so the next
			// command fails with "no active workspace" instead of 404-ing.
			if active := cfg.ActiveWorkspaceFor(acfg.App); active.Slug == ref || fmt.Sprint(active.ID) == ref {
				cfg.SetActiveWorkspaceFor(acfg.App, config.ActiveWorkspace{})
				_ = config.Save(cfg)
				fmt.Fprintf(cmd.ErrOrStderr(),
					"note: that was your active %s workspace — run `bk %s workspace use <slug>` to pick another\n",
					acfg.App, acfg.App)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "deleted workspace %q\n", ref)
			return nil
		},
	}
	cmd.Flags().StringVar(&confirmRef, "confirm", "",
		"Repeat the workspace slug/id to authorise the delete (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// ---------- shared helpers ----------
//
// cmdutil.NewClient/cmdutil.NewClientAndConfig, workspace-ref resolution and the small deref
// helpers moved to internal/cmdutil in Phase 5, so that commands/platform and
// commands/issues can both use them without importing each other.
