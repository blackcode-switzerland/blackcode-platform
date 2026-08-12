package appverbs

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

// THE INBOX IS GLOBAL BY DEFAULT AND `--ws` NARROWS IT.
//
// ---------------------------------------------------------------------------
// THE POSITIVE CASE FIRST, AND IT ASSERTS THE REQUEST
// ---------------------------------------------------------------------------
// CLAUDE.md finding #16: a check built on "was this refused?" cannot tell a
// working filter from one that never ran. And finding #21: a positive case has
// to assert the OUTCOME, not a side effect on the way to it. The outcome here is
// the QUERY STRING the server receives — not that ListInbox returned, not that
// a helper was called.
//
// This is the half that would have caught the bug: before 2026-08-12 the CLI
// sent `/api/me/inbox?limit=200` and nothing else, ever, while the route had
// always read `?workspace_id=`. Every existing test passed.
func TestInboxRequestCarriesTheWorkspaceFilter(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[],"unread_count":0}`))
	}))
	defer srv.Close()

	c := client.New(srv.URL, "token", "ws")
	if _, err := c.ListInbox(false, false, 42); err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if !strings.Contains(gotQuery, "workspace_id=42") {
		t.Fatalf("the request the server saw was %q — it does not scope to the workspace, "+
			"so `--ws` would be accepted and silently dropped", gotQuery)
	}

	// And the DEFAULT stays global (decision Q3): a caller who passed no
	// workspace must get every workspace, not the active one.
	gotQuery = ""
	if _, err := c.ListInbox(false, false, 0); err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if strings.Contains(gotQuery, "workspace_id") {
		t.Fatalf("an unscoped `inbox list` sent %q — the inbox is global by default, and one that "+
			"quietly showed a single workspace would hide the invitation that arrived from another",
			gotQuery)
	}
}

// A BARE ID COSTS NO REQUEST, AND NEITHER DOES THE COMMON CASE OF NO --ws.
// The nil client is the instrument: any call panics.
func TestInboxWorkspaceIDResolvesLocallyWhereItCan(t *testing.T) {
	t.Cleanup(func() { cmdutil.WSOverride = "" })

	cmdutil.WSOverride = ""
	if got, err := inboxWorkspaceID(nil); err != nil || got != 0 {
		t.Errorf("with no --ws: (%d, %v), want (0, nil) — the unscoped read must not "+
			"fetch a workspace list it has no use for", got, err)
	}

	cmdutil.WSOverride = "42"
	if got, err := inboxWorkspaceID(nil); err != nil || got != 42 {
		t.Errorf("with --ws 42: (%d, %v), want (42, nil)", got, err)
	}
}

// AN UNKNOWN SLUG MUST NOT FALL BACK TO THE GLOBAL LIST.
//
// This is the shape that would be invisible: a caller who names a workspace and
// receives 150 messages from every workspace has no way to see that the filter
// was dropped, and reads the noise as the answer.
func TestInboxWorkspaceIDRefusesAnUnknownSlug(t *testing.T) {
	t.Cleanup(func() { cmdutil.WSOverride = "" })
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":7,"name":"Acme","slug":"acme"}]}`))
	}))
	defer srv.Close()
	c := client.New(srv.URL, "token", "ws")

	// The positive half: a slug that exists resolves to its id.
	cmdutil.WSOverride = "acme"
	if got, err := inboxWorkspaceID(c); err != nil || got != 7 {
		t.Fatalf("--ws acme: (%d, %v), want (7, nil)", got, err)
	}

	cmdutil.WSOverride = "not-a-workspace"
	got, err := inboxWorkspaceID(c)
	if err == nil {
		t.Fatalf("--ws not-a-workspace resolved to %d with no error — the filter was dropped and "+
			"the caller would be shown every workspace as though it were the answer", got)
	}
	if !strings.Contains(err.Error(), "not-a-workspace") {
		t.Errorf("the error does not name the slug that failed: %v", err)
	}
}
