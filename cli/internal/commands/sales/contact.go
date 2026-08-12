package sales

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

// `bk sales contact` — the decision makers at a prospect.
//
// ---------------------------------------------------------------------------
// A CONTACT IS ADDRESSED BY ITS ID, AND A PROSPECT NEVER IS
// ---------------------------------------------------------------------------
// Every command here takes a PROSPECT #NUMBER first and a CONTACT ID second, and
// the asymmetry is deliberate rather than sloppy. A prospect is projected into
// the cross-app index and has a URN, so its address is the #number and its row
// id is never served. A contact has neither: it is always reached through its
// prospect, so its id is the only address there is — exactly as a comment is
// reached in the issue tracker.
//
// The ID column in `contact list` is what you paste into `edit` and `rm`.
func newContactCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "contact",
		Short: "Decision makers at a prospect",
	}
	cmd.AddCommand(
		newContactListCmd(),
		newContactAddCmd(),
		newContactEditCmd(),
		newContactRemoveCmd(),
	)
	return cmd
}

func newContactListCmd() *cobra.Command {
	var prospect int
	cmd := &cobra.Command{
		Use:         "list <prospect>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}/contacts"},
		Short:       "List a prospect's contacts",
		Args:        cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			rows, err := c.ListContacts(ws, n)
			if err != nil {
				return err
			}
			return output.Render(format, rows, func(w io.Writer) error {
				tw := output.Tabwriter(w)
				fmt.Fprintln(tw, "ID\tNAME\tROLE\tEMAIL\tPHONE")
				for _, r := range rows {
					name := r.Name
					if r.IsPrimary {
						name = "★ " + name
					}
					fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\n",
						r.ID, cmdutil.Truncate(name, 26), cmdutil.Truncate(r.Role, 26),
						dashIf(r.Email), dashIf(r.Phone))
				}
				if err := tw.Flush(); err != nil {
					return err
				}
				if len(rows) == 0 {
					fmt.Fprintln(cmd.ErrOrStderr(), "(no contacts)")
				}
				return nil
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	return cmd
}

func newContactAddCmd() *cobra.Command {
	var req client.ContactRequest
	var primary bool
	var prospect int
	cmd := &cobra.Command{
		Use: "add <prospect> --name <person>",
		Annotations: map[string]string{"routes": "GET /api/workspaces/{ws}/prospects/{n}," +
			"POST /api/workspaces/{ws}/prospects/{n}/contacts"},
		Short: "Add a contact to a prospect",
		Long: `Add a decision maker.

--primary marks this one as THE contact and demotes any other. At most one
prospect contact is primary at a time, and naming a new one is taken to mean the
old one is not — a 409 you would have to resolve in two calls is a worse product
than doing the obvious thing.

The prospect may be given as the first argument or as --prospect <n>; both work
everywhere in this app, and naming two different ones is an error.`,
		Args: cobra.RangeArgs(0, 1),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, _, err := resolveProspect(cmd, args, prospect, 0)
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("primary") {
				req.IsPrimary = &primary
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.AddContact(ws, n, req)
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				// The company, not just the id: ten prospects in, the #number on
				// its own no longer tells anybody which deal this landed on.
				_, err := fmt.Fprintf(w, "added contact %d to prospect %s: %s\n",
					row.ID, prospectLabel(c, ws, n), row.Name)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&req.Name, "name", "", "The person's name (required)")
	cmd.Flags().StringVar(&req.Role, "role", "", "Their role (\"Co-founder · product\")")
	cmd.Flags().StringVar(&req.Email, "email", "", "Email")
	cmd.Flags().StringVar(&req.Phone, "phone", "", "Phone")
	cmd.Flags().BoolVar(&primary, "primary", false, "Make this the primary contact")
	cmd.Flags().StringVar(&req.Notes, "notes", "", "Notes about this person")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newContactEditCmd() *cobra.Command {
	var req client.ContactRequest
	var primary bool
	var prospect int
	cmd := &cobra.Command{
		Use:         "edit <prospect> <contact-id>",
		Annotations: map[string]string{"routes": "PATCH /api/workspaces/{ws}/prospects/{n}/contacts/{cid}"},
		Short:       "Edit a contact",
		Args:        cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, cid, err := prospectAndChild(cmd, args, prospect, "contact")
			if err != nil {
				return err
			}
			if cmd.Flags().Changed("primary") {
				req.IsPrimary = &primary
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			row, err := c.UpdateContact(ws, n, cid, req)
			if err != nil {
				return err
			}
			return output.Render(format, row, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "updated contact %d: %s\n", row.ID, row.Name)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&req.Name, "name", "", "The person's name")
	cmd.Flags().StringVar(&req.Role, "role", "", "Their role")
	cmd.Flags().StringVar(&req.Email, "email", "", "Email")
	cmd.Flags().StringVar(&req.Phone, "phone", "", "Phone")
	cmd.Flags().BoolVar(&primary, "primary", false, "Make this the primary contact")
	cmd.Flags().StringVar(&req.Notes, "notes", "", "Notes about this person")
	return cmd
}

func newContactRemoveCmd() *cobra.Command {
	var confirm string
	var yes bool
	var prospect int
	cmd := &cobra.Command{
		Use:         "rm <prospect> <contact-id> --confirm <name>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/contacts/{cid}"},
		Short:       "Remove a contact from a prospect",
		Long: `Bin a contact.

--confirm must be the PERSON'S NAME at that id, not the id again. Repeating an
id back proves nothing about whether it is the right one.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			n, cid, err := prospectAndChild(cmd, args, prospect, "contact")
			if err != nil {
				return err
			}
			confirm = strings.TrimSpace(confirm)
			if confirm == "" {
				return fmt.Errorf("--confirm is required and must be the name of contact %d "+
					"— run `bk sales contact list %d` to see it", cid, n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			// Read before the delete, so what is removed can be reported and so
			// the name can be checked against the row that would actually go.
			rows, err := c.ListContacts(ws, n)
			if err != nil {
				return err
			}
			var target *client.SalesContact
			for i := range rows {
				if rows[i].ID == cid {
					target = &rows[i]
					break
				}
			}
			if target == nil {
				return fmt.Errorf("no contact %d on prospect #%d — run `bk sales contact list %d`", cid, n, n)
			}
			if confirm != target.Name {
				return fmt.Errorf("--confirm is required to match contact %d, which is %q — got %q; nothing was deleted",
					cid, target.Name, confirm)
			}
			if !cmdutil.Confirm(fmt.Sprintf("Remove %s from prospect #%d?", target.Name, n), yes) {
				return fmt.Errorf("aborted")
			}
			done, err := c.RemoveContact(ws, n, cid)
			if err != nil {
				return err
			}
			return output.Render(format, done, func(w io.Writer) error {
				_, err := fmt.Fprintf(w, "removed contact %d: %s\n", cid, done.Name)
				return err
			})
		},
	}
	addProspectFlag(cmd, &prospect)
	cmd.Flags().StringVar(&confirm, "confirm", "", "Repeat the contact's NAME to authorise the removal (required)")
	cmdutil.AddYesFlag(cmd, &yes)
	return cmd
}

// prospectAndChild parses `<prospect> <child-id>` — a #number then a row id.
// One helper, so the asymmetry described at the top of this file is applied the
// same way by every command that has it.
//
// The prospect half goes through resolveProspect, so `--prospect 8 3` is the
// same call as `8 3`. The CHILD id stays positional in both shapes: it is not a
// second convention, it is the argument the command is about.
func prospectAndChild(cmd *cobra.Command, args []string, prospectFlag int, noun string) (int, int, error) {
	n, tail, err := resolveProspect(cmd, args, prospectFlag, 1)
	if err != nil {
		return 0, 0, err
	}
	id, err := strconv.Atoi(strings.TrimSpace(tail[0]))
	if err != nil || id <= 0 {
		return 0, 0, fmt.Errorf("invalid %s id %q — it is the ID column of `bk sales %s list %d`",
			noun, tail[0], noun, n)
	}
	return n, id, nil
}

func dashIf(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}
