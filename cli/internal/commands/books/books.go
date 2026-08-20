// Package books holds the command tree for the b/books app — everything under
// `bk books …`.
//
// One Go package per app, and app packages do not import each other
// (docs/platform-architecture.md §7.1, enforced by commands/boundaries_test.go).
// Anything two apps need lives in internal/cmdutil or internal/appverbs; anything
// only this app needs lives here.
//
// ---------------------------------------------------------------------------
// THE GROUP PINS ITS APP
// ---------------------------------------------------------------------------
// `bk books …` always talks to `app_servers["books"]`. It is not affected by
// `bk app use`, by `--app-server`, or by whatever the previous command did — the
// pin is applied to the whole subtree in commands/root.go, so there is no
// spelling under this group that can reach the wrong deployment.
//
// ---------------------------------------------------------------------------
// WHY THE CLI IS HALF OF THIS APP RATHER THAN A REPORTING TOOL
// ---------------------------------------------------------------------------
// b/books is a tool that agents operate from outside; the web surface is
// read-mostly (docs/books-app-plan/). So the CLI is not a convenience layer over
// a UI-first app — for the whole of week one it carries every write, and the four
// screens read. `bk books entry create` is how books get kept.
//
// That also means the parity guard matters more here than usual: a route with no
// command is a capability the agent that actually does the bookkeeping cannot
// reach.
package books

