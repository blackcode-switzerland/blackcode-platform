package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Labelling by NAME, which is what `bk issues label attach 189 urgent` and
// `bk issues issue edit 189 --label urgent` both do.
//
// The route has always accepted `{"name": …}` on POST — the CLI's id-only
// restriction was its own. DELETE has not: it takes a label id in the path, so a
// name has to be resolved first, and WHERE it is resolved is the property worth
// guarding. It resolves against the labels the ISSUE carries, not the
// workspace's: resolving against the wider set would let a name that exists in
// the workspace but not on this issue produce a DELETE for a label that was
// never attached — a success that changed nothing, which is the exact defect
// Todo/issues-app-feedback.md item 1b was about.

// stub returns a client pointed at a server that answers the issue-labels
// sub-resource and records what it was asked for.
func stub(t *testing.T, labels []Label) (*Client, *[]string) {
	t.Helper()
	var hits []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.Method+" "+r.URL.Path)
		switch {
		case r.Method == http.MethodGet:
			_ = json.NewEncoder(w).Encode(map[string]any{"data": labels})
		case r.Method == http.MethodPost:
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if name, ok := body["name"].(string); ok {
				hits = append(hits, "name="+name)
			}
			if _, ok := body["label_id"]; ok {
				hits = append(hits, "sent-an-id")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"attached": true})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"deleted": true})
		}
	}))
	t.Cleanup(srv.Close)
	// New(), not a struct literal — it is what sets HTTP, and a hand-built
	// Client nil-panics on the first request rather than failing an assertion.
	return New(srv.URL, "t", "acme"), &hits
}

// A name is sent as a NAME. If this ever posted an id, the "created on the fly"
// half would silently stop working and every new label would 400 instead.
func TestAttachByNameSendsTheName(t *testing.T) {
	c, hits := stub(t, nil)
	if err := c.AttachIssueLabelByName("acme", 189, "urgent"); err != nil {
		t.Fatalf("attach: %v", err)
	}
	if !contains(*hits, "name=urgent") {
		t.Fatalf("the name was not sent; the server saw: %v", *hits)
	}
	if contains(*hits, "sent-an-id") {
		t.Error("an id was sent alongside the name — the server would take the id and never create the label")
	}
}

// Detach resolves against the issue's own labels and deletes the matching id.
func TestDetachByNameResolvesAgainstTheIssue(t *testing.T) {
	c, hits := stub(t, []Label{{ID: 58, Name: "Urgent"}, {ID: 12, Name: "backend"}})
	// Case-insensitive, like the server's own matching.
	if err := c.DetachIssueLabelByName("acme", 189, "urgent"); err != nil {
		t.Fatalf("detach: %v", err)
	}
	if !contains(*hits, "DELETE /api/workspaces/acme/issues/189/labels/58") {
		t.Fatalf("did not delete label 58; the server saw: %v", *hits)
	}
}

// THE ONE THAT MATTERS. A name the issue does not carry must be an ERROR that
// names what it does carry — never a silent success, and never a DELETE.
//
// Without this the command would report "detached" for a label that was never
// attached, which is indistinguishable from the real thing.
func TestDetachByNameRefusesALabelTheIssueDoesNotHave(t *testing.T) {
	c, hits := stub(t, []Label{{ID: 12, Name: "backend"}})
	err := c.DetachIssueLabelByName("acme", 189, "urgent")
	if err == nil {
		t.Fatal("detaching an absent label succeeded — the caller is told something happened that did not")
	}
	if !strings.Contains(err.Error(), "backend") {
		t.Errorf("the error does not name what the issue DOES have, so there is nothing to act on: %v", err)
	}
	for _, h := range *hits {
		if strings.HasPrefix(h, "DELETE") {
			t.Errorf("a DELETE was sent for a label the issue does not carry: %s", h)
		}
	}
}

// The empty case gets its own message: "has no labels" is actionable in a way
// that "has no label X — it has: " is not.
func TestDetachByNameOnAnUnlabelledIssue(t *testing.T) {
	c, _ := stub(t, nil)
	err := c.DetachIssueLabelByName("acme", 189, "urgent")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "no labels") {
		t.Errorf("want the empty-issue wording, got: %v", err)
	}
}

func contains(hs []string, want string) bool {
	for _, h := range hs {
		if h == want {
			return true
		}
	}
	return false
}
