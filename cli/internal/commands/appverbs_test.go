package commands

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/appverbs"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/sales"
	"github.com/spf13/cobra"
)

// THE APP-OWNED TIER: spelled `bk <app> <verb>`, with no bare form.
//
// Three verbs from D-11 (upload, trash, label) and eight more from
// multiAppFinalRefactor Phase 4, when the cross-app tier stopped existing —
// `apps/sales` got its own workspaces, members, invitations, labels, uploads
// ledger and event spine, so a bare `bk workspace list` no longer had one table
// to read.
//
// The properties below are what "the tier is visible in the command itself"
// actually means, asserted rather than described. The end-to-end half — that the
// removed spelling still hands an agent its replacement — is in
// cmd/bk/main_test.go, because hintFor() lives there and testing DeprecationHint
// alone would pass with hintFor() never calling it. That is CLAUDE.md finding
// #8's shape, found in this repo once already.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS FILE WAS FOUND INERT DURING PHASE 4, BY THE CHANGE THAT WROTE IT
// ═══════════════════════════════════════════════════════════════════════════
// It read the tier from `appverbs.New(appverbs.Config{App: "probe"}).All()`,
// which was the right instinct — derive the list, do not type it out — and the
// moment Config grew per-app capability flags, a probe that set none of them
// returned THREE verbs. Every assertion below kept passing over `upload`,
// `trash` and `label` while the eight verbs the phase had just moved were
// checked by nothing at all. The suite was green the whole time.
//
// That is finding #10 exactly: a correct change (the Config had to grow, because
// sales serves a subset) silently retargeted an assertion phrased for the old,
// narrower set. **When you widen a value, grep for what asserts on it.**
//
// The fix is `everyVerb()` below — a Config with every capability ON — plus a
// floor that fails if the discovered list is smaller than the tier is known to
// be. A floor is not a specification; it is the assertion that stops "found
// nothing" from reading as "nothing wrong".
func everyVerb() appverbs.Config {
	return appverbs.Config{
		App:            "probe",
		Uploads:        true,
		Trash:          true,
		Labels:         true,
		Workspace:      true,
		WorkspaceAdmin: true,
		Members:        true,
		MemberLeave:    true,
		Invites:        true,
		Users:          true,
		Search:         true,
		Activity:       true,
		Inbox:          true,
		Storage:        true,
	}
}

// appOwnedVerbNames is the whole tier, read from the shared constructor rather
// than typed out, so a verb added there cannot be missed here.
func appOwnedVerbNames(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, c := range appverbs.New(everyVerb()).All() {
		out = append(out, c.Name())
	}
	// Eleven since Phase 4. The floor is an input assertion, not a
	// specification: it exists so a Set that returned a SUBSET — which is what
	// a Config with no flags set now returns — would fail here instead of making
	// every assertion below pass over three verbs.
	if len(out) < 11 {
		t.Fatalf("only %d app-owned verbs discovered (%v) — everyVerb() has fallen behind "+
			"appverbs.Config, and every assertion below is now checking a subset",
			len(out), out)
	}
	return out
}

// The bare spellings must be gone. A bare `bk workspace use` that still resolved
// would have to pick an app, and picking one silently is the accident the tier
// removes — measurably so: with one shared active workspace, `bk workspace use
// balathanusan-1` left `bk sales prospect list` answering 404.
//
// BOTH directions are asserted on the RESOLVED COMMAND, never on Find's error.
// Find returns no error for an unknown subcommand of a group — cobra's
// legacyArgs only complains at the root — so `Find([]string{"issues",
// "upload"})` succeeds, handing back the `issues` group itself, whether or not
// `upload` exists. The first draft of this test checked the error and passed
// with the whole tier unmounted; the mount was deleted to find that out.
func TestAppOwnedVerbsHaveNoBareSpelling(t *testing.T) {
	root := NewRoot()
	for _, verb := range appOwnedVerbNames(t) {
		t.Run(verb, func(t *testing.T) {
			if c, _, err := root.Find([]string{verb}); err == nil && c.Name() == verb {
				t.Errorf("`bk %s` still resolves — it must be spelled `bk <app> %s`", verb, verb)
			}
			c, _, err := root.Find([]string{issues.Slug, verb})
			if err != nil {
				t.Fatalf("`bk %s %s`: %v", issues.Slug, verb, err)
			}
			if c.Name() != verb {
				t.Fatalf("`bk %s %s` resolved to %q — the app-qualified spelling is the one "+
					"that has to work", issues.Slug, verb, c.CommandPath())
			}
		})
	}
}

