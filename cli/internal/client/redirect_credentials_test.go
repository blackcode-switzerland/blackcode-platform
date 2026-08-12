package client

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// CREDENTIALS ACROSS OUR OWN REDIRECT — the outage of 2026-08-12.
//
// `net/http` strips `Authorization` when a redirect crosses to a different
// domain. The day a redirect was put on the platform's old hostname, every user
// whose config still named it lost every authenticated command at once:
//
//	redirect #1 -> https://issues.blackcode.ch/api/me
//	Authorization on the FOLLOW-UP request: ""
//	final status: 401 Unauthorized
//
// Including `bk login`, whose token check is an authenticated GET — so the one
// command that repairs the config could not complete, and the self-healing
// address book could never fire.
//
// `doFollowingOurOwnRedirect` follows redirects itself and carries credentials
// across exactly ONE cross-origin hop. These tests are the fence around that:
// the positive case first, because a guard built only on refusals cannot tell a
// working carry from one that never sends anything.

// twoHosts builds a "canonical" server that reports what it received, and an
// "old" server that redirects everything to it. Both are httptest origins, so a
// redirect between them is genuinely cross-origin.
func twoHosts(t *testing.T, status int) (old *httptest.Server, canonical *httptest.Server, seen *[]string) {
	t.Helper()
	var got []string
	canonical = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got = append(got, r.Method+" auth="+r.Header.Get("Authorization")+" body="+string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	old = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, canonical.URL+r.URL.Path, status)
	}))
	t.Cleanup(func() { old.Close(); canonical.Close() })
	return old, canonical, &got
}

// THE POSITIVE CASE. Without this, every "did not carry" assertion below would
// also pass against a client that sent nothing at all.
func TestTokenSurvivesOneCrossOriginRedirect(t *testing.T) {
	resetRedirect(t)
	old, _, seen := twoHosts(t, http.StatusTemporaryRedirect)

	c := New(old.URL, "bk_live_secret", "acme")
	var out map[string]any
	if err := c.get("/api/me", &out); err != nil {
		t.Fatalf("get across the redirect: %v", err)
	}
	if len(*seen) != 1 {
		t.Fatalf("canonical host saw %d requests, want 1: %v", len(*seen), *seen)
	}
	if !strings.Contains((*seen)[0], "auth=Bearer bk_live_secret") {
		t.Fatalf("the token did not survive the redirect — this is the 401 outage:\n  %s", (*seen)[0])
	}
}

// The address book still learns the canonical origin, which is what makes the
// repair permanent rather than per-command.
func TestTheRedirectTargetIsStillRecorded(t *testing.T) {
	resetRedirect(t)
	old, canonical, _ := twoHosts(t, http.StatusTemporaryRedirect)

	c := New(old.URL, "bk_live_secret", "acme")
	var out map[string]any
	_ = c.get("/api/me", &out)
	if RedirectedOrigin != canonical.URL {
		t.Fatalf("RedirectedOrigin = %q, want %q — without it the config is never "+
			"repaired and every command pays the extra hop", RedirectedOrigin, canonical.URL)
	}
}

// A POST must arrive as a POST, with its body. A naive re-issue loses one or
// both, and the server answers a confusing 400 instead of doing the write.
func TestAPostKeepsItsMethodAndBodyAcrossTheRedirect(t *testing.T) {
	resetRedirect(t)
	old, _, seen := twoHosts(t, http.StatusTemporaryRedirect)

	c := New(old.URL, "bk_live_secret", "acme")
	var out map[string]any
	if err := c.postJSON("/api/things", map[string]string{"name": "widget"}, &out); err != nil {
		t.Fatalf("post across the redirect: %v", err)
	}
	if len(*seen) != 1 {
		t.Fatalf("canonical host saw %d requests: %v", len(*seen), *seen)
	}
	if !strings.HasPrefix((*seen)[0], "POST ") {
		t.Errorf("method was not preserved: %s", (*seen)[0])
	}
	if !strings.Contains((*seen)[0], `"name":"widget"`) {
		t.Errorf("body was not replayed: %s", (*seen)[0])
	}
}

// THE LIMIT THAT MATTERS. https -> http is a downgrade, and there is no benign
// version of putting a bearer token on it.
//
// The source must genuinely be https for this to test anything, so it is a TLS
// httptest server and the client is given that server's trusted transport. The
// first version of this test used two plain-http servers and asserted the token
// was refused — which passed only because the code then demanded https on the
// TARGET, a rule that also broke every local dev server. The test was
// asserting a bug.
func TestTokenIsNOTCarriedToAnHTTPDowngrade(t *testing.T) {
	resetRedirect(t)
	var got []string
	insecure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = append(got, r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer insecure.Close()

	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, insecure.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer secure.Close()

	c := New(secure.URL, "bk_live_secret", "acme")
	// The TLS server's own client trusts its certificate; keep New()'s policy
	// of never auto-following, since that is what the code under test relies on.
	c.HTTP = secure.Client()
	c.HTTP.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	var out map[string]any
	_ = c.get("/api/me", &out)

	if len(got) != 1 {
		t.Fatalf("the downgraded host saw %d requests, want 1", len(got))
	}
	if got[0] != "" {
		t.Fatalf("the token was sent across https -> http — a downgrade must never "+
			"carry credentials, got %q", got[0])
	}
}

// A chain must not walk the token somewhere unrelated: one credentialed
// cross-origin hop, then the token is dropped exactly as Go would drop it.
func TestOnlyOneCrossOriginHopCarriesTheToken(t *testing.T) {
	resetRedirect(t)
	var third []string
	c3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		third = append(third, r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer c3.Close()
	c2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, c3.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer c2.Close()
	c1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, c2.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer c1.Close()

	c := New(c1.URL, "bk_live_secret", "acme")
	var out map[string]any
	_ = c.get("/api/me", &out)

	if len(third) != 1 {
		t.Fatalf("the third host saw %d requests, want 1", len(third))
	}
	if third[0] != "" {
		t.Fatalf("the token was walked across TWO cross-origin hops, got %q", third[0])
	}
}
