// Package appverbs holds the platform verbs whose ANSWER DEPENDS ON THE APP,
// and builds one copy of them per app group — so they are spelled
// `bk issues workspace list`, `bk sales trash list`, `bk issues upload`.
//
// ---------------------------------------------------------------------------
// TWO TIERS, NOT THREE (multiAppFinalRefactor Phase 4)
// ---------------------------------------------------------------------------
// D-11 gave every verb one of three tiers:
//
//	NEUTRAL    same answer from any deployment            bare
//	CROSS-APP  spans every app by design, results tagged  bare
//	APP-OWNED  the answer depends on the app              bk <app> <verb>
//
// The middle tier existed BECAUSE THE APPS SHARED A DATABASE. `bk search` read
// `platform.entities`, which every app projected into; `bk activity` read
// `platform.events`; `bk storage` listed one ledger against one quota. Every one
// of those sentences stopped being true in Phases 2 and 3: sales has its own
// workspaces, members, invitations, labels, events and upload ledger, and it
// stopped projecting into the shared index altogether.
//
// So the cross-app tier is GONE, and with it `bk link` (PLAN.md §3). What is
// left is two tiers, and the split is now a single question with a single
// answer:
//
//	Is this about the ACCOUNT or about the BINARY?   → bare
//	Is it about an app's DATA?                       → bk <app> <verb>
//
// Bare, after Phase 4: login · logout · whoami · token · profile · meta · app ·
// guide · skill · changelog · version · super-admin.
//
// Everything else is here. **The prize is not tidiness.** Before this,
// `bk trash purge` destroyed things in whichever app the config was last homed
// on and nothing in the command said which — an agent could not read back its
// own command and know what it hit. Now every command that touches an app's
// data names the app, and there is no hidden state left to decide it.
//
// `bk storage` is here too, and its D-28 argument is what CHANGED rather than
// what was misapplied. It stayed bare because "uploads are one ledger against
// one workspace quota, so every app returns the same rows". Since Phase 3 the
// LEDGER is per app (`AppContext.uploads`; sales writes `sales.uploads`) — only
// the Blob store and the quota are still shared. Two deployments now answer
// differently, which is the test D-28 itself specifies, so the pairing it
// taught — "you upload INTO one app, you list ACROSS all of them" — no longer
// describes anything that exists. Both halves are per app.
//
// ---------------------------------------------------------------------------
// AN APP MOUNTS A SUBSET, AND SAYS SO (D-36)
// ---------------------------------------------------------------------------
// `hostsPlatformRoutes` was retired because a yes/no flag cannot express a
// subset, and a permanent subset is legitimate. The same is true one level down:
// `apps/sales` serves `GET /api/workspaces` and will never serve `POST` (D-3 —
// a workspace is the company; you are granted one, you do not open one from a
// sales context), serves members without `/leave`, and serves no inbox, no
// storage, no user directory at all.
//
// So Config declares what this app serves, verb by verb, and New() builds only
// those. A command that could only ever 404 is not a command; it is a dead end
// with a help page. The declaration is checked against reality by each app's
// `lib/cli-parity.test.ts` — claim a route the app has no file for and that
// suite goes red.
//
// ---------------------------------------------------------------------------
// WHY THE IMPLEMENTATION LIVES HERE AND NOT IN A COMMAND PACKAGE
// ---------------------------------------------------------------------------
// `internal/commands/<app>` packages must not import each other, and must not
// import `internal/commands/platform` (commands/boundaries_test.go). So a verb
// two app groups both mount cannot live in either of them, and it cannot live in
// `platform` — an app package could not reach it.
//
// It sits outside `internal/commands/` for the same reason `cmdutil` does: that
// is the sanctioned place for what several command packages share. What is here
// is only the app-agnostic half. Anything that names one app's entities —
// `bk issues label attach <issue>` — is built in that app's own package and
// added to the group returned by New(). That split is deliberate: it is what
// lets the parity guard check each claim against the app that actually serves
// the route.
//
// ADDING AN APP: one line in the app's group constructor —
//
//	cmd.AddCommand(appverbs.New(appverbs.Config{App: Slug, …}).All()...)
//
// and nothing else.
package appverbs

import (
	"strings"

	"github.com/spf13/cobra"
)

