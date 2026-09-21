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
// THE TENANCY VERBS ARE THE SHARED ONES; THE NOUNS ARE THIS PACKAGE'S
// ---------------------------------------------------------------------------
// Companies, invoices, the audit log, the overview, recurring series and the
// imported archive are built here (company.go, invoice.go, …). The workspace,
// member and invite verbs come from `internal/appverbs`, declared verb by verb
// in `appOwnedVerbs` below — since phase 2 (2026-09-21) the whole set
// `apps/sales` serves, with delete narrowed by the server to a workspace that
// holds no retained record.
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

WHAT THIS GROUP HAS: companies (the issuing entities and their numbering),
invoices with their line items, the PDF with its QR-bill payment part, the
lifecycle (send, mark-sent, paid, void), the audit log, the overview, finite
recurring series and the imported archive of bills issued elsewhere. Start with
"bk guide billing"; every command's --help says what it does and how it fails.

THIS APP'S OWN TENANCY — the same verbs every app has, answering for THIS one:

  bk billing workspace  list, show, use, create, edit, transfer, delete
  bk billing member     list, remove
  bk billing invite     send, list, revoke, candidates, show, accept, decline, pending

"bk billing workspace use x" sets THIS app's active workspace and no other's:
two apps' workspace tables have overlapping ids, so one shared setting would
mean selecting here silently retargeted another app.

A WORKSPACE is a tenant. The company that issues a bill is a row inside it, so
a second issuing entity is not a second workspace — that is
"bk billing company create". "workspace edit" renames (the slug is fixed: it is
in every URN this app has printed). "workspace delete" works ONLY for a
workspace nothing was ever issued from — no company, invoice, series, imported
bill or audit row. Anything else is refused with 409 workspace_retained:
invoices carry a ten-year retention duty (art. 958f CO) and the database
refuses the delete for everybody. That is the same doctrine that keeps "trash"
and "label" off this group — an invoice is voided, never binned. To stop using
such a workspace, retire its companies or transfer it.

"member remove <your own id>" is how you LEAVE a workspace; the owner cannot be
removed until ownership is transferred.

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
		newRecurrenceCmd(),
		newHistoryCmd(),
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
// THE TENANCY SUBSET — all of `apps/sales`' since phase 2 (2026-09-21):
//
//	Workspace        yes — list, show, use
//	WorkspaceAdmin   yes — create, edit, transfer, delete. Until phase 2 this
//	                 was `WorkspaceCreate` alone, with "DELETE is permanently
//	                 absent" — because a workspace holds invoices. The server
//	                 now serves DELETE and REFUSES it (409 workspace_retained)
//	                 for any workspace holding a company, invoice, series,
//	                 imported bill or audit row; only an empty tenant can go.
//	                 The shared `edit --slug` flag compiles and sends, and the
//	                 server answers 400 slug_immutable — the same deliberate
//	                 asymmetry `commands/sales/appverbs.go` documents.
//	Members          yes — list
//	MemberRemove     yes — DELETE …/members/{userId}. The owner removes anyone
//	                 but themselves; a member may remove THEMSELVES, which is
//	                 how you leave here
//	MemberLeave      NO  — there is no POST …/leave route; see MemberRemove
//	Invites          yes — send, list, revoke
//	InviteCandidates yes — GET …/invite-candidates (owner only)
//	InviteAccept     yes — show, accept, decline, pending: /api/invitations/*
//	                 and /api/me/pending-invitations, plus the
//	                 /invitations/{token} page the email links to
func appOwnedVerbs() []*cobra.Command {
	return appverbs.New(appverbs.Config{
		App:              Slug,
		Workspace:        true,
		WorkspaceAdmin:   true,
		Members:          true,
		MemberRemove:     true,
		Invites:          true,
		InviteCandidates: true,
		InviteAccept:     true,
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
