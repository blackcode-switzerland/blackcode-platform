package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
)

// LatestSeen and MinSeen capture the most recent values of the
// X-BK-CLI-Latest / X-BK-CLI-Min response headers the API sends on every
// response. main.go reads them after Execute() to print the soft update
// notice; the hard floor is enforced in do() via OutdatedError.
var (
	LatestSeen string
	MinSeen    string
	// RedirectedOrigin is the origin that ANSWERED, when redirects moved the
	// request off the origin we asked for — e.g. asking
	// `https://bc-issues.vercel.app` and being served by
	// `https://issues.blackcode.ch`. Empty when nothing redirected, which is the
	// normal case. See the comment in do() for why this, and not the registry,
	// is the signal safe to act on without asking.
	RedirectedOrigin string
)

// originOf reduces a URL to scheme://host, the unit an address book stores.
func originOf(u *url.URL) string {
	if u == nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

// Verbose, when true (set by the root --verbose flag or BK_DEBUG=1), makes every
// request log its method, URL, status, and response body to stderr. Useful when
// the CLI's view of the data disagrees with reality and you'd otherwise reach
// for curl.
var Verbose bool

// blobAPIVersion is Vercel Blob's client-upload wire-protocol version, sent as
// the x-api-version header on the direct PUT in uploadViaBlob. The JS SDK
// (@vercel/blob) tracks this internally and bumps it when Vercel changes the
// protocol; the Go CLI can't use that SDK, so we pin it here. If Vercel retires
// this version, the direct PUT starts failing with a 4xx — bump this to match
// the value the current @vercel/blob release sends (grep its source for
// BLOB_API_VERSION) and ship a new CLI. This is the ONE place to change.
const blobAPIVersion = "7"

// OutdatedError is returned by every request when the running CLI version is
// below the minimum version the API still supports (X-BK-CLI-Min). Commands
// fail fast with this so the user is forced to upgrade.
type OutdatedError struct{ Current, Min string }

func (e *OutdatedError) Error() string {
	return fmt.Sprintf("bk %s is below the minimum supported version %s", e.Current, e.Min)
}

// UnreachableError is a transport failure against a KNOWN address: the registry
// gave us a URL and nothing answered there.
//
// It is a distinct type because the recovery is distinct. A 404 means the server
// disagrees about the resource; this means we may be talking to the wrong host
// entirely, and the fix is `bk meta` (refresh the registry) or `bk login
// --server <url>` — which cmd/bk/main.go's hintFor() prints. Before D-1 there
// was one configured server and "connection refused" was self-explanatory; with
// a learned per-app registry it is not.
type UnreachableError struct {
	App     string
	BaseURL string
	Err     error
}

func (e *UnreachableError) Error() string {
	who := "the server"
	if e.App != "" {
		who = "the " + e.App + " app"
	}
	return fmt.Sprintf("cannot reach %s at %s: %v", who, e.BaseURL, e.Err)
}

func (e *UnreachableError) Unwrap() error { return e.Err }

// NotServedError is a 4xx whose body is NOT the API's JSON envelope — in
// practice, a deployment that has no route file at that path and let the web
// framework render its 404 page.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A TYPE AND NOT JUST A BETTER STRING
// ---------------------------------------------------------------------------
// Before it existed, `do` set the error message to the whole response body. For
// a JSON error that is right. For a Next.js 404 it meant **thirty lines of HTML
// on stderr**, breaking the one contract the CLI has for failures: "every
// failure is a non-zero exit with one line on stderr". `bk workspace list`
// against a host that did not mount that route printed a document.
//
// And the recovery is specific, which is the real reason for a type. An app
// serving a SUBSET of the platform surface is a permanent, legitimate state
// (D-36) — so "this host does not serve that" is not a bug report, it is a
// routing fact with a one-flag fix. `cmd/bk/main.go`'s hintFor() turns it into
// the flag, because that is where the command name is known and here it is not.
type NotServedError struct {
	// The app slug whose deployment answered, or "" for the home server.
	App     string
	BaseURL string
	Path    string
	Status  int
}

func (e *NotServedError) Error() string {
	who := "this deployment"
	if e.App != "" {
		who = "the " + e.App + " app"
	}
	if e.Status == 404 {
		return fmt.Sprintf("%s does not serve %s (404)", who, e.Path)
	}
	return fmt.Sprintf("%s answered %d for %s with a non-JSON body", who, e.Status, e.Path)
}

type APIError struct {
	Status     int
	ErrorMsg   string `json:"error"`
	Suggestion string `json:"suggestion,omitempty"`
	Details    string `json:"details,omitempty"`
}

// Error states WHAT failed. It deliberately does not include Suggestion, which
// says what to do about it.
//
// Suggestion used to be appended here as well, and main.go also prints it as the
// `hint:` line — so every server suggestion reached stderr twice:
//
//	error: you do not have access to the issues app here (403) — ask a workspace owner to grant you access
//	hint: ask a workspace owner to grant you access
//
// That is exactly the double-print SilenceErrors was added to root.go to stop,
// on the one channel agents parse. Phase 4 turned it from an edge case into
// routine traffic (app_access_denied is expected now), which is what surfaced
// it.
//
// One fact, one line, one owner: this method owns `error:`, hintFor() in
// cmd/bk/main.go owns `hint:`. Details stays because it is part of what failed
// (a field-level validation reason), not advice.
func (e *APIError) Error() string {
	if e.Details != "" {
		return fmt.Sprintf("%s (%d): %s", e.ErrorMsg, e.Status, e.Details)
	}
	return fmt.Sprintf("%s (%d)", e.ErrorMsg, e.Status)
}

type Client struct {
	BaseURL string
	// App is the app slug this client is talking to — "" for the home server
	// with no app lens. It exists so a transport failure can name WHOSE address
	// was wrong (see UnreachableError); nothing about the request itself
	// depends on it.
	App   string
	Token string
	// WorkspaceSlug is the active workspace slug from config, used to build
	// canonical /api/workspaces/{slug}/... routes.
	WorkspaceSlug string
	HTTP          *http.Client
}

func New(baseURL, token, workspaceSlug string) *Client {
	return &Client{
		BaseURL:       strings.TrimRight(baseURL, "/"),
		Token:         token,
		WorkspaceSlug: workspaceSlug,
		// NEVER auto-follow. Go's own policy strips `Authorization` across a
		// domain, which turns a deployment's canonical-host redirect into a 401
		// on every authenticated command — see doFollowingOurOwnRedirect, which
		// does the following instead and can carry credentials one hop.
		HTTP: &http.Client{
			Timeout:       30 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// wsPath builds a workspace-scoped path of the form
// /api/workspaces/{slug}/{suffix}. The suffix should NOT include a leading
// slash for the workspace segment; e.g. wsPath("issues") ->
// /api/workspaces/acme/issues. Returns an error if no active workspace is set.
func (c *Client) wsPath(suffix string) (string, error) {
	if c.WorkspaceSlug == "" {
		return "", fmt.Errorf("no active workspace; run `bk <app> workspace use <slug>`")
	}
	suffix = strings.TrimPrefix(suffix, "/")
	if suffix == "" {
		return "/api/workspaces/" + c.WorkspaceSlug, nil
	}
	return "/api/workspaces/" + c.WorkspaceSlug + "/" + suffix, nil
}

// doFollowingOurOwnRedirect performs the request and follows redirects ITSELF,
// carrying credentials across exactly one cross-origin hop.
//
// ---------------------------------------------------------------------------
// WHY: GO DROPS THE BEARER TOKEN ON A CROSS-DOMAIN REDIRECT, SILENTLY
// ---------------------------------------------------------------------------
// `net/http` strips `Authorization` when a redirect crosses to a different
// domain. That is correct default behaviour — but it means a deployment that
// redirects its old hostname to its canonical one turns EVERY authenticated
// command into a 401, with nothing on screen connecting the two.
//
// MEASURED 2026-08-12 against production, the day a redirect was put on the old
// hostname:
//
//	redirect #1 -> https://issues.blackcode.ch/api/me
//	Authorization on the FOLLOW-UP request: ""
//	final status: 401 Unauthorized
//
// Every user whose config still named the old host lost every authenticated
// command at once — INCLUDING `bk login`, whose token check is an authenticated
// GET, so the one command that repairs the config could not complete. A
// self-healing address book is worth nothing when the request that heals it is
// the one being refused.
//
// ---------------------------------------------------------------------------
// WHY RE-ATTACHING THE TOKEN IS SAFE HERE, AND WHERE THE LINE IS
// ---------------------------------------------------------------------------
// We already trust the host we asked: it receives this token on every request.
// A redirect from it is that host DELEGATING to another address — the same
// signal `RedirectedOrigin` already treats as authoritative for the address
// book. Honouring it with credentials is the same trust decision, made once.
//
// Four limits, because "resend the token wherever you are told" is a
// credential-leak primitive:
//
//   - **Never a downgrade.** https -> http is followed WITHOUT credentials.
//     (Not "https only": a local dev server is plain http, and http -> http
//     exposes nothing a listener could not already read.)
//   - **One credentialed cross-origin hop.** After it, a further cross-origin
//     redirect drops the token again, exactly as Go would.
//   - **Same method and body**, replayed from `GetBody`, so a POST is not
//     silently downgraded to a GET.
//   - A same-origin redirect is followed normally; nothing was stripped.
func (c *Client) doFollowingOurOwnRedirect(req *http.Request) (*http.Response, error) {
	const maxHops = 5
	credentialedHopUsed := false

	for hop := 0; ; hop++ {
		resp, err := c.HTTP.Do(req)
		if err != nil || resp.StatusCode < 300 || resp.StatusCode > 399 {
			return resp, err
		}
		loc := resp.Header.Get("Location")
		if loc == "" || hop >= maxHops {
			return resp, nil
		}
		target, perr := req.URL.Parse(loc)
		if perr != nil {
			return resp, nil
		}

		sameOrigin := strings.EqualFold(originOf(target), originOf(req.URL))
		// The address book learns from this even when we do not carry the token
		// across — it is the deployment naming itself either way.
		if !sameOrigin && originOf(target) != "" {
			RedirectedOrigin = originOf(target)
		}

		// NEVER DOWNGRADE. The rule is not "https only" — it is "not less secure
		// than we already were". A first version demanded https on the target
		// and its own positive test could not pass, because a local dev server
		// is plain http and an http->http redirect strips nothing a listener
		// could not already read. What must never happen is https -> http.
		downgrade := strings.EqualFold(req.URL.Scheme, "https") && !strings.EqualFold(target.Scheme, "https")
		carry := sameOrigin ||
			(c.Token != "" && !downgrade && !credentialedHopUsed)
		if !sameOrigin && carry {
			credentialedHopUsed = true
			if Verbose {
				fmt.Fprintf(os.Stderr, "· %s redirected to %s — re-issuing with credentials\n",
					originOf(req.URL), originOf(target))
			}
		}

		var body io.ReadCloser
		if req.GetBody != nil {
			if body, err = req.GetBody(); err != nil {
				return resp, nil
			}
		}
		next, rerr := http.NewRequest(req.Method, target.String(), body)
		if rerr != nil {
			return resp, nil
		}
		next.Header = req.Header.Clone()
		if !carry {
			next.Header.Del("Authorization")
			next.Header.Del("Cookie")
		}
		_ = resp.Body.Close()
		req = next
	}
}

func (c *Client) do(req *http.Request, out any) error {
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "bk-cli/"+version.Version)

	if Verbose {
		fmt.Fprintf(os.Stderr, "→ %s %s\n", req.Method, req.URL.String())
		logRequestBody(req)
	}

	started := time.Now()
	resp, err := c.doFollowingOurOwnRedirect(req)
	elapsed := time.Since(started)
	if err != nil {
		// A dial/TLS/DNS failure, not an API answer. Since 2.0.0 the address
		// came out of the app registry rather than a single configured server,
		// so "connection refused" alone leaves the caller unable to tell a dead
		// deployment from a stale registry entry. Name both.
		return &UnreachableError{App: c.App, BaseURL: c.BaseURL, Err: err}
	}
	defer resp.Body.Close()

	// Record the version headers the API sends on every response. Header.Get
	// is case-insensitive, so the canonical/non-canonical casing both work.
	if v := resp.Header.Get("X-BK-CLI-Latest"); v != "" {
		LatestSeen = v
	}
	if v := resp.Header.Get("X-BK-CLI-Min"); v != "" {
		MinSeen = v
	}
	// A REDIRECT IS THE DEPLOYMENT NAMING ITS OWN CANONICAL ADDRESS.
	//
	// Go follows redirects transparently, so `resp.Request` is the request that
	// actually got answered. When its origin differs from the one we asked for,
	// the host we asked has told us where it really lives — and unlike the
	// registry's `base_url`, which is a database column about somebody else,
	// this came from the host that just served this token.
	//
	// That distinction is what makes it safe to adopt automatically:
	//   - a vanity domain aliased over a project hostname REDIRECTS, so the
	//     canonical address is learned without anyone typing it
	//   - a preview deployment or a self-hosted instance does NOT redirect, so
	//     it keeps the address the user authenticated against
	//
	// Recorded, not acted on here: `bk login` and `bk meta` are where the
	// address book is written. See applyAppRegistry.
	// (Recorded inside doFollowingOurOwnRedirect, which is the only thing that
	// sees a 3xx now that the transport no longer follows them itself.)
	// Hard floor: if we're below the minimum supported version, refuse the
	// request outcome so every command fails fast and the user must upgrade.
	if version.Parsable(version.Version) && MinSeen != "" && version.Less(version.Version, MinSeen) {
		return &OutdatedError{Current: version.Version, Min: MinSeen}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if Verbose {
		fmt.Fprintf(os.Stderr, "← %d %s (%d bytes, %s)\n",
			resp.StatusCode, http.StatusText(resp.StatusCode), len(body), elapsed.Round(time.Millisecond))
		// A REDIRECT IS INVISIBLE OTHERWISE. Go follows it transparently, so a
		// command answered by a host nobody named looks identical to one answered
		// by the host in the config — and the address is sticky (see the block
		// above). Under -v it is the difference between "why is this 404" and
		// "because you are talking to a different deployment".
		if RedirectedOrigin != "" && !strings.EqualFold(RedirectedOrigin, originOf(req.URL)) {
			fmt.Fprintf(os.Stderr, "  redirected to %s — that host is now the canonical address for this app\n",
				RedirectedOrigin)
		}
		if len(body) > 0 {
			fmt.Fprintf(os.Stderr, "  %s\n", truncate(string(body), 2000))
		}
	}

	if resp.StatusCode >= 400 {
		var ae APIError
		decoded := json.Unmarshal(body, &ae) == nil
		ae.Status = resp.StatusCode

		// A body that is not the API's JSON envelope did not come from
		// `apiHandler` — it is the web framework's error page, i.e. this
		// deployment has no route file here. Pasting it into the message put a
		// whole HTML document on stderr; see NotServedError.
		if !decoded || ae.ErrorMsg == "" {
			if !decoded || looksLikeMarkup(body) {
				return &NotServedError{
					App:     c.App,
					BaseURL: c.BaseURL,
					Path:    req.URL.Path,
					Status:  resp.StatusCode,
				}
			}
			ae.ErrorMsg = strings.TrimSpace(string(body))
			if ae.ErrorMsg == "" {
				ae.ErrorMsg = http.StatusText(resp.StatusCode)
			}
		}
		return &ae
	}

	if out == nil {
		return nil
	}
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode response: %w (body=%q)", err, truncate(string(body), 200))
	}
	return nil
}

// logRequestBody prints what a write command actually SENT.
//
// ---------------------------------------------------------------------------
// THE GAP THIS CLOSES (issue #10, the `--verbose` audit)
// ---------------------------------------------------------------------------
// -v logged the request LINE and the whole response, and nothing in between. So
// the single most common debugging question — "a 400 on `issue edit`; what did
// it send?" — was the one thing -v could not answer, and the caller was left
// re-deriving the payload from flag parsing by eye.
//
// Two things it deliberately does NOT do:
//
//   - **Headers are never printed.** The Authorization header is set two lines
//     above this and carries the bearer token. -v output goes into bug reports
//     and CI logs, and a debug flag that leaks a credential is a worse bug than
//     any it helps find. There is no --verbose level that turns this on.
//   - **Non-JSON bodies are described, not dumped.** An upload is a multipart
//     body of arbitrary size; printing it would bury the session in binary and
//     could itself be what makes a failure unreadable.
func logRequestBody(req *http.Request) {
	if req.Body == nil || req.GetBody == nil {
		return
	}
	ct := req.Header.Get("Content-Type")
	if ct != "" && !strings.HasPrefix(ct, "application/json") {
		fmt.Fprintf(os.Stderr, "  body: %s, %d bytes (not shown)\n", ct, req.ContentLength)
		return
	}
	rc, err := req.GetBody()
	if err != nil {
		return
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, 4096))
	if err != nil || len(bytes.TrimSpace(b)) == 0 {
		return
	}
	fmt.Fprintf(os.Stderr, "  body: %s\n", truncate(strings.TrimSpace(string(b)), 2000))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) postJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) patchJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodPatch, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

// ----- public methods -----

func (c *Client) Whoami() (*Me, error) {
	var me Me
	if err := c.get("/api/me", &me); err != nil {
		return nil, err
	}
	return &me, nil
}

// Meta fetches GET /api/meta (the agent bootstrap: identity, active workspace,
// the full workspaces list, and the enum vocabulary). When ws is non-empty it
// is passed as ?ws=<slug|id> to preview that workspace's context without
// changing the active one.
func (c *Client) Meta(ws string) (*Meta, error) {
	path := "/api/meta"
	if strings.TrimSpace(ws) != "" {
		path += "?ws=" + url.QueryEscape(ws)
	}
	var raw json.RawMessage
	if err := c.get(path, &raw); err != nil {
		return nil, err
	}
	var m Meta
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	m.Raw = raw
	return &m, nil
}

// Changelog fetches GET /api/changelog — the dated change log, newest first.
// Public (no workspace needed); auth is sent if present. For how the CLI WORKS
// rather than what changed, see internal/guide (`bk guide`).
func (c *Client) Changelog(app string) (*Changelog, error) {
	path := "/api/changelog"
	if a := strings.TrimSpace(app); a != "" {
		path += "?app=" + url.QueryEscape(a)
	}
	var cl Changelog
	if err := c.get(path, &cl); err != nil {
		return nil, err
	}
	return &cl, nil
}

func (c *Client) ListProjects(search string) ([]Project, error) {
	path, err := c.wsPath("projects")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(search) != "" {
		path += "?search=" + url.QueryEscape(search)
	}
	var page ProjectsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return page.Data, nil
}

func (c *Client) GetProject(id int) (*Project, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.get(path, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) ListIssues(opts ListIssuesOpts) (*IssuesPage, error) {
	path, err := c.wsPath("issues")
	if err != nil {
		return nil, err
	}
	if q := IssuesQuery(opts); len(q) > 0 {
		path += "?" + q.Encode()
	}

	var page IssuesPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

// ListIssuesOpts is what the SERVER filters on, and every field here reaches the
// query string — `IssuesQuery` below is the whole of that translation and is
// tested directly.
//
// ---------------------------------------------------------------------------
// THIS STRUCT IS A CLAIM ABOUT THE REQUEST, AND IT HAS BEEN WRONG BEFORE
// ---------------------------------------------------------------------------
// It carried a `Status` field that nothing ever set and `ListIssues` never sent.
// Read from here, `--status` looked server-side; it was applied locally after
// every issue in the workspace had been fetched. The field was deleted on
// 2026-08-12 with a guard pinning the absence.
//
// On 2026-08-12 the filters MOVED — the route had accepted `status`,
// `assignee_id`, `priority` and `task_id` the whole time, so the client was the
// only thing standing between the flag and the server. The guard was inverted
// with them: it now asserts these fields are PRESENT and that each one lands in
// the query string, so the reverse regression (a field added, never sent) cannot
// come back quietly. See `cli/internal/client/issues_query_test.go` and
// `cli/internal/commands/issues/serverside_filters_test.go`.
type ListIssuesOpts struct {
	ProjectID int
	Search    string
	// Status is a single issue status. Empty = no filter.
	Status string
	// AssigneeIDs filters to issues assigned to any of these users.
	AssigneeIDs []int
	// Unassigned asks for issues with NO assignee. It is a separate field rather
	// than a sentinel in AssigneeIDs because "nobody" and "no filter" are
	// different requests and an empty slice already means the second.
	Unassigned bool
	// Priority is the stored 1-5 value. 0 = no filter.
	Priority int
	// TaskID is the task's #number. 0 = no filter.
	TaskID int
	// Labels are label NAMES; several are an OR on the server.
	Labels []string
	// DueBefore is YYYY-MM-DD and is INCLUSIVE on the server.
	DueBefore string
}

// IssuesQuery is the opts → query-string translation, split out from ListIssues
// so it can be asserted without a server.
//
// A filter that is dropped here fails in the direction nobody notices: the
// request succeeds, the server applies no such filter, and the caller reads a
// wider answer as the answer to their narrower question.
func IssuesQuery(opts ListIssuesOpts) url.Values {
	q := url.Values{}
	if opts.ProjectID > 0 {
		q.Set("project_id", fmt.Sprint(opts.ProjectID))
	}
	if opts.TaskID > 0 {
		q.Set("task_id", fmt.Sprint(opts.TaskID))
	}
	if strings.TrimSpace(opts.Search) != "" {
		q.Set("search", opts.Search)
	}
	if s := strings.TrimSpace(opts.Status); s != "" {
		q.Set("status", s)
	}
	if opts.Priority > 0 {
		q.Set("priority", fmt.Sprint(opts.Priority))
	}
	if opts.Unassigned {
		q.Set("assignee_id", "null")
	} else {
		for _, id := range opts.AssigneeIDs {
			q.Add("assignee_ids", fmt.Sprint(id))
		}
	}
	for _, name := range opts.Labels {
		if n := strings.TrimSpace(name); n != "" {
			q.Add("label", n)
		}
	}
	if d := strings.TrimSpace(opts.DueBefore); d != "" {
		q.Set("due_before", d)
	}
	return q
}

func (c *Client) ListUsers() ([]User, error) {
	var users []User
	if err := c.get("/api/users", &users); err != nil {
		return nil, err
	}
	return users, nil
}

func (c *Client) ListProjectMembers(projectID int) ([]ProjectMember, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return nil, err
	}
	var env projectMembersEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueComments(issueID int) ([]Comment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/comments", issueID))
	if err != nil {
		return nil, err
	}
	var env commentsEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueActivity(issueID int) ([]ActivityItem, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/activity", issueID))
	if err != nil {
		return nil, err
	}
	var env activityEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueAttachments(issueID int) ([]Attachment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments", issueID))
	if err != nil {
		return nil, err
	}
	var env attachmentsEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListTasks(projectID int, search string) ([]Task, error) {
	path, err := c.wsPath("tasks")
	if err != nil {
		return nil, err
	}
	q := url.Values{}
	if projectID > 0 {
		q.Set("project_id", fmt.Sprint(projectID))
	}
	if strings.TrimSpace(search) != "" {
		q.Set("search", search)
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var env tasksEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) GetTask(id int, includeIssues bool) (*Task, error) {
	path, err := c.wsPath(fmt.Sprintf("tasks/%d", id))
	if err != nil {
		return nil, err
	}
	if includeIssues {
		path += "?includeIssues=true"
	}
	var m Task
	if err := c.get(path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Activity returns the workspace-scoped activity feed. The scoped route is
// keyset-paginated (cursor = last event id seen); pass cursor=nil for the first
// page. It returns the page of items plus the next cursor (nil when exhausted).
func (c *Client) Activity(limit int, cursor *int, since, apps, subject string) ([]ActivityFeedItem, *int, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if cursor != nil {
		q.Set("cursor", fmt.Sprint(*cursor))
	}
	// Phase 6 filters. Sent only when set, so the request an old flag-free
	// invocation produces is byte-for-byte what it was before.
	if since != "" {
		q.Set("since", since)
	}
	if apps != "" {
		q.Set("app", apps)
	}
	if subject != "" {
		q.Set("subject_urn", subject)
	}
	path, err := c.wsPath("activity")
	if err != nil {
		return nil, nil, err
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var env activityFeedEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, nil, err
	}
	return env.Data, env.NextCursor, nil
}

// AnalyticsRaw fetches the workspace-scoped analytics payload as raw JSON. The
// scoped route reads the workspace from the path, so any `ws`/`workspace` value
// in q is consumed as the target slug (and removed from the query); otherwise
// the active workspace is used.
func (c *Client) AnalyticsRaw(q url.Values) (json.RawMessage, error) {
	slug := ""
	if v := q.Get("ws"); v != "" {
		slug = v
	} else if v := q.Get("workspace"); v != "" {
		slug = v
	}
	q.Del("ws")
	q.Del("workspace")

	var path string
	var err error
	if slug != "" {
		path = "/api/workspaces/" + slug + "/analytics"
	} else {
		path, err = c.wsPath("analytics")
		if err != nil {
			return nil, err
		}
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var raw json.RawMessage
	if err := c.get(path, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// ----- write methods -----

func (c *Client) deleteJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodDelete, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) CreateProject(req CreateProjectRequest) (*Project, error) {
	path, err := c.wsPath("projects")
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.postJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) UpdateProject(id int, req UpdateProjectRequest) (*Project, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.patchJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteProject moves a project to the recycle bin. mode is "cascade" (also bin
// the attached issues/tasks) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteProject(id int, mode string) error {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return err
	}
	if mode != "" {
		path += "?mode=" + mode
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) AddProjectMember(projectID int, req AddMemberRequest) (*ProjectMember, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return nil, err
	}
	var m ProjectMember
	if err := c.postJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) RemoveProjectMember(projectID, userID int) error {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return err
	}
	body := map[string]any{"user_id": userID}
	return c.deleteJSON(path, body, nil)
}

func (c *Client) DeleteIssue(id int) error {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return err
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) CreateComment(issueID int, req CreateCommentRequest) (*Comment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/comments", issueID))
	if err != nil {
		return nil, err
	}
	var cm Comment
	if err := c.postJSON(path, req, &cm); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) DeleteAttachment(issueID, attachmentID int) error {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments/%d", issueID, attachmentID))
	if err != nil {
		return err
	}
	return c.deleteJSON(path, nil, nil)
}

// --- Storage (owner-only) ---

// ListStorage returns every uploaded file in the active workspace with its live
// references and the workspace's total usage. A non-empty app filters to that
// app's files; usage is always the workspace-wide total.
func (c *Client) ListStorage(app string) (*StorageListing, error) {
	path, err := c.wsPath("storage")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(app) != "" {
		q := url.Values{}
		q.Set("app", app)
		path += "?" + q.Encode()
	}
	var out StorageListing
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteStorageFile permanently removes an orphaned file (refused by the server
// with 409 if anything still references it).
func (c *Client) DeleteStorageFile(id int) error {
	path, err := c.wsPath(fmt.Sprintf("storage/%d", id))
	if err != nil {
		return err
	}
	return c.deleteJSON(path, nil, nil)
}

// ListWorkspaceAttachments returns the owner-only workspace-wide attachments view.
func (c *Client) ListWorkspaceAttachments() ([]WorkspaceAttachment, error) {
	path, err := c.wsPath("attachments")
	if err != nil {
		return nil, err
	}
	var env workspaceAttachmentsEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) CreateTask(req CreateTaskRequest) (*Task, error) {
	path, err := c.wsPath("tasks")
	if err != nil {
		return nil, err
	}
	var m Task
	if err := c.postJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) UpdateTask(id int, req UpdateTaskRequest) (*Task, error) {
	path, err := c.wsPath(fmt.Sprintf("tasks/%d", id))
	if err != nil {
		return nil, err
	}
	var m Task
	if err := c.patchJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteTask moves a task to the recycle bin. mode is "cascade" (also
// bin the attached issues) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteTask(id int, mode string) error {
	path, err := c.wsPath(fmt.Sprintf("tasks/%d", id))
	if err != nil {
		return err
	}
	if mode != "" {
		path += "?mode=" + mode
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) AttachExisting(issueID int, up *UploadResponse) (*Attachment, error) {
	return c.AttachToIssue(issueID, up)
}

func (c *Client) GetIssue(id int) (*Issue, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.get(path, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) CreateIssue(req CreateIssueRequest) (*Issue, error) {
	path, err := c.wsPath("issues")
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.postJSON(path, req, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) UpdateIssue(id int, req UpdateIssueRequest) (*Issue, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.patchJSON(path, req, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) UploadFile(filePath string) (*UploadResponse, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	base := filepath.Base(filePath)
	ctype := mime.TypeByExtension(filepath.Ext(base))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	if i := strings.Index(ctype, ";"); i >= 0 {
		ctype = strings.TrimSpace(ctype[:i])
	}

	// When the server has a Blob store (production), upload client-direct so we
	// aren't capped by the serverless ~4.5MB request-body limit. Otherwise
	// (local dev) POST multipart through the function.
	if caps := c.uploadCaps(); caps.Blob {
		return c.uploadViaBlob(f, base, ctype, blobPath(caps, base))
	}
	return c.uploadMultipart(f, base, ctype)
}

// uploadCapabilities is what GET /api/upload reports: whether the server has a
// Blob store, and — since the app-prefix convention landed — which app and
// workspace this caller's files belong under.
type uploadCapabilities struct {
	Blob      bool   `json:"blob"`
	App       string `json:"app"`
	Workspace string `json:"workspace"`
}

func (c *Client) uploadCaps() uploadCapabilities {
	var meta uploadCapabilities
	// Ask about the workspace this command targets (--ws / the active one), so
	// the folder the file lands in matches the workspace the ledger records.
	capsURL := c.BaseURL + "/api/upload"
	if strings.TrimSpace(c.WorkspaceSlug) != "" {
		capsURL += "?workspace=" + url.QueryEscape(c.WorkspaceSlug)
	}
	req, err := http.NewRequest(http.MethodGet, capsURL, nil)
	if err != nil {
		return meta
	}
	if err := c.do(req, &meta); err != nil {
		return uploadCapabilities{}
	}
	return meta
}

// blobPath is where this upload should be written: <app>/<workspace>/<file>.
//
// Both halves come from the SERVER, so the client never invents a convention.
// An older server returns neither, and then the bare filename is correct — the
// server accepts an unprefixed path precisely so a client and a server of
// different vintages still work together. Never build this from a local guess.
func blobPath(caps uploadCapabilities, base string) string {
	if caps.App == "" || caps.Workspace == "" {
		return base
	}
	clean := func(s string) string {
		return strings.ReplaceAll(strings.ReplaceAll(s, "/", "_"), "\\", "_")
	}
	return clean(caps.App) + "/" + clean(caps.Workspace) + "/" + clean(base)
}

func (c *Client) uploadMultipart(f *os.File, base, ctype string) (*UploadResponse, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, base))
	h.Set("Content-Type", ctype)
	fw, err := w.CreatePart(h)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return nil, err
	}
	// Attribute the upload to the active workspace for the ledger (best-effort;
	// the server falls back to the user's active workspace if empty).
	if c.WorkspaceSlug != "" {
		_ = w.WriteField("workspace", c.WorkspaceSlug)
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/upload", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	var up UploadResponse
	if err := c.do(req, &up); err != nil {
		return nil, err
	}
	return &up, nil
}

// uploadViaBlob mirrors the @vercel/blob client-upload flow for non-JS clients:
// (1) ask our /api/upload/blob handshake for a short-lived client token, then
// (2) PUT the bytes straight to Blob storage. The PUT headers + api-version
// track @vercel/blob's wire protocol; the version is pinned in blobAPIVersion
// (see its doc comment) and a 4xx on the PUT surfaces a clear "bump me" error.
func (c *Client) uploadViaBlob(f *os.File, base, ctype, pathname string) (*UploadResponse, error) {
	// File metadata + target workspace travel in clientPayload so the server can
	// record the upload ledger row in onUploadCompleted. Marshalled (not
	// hand-built) so filenames with quotes/specials can't corrupt the JSON.
	var size int64
	if fi, err := f.Stat(); err == nil {
		size = fi.Size()
	}
	clientPayload, _ := json.Marshal(map[string]any{
		"contentType": ctype,
		"filename":    base,
		"size":        size,
		"workspace":   c.WorkspaceSlug, // may be empty → server uses active workspace
	})

	// 1. Token handshake (authenticated via c.do).
	handshake := map[string]any{
		"type": "blob.generate-client-token",
		"payload": map[string]any{
			"pathname":      pathname,
			"callbackUrl":   c.BaseURL + "/api/upload/blob",
			"clientPayload": string(clientPayload),
			"multipart":     false,
		},
	}
	body, err := json.Marshal(handshake)
	if err != nil {
		return nil, err
	}
	hreq, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/upload/blob", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	hreq.Header.Set("Content-Type", "application/json")
	var hs struct {
		ClientToken string `json:"clientToken"`
	}
	if err := c.do(hreq, &hs); err != nil {
		return nil, err
	}
	if hs.ClientToken == "" {
		return nil, fmt.Errorf("upload token request returned no token")
	}

	// 2. Direct PUT to Vercel Blob.
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	// The PUT path must be the SAME pathname the token was minted for, or Blob
	// answers 403 "does not match the token payload". Escape per SEGMENT: the
	// separators in <app>/<workspace>/<file> are structure, and PathEscape on the
	// whole string would turn them into %2F and flatten the prefix away.
	segments := strings.Split(pathname, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	putURL := "https://blob.vercel-storage.com/" + strings.Join(segments, "/")
	preq, err := http.NewRequest(http.MethodPut, putURL, f)
	if err != nil {
		return nil, err
	}
	preq.ContentLength = fi.Size()
	preq.Header.Set("authorization", "Bearer "+hs.ClientToken)
	preq.Header.Set("x-api-version", blobAPIVersion)
	preq.Header.Set("x-content-type", ctype)
	preq.Header.Set("x-add-random-suffix", "1")

	resp, err := http.DefaultClient.Do(preq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		msg := strings.TrimSpace(string(b))
		// A 4xx on the direct PUT most often means Vercel retired the pinned
		// wire-protocol version (blobAPIVersion). Point the user at the fix
		// instead of leaving a cryptic HTTP error.
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return nil, fmt.Errorf(
				"blob upload rejected (%d): %s\n"+
					"this can mean the CLI's Vercel Blob protocol version (x-api-version=%s) is outdated — "+
					"update bk to the latest release; if it persists, the pin in client.go (blobAPIVersion) needs bumping",
				resp.StatusCode, msg, blobAPIVersion)
		}
		return nil, fmt.Errorf("blob upload failed (%d): %s", resp.StatusCode, msg)
	}
	var blobResp struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&blobResp); err != nil {
		return nil, err
	}
	return &UploadResponse{
		URL:         blobResp.URL,
		Filename:    base,
		Size:        int(fi.Size()),
		ContentType: ctype,
	}, nil
}

// EmbedMarkdown returns a Markdown reference to an uploaded file that the server
// renders inline: images become previews, video/audio become players, and
// everything else becomes a download card. The server (lib/rich-text.ts)
// recognizes our upload URLs and upgrades them to the right node, so callers only
// ever need to emit plain Markdown — no app-specific markup.
func EmbedMarkdown(up *UploadResponse) string {
	name := up.Filename
	if name == "" {
		name = "file"
	}
	if strings.HasPrefix(up.ContentType, "image/") {
		return fmt.Sprintf("![%s](%s)", name, up.URL)
	}
	return fmt.Sprintf("[%s](%s)", name, up.URL)
}

func (c *Client) AttachToIssue(issueID int, up *UploadResponse) (*Attachment, error) {
	body := map[string]any{
		"filename":  up.Filename,
		"file_url":  up.URL,
		"file_size": up.Size,
		"mime_type": up.ContentType,
	}
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments", issueID))
	if err != nil {
		return nil, err
	}
	var att Attachment
	if err := c.postJSON(path, body, &att); err != nil {
		return nil, err
	}
	return &att, nil
}

// MoveItemsRequest is the body for POST /api/workspaces/{ws}/move. The active
// workspace (c.WorkspaceSlug) is the source; Target names the destination.
type MoveItemsRequest struct {
	Target        string `json:"target"`
	Mode          string `json:"mode"` // "move" | "copy"
	Projects      []int  `json:"projects,omitempty"`
	Tasks         []int  `json:"tasks,omitempty"`
	Issues        []int  `json:"issues,omitempty"`
	CascadeTasks  *bool  `json:"cascade_tasks,omitempty"`
	CascadeIssues *bool  `json:"cascade_issues,omitempty"`
}

// MoveItems copies or moves the selected items from the active workspace into
// Target. The response is the transfer report (returned verbatim as a generic
// map so new fields flow through without a client change).
func (c *Client) MoveItems(req MoveItemsRequest) (map[string]any, error) {
	path, err := c.wsPath("move")
	if err != nil {
		return nil, err
	}
	var report map[string]any
	if err := c.postJSON(path, req, &report); err != nil {
		return nil, err
	}
	return report, nil
}

// looksLikeMarkup reports whether a response body is a web page rather than an
// API answer.
//
// Checked in ADDITION to "did it parse as JSON", not instead of it: a body can
// be valid JSON and still not be the error envelope. The two together are what
// separate "the API said no" from "there is no API here".
func looksLikeMarkup(body []byte) bool {
	head := strings.TrimSpace(string(body))
	if len(head) > 200 {
		head = head[:200]
	}
	lower := strings.ToLower(head)
	return strings.HasPrefix(lower, "<!doctype") || strings.HasPrefix(lower, "<html") ||
		strings.HasPrefix(lower, "<")
}
