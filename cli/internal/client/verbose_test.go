package client

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// What `-v` / `BK_DEBUG=1` prints, and — the half that matters more — what it
// must never print.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE CREDENTIAL CASE IS THE POINT OF THIS FILE
// ═══════════════════════════════════════════════════════════════════════════
// `do` sets `Authorization: Bearer <token>` two lines above the verbose block.
// Verbose output goes into bug reports, CI logs and agent transcripts, so a
// debug flag that prints headers is a worse bug than anything it would help
// find — and it is a one-line change away at all times, because "print the
// headers too" is the obvious next thing anyone adds here.
//
// Both directions are asserted. A test that only checked "the body is printed"
// would pass just as happily against an implementation that dumped everything.
// ═══════════════════════════════════════════════════════════════════════════

// captureStderr runs fn with os.Stderr replaced by a pipe and returns what was
// written. The verbose logging writes to os.Stderr directly — deliberately, so
// stdout stays parseable — so this is the only way to see it.
func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	orig := os.Stderr
	os.Stderr = w
	done := make(chan string, 1)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	fn()
	os.Stderr = orig
	w.Close()
	out := <-done
	r.Close()
	return out
}

func verboseRun(t *testing.T, fn func(c *Client)) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	prev := Verbose
	Verbose = true
	t.Cleanup(func() { Verbose = prev })

	c := New(srv.URL, "bk_live_SECRETTOKENVALUE", "demo-ws")
	return captureStderr(t, func() { fn(c) })
}

func TestVerboseNeverPrintsTheBearerToken(t *testing.T) {
	out := verboseRun(t, func(c *Client) {
		var v map[string]any
		_ = c.postJSON("/api/anything", map[string]string{"title": "x"}, &v)
	})
	if out == "" {
		t.Fatal("captured nothing — the capture is broken, so nothing below means anything")
	}
	if strings.Contains(out, "bk_live_SECRETTOKENVALUE") {
		t.Errorf("verbose output contains the bearer token:\n%s", out)
	}
	if strings.Contains(strings.ToLower(out), "authorization") {
		t.Errorf("verbose output names the Authorization header:\n%s", out)
	}
}

// The positive case, asserted on the OUTPUT rather than on "something happened".
// The gap this closes is a 400 on a write whose payload was invisible.
func TestVerbosePrintsTheRequestBodyOfAWrite(t *testing.T) {
	out := verboseRun(t, func(c *Client) {
		var v map[string]any
		_ = c.patchJSON("/api/workspaces/demo-ws/issues/5", map[string]any{"title": "hello there"}, &v)
	})
	if !strings.Contains(out, `"title":"hello there"`) {
		t.Errorf("verbose output does not show what was sent:\n%s", out)
	}
	if !strings.Contains(out, "PATCH") {
		t.Errorf("verbose output does not name the method:\n%s", out)
	}
	// The response line carries a duration now. Assert the shape rather than a
	// number: a timing that is always absent reads exactly like a fast request.
	if !strings.Contains(out, "ms)") && !strings.Contains(out, "s)") {
		t.Errorf("verbose output has no timing on the response line:\n%s", out)
	}
}

// A GET has no body, and inventing a `body:` line for it would be noise that
// makes the real ones harder to spot.
func TestVerbosePrintsNoBodyLineForAGet(t *testing.T) {
	out := verboseRun(t, func(c *Client) {
		var v map[string]any
		_ = c.get("/api/me", &v)
	})
	if strings.Contains(out, "body:") {
		t.Errorf("verbose output invented a body line for a GET:\n%s", out)
	}
	if !strings.Contains(out, "→ GET") {
		t.Errorf("verbose output does not log the GET at all:\n%s", out)
	}
}

// An upload is a multipart body of arbitrary size. Describing it is useful;
// dumping it would bury the session in binary and could itself be what makes a
// failure unreadable.
func TestVerboseDescribesANonJSONBodyRatherThanDumpingIt(t *testing.T) {
	out := verboseRun(t, func(c *Client) {
		req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/upload",
			strings.NewReader("BINARYPAYLOADMARKER-not-json"))
		if err != nil {
			t.Fatalf("build request: %v", err)
		}
		req.Header.Set("Content-Type", "multipart/form-data; boundary=xyz")
		var v map[string]any
		_ = c.do(req, &v)
	})
	if strings.Contains(out, "BINARYPAYLOADMARKER") {
		t.Errorf("verbose output dumped a non-JSON body:\n%s", out)
	}
	if !strings.Contains(out, "multipart/form-data") || !strings.Contains(out, "not shown") {
		t.Errorf("verbose output does not describe the non-JSON body:\n%s", out)
	}
}

// And with Verbose off, none of it appears. Without this the whole feature could
// be printing on every run and every test above would still pass.
func TestQuietByDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	prev := Verbose
	Verbose = false
	defer func() { Verbose = prev }()

	c := New(srv.URL, "tok", "demo-ws")
	out := captureStderr(t, func() {
		var v map[string]any
		_ = c.postJSON("/api/anything", map[string]string{"title": "x"}, &v)
	})
	if strings.TrimSpace(out) != "" {
		t.Errorf("a non-verbose request wrote to stderr:\n%s", out)
	}
}
