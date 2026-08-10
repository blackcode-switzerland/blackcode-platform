package commands

import (
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands/issues"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
)

// D-1's routing rule has exactly one implementation — cmdutil.ClientForApp —
// and these are the two ways it could stop being true.

// ---------------------------------------------------------------------------
// 1. NOBODY BUILDS A CLIENT BEHIND THE RESOLVER'S BACK
// ---------------------------------------------------------------------------
// Found by writing D-1 and then grepping: SIX commands under `bk issues …`
// built their client with `client.New(cfg.Server, …)` directly, duplicating
// what cmdutil already did. Harmless while there was one server. With an app
// registry they would have gone to the HOME server no matter which app group
// they were in — `bk issues issue list` talking to sales, silently, which is
// the precise failure D-1 exists to remove.
//
// A comment saying "always use cmdutil" would not have caught it; those six
// call sites predate the rule. So it is a test. The exceptions are listed with
// reasons, because the honest ones are few and each is a decision:
//
//	cmdutil/       the resolver itself
//	platform/login.go   builds a client for a server the user just typed, BEFORE
//	                    a config exists — that is what login is
//	platform/changelog.go  a public, unauthenticated endpoint reachable with no
//	                    config at all, with an explicit --server flag
//	platform/routing.go the probe: it deliberately targets an app OTHER than
//	                    this invocation's, via cmdutil.ClientForApp
var clientNewAllowed = map[string]string{
	"platform/login.go":     "login builds a client for a server the user just named, before any config exists",
	"platform/changelog.go": "the changelog is public and works with no config; --server may name any host",
}

func TestNobodyBuildsAClientOutsideTheResolver(t *testing.T) {
	checked := 0
	for _, pkg := range subPackages(t) {
		entries, err := os.ReadDir(pkg)
		if err != nil {
			t.Fatalf("read %s: %v", pkg, err)
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
				continue
			}
			rel := pkg + "/" + e.Name()
			path := filepath.Join(pkg, e.Name())
			src, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			checked++
			f, err := parser.ParseFile(token.NewFileSet(), path, src, 0)
			if err != nil {
				t.Fatalf("parse %s: %v", path, err)
			}
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || sel.Sel.Name != "New" {
					return true
				}
				ident, ok := sel.X.(*ast.Ident)
				if !ok || ident.Name != "client" {
					return true
				}
				if _, allowed := clientNewAllowed[rel]; allowed {
					return true
				}
				t.Errorf("%s calls client.New directly — every command must go through "+
					"cmdutil.NewClient/NewClientAndConfig/ClientForApp, or it silently talks to "+
					"the home server instead of its own app's (D-1). If this one is genuinely "+
					"different, add it to clientNewAllowed WITH A REASON.", rel)
				return true
			})
		}
	}
	// Assert the input: a walk that found no files would pass this test while
	// checking nothing, which is finding #5's shape.
	if checked < 10 {
		t.Fatalf("only %d command files scanned — the walk is not finding the tree", checked)
	}
}

// Every exception must still exist. An allow-list entry pointing at a deleted
// file is an exemption nobody is watching.
func TestClientNewExceptionsStillExist(t *testing.T) {
	for rel, reason := range clientNewAllowed {
		if _, err := os.Stat(rel); err != nil {
			t.Errorf("clientNewAllowed names %q (%q), which does not exist — delete the entry", rel, reason)
		}
	}
}

