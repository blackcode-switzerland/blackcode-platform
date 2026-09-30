package client

// Client methods for the entity index: search over `platform.entities`, and the
// reconciliation report.
//
// Search is workspace-scoped even though a URN already names its workspace. That
// is not redundancy for its own sake: the server decides which workspace the
// caller may act in, and treating the workspace segment of a caller-supplied
// string as an authorisation fact is how a read reaches across tenants.
//
// `ListLinks`, `CreateLink` and `DeleteLink` were here until 2026-08-12. They
// called `/api/workspaces/{ws}/links` for `bk link`, a command removed on
// 2026-08-10 whose route factory no app had mounted since. Cross-app references
// are not supported; the far end's URN goes in the record's own text, which is a
// string and needs no client method. `bk guide platform/cross-app`.

import (
	"fmt"
	"net/url"
	"strings"
)

type entityListEnvelope struct {
	Data []Entity `json:"data"`
}

// SearchEntities runs a federated search across every app's entities in the
// active workspace. `apps` and `types` are optional filters; empty means all.
func (c *Client) SearchEntities(query string, apps, types []string, limit int, includeDeleted bool) ([]Entity, error) {
	q := url.Values{}
	q.Set("q", query)
	if len(apps) > 0 {
		q.Set("app", strings.Join(apps, ","))
	}
	if len(types) > 0 {
		q.Set("type", strings.Join(types, ","))
	}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if includeDeleted {
		q.Set("include_deleted", "1")
	}
	path, err := c.wsPath("search")
	if err != nil {
		return nil, err
	}
	var env entityListEnvelope
	if err := c.get(path+"?"+q.Encode(), &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

// EntityDrift runs the reconciliation job. `repair` switches it from a read-only
// report to a repair — which, as the route's own comment says, should be read as
// a bug report rather than routine maintenance.
func (c *Client) EntityDrift(ws string, repair bool) (*EntityDriftReport, error) {
	q := url.Values{}
	if ws != "" {
		q.Set("ws", ws)
	}
	path := "/api/super-admin/entity-drift"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out EntityDriftReport
	if repair {
		if err := c.postJSON(path, nil, &out); err != nil {
			return nil, err
		}
		return &out, nil
	}
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BlobDrift checks the trigger-maintained `platform.blob_references` index
// against a live scan of the app's own tables. Same GET-reports / POST-repairs
// shape as EntityDrift.
func (c *Client) BlobDrift(ws string, repair bool) (*BlobDriftReport, error) {
	q := url.Values{}
	if ws != "" {
		q.Set("ws", ws)
	}
	path := "/api/super-admin/blob-drift"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out BlobDriftReport
	if repair {
		if err := c.postJSON(path, nil, &out); err != nil {
			return nil, err
		}
		return &out, nil
	}
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// WorkspaceSearchHit is one row of `bk issues search`: a record found INSIDE the
// issues app, with the snippet it was found in. Numbers and URNs are pointers
// because a label, a member and a comment's own row have neither.
type WorkspaceSearchHit struct {
	Type      string  `json:"type" yaml:"type"`
	ID        int     `json:"id" yaml:"id"`
	Number    *int    `json:"number" yaml:"number"`
	Title     string  `json:"title" yaml:"title"`
	Detail    *string `json:"detail" yaml:"detail"`
	Snippet   *string `json:"snippet" yaml:"snippet"`
	MatchedIn string  `json:"matched_in" yaml:"matched_in"`
	Status    *string `json:"status" yaml:"status"`
	Parent    *struct {
		Type   string `json:"type" yaml:"type"`
		Number int    `json:"number" yaml:"number"`
	} `json:"parent" yaml:"parent"`
	Path    string  `json:"path" yaml:"path"`
	URN     *string `json:"urn" yaml:"urn"`
	Deleted bool    `json:"deleted" yaml:"deleted"`
}

// IssuesSearch runs the issues app's own search over `…/issues-search`. It is a
// different route from SearchEntities on purpose — see that route's header.
func (c *Client) IssuesSearch(query string, types []string, perType, limit int, includeDeleted bool) ([]WorkspaceSearchHit, error) {
	q := url.Values{}
	q.Set("q", query)
	if len(types) > 0 {
		q.Set("type", strings.Join(types, ","))
	}
	if perType > 0 {
		q.Set("per_type", fmt.Sprint(perType))
	}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if includeDeleted {
		q.Set("include_deleted", "1")
	}
	path, err := c.wsPath("issues-search")
	if err != nil {
		return nil, err
	}
	var env struct {
		Data []WorkspaceSearchHit `json:"data"`
	}
	if err := c.get(path+"?"+q.Encode(), &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}
