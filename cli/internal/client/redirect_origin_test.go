package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A REDIRECT IS THE DEPLOYMENT NAMING ITS OWN CANONICAL ADDRESS.
//
// This is what lets a stale address book repair itself. Everyone who ran
// `bk login` before 2026-08-11 pinned `https://bc-issues.vercel.app` (the old
// default), and "reached wins" made it permanent — see
// commands/platform/registry_mismatch_test.go. Adopting the registry's declared
// address instead is not safe: a preview deployment's registry entry points at
// production, so it would redirect itself off the deployment the user is
// testing.
//
// A redirect distinguishes the two with no heuristic. The vanity domain
// answering for the project hostname 30x-es; a preview does not. Go follows
// redirects transparently, so `resp.Request.URL` is where the answer actually
// came from.

func resetRedirect(t *testing.T) {
	t.Helper()
	RedirectedOrigin = ""
	t.Cleanup(func() { RedirectedOrigin = "" })
}

// THE POSITIVE CASE, asserted first (CLAUDE.md finding #16): a redirect must be
// RECORDED, not merely "not crash".
func TestRedirectRecordsTheAnsweringOrigin(t *testing.T) {
	resetRedirect(t)

	canonical := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer canonical.Close()

	// The stale hostname, aliased over the canonical one.
	stale := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, canonical.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer stale.Close()

	c := New(stale.URL, "t", "acme")
	var out map[string]any
	if err := c.get("/api/me", &out); err != nil {
		t.Fatalf("get through the redirect: %v", err)
	}
	if RedirectedOrigin != canonical.URL {
		t.Fatalf("RedirectedOrigin = %q, want %q — without this the stale address "+
			"survives every `bk meta`, which is the bug", RedirectedOrigin, canonical.URL)
	}
}

// AND IT MUST NOT FIRE WHEN NOTHING REDIRECTED. This is the half that keeps a
// preview deployment and a self-hosted instance on the address the user
// authenticated against. A value here would move them silently.
func TestNoRedirectLeavesTheOriginEmpty(t *testing.T) {
	resetRedirect(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer srv.Close()

	c := New(srv.URL, "t", "acme")
	var out map[string]any
	if err := c.get("/api/me", &out); err != nil {
		t.Fatalf("get: %v", err)
	}
	if RedirectedOrigin != "" {
		t.Fatalf("RedirectedOrigin = %q after a request that did not redirect — a "+
			"preview deployment would be moved to production on the strength of nothing",
			RedirectedOrigin)
	}
}

// A redirect that stays on the SAME origin — http→https, a trailing slash, a
// path rewrite — is not a change of address and must not be recorded as one.
func TestSameOriginRedirectIsNotAnAddressChange(t *testing.T) {
	resetRedirect(t)

	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/me" {
			http.Redirect(w, r, srv.URL+"/api/me/", http.StatusTemporaryRedirect)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer srv.Close()

	c := New(srv.URL, "t", "acme")
	var out map[string]any
	if err := c.get("/api/me", &out); err != nil {
		t.Fatalf("get: %v", err)
	}
	if RedirectedOrigin != "" {
		t.Fatalf("a same-origin redirect was recorded as an address change: %q", RedirectedOrigin)
	}
}
