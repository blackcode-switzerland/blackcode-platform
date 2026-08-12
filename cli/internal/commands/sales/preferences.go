package sales

import (
	"fmt"
	"io"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
)

// `bk sales preferences` — what the WEB app shows you. Nothing here changes what
// anybody may do.
//
// ---------------------------------------------------------------------------
// WHY A COMMAND EXISTS FOR A BROWSER SETTING
// ---------------------------------------------------------------------------
// Two reasons, and the first is a rule rather than a convenience. Every route in
// this app has to be reachable from `bk` or `lib/cli-parity.test.ts` goes red: a
// route with no command is a capability agents cannot reach, and the check does
// not make an exception for one that happens to be about the UI.
//
// The second is real use. A person asking an agent to "turn editing on in the
// web app" is asking for exactly this, and it is a poor answer to say the only
// way is to click something. `bk sales preferences set --ui-mode …` does it.
//
// ---------------------------------------------------------------------------
// `ui_mode` IS NOT A PERMISSION (D-7)
// ---------------------------------------------------------------------------
// `read_only` means the web app renders no editing. The SERVER never reads it:
// authorisation is per-app access and the workspace role, and `bk` writes the
// same in either mode. Setting it grants nothing and removes nothing.
//
// It is worth saying here, at length, because the name invites the other
// reading — and a preference mistaken for a control is the one failure mode D-7
// is written to prevent. The values themselves are NOT listed: they are a
// vocabulary, they are served live by `bk meta`, and a topic or a help string
// that restated them would be one more copy to go stale.
func newPreferencesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "preferences",
		Short: "Your own display settings for the b/sales web app",
		Long: `What the b/sales WEB APP shows you. Not a permission.

"ui_mode" decides whether the browser renders editing controls. The server does
not consult it: what you may do is decided by your access to this app and your
role in the workspace, and this command writes to neither. Turning it off does
not stop anyone — including you — from writing through bk.

Run "bk meta" for the values it accepts.`,
	}
	cmd.AddCommand(newPreferencesShowCmd(), newPreferencesSetCmd())
	return cmd
}

func newPreferencesShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "show",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/preferences"},
		Short:       "Show your display settings",
		Long: `Your own settings in this workspace.

A person who has never opened Settings has no stored row, and this prints the
defaults rather than an error — "you have no preferences" is not a state anybody
is in.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.SalesPreferences(ws)
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintf(tw, "ui mode\t%s\n", p.UIMode)
				fmt.Fprintf(tw, "\t(a browser display setting — not a permission)\n")
				if p.UpdatedAt != "" {
					fmt.Fprintf(tw, "updated\t%s\n", p.UpdatedAt)
				}
				return tw.Flush()
			})
		},
	}
}

func newPreferencesSetCmd() *cobra.Command {
	var uiMode string
	cmd := &cobra.Command{
		Use:         "set",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/preferences"},
		Short:       "Change your display settings",
		Long: `Change your own settings. Only the flags you pass are changed.

This changes what the WEB APP renders for you and nothing else. It grants no
access and revokes none, and it has no effect on bk.

Run "bk meta" for the values --ui-mode accepts.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			// Refused here rather than sent, because the route's "nothing to
			// change" 400 is a round trip to be told what the flags already say.
			if !cmd.Flags().Changed("ui-mode") {
				return fmt.Errorf("nothing to change: pass --ui-mode (run `bk meta` for its values)")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			p, err := c.SalesSetPreferences(ws, map[string]any{"ui_mode": uiMode})
			if err != nil {
				return err
			}
			return output.Render(format, p, func(w io.Writer) error {
				fmt.Fprintf(w, "ui mode is now %s (web display only)\n", p.UIMode)
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&uiMode, "ui-mode", "", "What the web app renders — "+vocab("ui_modes"))
	return cmd
}
