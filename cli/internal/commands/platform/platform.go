// Package platform holds the BARE verbs — the ones that stay at the top level
// because no app can be the wrong one to ask.
//
// ---------------------------------------------------------------------------
// WHAT IS LEFT HERE, AND WHY IT IS SO MUCH LESS (Phase 4)
// ---------------------------------------------------------------------------
// D-11 had three tiers, and TWO of them lived in this package: NEUTRAL (the same
// answer from any deployment) and CROSS-APP (spans every app by design). Both
// rested on one fact — the apps shared a database. `bk workspace list` could be
// bare because there was one `platform.workspaces`; `bk search` could be bare
// because every app projected into `platform.entities`; `bk storage` could be
// bare because there was one upload ledger.
//
// multiAppFinalRefactor Phases 2 and 3 ended all three. Sales has its own
// workspaces, members, invitations, labels, uploads ledger and event spine, and
// it no longer projects into the shared index at all. So the cross-app tier is
// gone (and `bk link` with it, PLAN.md §3), and every verb that reads an app's
// DATA moved to `bk <app> <verb>` — internal/appverbs.
//
// What remains here is the account and the binary:
//
//	login, logout, whoami   authenticate; one account, every app
//	token                   API tokens — one token, every app
//	profile                 your own name, tagline, avatar
//	meta                    who am I, where will each command go, live limits
//	app                     the address book: which apps exist, where they live
//	guide, skill, version   this binary, offline
//	changelog               the dated record; merged from one source
//	super-admin             platform-wide administration — see below
//
// The test for adding anything here is unchanged in wording and much sharper in
// effect: **would two deployments give the same answer?** For everything above
// the answer is yes because the row lives in `platform.users`, `platform.apps`
// or `platform.api_tokens` — the four tables §4b of PLAN.md marks "stays
// shared" — or inside this binary.
//
// ---------------------------------------------------------------------------
// `super-admin` STAYS BARE, AND THE REASON HAS AN EXPIRY DATE
// ---------------------------------------------------------------------------
// `users`, `whitelist` and `errors` read `platform.users`,
// `platform.email_whitelist` and `platform.error_events` — genuinely shared
// operator surfaces, and `error_events` gained an `app` column in Phase 1
// precisely so ONE log can stay honest about which deployment wrote a row.
//
// `entity-drift` and `blob-drift` are NOT like that. Both are scoped to the
// deployment they run against — an app's Postgres role has no grant on another
// app's schema — which is CLAUDE.md finding #14: `entity-drift` reported no
// drift against a database holding 51 unprojected sales rows. By the rule above
// they are app-owned.
//
// They stay bare anyway, and this is the measurement rather than a preference:
// **only `apps/issues` mounts `/api/super-admin/**` at all.** With exactly one
// deployment able to answer, an app-qualified spelling would name a choice that
// does not exist, and `bk sales super-admin blob-drift` would be a command that
// can only 404. That stops being true the moment a second app mounts one of
// those routes — so it is asserted rather than remembered:
// superadmin_scope_test.go fails if any other app grows a super-admin route
// while these are still bare.
//
// This package must not import any app package, and no app package may import
// it. Anything both need is in internal/cmdutil or internal/appverbs.
package platform

import "github.com/spf13/cobra"

// NewCommands returns every bare platform verb, in the order `bk --help` should
// present them. root.go adds these, then one group per app.
func NewCommands() []*cobra.Command {
	return []*cobra.Command{
		newGuideCmd(),
		newSkillCmd(),
		newLoginCmd(),
		newLogoutCmd(),
		newWhoamiCmd(),
		newMetaCmd(),
		newProfileCmd(),
		newAppCmd(),
		newTokenCmd(),
		newChangelogCmd(),
		newSuperAdminCmd(),
		newVersionCmd(),
	}
}