// ---------------------------------------------------------------------------
// 2. EVERY COMMAND UNDER AN APP GROUP PINS THAT APP
// ---------------------------------------------------------------------------
// The pin is applied to the SUBTREE by root.go's pinApp, so this walks the real
// tree and runs each leaf's RunE to see what it sets. A command added to
// `bk issues …` tomorrow is covered without anyone remembering this file.
//
// It asserts on cmdutil.PinnedApp AFTER invoking RunE with an empty config
// directory: every command fails at the auth check, and the pin is set before
// that. Running the real closures is the point — a test that read the tree's
// shape instead would pass for a wrapper that set nothing.
func TestEveryCommandInAnAppGroupPinsItsApp(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	root := NewRoot()

	group, _, err := root.Find([]string{issues.Slug})
	if err != nil {
		t.Fatalf("no %s group: %v", issues.Slug, err)
	}

	leaves := 0
	for _, leaf := range runnableLeaves(group) {
		leaves++
		cmdutil.PinApp("") // clear, so a stale value cannot pass for a fresh one
		runLeaf(leaf)
		if cmdutil.PinnedApp != issues.Slug {
			t.Errorf("`%s` left PinnedApp=%q — every command under an app group must pin %q, "+
				"or it talks to the home server", leaf.CommandPath(), cmdutil.PinnedApp, issues.Slug)
		}
	}
	if leaves < 20 {
		t.Fatalf("only %d runnable commands found under `bk %s` — the walk is wrong and this "+
			"test is asserting almost nothing", leaves, issues.Slug)
	}
	cmdutil.PinApp("")
}

// runLeaf invokes a command's RunE with placeholder arguments.
//
// The arguments are nonsense on purpose: the config directory is empty, so every
// command fails at the auth check moments later, and NOTHING here reaches a
// server. A panic is tolerated for the same reason — a body that indexes args[3]
// with placeholder input is not what is being tested. The pin is set by the
// wrapper BEFORE the body runs, so it is observable either way, which is exactly
// the property under test.
func runLeaf(leaf *cobra.Command) {
	defer func() { _ = recover() }()
	_ = leaf.RunE(leaf, []string{"1", "1", "1", "1"})
}