// `bk link` is gone from the tree entirely — not moved under an app. It is
// asserted separately because it is the only verb this phase DELETED, and a
// deletion has a different failure mode from a move: re-adding it anywhere would
// re-create the shared entity index the whole refactor removed.
func TestLinkIsGoneFromEveryTier(t *testing.T) {
	root := NewRoot()
	if c, _, err := root.Find([]string{"link"}); err == nil && c.Name() == "link" {
		t.Error("`bk link` still resolves — it was removed on 2026-08-10 (PLAN.md §3); " +
			"a link's two ends needed one shared entity index, and only one app writes it now")
	}
	for _, app := range []string{issues.Slug, sales.Slug} {
		if c, _, err := root.Find([]string{app, "link"}); err == nil && c.Name() == "link" {
			t.Errorf("`bk %s link` exists — `link` was removed, not re-tiered", app)
		}
	}
}

// A Config that declares NOTHING must build NOTHING.
//
// This is the property that replaced "every app mounts upload/trash/label or
// none of them", and the replacement was forced by `apps/_scaffold`: it serves
// no /api/upload, no /trash and no /labels, so an unconditional mount claimed
// three routes it has no file for. The tier is fully declared now.
//
// The risk that creates is the opposite one — a constructor that ignores Config
// and builds everything — so it is asserted directly. Without this, every
// per-app expectation in TestEachAppMountsExactlyWhatItDeclares could be
// satisfied by a New() that mounted the lot.
func TestAConfigThatDeclaresNothingBuildsNothing(t *testing.T) {
	built := appverbs.New(appverbs.Config{App: "probe"}).All()
	if len(built) != 0 {
		var names []string
		for _, c := range built {
			names = append(names, c.Name())
		}
		t.Errorf("a Config with no capabilities set built %v — every verb is declared, so "+
			"an app gets exactly what its `app/api/**` tree serves and nothing else", names)
	}
}

// A DECLARED capability must actually appear, and an undeclared one must not.
//
// This is the guard the per-app subset needs and D-36 asked for: a permanent
// subset is legitimate, an ACCIDENTAL one is a bug. Reading both sides from the
// same Config would be circular, so the two apps' real, hand-written
// declarations are compared against the trees `NewRoot()` actually builds.
//
// The pair is what makes it discriminating. `sales` must NOT have `inbox`,
// `storage`, `user` or the shared `search`; `issues` MUST have all four. A
// constructor that ignored the flags and mounted everything fails the first
// half; one that mounted nothing fails the second.
func TestEachAppMountsExactlyWhatItDeclares(t *testing.T) {
	cases := []struct {
		app     string
		want    []string
		wantNot []string
	}{
		{
			app:  issues.Slug,
			want: []string{"workspace", "member", "invite", "user", "upload", "trash", "label", "search", "activity", "inbox", "storage"},
		},
		{
			app:  sales.Slug,
			want: []string{"workspace", "member", "invite", "upload", "trash", "label", "activity"},
			// Not absences of taste — absences of ROUTES. apps/sales mounts no
			// /me/inbox, no /storage, no /api/users, and agent 4 unmounted
			// /workspaces/{ws}/search after measuring it serving issues' titles
			// to a sales-only member. `bk sales search` exists and is this app's
			// OWN full-text command over /sales-search, which is why `search` is
			// checked by name below rather than by absence.
			wantNot: []string{"inbox", "storage", "user"},
		},
	}

	root := NewRoot()
	for _, tc := range cases {
		t.Run(tc.app, func(t *testing.T) {
			group, _, err := root.Find([]string{tc.app})
			if err != nil {
				t.Fatalf("no %s group: %v", tc.app, err)
			}
			for _, v := range tc.want {
				if findChild(group, v) == nil {
					t.Errorf("`bk %s %s` is missing — its Config declares it", tc.app, v)
				}
			}
			for _, v := range tc.wantNot {
				if findChild(group, v) != nil {
					t.Errorf("`bk %s %s` exists — this app mounts no route for it, so the "+
						"command can only 404. A dead end with a help page is not a command.",
						tc.app, v)
				}
			}
		})
	}

	// The subset has to be a real subset, or the two rows above are one row
	// written twice and the whole test could pass on a constructor that ignores
	// Config entirely.
	issuesGroup, _, _ := root.Find([]string{issues.Slug})
	salesGroup, _, _ := root.Find([]string{sales.Slug})
	if len(issuesGroup.Commands()) <= len(salesGroup.Commands()) {
		t.Log("note: sales now has at least as many groups as issues — check that the " +
			"subset above is still the discriminating case it was written to be")
	}
}