import (
	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

// Slug is this app's name — the first segment of `bk books …`, the key in
// `bk meta`'s apps object, the Postgres schema, and the primary key in
// platform.apps. One spelling, used everywhere.
const Slug = "books"

// Short is the one-line description shown against this app in `bk --help`.
const Short = "Swiss statutory bookkeeping — books, entries, evidence"

const long = `The b/books app: statutory bookkeeping for any number of books.

A BOOK is one legal entity's set of accounts: a company, or a person's
self-employment activity. A user may have as many as they need, and nothing in
this app assumes a particular number.

THE STATUTORY CORE — phase 1, and here now:

  bk books entity     list, create      a book. Arrives with the PME chart in it
  bk books exercice   list, create      a fiscal year. Needed before anything posts
  bk books account    list              that book's chart of accounts
  bk books entry      list, show, declare, post   the grand livre, and the two writes
  bk books bilan                        balance sheet, art. 959a
  bk books cr                           compte de résultat, art. 959b
  bk books patrimoine                   net worth, for a sole proprietorship
  bk books overview                     every book, with the statement its form has

RECOGNITION — phase 2, here now. The first write path:

  bk books worklist                     what needs a human, with live suggestions
  bk books rule       list, create, deactivate   remembered judgments, keyed to the pair
  bk books resolve    <n>               say what the money was; history kept

SOURCES AND PIÈCES — phase 3, here now. Provenance and the proof:

  bk books source     list, show, import   the register, and the camt.053 door
  bk books source     create, edit, mapping-set, record-pull, runbook-set
                                        registering a feed and saying how it is read
  bk books manifest   <n>               every Drive file one source has seen
  bk books piece      list, ingest, match   the receipts inbox and the robot door

"source show" ends with a RECONCILIATION: the ledger against what the bank last
reported. It reports and never refuses — a drift is usually a payment posted
before it cleared — but an unknown says so rather than reading as agreement.

MANAGEMENT AND TAX — phase 4, here now:

  bk books analytique                   cost per category, and the monthly flows
  bk books category   list, create, retire   the analytique's buckets, account-mapped
  bk books tax                          the PM tax snapshot: derived, cited, never stored
  bk books tax-params show, set         where a company is taxed, and at what rates
  bk books analyse    list, show, record   the agent write-back: a filed verdict

COMPLIANCE — phase 5, here now:

  bk books compliance list, show, review   the statutory rules, draft until signed off
  bk books verdict    <n>               file a verdict onto a record

STARTING AND ENDING A BOOK:

  bk books account    create            an account this book keeps and the template does not
  bk books opening    list, set         the balance sheet a book starts from (first year only)
  bk books exercice   close             close a year and carry its bilan into the next
  bk books entity     edit              a book's own facts; slug, form and regime are permanent

THIS APP'S OWN TENANCY — the same verbs every app has, answering for THIS one:

  bk books workspace  list, show, use
  bk books member     list
  bk books invite     send, list, revoke

"bk books workspace use x" sets THIS app's active workspace and no other's.

The table below is generated from the commands this binary actually carries, so
where it and this prose ever disagree, the table is right. (This paragraph
replaced a "not here yet" list naming analyse and tax, which had both shipped —
found 2026-08-20 by an agent that read the help and believed it.)

CREATING A BOOK GIVES YOU TWO THINGS, and you need a third. "entity create"
installs the Swiss PME chart of accounts, because a book with no accounts can
hold no entry. It does NOT open a fiscal year — run "exercice create" next, or
every read will tell you the book has no exercice.

THE DOCTRINE, because it explains the shape: this app holds no intelligence. It
stores legible records and derives statements; the judgement lives in the agent
driving these commands from outside. Nothing here decides what a transaction
means — you tell it, and it remembers so the next one is automatic.

Vocabularies and limits are served live by "bk meta --app-server books". They
change without a release of this binary, so this help text does not list them.

THAT SPELLING IS DELIBERATE. "bk meta" answers from whichever app your config is
homed on, and one deployment cannot answer for another — a books recognition
state is not something another app knows. "--app-server books" asks THIS app for
one invocation and changes nothing about your config; when books is already your
home app, plain "bk meta" is the same call. There is no "bk books meta": meta is
the command that WRITES the app registry, and "bk books ..." resolves its server
THROUGH that registry, so an app-owned spelling could not run in the one state
it is most needed in — a config that has no address for books yet.

Bare verbs are identity and this binary only: login, logout, whoami, token,
profile, meta, app, guide, skill, changelog, version, super-admin. Run
"bk guide platform/apps" for the rule.`

// ---------------------------------------------------------------------------
// WHICH GROUP NODES CARRY A `Long:`, AND WHICH DELIBERATELY DO NOT
// ---------------------------------------------------------------------------
// Phase 8 (2026-08-20) gave every LEAF a `Long:` — an agent runs a leaf, and a
// `Short:` is a menu entry, not a description. Group nodes are a different
// question: nobody runs `bk books entry`, they route through it, and filling
// every one with prose adds surface that can drift while telling a reader
// nothing the child does not.
//
// So the test applied was: does this group carry a CROSS-CUTTING fact that no
// single child states, and that costs a real mistake to not know?
//
// SIX DO, and have one:
//
//	entry      two journals under one noun; everything lands staged; posted is
//	           immutable; the #number is not the journal no.
//	exercice   nothing posts without one, and close is the one irreversible act
//	opening    typed once per book, first year only; later years are produced
//	source     the register, the runbook and the door are three different things
//	piece      this app never holds the file, and match does not set the tier
//	rule       the match key is the PAIR, and rules never apply themselves
//
// SIX DELIBERATELY DO NOT — account, entity, category, analyse, compliance,
// tax-params. Each has at most three children whose own `Long:` covers it
// completely, and the parent's `Short:` already names the concept. A paragraph
// there would restate a child, and a restatement is the thing that goes stale.
//
// This is the record the decision is supposed to leave. If a seventh group
// grows a cross-cutting rule, it moves to the first list.

// NewGroup returns the `bk books` command group. Registered from
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

// nouns is this app's surface — what `bk books` offers today.
func nouns() []*cobra.Command {
	return []*cobra.Command{
		// The statutory core — see statutory.go.
		newEntityCmd(),
		newExerciceCmd(),
		newAccountCmd(),
		newOpeningCmd(),
		newEntryCmd(),
		newBilanCmd(),
		newCrCmd(),
		newOverviewCmd(),
		newPatrimoineCmd(),
		// Recognition — see recognition.go.
		newWorklistCmd(),
		newRuleCmd(),
		newResolveCmd(),
		// Sources and pièces — see source.go, piece.go, manifest.go.
		newSourceCmd(),
		newPieceCmd(),
		newManifestCmd(),
		// Management — see management.go.
		newAnalytiqueCmd(),
		newAnalyseCmd(),
		newCategoryCmd(),
		newTaxCmd(),
		newTaxParamsCmd(),
		// Compliance — see compliance.go.
		newComplianceCmd(),
		newVerdictCmd(),
	}
}

// appOwnedVerbs declares the app-owned platform verbs THIS app serves.
//
// `appverbs.Config` is a DECLARATION OF WHAT `app/api/**` HAS, never a wish
// list. Turn on `Uploads` and lib/cli-parity.test.ts immediately reports a claim
// on `POST /api/upload`, which this app has no file for — and never will:
// supporting documents are Google Drive references, so b/books records no
// uploads at all.
//
// `Trash` and `Label` are off, and for books that is permanent rather than
// pending. Accounting rows have a ten-year retention duty (art. 958f CO), so
// there is no purge path to expose; see docs/books-app-plan/phase-5-compliance.md.
//
// `Invites` is the owner's half only — send, list, revoke — because that is what
// this app serves. `InviteCandidates` and `InviteAccept` are off: there is no
// `/invite-candidates`, no `/api/invitations/accept` and no
// `/api/me/pending-invitations` here. Flipping a flag without its route claims
// something that can only 404.
//
// `WorkspaceCreate`, not `WorkspaceAdmin`: this app serves GET and POST on
// /api/workspaces and no other method. Create arrived for the person whose
// second venture needs its own set of books; edit and transfer wait for
// somebody to need them, and DELETE is permanently absent — a workspace holds
// statutory records (art. 958f CO), the same doctrine that keeps `Trash` off.
// `MemberLeave` is off because there is no /leave route.
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
// slug in the CLI's own config, so `bk books workspace use` does not disturb
// sales.
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
