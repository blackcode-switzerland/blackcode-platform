// Package billing holds the command tree for the b/billing app — everything
// under `bk billing …`.
//
// One Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1, enforced by commands/boundaries_test.go).
// Anything two apps need lives in internal/cmdutil or internal/appverbs;
// anything only this app needs lives here.
//
// ---------------------------------------------------------------------------
// THE GROUP PINS ITS APP
// ---------------------------------------------------------------------------
// `bk billing …` always talks to `app_servers["billing"]`. It is not affected by
// `bk app use`, by `--app-server`, or by whatever the previous command did — the
// pin is applied to the whole subtree in commands/root.go, so there is no
// spelling under this group that can reach the wrong deployment.
//
// That matters more here than in most apps. This one issues numbered legal
// documents against a named company's bank account, and a command that reached
// the wrong deployment would not fail — it would succeed somewhere else.
//
// ---------------------------------------------------------------------------
// PHASE 0 HAS NO NOUNS OF ITS OWN, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// This group carries the app-owned platform verbs and nothing else. Companies,
// invoices and the audit log arrive in phase 1
// (docs/billing-app-plan/phase-1-companies-and-invoices.md) together with their
// routes, in the same commit, because `lib/cli-parity.test.ts` fails the build
// otherwise.
//
// It is still a real group with a real claim: `bk billing workspace list`,
// `member list` and the three invite verbs are attributed to THIS app by
// `bk __routes`, which is what satisfies `appOwnClaims` in the parity guard.
// Verified with `bk __routes` on 2026-09-16 before the scaffold's placeholder
// entity was dropped rather than copied — b/books kept a `notes` table through
// its whole phase 0 believing it was needed for this, and then spent phase 1
// dropping it.
package billing

import (
	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/spf13/cobra"
)

// Slug is this app's name — the first segment of `bk billing …`, the key in
// `bk meta`'s apps object, the Postgres schema, and the primary key in
// platform.apps. One spelling, used everywhere.
const Slug = "billing"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Swiss QR-bill invoicing — companies, invoices, payment parts"

const long = `The b/billing app: Swiss invoicing with QR-bill payment parts.

An INVOICE here is a numbered legal document. Its number is contiguous with no
holes, it is never reused, and it is never deleted — a mistake is voided and
reissued, and the void keeps its number forever. Every change to any of it is
attributable to a person or a token.

THIS APP'S OWN TENANCY — the same verbs every app has, answering for THIS one:

  bk billing workspace  list, show, use, create
  bk billing member     list
  bk billing invite     send, list, revoke

"bk billing workspace use x" sets THIS app's active workspace and no other's:
two apps' workspace tables have overlapping ids, so one shared setting would
mean selecting here silently retargeted another app.

A WORKSPACE is a tenant. The company that issues a bill is a row inside it, so
a second issuing entity is not a second workspace — that is
"bk billing company create". "workspace create" exists for a genuinely separate
tenant, and there is deliberately no "workspace delete": a workspace holds
invoices, and those carry a ten-year retention duty (art. 958f CO). That is the
same doctrine that keeps "trash" and "label" off this group entirely — an
invoice is voided, never binned, so there is no purge path to expose.

NOT HERE YET. Companies, invoices, line items, the audit log and the lifecycle
(send, mark-sent, paid, void) exist. The payment reference check digit, the
QR-bill payload and the PDF do not, so "invoice send" refuses before doing
anything and "invoice mark-sent" records a bill delivered another way. See
docs/billing-app-plan/. This paragraph is the one thing in this
help text that is expected to go out of date, and the table below is generated
from the commands this binary actually carries — so where it and this prose
disagree, the table is right.

Vocabularies and limits are served live by "bk meta --app-server billing". They
change without a release of this binary, so this help text does not list them.

THAT SPELLING IS DELIBERATE. "bk meta" answers from whichever app your config is
homed on, and one deployment cannot answer for another. "--app-server billing"
asks THIS app for one invocation and changes nothing about your config; when
billing is already your home app, plain "bk meta" is the same call. There is no
"bk billing meta": meta is the command that WRITES the app registry, and
"bk billing ..." resolves its server THROUGH that registry, so an app-owned
spelling could not run in the one state it is most needed in — a config that has
no address for billing yet.

Bare verbs are identity and this binary only: login, logout, whoami, token,
profile, meta, app, guide, skill, changelog, version, super-admin. Run
"bk guide platform/apps" for the rule.`

