package platform

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// `bk super-admin` STAYS BARE, AND THIS IS THE EXPIRY DATE ON THAT DECISION.
//
// ---------------------------------------------------------------------------
// THE ARGUMENT, AND THE HALF OF IT THAT IS NOT SAFE TO WRITE DOWN AND FORGET
// ---------------------------------------------------------------------------
// Phase 4's rule for the bare tier is "would two deployments give the same
// answer?". Three of these five subcommands pass it outright — `users`,
// `whitelist` and `errors` read `platform.users`, `platform.email_whitelist`
// and `platform.error_events`, which PLAN.md §4b keeps shared, and
// `error_events` gained an `app` column in Phase 1 precisely so one log can stay
// honest about which deployment wrote a row.
//
// `entity-drift` and `blob-drift` FAIL it. Both are scoped to the deployment
// they run against — an app's Postgres role has no grant on another app's schema
// — which is CLAUDE.md finding #14: `bk super-admin entity-drift` reported no
// drift against a database holding 51 unprojected sales rows, and its help text
// claimed it checked "each app's" tables. By the rule they are app-owned.
//
// They stay bare anyway, for a reason that is a MEASUREMENT and not a
// preference: only `apps/issues` mounts `/api/super-admin/**` at all. With
// exactly one deployment able to answer, `bk sales super-admin blob-drift` would
// be a command that can only 404 — a dead end with a help page, which is the
// thing this phase is removing everywhere else.
//
// That argument has one input, and the input can change without anyone
// remembering this comment. So it is asserted. **The day a second app mounts a
// super-admin route, this test goes red and the drift commands move under the
// app name.** A deferral with a trigger is a decision; a deferral without one is
// how a wrong tier survives three phases.
//
// It scans the filesystem rather than reading a list, so an app added later is
// covered without anyone editing this file — and it asserts its own inputs
// first, because a walk that finds no apps would report perfect agreement.
func TestOnlyOneAppMountsTheSuperAdminSurface(t *testing.T) {
	appsRoot := filepath.Join("..", "..", "..", "..", "apps")
	entries, err := os.ReadDir(appsRoot)
	if err != nil {
		t.Fatalf("read %s: %v — this guard cannot see the apps it is about", appsRoot, err)
	}

	scanned := 0
	var mounters []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		apiDir := filepath.Join(appsRoot, e.Name(), "app", "api")
		if _, err := os.Stat(apiDir); err != nil {
			continue // not an app with an HTTP surface
		}
		scanned++
		saDir := filepath.Join(apiDir, "super-admin")
		if _, err := os.Stat(saDir); err == nil {
			mounters = append(mounters, e.Name())
		}
	}

	// Assert the inputs. Both numbers matter: no apps scanned means the path is
	// wrong, and no mounters at all means the surface moved somewhere this scan
	// cannot see — in which case the conclusion "only one app serves it" is
	// arithmetically true and completely uninformative. Finding #5's shape.
	if scanned < 2 {
		t.Fatalf("only %d app(s) with an app/api tree found under %s — this test would "+
			"report agreement no matter what", scanned, appsRoot)
	}
	if len(mounters) == 0 {
		t.Fatalf("no app mounts /api/super-admin/** — every `bk super-admin` subcommand " +
			"claims a route nobody serves, which is a worse failure than the one this " +
			"test was written for")
	}

	if len(mounters) > 1 {
		t.Errorf("%d apps now mount /api/super-admin/** (%s), so `bk super-admin` has an "+
			"app to be wrong about.\n\n"+
			"`entity-drift` and `blob-drift` are scoped to the deployment they run against "+
			"(CLAUDE.md finding #14 — entity-drift reported no drift over 51 unprojected "+
			"rows because it CANNOT see another app's schema). They stayed bare only "+
			"because one app could answer. Move them under the app name now: "+
			"`bk <app> super-admin entity-drift`.\n\n"+
			"`users`, `whitelist` and `errors` read shared platform tables and stay bare.",
			len(mounters), strings.Join(mounters, ", "))
	}
}