// Config is what the shared verbs need to know about the app mounting them.
//
// The booleans are NOT feature flags and must not be used as one. Each says
// "this app serves these routes", and the honest value is the one its
// `app/api/**` tree already has — nothing here turns a capability on. Getting
// one wrong in either direction is caught: claim what the app does not serve and
// its parity test reports drift; omit what it does serve and the same test
// reports an uncovered capability.
type Config struct {
	// App is the app slug — the first segment of `bk <app> …`, the key in
	// `bk meta`'s apps object, and the key that picks which server the command
	// talks to. Never a default: the group PINS it.
	App string

	// TrashTypes are this app's binnable entity types, in the spelling a
	// `<type>:<#number>` ref uses. They are validated locally so a typo costs
	// nothing instead of a round-trip.
	//
	// This is one app's vocabulary, so it is passed in rather than listed here —
	// the platform has no business inventing another app's nouns. Empty means no
	// local validation and the server decides, which is a legitimate choice for
	// an app whose vocabulary changes often; it is not a legitimate accident, so
	// state it explicitly at the call site.
	TrashTypes []string

	// Workspace mounts `bk <app> workspace` — list, show, use. Every app that
	// has workspaces of its own needs these three: `use` is how a caller picks
	// the tenancy every other command in the group runs against.
	Workspace bool

	// WorkspaceAdmin adds create, edit, transfer and delete. Separate from
	// Workspace because administering the company is not the same capability as
	// working inside it, and `apps/sales` deliberately serves only the second
	// (D-3). Ignored unless Workspace is set.
	WorkspaceAdmin bool

	// Members mounts `bk <app> member` — list and remove.
	Members bool

	// MemberLeave adds `member leave`, which needs POST /api/workspaces/{ws}/leave.
	// Ignored unless Members is set.
	MemberLeave bool

	// Invites mounts `bk <app> invite` — candidates, send, list, revoke,
	// pending, accept, decline.
	Invites bool

	// Users mounts `bk <app> user` — the directory of people you share a
	// workspace with IN THIS APP. App-owned since Phase 4 and not merely
	// re-spelled: the answer comes from this app's membership table, so two
	// deployments give two different lists to the same caller.
	Users bool

	// Activity mounts `bk <app> activity` — this app's event feed.
	Activity bool

	// Search mounts `bk <app> search` over `GET /api/workspaces/{ws}/search`.
	//
	// Off for `apps/sales`, and NOT because sales cannot search: it has its own
	// `bk sales search` over `/sales-search`, full-text inside its records,
	// built in its own package. Mounting this one there would collide with a
	// better command and claim a route agent 4 unmounted for leaking issues'
	// titles into sales.
	Search bool

	// Inbox mounts `bk <app> inbox` — per-user notifications from this app.
	Inbox bool

	// Storage mounts `bk <app> storage` — this app's uploaded files and the
	// workspace's usage against the shared quota.
	Storage bool
}

// Set is one app's copy of the app-owned verbs.
//
// The groups are returned individually as well as through All() because an app
// adds its own entity-specific subcommands to them: `bk issues label attach`
// takes an issue and posts to an issues route, so it is built in the issues
// package and hung off Label here.
//
// A field is nil when Config did not ask for it. All() skips nils, so an app
// group's `AddCommand(set.All()...)` line is the same one line whatever the app
// serves.
type Set struct {
	Config    Config
	Workspace *cobra.Command
	Member    *cobra.Command
	Invite    *cobra.Command
	User      *cobra.Command
	Upload    *cobra.Command
	Trash     *cobra.Command
	Label     *cobra.Command
	Search    *cobra.Command
	Activity  *cobra.Command
	Inbox     *cobra.Command
	Storage   *cobra.Command
}

// All returns the mounted groups in the order `bk <app> --help` should list
// them: the tenancy first (workspace, member, invite, user), then the work
// (upload, trash, label), then the read surfaces (search, activity, inbox,
// storage).
func (s Set) All() []*cobra.Command {
	out := make([]*cobra.Command, 0, 11)
	for _, c := range []*cobra.Command{
		s.Workspace, s.Member, s.Invite, s.User,
		s.Upload, s.Trash, s.Label,
		s.Search, s.Activity, s.Inbox, s.Storage,
	} {
		if c != nil {
			out = append(out, c)
		}
	}
	return out
}

// New builds one app's copy of the app-owned verbs.
//
// A fresh construction per app, never a shared pointer: a cobra command carries
// per-invocation state (parsed flags, its parent link), so the same
// *cobra.Command cannot hang off two app groups.
func New(cfg Config) Set {
	if strings.TrimSpace(cfg.App) == "" {
		// Every one of these commands is defined by which app it targets. An
		// empty slug would build a tree that looks right and routes nowhere —
		// fail at construction, where every test that builds the command tree
		// sees it, rather than at the first HTTP call.
		panic("appverbs.New: Config.App is required — these verbs are app-owned by definition")
	}
	s := Set{
		Config: cfg,
		// The three that every app with data has. They are unconditional
		// because an app that stores nothing has no reason to exist, and
		// `apps/_scaffold` proves the mount works with nothing else set.
		Upload: newUploadCmd(cfg),
		Trash:  newTrashCmd(cfg),
		Label:  newLabelCmd(cfg),
	}
	if cfg.Workspace {
		s.Workspace = newWorkspaceCmd(cfg)
	}
	if cfg.Members {
		s.Member = newMemberCmd(cfg)
	}
	if cfg.Invites {
		s.Invite = newInviteCmd(cfg)
	}
	if cfg.Users {
		s.User = newUserCmd(cfg)
	}
	if cfg.Search {
		s.Search = newSearchCmd(cfg)
	}
	if cfg.Activity {
		s.Activity = newActivityCmd(cfg)
	}
	if cfg.Inbox {
		s.Inbox = newInboxCmd(cfg)
	}
	if cfg.Storage {
		s.Storage = newStorageCmd(cfg)
	}
	return s
}
