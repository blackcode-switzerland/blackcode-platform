package config

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// DisplayPath must follow BK_CONFIG_DIR. This is the case the hardcoded string
// could never get right: every agent and every test in this repo isolates
// itself with that variable, and the help text went on naming ~/.config/bk.
func TestDisplayPathFollowsConfigDirOverride(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", filepath.Join("tmp", "bk-somewhere-else"))
	got := DisplayPath()
	want := filepath.Join("tmp", "bk-somewhere-else", "config.json")
	if got != want {
		t.Fatalf("DisplayPath() = %q, want %q", got, want)
	}
}

// And with no override it must be an ABSOLUTE path under the real home, spelled
// with the running OS's separator — the whole reason this function exists.
func TestDisplayPathIsAbsoluteAndOSNative(t *testing.T) {
	t.Setenv("BK_CONFIG_DIR", "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skipf("no home directory on this machine: %v", err)
	}
	got := DisplayPath()
	if !filepath.IsAbs(got) {
		t.Fatalf("DisplayPath() = %q, want an absolute path", got)
	}
	if !strings.HasPrefix(got, home) {
		t.Fatalf("DisplayPath() = %q, want it under the home directory %q", got, home)
	}
	if !strings.HasSuffix(got, filepath.Join(".config", "bk", "config.json")) {
		t.Fatalf("DisplayPath() = %q, want it to end in .config/bk/config.json", got)
	}
	// The separator is the point of the finding: on Windows this must not be a
	// POSIX path. filepath.Join gives us that for free — assert it anyway, since
	// a future rewrite with string concatenation would not.
	if runtime.GOOS == "windows" && strings.Contains(got, "/") {
		t.Fatalf("DisplayPath() = %q contains a POSIX separator on Windows", got)
	}
}

// TestNoHardcodedConfigPathInStrings is the guard.
//
// Three user-facing strings named `~/.config/bk/config.json` — a path that does
// not exist on Windows and is wrong under BK_CONFIG_DIR everywhere. They are
// DisplayPath() now, and the way that regresses is somebody typing the literal
// back into a help string, which reads perfectly well in review.
//
// It parses each file and inspects STRING LITERALS ONLY, so a comment
// explaining the history (there are several, deliberately) is not a failure.
func TestNoHardcodedConfigPathInStrings(t *testing.T) {
	root := filepath.Join("..", "..") // cli/
	scanned := 0
	fset := token.NewFileSet()

	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if info.Name() == "node_modules" || info.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		// This file is allowed to name the literal — it is what it asserts on.
		if filepath.Base(p) == "display_path_test.go" {
			return nil
		}
		f, perr := parser.ParseFile(fset, p, nil, 0)
		if perr != nil {
			return perr
		}
		scanned++
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			if strings.Contains(lit.Value, ".config/bk") || strings.Contains(lit.Value, `.config\bk`) {
				t.Errorf("%s:%d: string literal hardcodes the config path (%s).\n"+
					"Use config.DisplayPath() — the literal is wrong on Windows and wrong under BK_CONFIG_DIR.",
					p, fset.Position(lit.Pos()).Line, strings.TrimSpace(lit.Value))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	// Assert the input. A scanner that found no files passes silently, which is
	// this repo's most-repeated inert-guard shape.
	if scanned < 50 {
		t.Fatalf("scanned only %d Go files under %s — the walk is not seeing the CLI", scanned, root)
	}
}
