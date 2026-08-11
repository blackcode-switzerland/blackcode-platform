package commands

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The app boundary, enforced rather than agreed.
//
// docs/platform-architecture.md §7.1: one Go package per app, and no cross-imports
// between them. §7.6 asks for a lint that makes it real, on the grounds that a
// seam only stays legible if something fails when it is crossed — a developer or
// an agent landing anywhere in this repo has to be able to tell which app they
// are in without tracing imports.
//
// The rule is directional and deliberately asymmetric:
//
//	commands            may import platform and every app  (it assembles the tree)
//	commands/<app>      may import cmdutil, appverbs, client, config, output —
//	                    nothing else under commands/
//	commands/platform   may import the same — and NOT any app
//
// `internal/appverbs` (added 2.0.0 for D-11's app-owned tier) sits outside
// `internal/commands/` for exactly the reason `cmdutil` does: it holds command
// trees that SEVERAL app groups mount — `bk issues upload`, `bk sales upload` —
// and neither `platform` nor any app package could host that without one of the
// rules above being broken. The rule for putting something there is unchanged:
// two command packages need it, and it names no app's entities.
//
// The last line is the one that matters most and the one most likely to be
// broken by accident: it is what stops a "small helper" in the issues package
// becoming load-bearing for the platform, which is how a shared codebase quietly
// becomes an unextractable one. It has already happened once — before Phase 5,
// `bk storage list` and `bk super-admin` called truncate/humanBytes defined in
// issue.go. Those moved to cmdutil.
const commandsPkg = "github.com/blackcode-switzerland/bc-issues/cli/internal/commands"

func importsOf(t *testing.T, dir string) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	fset := token.NewFileSet()
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for _, imp := range f.Imports {
			p, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				t.Fatalf("bad import literal in %s: %v", path, err)
			}
			out[e.Name()] = append(out[e.Name()], p)
		}
	}
	return out
}

// subPackages lists every directory under internal/commands — one per app, plus
// platform. Discovered rather than listed, so an app added later is covered
// without anyone remembering to add it here.
func subPackages(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read .: %v", err)
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() && e.Name() != "testdata" {
			out = append(out, e.Name())
		}
	}
	if len(out) < 2 {
		t.Fatalf("found %d subpackages under internal/commands; expected at least "+
			"platform and one app — an empty list would make this test vacuous", len(out))
	}
	return out
}

func TestNoCrossImportsBetweenCommandPackages(t *testing.T) {
	pkgs := subPackages(t)

	for _, pkg := range pkgs {
		for file, imports := range importsOf(t, pkg) {
			for _, imp := range imports {
				if !strings.HasPrefix(imp, commandsPkg) {
					continue // cmdutil, client, config, output, stdlib, cobra — all fine
				}
				// Importing the assembler itself would also be a cycle, but say
				// why rather than leaving it to the compiler.
				if imp == commandsPkg {
					t.Errorf("%s/%s imports the root commands package; the tree is assembled "+
						"there, not from inside a leaf package", pkg, file)
					continue
				}
				other := strings.TrimPrefix(imp, commandsPkg+"/")
				if other != pkg {
					t.Errorf("%s/%s imports %q — command packages must not import each other. "+
						"If both need it, it belongs in internal/cmdutil.", pkg, file, other)
				}
			}
		}
	}
}

// The other half: the platform must not depend on any app. Stated separately
// from the rule above because it is the direction with the real consequence —
// `pg_dump --schema=issues` and "split the repo" (§11) both assume the platform
// stands up without any given app.
func TestPlatformDoesNotDependOnAnyApp(t *testing.T) {
	apps := []string{}
	for _, p := range subPackages(t) {
		if p != "platform" {
			apps = append(apps, p)
		}
	}
	if len(apps) == 0 {
		t.Fatal("no app packages found under internal/commands")
	}

	for file, imports := range importsOf(t, "platform") {
		for _, imp := range imports {
			for _, app := range apps {
				if imp == commandsPkg+"/"+app {
					t.Errorf("platform/%s imports the %q app. The platform is what every app "+
						"is built on; it cannot be built on one of them.", file, app)
				}
			}
		}
	}
}