// `bk sales search` must be SALES' OWN command, not the shared one.
//
// The two are different questions with the same name: the shared verb reads
// `GET /api/workspaces/{ws}/search`, which sales does not serve; this one reads
// `/sales-search` and searches inside sales' records. Mounting the shared copy
// there would have silently replaced a working command with one that 404s, and
// nothing in `bk sales --help` would have looked different.
func TestSalesSearchIsItsOwnCommandNotTheSharedOne(t *testing.T) {
	root := NewRoot()
	c, _, err := root.Find([]string{sales.Slug, "search"})
	if err != nil || c.Name() != "search" {
		t.Fatalf("`bk sales search` does not resolve: %v", err)
	}
	want := "GET /api/workspaces/{ws}/sales-search"
	if got := c.Annotations["routes"]; got != want {
		t.Errorf("`bk sales search` claims %q; want %q — the shared search verb reads "+
			"/workspaces/{ws}/search, which this app does not serve", got, want)
	}
}

func findChild(parent *cobra.Command, name string) *cobra.Command {
	for _, c := range parent.Commands() {
		if c.Name() == name {
			return c
		}
	}
	return nil
}

// Every removed spelling keeps a deprecations.go row that NAMES its replacement.
// Without this, dropping a bare verb and forgetting its hint looks exactly like a
// clean removal — until an agent runs the old command next week.
func TestRemovedBareVerbsCarryANamedHint(t *testing.T) {
	for _, verb := range appOwnedVerbNames(t) {
		t.Run(verb, func(t *testing.T) {
			// The string cobra ACTUALLY emits for the argv an agent would type.
			// Verified against the built binary: cobra's legacyArgs reports the
			// first token only (`unknown command "upload" for "bk"`), while
			// rejectUnknownSubcommands' RunE reports it for a group. Asserting a
			// hand-written approximation is how the previous version of this
			// check passed while the real binary served the generic hint.
			for _, errMsg := range []string{
				`unknown command "` + verb + `" for "bk"`,
				`unknown command "` + verb + ` list" for "bk"`,
			} {
				hint := DeprecationHint(errMsg)
				if hint == "" {
					t.Fatalf("no deprecation hint for %s — an agent running the old spelling "+
						"gets `unknown command` and nothing to act on", errMsg)
				}
			}
			// The hint must name a CONCRETE, runnable replacement. "use the app
			// name" is not something an agent can execute, and every one of these
			// verbs is reachable under `bk issues`.
			hint := DeprecationHint(`unknown command "` + verb + ` list" for "bk"`)
			want := "bk " + issues.Slug + " " + verb
			if !strings.Contains(hint, want) {
				t.Errorf("the hint for `bk %s` does not name a concrete replacement (%q):\n  %s",
					verb, want, hint)
			}
		})
	}
}
