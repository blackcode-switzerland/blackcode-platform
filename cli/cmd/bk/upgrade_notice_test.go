package main

import (
	"os"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
)

// THE UPGRADE NOTICE — the binary saying, once, that it is not the one that ran
// last time.
//
// Until 2026-08-12 the CLI could only answer "am I behind?", from a server
// header. Moving FORWARD was silent: `npm install -g …@latest` replaced the tool
// and the next command behaved differently with no announcement. An agent
// upgraded 2.3.0 -> 3.0.0 and then filed six already-fixed behaviours as still
// broken, because its knowledge was one version old and nothing said so.
//
// These assert the STATE TRANSITIONS rather than the wording: what gets
// remembered, and when the notice is due. The notice text is built from those
// two facts, so pinning the sentence would guard the phrasing and not the
// behaviour.

// pinVersion gives the test binary a REAL version for the duration of one test.
//
// Without it every case below hits `!version.Parsable("dev")` and returns
// early. The first draft guarded that with a skip — which made three of these
// four guards report SUCCESS while asserting nothing, the failure mode this
// repo's rules are mostly about. `version.Version` is an ldflags var, so a test
// can simply set it, which is cheaper and far more honest.
func pinVersion(t *testing.T, v string) {
	t.Helper()
	orig := version.Version
	version.Version = v
	t.Cleanup(func() { version.Version = orig })
}

// capture runs maybeNotifyUpgrade with stderr redirected, in an isolated config.
func capture(t *testing.T, seed func(*config.Config)) (string, *config.Config) {
	t.Helper()
	t.Setenv("BK_CONFIG_DIR", t.TempDir())

	cfg := &config.Config{Server: "https://example.test", Token: "t"}
	if seed != nil {
		seed(cfg)
	}
	if err := config.Save(cfg); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	orig := os.Stderr
	os.Stderr = w
	maybeNotifyUpgrade()
	os.Stderr = orig
	_ = w.Close()

	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	_ = r.Close()

	after, err := config.Load()
	if err != nil {
		t.Fatalf("reload config: %v", err)
	}
	return string(buf[:n]), after
}

// THE POSITIVE CASE. A config that remembers an older version must produce the
// notice, and it must carry the date — the date is the whole point, because it
// is what makes `bk changelog --since` answerable.
func TestUpgradeIsAnnouncedWithTheDateToLookFrom(t *testing.T) {
	pinVersion(t, "3.0.0")
	out, after := capture(t, func(c *config.Config) {
		c.LastVersion = "0.0.1"
		c.LastVersionAt = "2026-08-11"
	})

	if !strings.Contains(out, "0.0.1") || !strings.Contains(out, version.Version) {
		t.Fatalf("the notice does not name the jump:\n%s", out)
	}
	if !strings.Contains(out, "--since 2026-08-11") {
		t.Fatalf("the notice does not hand over a usable date — without it the advice "+
			"is 'read the whole changelog':\n%s", out)
	}
	if after.LastVersion != version.Version {
		t.Errorf("the new version was not recorded: %q", after.LastVersion)
	}
	if after.LastVersionAt == "" {
		t.Error("no date recorded for the new version — the NEXT upgrade will have no 'since'")
	}
}

// ONCE, not on every command. A notice that repeats is a notice that gets
// filtered out, and this one has exactly one chance to be read.
func TestTheUpgradeNoticeDoesNotRepeat(t *testing.T) {
	pinVersion(t, "3.0.0")
	t.Setenv("BK_CONFIG_DIR", t.TempDir())
	cfg := &config.Config{Server: "https://example.test", LastVersion: "0.0.1", LastVersionAt: "2026-08-11"}
	if err := config.Save(cfg); err != nil {
		t.Fatal(err)
	}

	r, w, _ := os.Pipe()
	orig := os.Stderr
	os.Stderr = w
	maybeNotifyUpgrade() // records the new version
	maybeNotifyUpgrade() // must say nothing
	maybeNotifyUpgrade()
	os.Stderr = orig
	_ = w.Close()
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	_ = r.Close()

	if got := strings.Count(string(buf[:n]), "was upgraded"); got != 1 {
		t.Fatalf("the notice fired %d times, want exactly 1:\n%s", got, string(buf[:n]))
	}
}

// A FRESH INSTALL has missed nothing, so it must say nothing — but it must
// still REMEMBER, or the first real upgrade is silent too.
func TestAFreshInstallIsSilentButRemembers(t *testing.T) {
	pinVersion(t, "3.0.0")
	out, after := capture(t, nil) // no LastVersion

	if strings.Contains(out, "was upgraded") {
		t.Errorf("a fresh install was told it upgraded:\n%s", out)
	}
	if after.LastVersion == "" {
		t.Error("nothing was recorded, so the NEXT upgrade will also be silent")
	}
}

// A ROLLBACK is deliberate. The person who did it knows what they did, and
// telling them they "upgraded" to an older version is both wrong and noise.
func TestARollbackIsNotAnnouncedAsAnUpgrade(t *testing.T) {
	pinVersion(t, "3.0.0")
	out, after := capture(t, func(c *config.Config) {
		c.LastVersion = "999.0.0" // came down from a much newer build
		c.LastVersionAt = "2026-08-11"
	})

	if strings.Contains(out, "was upgraded") {
		t.Errorf("a rollback was announced as an upgrade:\n%s", out)
	}
	if after.LastVersion != version.Version {
		t.Errorf("the running version was not recorded on a rollback: %q", after.LastVersion)
	}
}