// runnableLeaves returns every command in a subtree that actually runs
// something — the ones that build a client.
func runnableLeaves(root *cobra.Command) []*cobra.Command {
	var out []*cobra.Command
	var walk func(*cobra.Command)
	walk = func(c *cobra.Command) {
		if c.Name() == "help" || c.Name() == "completion" {
			return
		}
		if c.RunE != nil && !hasRunnableChildren(c.Commands()) {
			out = append(out, c)
		}
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
	return out
}

// ---------------------------------------------------------------------------
// 3. TWO APPS, TWO SERVERS, AND THE ANSWERS MUST DIFFER
// ---------------------------------------------------------------------------
// The master's step-3 question for this phase: *would this test still pass if
// the resolver ignored its argument and always returned the home server?*
//
// It would not, and that is the only reason it is written this way. A one-app
// fixture cannot tell "routed correctly" from "routed home", so every case below
// is a pair: the SAME verb reaching a DIFFERENT server depending on the tier and
// the override, plus the two cases where routing must fail loudly instead of
// picking somewhere.
//
// The assertions are on which server RECEIVED the request, never on whether the
// command succeeded. What the fixtures return is irrelevant to routing, and a
// test that also depended on response shapes would break for reasons that have
// nothing to do with D-1.
func TestRoutingSendsEachTierToItsOwnServer(t *testing.T) {
	issuesHits, salesHits := &[]string{}, &[]string{}
	recorder := func(sink *[]string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			*sink = append(*sink, r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[]}`))
		}
	}
	issuesSrv := httptest.NewServer(recorder(issuesHits))
	defer issuesSrv.Close()
	salesSrv := httptest.NewServer(recorder(salesHits))
	defer salesSrv.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	// THE HOME APP IS **SALES**, and the app under test is issues. That is
	// deliberate and it is what makes every case below discriminating: with
	// home == issues, "routed to the issues server" and "routed home" are the
	// same observation, and a resolver that ignored its argument entirely would
	// pass most of this table. Injecting exactly that regression is how the
	// original fixture — home == issues — was found to be too weak.
	// Each app gets its OWN active workspace, because since Phase 4 that is the
	// only kind there is. The two slugs are DIFFERENT on purpose: an assertion
	// on which server was reached would still pass with one shared field, but
	// the path each server sees would not, and case "the same verb, two apps"
	// below reads the path.
	writeConfig(t, dir, map[string]any{
		"token":       "bk_live_test",
		"home_app":    "sales",
		"home_server": salesSrv.URL,
		"active_workspaces": map[string]any{
			"issues": map[string]any{"id": 1, "slug": "acme-issues"},
			"sales":  map[string]any{"id": 2, "slug": "acme-sales"},
		},
		"app_servers": map[string]string{
			"issues": issuesSrv.URL,
			"sales":  salesSrv.URL,
		},
	})

	cases := []struct {
		name string
		argv []string
		want string // "issues" | "sales"
	}{
		// App-owned: the group pins its app — AGAINST the home app, which is sales.
		{"app-owned verb goes to its app, not home", []string{"issues", "label", "list"}, "issues"},
		{"an app's own noun goes to its app, not home", []string{"issues", "issue", "list"}, "issues"},
		// THE VERBS PHASE 4 MOVED. Each of these was bare and went home; the
		// app name on the command is now the only thing that decides, which is
		// the whole prize of the phase — `bk trash purge` used to destroy things
		// in whichever app the config was last homed on.
		{"a moved verb goes to its app, not home", []string{"issues", "workspace", "list"}, "issues"},
		{"a moved read verb goes to its app, not home", []string{"issues", "storage", "list"}, "issues"},
		// Bare, after Phase 4: identity and the binary. These still follow home.
		{"an identity verb goes home", []string{"token", "list"}, "sales"},
		{"another identity verb goes home", []string{"profile", "view"}, "sales"},
		// …and --app-server moves the home half, one invocation at a time. It is
		// NOT spelled --app: six commands already use --app as a FILTER, and a
		// persistent flag of that name shadows them silently rather than
		// colliding. This pair of cases is what found that.
		{"--app-server redirects an identity verb", []string{"--app-server", "issues", "token", "list"}, "issues"},
		{"--app-server redirects the address book", []string{"--app-server", "issues", "profile", "view"}, "issues"},
		// THE ONE THAT MATTERS MOST: an override must NOT move an app-owned verb.
		// Its app is written on the command, and a flag cannot outrank it.
		{"--app-server does not move an app-owned verb", []string{"--app-server", "sales", "issues", "label", "list"}, "issues"},
		{"--app-server does not move a moved verb", []string{"--app-server", "sales", "issues", "member", "list"}, "issues"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			*issuesHits, *salesHits = nil, nil
			resetRoutingState()
			_ = runRoot(t, tc.argv...)

			got, other := issuesHits, salesHits
			gotName, otherName := "issues", "sales"
			if tc.want == "sales" {
				got, other = salesHits, issuesHits
				gotName, otherName = "sales", "issues"
			}
			if len(*got) == 0 {
				t.Fatalf("`bk %s` sent nothing to the %s server (the %s server got %v)",
					strings.Join(tc.argv, " "), gotName, otherName, *other)
			}
			if len(*other) > 0 {
				t.Fatalf("`bk %s` reached the %s server (%v) — it must go to %s",
					strings.Join(tc.argv, " "), otherName, *other, gotName)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 4. THE SAME VERB, TWO APPS, TWO ANSWERS — Phase 4's whole claim
// ---------------------------------------------------------------------------
// `member` was a bare NEUTRAL verb: one workspace table, so one membership list,
// so no app could be the wrong one to ask. Since Phase 2 that is two tables with
// OVERLAPPING ids, and a bare spelling would answer from whichever app the
// config was last homed on.
//
// This asserts both halves of the fix at once, and neither alone would do:
//
//   - the SERVER differs (routing), and
//   - the WORKSPACE SLUG IN THE PATH differs (per-app active workspace).
//
// The second is the one a re-tiering could silently get wrong. Move the verb
// under the app, keep one shared `active_workspace_slug`, and every case in the
// table above still passes while `bk sales member list` asks the sales server
// about an ISSUES workspace slug. Measured before the split existed: with one
// field, `bk workspace use balathanusan-1` left `bk sales prospect list`
// answering `workspace not found (404)`.
func TestTheSameVerbUnderTwoAppsAsksTwoTenancies(t *testing.T) {
	issuesHits, salesHits := &[]string{}, &[]string{}
	recorder := func(sink *[]string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			*sink = append(*sink, r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[]}`))
		}
	}
	issuesSrv := httptest.NewServer(recorder(issuesHits))
	defer issuesSrv.Close()
	salesSrv := httptest.NewServer(recorder(salesHits))
	defer salesSrv.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token":       "bk_live_test",
		"home_app":    "sales",
		"home_server": salesSrv.URL,
		"active_workspaces": map[string]any{
			"issues": map[string]any{"id": 1, "slug": "acme-issues"},
			"sales":  map[string]any{"id": 2, "slug": "acme-sales"},
		},
		"app_servers": map[string]string{"issues": issuesSrv.URL, "sales": salesSrv.URL},
	})

	resetRoutingState()
	_ = runRoot(t, "issues", "member", "list")
	resetRoutingState()
	_ = runRoot(t, "sales", "member", "list")

	if len(*issuesHits) != 1 || len(*salesHits) != 1 {
		t.Fatalf("expected one request each; issues=%v sales=%v", *issuesHits, *salesHits)
	}
	if !strings.Contains((*issuesHits)[0], "acme-issues") {
		t.Errorf("`bk issues member list` asked for %q — it must use the ISSUES active "+
			"workspace (acme-issues). A shared active-workspace field passes the routing "+
			"table above and fails here.", (*issuesHits)[0])
	}
	if !strings.Contains((*salesHits)[0], "acme-sales") {
		t.Errorf("`bk sales member list` asked for %q — it must use the SALES active "+
			"workspace (acme-sales)", (*salesHits)[0])
	}
}