// NewGroup returns the `bk billing` command group. Registered from
// commands/root.go, exactly as an app's group should be.
func NewGroup() *cobra.Command {
	cmd := &cobra.Command{
		Use:   Slug,
		Short: Short,
		Long:  long,
	}
	cmd.AddCommand(nouns()...)
	cmd.AddCommand(appOwnedVerbs()...)
	return cmd
}

// nouns is this app's own surface — what `bk billing` offers beyond the
// platform verbs every app has.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		newCompanyCmd(),
		newInvoiceCmd(),
		newAuditCmd(),
		newOverviewCmd(),
	}
}

// appOwnedVerbs declares the app-owned platform verbs THIS app serves.
//
// `appverbs.Config` is a DECLARATION OF WHAT `app/api/**` HAS, never a wish
// list. Turn one on and lib/cli-parity.test.ts immediately reports a claim on a
// route this app has no file for.
//
// `Uploads` is off, and permanently: this app serves no `/api/upload` and stores
// no files. A company logo is initials plus a colour, and the invoice PDF is
// regenerated on demand byte-stably rather than archived (position P10), so
// there is nothing to upload. `AppContext.uploads` throws rather than recording
// anything.
//
// `Trash` and `Labels` are off, and permanently. An invoice is voided, never
// binned — the void is a record with a reason and the number stays consumed —
// so there is no soft-delete state to list and no purge path to expose. Art.
// 958f CO's ten-year retention applies to invoices as much as to ledgers.
//
// `Invites` is the owner's half only — send, list, revoke — because that is what
// this app serves. `InviteCandidates` and `InviteAccept` are off: there is no
// `/invite-candidates`, no `/api/invitations/accept` and no
// `/api/me/pending-invitations` here. Flipping a flag without its route claims
// something that can only 404, and the honest consequence is stated on the
// dashboard rather than hidden: an invitation can be sent and nobody can redeem
// it yet.
//
// `WorkspaceCreate`, not `WorkspaceAdmin`: this app serves GET and POST on
// /api/workspaces and no other method. Create is what closes the empty-workspace
// dead end for somebody arriving on a cookie from another blackcode app — see
// `createWorkspaceForUser` in the app, where phase 0's decision is written down.
// Edit and transfer wait for somebody to need them; DELETE is permanently
// absent. `MemberLeave` is off because there is no /leave route, and
// `MemberRemove` because removing the last member of a workspace holding
// invoices is not a thing this app knows how to do safely yet.
func appOwnedVerbs() []*cobra.Command {
	return appverbs.New(appverbs.Config{
		App:             Slug,
		Workspace:       true,
		WorkspaceCreate: true,
		Members:         true,
		Invites:         true,
	}).All()
}

// clientAndWorkspace resolves the credential and THIS app's active workspace.
//
// One helper for every command in this package, because the failure it prevents
// is the same everywhere: a command that silently acted on whichever workspace
// happened to be remembered by another app. The active workspace is keyed by app
// slug in the CLI's own config, so `bk billing workspace use` does not disturb
// sales — two apps' workspace tables have overlapping ids, and one shared
// setting meant selecting here retargeted the others.
//
// In THIS app the consequence is sharper than elsewhere: acting on the wrong
// workspace means issuing a numbered legal document from the wrong tenant, which
// cannot be deleted afterwards.
func clientAndWorkspace() (*client.Client, string, error) {
	c, cfg, err := cmdutil.NewClientAndConfig()
	if err != nil {
		return nil, "", err
	}
	ws, err := cmdutil.RequireActiveWorkspace(cfg)
	if err != nil {
		return nil, "", err
	}
	return c, ws, nil
}
