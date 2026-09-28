package platform

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

func newProfileCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "profile",
		Short: "View and edit your user profile",
	}
	cmd.AddCommand(
		newProfileViewCmd(),
		newProfileEditCmd(),
		newProfileAvatarCmd(),
	)
	return cmd
}

func newProfileViewCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "view",
		Annotations: map[string]string{"routes": "GET /api/me"},
		Short:       "Show your profile",
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			me, err := c.GetMe()
			if err != nil {
				return err
			}
			return output.Render(format, me, func(w io.Writer) error {
				fmt.Fprintf(w, "ID:      %d\n", me.ID)
				fmt.Fprintf(w, "Email:   %s\n", me.Email)
				fmt.Fprintf(w, "Name:    %s\n", cmdutil.DerefOr(me.Name, "—"))
				fmt.Fprintf(w, "Tagline: %s\n", cmdutil.DerefOr(me.Tagline, "—"))
				if me.AvatarURL != nil {
					fmt.Fprintf(w, "Avatar:  %s\n", *me.AvatarURL)
				}
				return nil
			})
		},
	}
}

func newProfileEditCmd() *cobra.Command {
	var name, tagline, avatarURL string
	cmd := &cobra.Command{
		Use:         "edit",
		Annotations: map[string]string{"routes": "PATCH /api/me"},
		Short:       "Update your profile (name, tagline, avatar URL)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !cmd.Flags().Changed("name") &&
				!cmd.Flags().Changed("tagline") &&
				!cmd.Flags().Changed("avatar-url") {
				return fmt.Errorf("provide at least one flag: --name, --tagline, --avatar-url")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			req := client.UpdateProfileRequest{}
			if cmd.Flags().Changed("name") {
				req.Name = &name
			}
			if cmd.Flags().Changed("tagline") {
				req.Tagline = &tagline
			}
			if cmd.Flags().Changed("avatar-url") {
				req.AvatarURL = &avatarURL
			}
			me, err := c.UpdateProfile(req)
			if err != nil {
				return err
			}
			return output.Render(format, me, func(w io.Writer) error {
				fmt.Fprintf(w, "profile updated\n")
				fmt.Fprintf(w, "Name:    %s\n", cmdutil.DerefOr(me.Name, "—"))
				fmt.Fprintf(w, "Tagline: %s\n", cmdutil.DerefOr(me.Tagline, "—"))
				return nil
			})
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "Display name (pass empty string to clear)")
	cmd.Flags().StringVar(&tagline, "tagline", "", "Short tagline, max 140 chars (pass empty string to clear)")
	cmd.Flags().StringVar(&avatarURL, "avatar-url", "", "Avatar image URL")
	return cmd
}

func newProfileAvatarCmd() *cobra.Command {
	var remove bool
	cmd := &cobra.Command{
		Use:         "avatar [<image-file>]",
		Annotations: map[string]string{"routes": "POST /api/me/avatar,DELETE /api/me/avatar"},
		Short:       "Upload or remove your profile photo",
		Long: `Upload an image as your profile photo, or remove it with --remove.

The photo is on your blackcode account, so every app shows it. Which image types
are accepted and how large they may be is the server's to decide. An account
connected to Google gets its photo from Google and cannot set one here.

  bk profile avatar ./me.png
  bk profile avatar --remove`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if remove == (len(args) == 1) {
				return fmt.Errorf("give an image file, or --remove (not both)")
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}
			if remove {
				if _, err := c.RemoveAvatar(); err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), "removed your profile photo")
				return nil
			}
			me, err := c.SetAvatar(args[0])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "set your profile photo: %s\n", cmdutil.DerefOr(me.AvatarURL, ""))
			return nil
		},
	}
	cmd.Flags().BoolVar(&remove, "remove", false, "Remove your photo instead of setting one")
	return cmd
}