// THE SECOND RESOLVER, which the test above does NOT cover.
//
// There are two, and finding that out was the point of injecting a regression
// into each: `ResolveWorkspaceRef` builds the PATH every workspace-scoped
// command asks for, and `ClientWorkspaceSlug` sets the client's implicit
// workspace. The test above is discriminating for the first and stayed GREEN
// when the second was pointed back at the shared legacy field — because
// `member list` passes its workspace explicitly and never reads it.
//
// That is not a harmless second copy. `ClientWorkspaceSlug` is sent as
// `?workspace=` on `GET /api/upload`, and the server answers with the folder the
// blob is written to and the workspace the ledger row records. A wrong value
// there files a SALES contract under an ISSUES workspace's prefix — the same
// mis-attribution agent 4 fixed on the server in Phase 3, arriving from the
// client instead.
//
// So it gets its own case, asserting on the query string rather than on the path.
func TestUploadAsksAboutItsOwnAppsWorkspace(t *testing.T) {
	salesHits := &[]string{}
	salesSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*salesHits = append(*salesHits, r.URL.RequestURI())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer salesSrv.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token":       "bk_live_test",
		"home_app":    "issues",
		"home_server": "https://issues.example.test",
		"active_workspaces": map[string]any{
			"issues": map[string]any{"id": 1, "slug": "acme-issues"},
			"sales":  map[string]any{"id": 2, "slug": "acme-sales"},
		},
		"app_servers": map[string]string{
			"issues": "https://issues.example.test",
			"sales":  salesSrv.URL,
		},
	})

	// A real (tiny) file: the command opens it, probes for capabilities, and then
	// fails against a fixture that returns nothing useful. The PROBE is what is
	// being measured — asserting on a successful upload would make this about
	// response shapes rather than routing.
	f := filepath.Join(dir, "contract.txt")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	resetRoutingState()
	_ = runRoot(t, "sales", "upload", f)

	// The FIRST /api/upload hit is the capabilities GET; the POST that follows
	// carries the same path with no query, so taking the last one would compare
	// against a request that never had a workspace to lose.
	var probe string
	for _, h := range *salesHits {
		if strings.HasPrefix(h, "/api/upload") {
			probe = h
			break
		}
	}
	if probe == "" {
		t.Fatalf("`bk sales upload` never asked the sales server about upload capabilities "+
			"(hits: %v) — this test is measuring nothing", *salesHits)
	}
	if !strings.Contains(probe, "workspace=acme-sales") {
		t.Errorf("`bk sales upload` probed %q — it must name the SALES active workspace. "+
			"The server answers with the folder the blob is written to, so the home app's "+
			"workspace here files a sales file under another tenant's prefix.", probe)
	}
}

