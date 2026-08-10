package platform

import (
	"fmt"
	"io"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk app` — which Blackcode apps a workspace runs, and who may use them.
//
// A PLATFORM verb, so it stays at the root when Phase 5 moves this app's nouns
// behind `bk issues …`: "which apps does this org run" is the same question
// whichever app you are asking from.
//
// The distinction this group exists to make legible:
//
//	workspace member  you are in this organisation
//	app access        you may open this app inside it
//
// A member without access is not an error — it is what `invite_only` means. It is
// also the failure that looks like success (an empty workspace list, not a
// crash), which is why every denial from the server carries a hint, and why
// `bk app access list` shows members WITHOUT access alongside those with it.
func newAppCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "app",
		Short: "Apps enabled for a workspace, and who may use them",
		Long: `Manage which Blackcode apps a workspace runs, and which of its members
may use each one.

  bk app list                              apps here, their servers, reachability
  bk app use <slug>                        switch the home app (bare verbs)
  bk app enable <app>                      turn an app on for the workspace
  bk app disable <app>                     turn it off (revokes every grant)
  bk app default-access <app> --mode …     all_members | invite_only
  bk app access list <app>                 who has access, and who does not
  bk app access grant <app> --user <ref>   grant one member
  bk app access revoke <app> --user <ref>  revoke one member

Membership and access are different things: ` + "`bk <app> member list`" + ` shows who is in
the workspace, this shows who can open a given app inside it. With
default-access all_members the two are the same set; with invite_only they are
not, which is the point.

Use --ws <slug> to target a workspace other than the active one.`,
	}
	cmd.AddCommand(
		newAppListCmd(),
		newAppUseCmd(),
		newAppEnableCmd(),
		newAppDisableCmd(),
		newAppDefaultAccessCmd(),
		newAppAccessCmd(),
	)
	return cmd
}

func newAppListCmd() *cobra.Command {
	var noProbe bool
	cmd := &cobra.Command{
		Use:         "list",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/apps,GET /api/me"},
		Short:       "List apps here, the server each one answers on, and whether you can reach it",
		Long: `List every app registered for the workspace, with the address this
binary will send its commands to and whether that address answers for you.

Three separate things have to be true before "bk <app> …" works, and they fail
in ways that look alike from inside a command that just 404s:

  ENABLED     the workspace runs the app
  SERVER      this binary knows its address (learned by "bk login" / "bk meta")
  REACHABLE   that address answers, and accepts this token

--no-probe skips the reachability check (no network calls beyond the app list).`,
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
			apps, err := c.ListWorkspaceApps(ws)
			if err != nil {
				return err
			}

			// The registry can hold an app this workspace does not run, and the
			// workspace can run one the registry has no address for. Both are
			// worth seeing here — this is the command someone runs when routing
			// is what they are confused about.
			type row struct {
				client.WorkspaceApp
				Server    string `json:"server" yaml:"server"`
				Reachable string `json:"reachable,omitempty" yaml:"reachable,omitempty"`
				IsHome    bool   `json:"is_home" yaml:"is_home"`
			}
			rows := make([]row, 0, len(apps))
			slugs := make([]string, 0, len(apps))
			for _, a := range apps {
				server := cfg.AppServers[a.Slug]
				rows = append(rows, row{WorkspaceApp: a, Server: server, IsHome: a.Slug == cfg.HomeApp})
				if server != "" {
					slugs = append(slugs, a.Slug)
				}
			}
			probes := map[string]string{}
			if !noProbe {
				probes = probeAll(cfg, slugs)
			}
			for i := range rows {
				if rows[i].Server == "" {
					rows[i].Reachable = "no server"
					continue
				}
				if r, ok := probes[rows[i].Slug]; ok {
					rows[i].Reachable = r
				}
			}

			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "\tAPP\tNAME\tENABLED\tDEFAULT ACCESS\tACCESS\tSERVER\tREACHABLE")
				for _, a := range rows {
					mode := "—"
					if a.DefaultAccess != nil {
						mode = *a.DefaultAccess
					}
					enabled := "no"
					if a.Enabled {
						enabled = "yes"
					}
					if !a.GloballyEnabled {
						enabled = "no (disabled platform-wide)"
					}
					home := " "
					if a.IsHome {
						home = "*"
					}
					server := a.Server
					if server == "" {
						server = "—"
					}
					reach := a.Reachable
					if reach == "" {
						reach = "—"
					}
					fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%d\t%s\t%s\n",
						home, a.Slug, a.Name, enabled, mode, a.AccessCount, server, reach)
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no apps registered)")
					return nil
				}
				fmt.Fprintf(cmd.ErrOrStderr(),
					"\n* = home app: where the bare verbs go (`bk app use <slug>` to switch).\n"+
						"An app with no SERVER cannot be reached by `bk <app> …` — run `bk meta` to refresh the registry.\n")
				return nil
			})
		},
	}
	cmd.Flags().BoolVar(&noProbe, "no-probe", false, "Skip the reachability check (no extra requests)")
	return cmd
}

func newAppEnableCmd() *cobra.Command {
	var mode string
	cmd := &cobra.Command{
		Use:         "enable <app>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/apps/{app}"},
		Short:       "Enable an app for a workspace (owner only)",
		Long: `Turn an app on for a workspace.

With --mode all_members (the default) every current member is granted access
immediately, and anyone joining later is granted automatically. With
--mode invite_only nobody is granted; use ` + "`bk app access grant`" + ` per person.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			enabled := true
			req := client.UpdateWorkspaceAppRequest{Enabled: &enabled}
			if cmd.Flags().Changed("mode") {
				if err := validateMode(mode); err != nil {
					return err
				}
				req.DefaultAccess = &mode
			}
			state, err := c.UpdateWorkspaceApp(ws, args[0], req)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "enabled %s for %s (default access: %s)\n",
				state.App, ws, cmdutil.DerefOr(state.DefaultAccess, "all_members"))
			return nil
		},
	}
	cmd.Flags().StringVar(&mode, "mode", "all_members", "How access is granted: all_members | invite_only")
	return cmd
}

