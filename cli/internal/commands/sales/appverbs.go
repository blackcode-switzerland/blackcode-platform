package sales

import (
	"fmt"
	"strconv"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/spf13/cobra"
)

// The app-owned platform verbs (D-11): `bk sales upload | trash | label`.
//
// ---------------------------------------------------------------------------
// WHY THEY SIT BEHIND THE APP NAME
// ---------------------------------------------------------------------------
// A file, a recycle bin and a label each belong to ONE app. The server records
// `platform.uploads.app` from the deployment that received the file; the bin
// lists this app's entities; a label is filtered by app. With two deployments a
// bare `bk upload` has no correct answer — it has a DEFAULT, and a default is
// how a sales contract gets filed under issues.
//
// `bk storage` is NOT here and must not be added: D-28 kept it bare, in the
// cross-app tier, because uploads are one ledger against one workspace quota, so
// every app returns the same rows. **You upload INTO one app; you list ACROSS
// all of them.**
//
// ---------------------------------------------------------------------------
// TRASH TYPES ARE THIS APP'S VOCABULARY, AND THE LIST IS SHORT ON PURPOSE
// ---------------------------------------------------------------------------
// Six, not seven: a CONTACT is missing because it has no #number, so `contact:12`
// is not an address a caller could type. Contacts are binned and restored WITH
// their prospect and are never addressed alone. The server's list is in
// `apps/sales/lib/db/queries/trash.ts`, and `lib/trash-types.test.ts` holds the
// two together — a `--type` this binary accepts and the server does not would
// fail on a round trip, and one the server accepts and this does not is a
// capability nobody can reach.
var trashTypes = []string{"prospect", "meeting", "communication", "product", "template", "document"}

// THE SUBSET THIS APP SERVES, AND WHY EACH ABSENCE IS PERMANENT (D-36).
//
// A yes/no "hosts the platform surface" flag could not say this, which is why it
// was retired. Every value below is the honest reading of `apps/sales/app/api`:
//
//	Workspace       yes — GET /api/workspaces and GET /api/workspaces/{ws} are
//	                mounted, and `workspace use` is how a caller picks the
//	                tenancy the rest of `bk sales …` runs in
//	WorkspaceAdmin  NO  — D-3: a workspace is the COMPANY. Sales has no
//	                create-workspace flow, does not rename one, and must not be
//	                a second implementation of the delete cascade
//	Members         yes — /members and /members/{userId}
//	MemberLeave     NO  — this app mounts no /leave route
//	Invites         yes — the whole invitation surface is this app's own since
//	                Phase 2, including invite-candidates, which agent 3 rewrote
//	                because the shared factory suggested ISSUES colleagues
//	Users           NO  — and this is the one worth reading twice. The shared
//	                `GET /api/users` answers "people you share a workspace
//	                with" out of `platform.workspace_members`, so on this
//	                deployment it listed issues colleagues, and returned NOTHING
//	                for a sales-only account. The route was removed rather than
//	                re-pointed: `bk sales member list` already answers the
//	                question this app actually has
//	Search          NO  — not missing, TAKEN. `bk sales search` is this app's
//	                own full-text search over /sales-search (see search.go).
//	                The shared one reads /api/workspaces/{ws}/search, which
//	                agent 4 unmounted after measuring it serving issues' titles
//	                to a sales-only member
//	Activity        yes — /activity, reading `sales.events` since Phase 3
//	Inbox           NO  — decision 3: sales touches `inbox_messages` in zero
//	                files and mounts no route
//	Storage         NO  — this app mounts no /storage route. It uploads (the
//	                bytes go to the one shared Blob store) and records them in
//	                `sales.uploads`; the listing view is issues' alone today
func appOwnedVerbs() []*cobra.Command {
	set := appverbs.New(appverbs.Config{
		App:          Slug,
		TrashTypes:   trashTypes,
		Uploads:      true,
		Trash:        true,
		Labels:       true,
		Workspace:    true,
		Members:      true,
		MemberRemove: true,
		Invites:      true,
		Activity:     true,
	})
	// `attach` and `detach` name an ENTITY, so they are built here rather than in
	// the shared package: they post to a SALES route, and `bk __routes` tags them
	// with this app so the claim is checked against the tree that serves it.
	set.Label.AddCommand(newLabelAttachCmd(), newLabelDetachCmd())
	return set.All()
}

func newLabelAttachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "attach <prospect> <label_id>",
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/prospects/{n}/labels,GET /api/workspaces/{ws}/prospects/{n}/labels"},
		Short:       "Attach a label to a prospect",
		Long: `Attach a label to a prospect.

The first argument is the prospect's #NUMBER; the second is the LABEL ID from
"bk sales label list". Attaching one that is already there is not an error —
you asked for a state and that is the state.

A label belonging to another app cannot be attached: labels are app-scoped, and
that scope is what stops the issue tracker's labels filling this app's picker.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil || labelID <= 0 {
				return fmt.Errorf("invalid label_id %q — run `bk sales label list` for the ids", args[1])
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			if err := c.AttachProspectLabel(ws, n, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "attached label %d to prospect #%d\n", labelID, n)
			return nil
		},
	}
}

func newLabelDetachCmd() *cobra.Command {
	return &cobra.Command{
		Use:         "detach <prospect> <label_id>",
		Annotations: map[string]string{"routes": "DELETE /api/workspaces/{ws}/prospects/{n}/labels/{lid}"},
		Short:       "Detach a label from a prospect",
		Args:        cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			n, err := prospectNumber(args[0])
			if err != nil {
				return err
			}
			labelID, err := strconv.Atoi(args[1])
			if err != nil || labelID <= 0 {
				return fmt.Errorf("invalid label_id %q — run `bk sales prospect show %d` to see its labels", args[1], n)
			}
			c, ws, err := clientAndWorkspace()
			if err != nil {
				return err
			}
			if err := c.DetachProspectLabel(ws, n, labelID); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "detached label %d from prospect #%d\n", labelID, n)
			return nil
		},
	}
}