// Setting one app's active workspace must not move another app's. The write half
// of the property above: `bk sales workspace use` writing a shared field is
// exactly how the two got confused before Phase 4.
func TestWorkspaceUseIsPerApp(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token":       "bk_live_test",
		"home_app":    "issues",
		"home_server": "https://issues.example.test",
		"active_workspaces": map[string]any{
			"issues": map[string]any{"id": 1, "slug": "acme-issues"},
		},
		"app_servers": map[string]string{"issues": "https://issues.example.test"},
	})

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	cfg.SetActiveWorkspaceFor("sales", config.ActiveWorkspace{ID: 9, Slug: "acme-sales"})
	if err := config.Save(cfg); err != nil {
		t.Fatalf("save: %v", err)
	}

	reloaded, err := config.Load()
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if got := reloaded.ActiveWorkspaceFor("issues").Slug; got != "acme-issues" {
		t.Errorf("setting sales' workspace changed issues' to %q — each app keeps its own", got)
	}
	if got := reloaded.ActiveWorkspaceFor("sales").Slug; got != "acme-sales" {
		t.Errorf("sales' active workspace did not persist: %q", got)
	}
	// The legacy pair mirrors the HOME app only. A non-home write touching it
	// would put a sales slug where a 3.x binary reads an issues one.
	if reloaded.ActiveWorkspaceSlug != "acme-issues" {
		t.Errorf("the legacy active_workspace_slug is %q — it mirrors the home app (issues) "+
			"so a rollback to 3.x keeps working, and must not follow another app's write",
			reloaded.ActiveWorkspaceSlug)
	}
}

// A 3.x config carries ONE active workspace and no per-app map. It must come
// forward as the HOME app's — and as nobody else's, because a slug resolved
// against issues is not a sales workspace.
func TestLegacyActiveWorkspaceMigratesToTheHomeAppOnly(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token":                 "bk_live_test",
		"home_app":              "issues",
		"home_server":           "https://issues.example.test",
		"active_workspace_id":   7,
		"active_workspace_slug": "legacy-ws",
		"app_servers":           map[string]string{"issues": "https://issues.example.test"},
	})

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := cfg.ActiveWorkspaceFor("issues"); got.Slug != "legacy-ws" || got.ID != 7 {
		t.Errorf("a 3.x config's active workspace did not come forward for the home app: %+v — "+
			"every `bk issues …` command would say \"no active workspace\" after an upgrade", got)
	}
	if got := cfg.ActiveWorkspaceFor("sales").Slug; got != "" {
		t.Errorf("the legacy workspace was adopted for sales too (%q) — it was resolved "+
			"against issues and naming it a sales workspace is the cross-tenant guess "+
			"this refactor removes", got)
	}
}

// An app with no entry in the registry FAILS, naming itself. It does not quietly
// become a request to the home server — which is the entire point of D-1, and the
// one behaviour a "sensible default" would destroy.
func TestUnknownAppFailsInsteadOfFallingBack(t *testing.T) {
	hits := &[]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits = append(*hits, r.URL.Path)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer srv.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token": "bk_live_test", "home_app": "issues", "home_server": srv.URL,
		"active_workspace_slug": "acme",
		"app_servers":           map[string]string{"issues": srv.URL},
	})

	resetRoutingState()
	// `bk scaffold …` is a real group whose app is deliberately absent from the
	// registry — the scaffold is not deployed. That makes it the honest fixture
	// for "an app this binary knows and this platform has no address for", which
	// is exactly what `bk sales …` looks like before the sales app ships.
	//
	// ── THE ASSERTION BELOW IS PHRASED TO EXCLUDE THE WRONG PASS ──────────────
	// Both halves of this used to be satisfiable by the group NOT EXISTING.
	// `runRoot(t, "template", …)` on a binary with no `template` group returns
	// `unknown command "template" for "bk"` — non-nil, and containing the word
	// "template". So when the scaffold's slug was renamed to `scaffold` on
	// 2026-08-07 this test stayed green while checking nothing at all: cobra's
	// arg parser was standing in for the routing failure it is here to observe.
	//
	// Caught the same day, by grepping for the renamed string rather than by
	// running the suite — the suite was green. CLAUDE.md's third corollary: a
	// correct change silently retargeted an assertion, and the diff that broke
	// the guard did not touch the guard.
	//
	// It now asserts on the ROUTING error's own words. `unknown command` is
	// checked for explicitly, because that is the specific wrong pass.
	err := runRoot(t, "scaffold", "note", "list")
	if err == nil {
		t.Fatal("`bk scaffold note list` succeeded — an app with no server must fail")
	}
	if strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("the `scaffold` group is not registered, so this never reached routing: %v", err)
	}
	if !strings.Contains(err.Error(), "scaffold") {
		t.Errorf("the failure does not name the app: %v", err)
	}
	if len(*hits) > 0 {
		t.Fatalf("it fell back to the home server (%v) — a wrong-server answer has no visible "+
			"cause, which is the failure D-1 exists to remove", *hits)
	}
}