// newAppDisableCmd turns an app off for a workspace, revoking every grant.
//
// The server refuses to disable the app that is serving the request — it would
// lock every member of the workspace, owner included, out of the product with no
// route back in. That refusal is deliberate and not overridable from here; see
// the route for the reasoning. We still require --confirm, because for any OTHER
// app this silently drops every grant an admin has made, and cmdutil.Confirm() cannot be
// the guard: it auto-approves under BK_NO_PROMPT=1 and on a non-TTY, which is
// exactly how agents run.
func newAppDisableCmd() *cobra.Command {
	var confirmRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "disable <app> --confirm <app>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/apps/{app}"},
		Short:       "Disable an app for a workspace, revoking every grant (owner only)",
		Long: `Turn an app off for a workspace. Every member's access to it is revoked;
the app's data is untouched.

--confirm must repeat the app slug. It is required even with --yes and even
under BK_NO_PROMPT=1.

  bk app disable sales --confirm sales

You cannot disable the app you are calling from — it would lock this workspace
out of the product with no way back. Do that from another app in the suite.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			app := strings.TrimSpace(args[0])
			if strings.TrimSpace(confirmRef) != app {
				return fmt.Errorf(
					"--confirm is required and must match the app being disabled: --confirm %s", app)
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"Disable %q for workspace %q? Every member loses access to it.", app, ws), yes) {
				return fmt.Errorf("aborted")
			}
			enabled := false
			if _, err := c.UpdateWorkspaceApp(ws, app, client.UpdateWorkspaceAppRequest{
				Enabled: &enabled,
			}); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "disabled %s for %s\n", app, ws)
			return nil
		},
	}
	cmd.Flags().StringVar(&confirmRef, "confirm", "",
		"Repeat the app slug to authorise the disable (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func newAppDefaultAccessCmd() *cobra.Command {
	var mode string
	cmd := &cobra.Command{
		Use:         "default-access <app> --mode all_members|invite_only",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/apps/{app}"},
		Short:       "Set how an app grants access to new members (owner only)",
		Long: `Choose how an app hands out access in this workspace.

  all_members   every member has it; joining grants it automatically. Switching
                TO this mode grants every current member immediately — otherwise
                the setting would only apply to people who join later, which is
                not what it says.
  invite_only   nobody has it until granted with ` + "`bk app access grant`" + `.
                Existing grants are KEPT when switching to this mode; revoke them
                explicitly if that is the intent.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validateMode(mode); err != nil {
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
			state, err := c.UpdateWorkspaceApp(ws, args[0], client.UpdateWorkspaceAppRequest{
				DefaultAccess: &mode,
			})
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s in %s: default access is now %s\n",
				state.App, ws, cmdutil.DerefOr(state.DefaultAccess, mode))
			return nil
		},
	}
	cmd.Flags().StringVar(&mode, "mode", "", "all_members | invite_only")
	_ = cmd.MarkFlagRequired("mode")
	return cmd
}

func newAppAccessCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "access",
		Short: "Who may use an app in this workspace",
	}
	cmd.AddCommand(
		newAppAccessListCmd(),
		newAppAccessGrantCmd(),
		newAppAccessRevokeCmd(),
	)
	return cmd
}

func newAppAccessListCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "list <app>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/apps/{app}/access"},
		Short:       "List every member and whether they may use the app",
		Long: `Every member of the workspace, flagged with whether they can open the app.

Members WITHOUT access are listed too, on purpose: "who is missing it" is the
question this command actually gets asked, and a list of only the people who
already have it cannot answer it.`,
		Args: cobra.ExactArgs(1),
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
			members, err := c.ListAppAccess(ws, args[0])
			if err != nil {
				return err
			}
			return output.Render(format, members, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "USER ID\tEMAIL\tNAME\tWORKSPACE ROLE\tACCESS")
				for _, m := range members {
					access := "no"
					if m.HasAccess {
						access = "yes"
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						m.UserID, m.Email, cmdutil.DerefOr(m.Name, "—"), m.MemberRole, access)
				}
				return tw.Flush()
			})
		},
	}
}

func newAppAccessGrantCmd() *cobra.Command {
	var userRef string
	cmd := &cobra.Command{
		Use:         "grant <app> --user <id|email|name|me>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/apps/{app}/access"},
		Short:       "Grant one member access to an app (owner only)",
		Args:        cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if userRef == "" {
				return fmt.Errorf("--user is required (id, email, name, or `me`)")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			userID, err := cmdutil.ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if err := c.GrantAppAccess(ws, args[0], userID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "granted user #%d access to %s in %s\n", userID, args[0], ws)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "user", "", "Member to grant (id, email, name, or `me`)")
	return cmd
}

func newAppAccessRevokeCmd() *cobra.Command {
	var userRef string
	var yes bool
	cmd := &cobra.Command{
		Use:         "revoke <app> --user <id|email|name|me>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/apps/{app}/access/{userId}"},
		Short:       "Revoke one member's access to an app (owner only)",
		Long: `Revoke one member's access. They stay a member of the workspace; they just
cannot open this app in it.

The workspace owner cannot be revoked — nobody else could grant it back. Transfer
ownership first if that is genuinely the intent.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if userRef == "" {
				return fmt.Errorf("--user is required (id, email, name, or `me`)")
			}
			c, cfg, err := cmdutil.NewClientAndConfig()
			if err != nil {
				return err
			}
			ws, err := cmdutil.RequireActiveWorkspace(cfg)
			if err != nil {
				return err
			}
			userID, err := cmdutil.ResolveUserRef(c, cfg, userRef)
			if err != nil {
				return err
			}
			if !cmdutil.Confirm(fmt.Sprintf(
				"Revoke user #%d's access to %q in %q?", userID, args[0], ws), yes) {
				return fmt.Errorf("aborted")
			}
			if err := c.RevokeAppAccess(ws, args[0], userID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "revoked user #%d's access to %s in %s\n", userID, args[0], ws)
			return nil
		},
	}
	cmd.Flags().StringVar(&userRef, "user", "", "Member to revoke (id, email, name, or `me`)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

func validateMode(mode string) error {
	switch mode {
	case "all_members", "invite_only":
		return nil
	default:
		return fmt.Errorf("--mode must be all_members or invite_only (got %q)", mode)
	}
}