// A registry entry pointing at a dead host must say so, naming the app AND the
// address, so the caller can tell a stale registry from a broken deployment.
// Not a bare dial error, and above all not a request somewhere else.
func TestDeadAppServerFailsByName(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close() // nothing is listening there now

	homeHits := &[]string{}
	home := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*homeHits = append(*homeHits, r.URL.Path)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer home.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	writeConfig(t, dir, map[string]any{
		"token": "bk_live_test", "home_app": "sales", "home_server": home.URL,
		"active_workspaces": map[string]any{
			"issues": map[string]any{"id": 1, "slug": "acme"},
			"sales":  map[string]any{"id": 2, "slug": "acme"},
		},
		"app_servers": map[string]string{"issues": deadURL, "sales": home.URL},
	})

	resetRoutingState()
	err := runRoot(t, "issues", "label", "list")
	if err == nil {
		t.Fatal("a dead app server must fail the command")
	}
	var ue *client.UnreachableError
	if !errors.As(err, &ue) {
		t.Fatalf("got %T (%v); want *client.UnreachableError so the hint can name the recovery", err, err)
	}
	if ue.App != "issues" || ue.BaseURL != deadURL {
		t.Errorf("the error does not name the app and address: app=%q url=%q", ue.App, ue.BaseURL)
	}
	if len(*homeHits) > 0 {
		t.Fatalf("it fell back to the home server (%v) instead of failing", *homeHits)
	}
}

// resetRoutingState clears the process-global pin and override between cases.
// They are set by the command tree at run time, and a test that inherited the
// previous case's pin would prove nothing about the current one.
func resetRoutingState() {
	cmdutil.PinApp("")
	cmdutil.AppOverride = ""
	cmdutil.WSOverride = ""
}

func runRoot(t *testing.T, argv ...string) error {
	t.Helper()
	root := NewRoot()
	root.SetOut(io.Discard)
	root.SetErr(io.Discard)
	root.SetArgs(argv)
	return root.Execute()
}

func writeConfig(t *testing.T, dir string, cfg map[string]any) {
	t.Helper()
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// 4. NO COMMAND MAY SHADOW THE ROUTING FLAG
// ---------------------------------------------------------------------------
// This is the trap that produced the flag's name, written down as a check so the
// next person cannot fall into it.
//
// Cobra lets a LOCAL flag shadow a persistent one of the same name, with no
// error and no warning: the local flag simply wins in that command's flag set.
// `--app` on the root would therefore have been silently inert on the six
// commands that already use `--app` as a filter — and worse, `bk storage list
// --app issues` would have started ROUTING instead of filtering, returning an
// unfiltered list that looks exactly like a filtered one.
//
// Nothing about that is visible in a passing test suite; the two-server routing
// table above is what surfaced it, and only because it asserted on the server
// that received the request rather than on the command succeeding.
func TestNoCommandShadowsTheRoutingFlag(t *testing.T) {
	const routingFlag = "app-server"
	root := NewRoot()
	if root.PersistentFlags().Lookup(routingFlag) == nil {
		t.Fatalf("the root has no --%s flag — this test would pass while checking nothing", routingFlag)
	}

	checked := 0
	var walk func(*cobra.Command)
	walk = func(c *cobra.Command) {
		if c.Name() != "help" && c.Name() != "completion" {
			checked++
			if c.HasParent() && c.LocalNonPersistentFlags().Lookup(routingFlag) != nil {
				t.Errorf("`%s` defines its own --%s flag, shadowing the root's routing override. "+
					"Cobra does not report this; the command would silently stop being routable.",
					c.CommandPath(), routingFlag)
			}
		}
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(root)
	if checked < 50 {
		t.Fatalf("only %d commands walked — the tree is not being traversed", checked)
	}
}

// ---------------------------------------------------------------------------
// 5. `bk meta` WRITES THE REGISTRY — THE SINGLE POINT OF FAILURE FOR RECOVERY
// ---------------------------------------------------------------------------
// Every routing failure in this CLI resolves to the same instruction: *run
// `bk meta`*. The unknown-app error, the dead-host error and the no-registry
// error all say it. If `bk meta` stops writing, all three become dead ends at
// once and the suite stays green — which is not hypothetical, because that is
// exactly what shipped for one commit: the routing PRINTER landed without the
// registry REFRESH, and `bk meta` printed "(no app registry yet)" three lines
// under a table listing both apps and their base_urls.
//
// THE TRAP, stated because it is what let that through: **a test that reads
// `bk meta`'s printed output passes with the write removed.** The table is built
// from the server's response, not from the config, so it looks identical either
// way. This asserts the SIDE EFFECT — the bytes on disk — and nothing else.
//
// It also pins the precedence rule that makes vanity domains and previews work:
// the registry declares `https://issues.example.test` for the app we are talking
// to, and we reached it at the test server's URL instead. The one that ANSWERED
// wins, because a column is a declaration and a live response is a proof.
func TestMetaWritesTheAppRegistryToDisk(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/api/meta") {
			_, _ = w.Write([]byte(`{
				"user": {"id": 7, "email": "a@b.ch", "via": "token"},
				"workspaces": [{"id":1,"name":"Acme","slug":"acme","role":"owner","is_active":true}],
				"apps": {
					"issues": {"slug":"issues","name":"Issues","base_url":"https://issues.example.test","is_current":true,"workspaces":["acme"]},
					"sales":  {"slug":"sales","name":"Sales","base_url":"https://sales.example.test","is_current":false,"workspaces":["acme"]}
				}
			}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer srv.Close()

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	// A 2.x config: one `server`, no address book. This is what every existing
	// user upgrades with, and `bk meta` is the one command that migrates it.
	writeConfig(t, dir, map[string]any{
		"server":                srv.URL,
		"token":                 "bk_live_test",
		"active_workspace_slug": "acme",
	})

	resetRoutingState()
	if err := runRoot(t, "meta"); err != nil {
		t.Fatalf("bk meta failed: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	var got struct {
		Server     string            `json:"server"`
		HomeApp    string            `json:"home_app"`
		HomeServer string            `json:"home_server"`
		AppServers map[string]string `json:"app_servers"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse config: %v\n%s", err, raw)
	}

	if got.HomeApp != "issues" {
		t.Errorf("home_app = %q; want %q — it is learned from the app the server says it IS",
			got.HomeApp, "issues")
	}
	if got.HomeServer != srv.URL {
		t.Errorf("home_server = %q; want %q", got.HomeServer, srv.URL)
	}
	if got.AppServers["issues"] != srv.URL {
		t.Errorf("app_servers[issues] = %q; want the server that ANSWERED (%q), not the "+
			"declared base_url — a column is a declaration, a response is a proof",
			got.AppServers["issues"], srv.URL)
	}
	if got.AppServers["sales"] != "https://sales.example.test" {
		t.Errorf("app_servers[sales] = %q; want the declared base_url — every app but the "+
			"one we reached has nothing better", got.AppServers["sales"])
	}
	// The 2.x rollback path, deliberately preserved: a 2.x binary reads only
	// `server`, so it must keep being written.
	if got.Server != srv.URL {
		t.Errorf("server = %q; want %q — it mirrors home_server so a rollback to a 2.x "+
			"binary still works", got.Server, srv.URL)
	}
}
