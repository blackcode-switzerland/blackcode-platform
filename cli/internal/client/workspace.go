package client

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Workspace-aware client methods. Companion to client.go; the legacy methods
// in that file continue to work via server-side shims, but new commands
// should use these.

// ---------- workspaces ----------

type Workspace struct {
	ID         int     `json:"id" yaml:"id"`
	Name       string  `json:"name" yaml:"name"`
	Slug       string  `json:"slug" yaml:"slug"`
	LogoURL    *string `json:"logo_url" yaml:"logo_url"`
	OwnerID    int     `json:"owner_id" yaml:"owner_id"`
	MemberRole string  `json:"member_role,omitempty" yaml:"member_role,omitempty"`
	CreatedAt  *string `json:"created_at" yaml:"created_at"`
}

type CreateWorkspaceRequest struct {
	Name string `json:"name"`
}

type UpdateWorkspaceRequest struct {
	Name    *string `json:"name,omitempty"`
	Slug    *string `json:"slug,omitempty"`
	LogoURL *string `json:"logo_url,omitempty"`
}

func (c *Client) ListMyWorkspaces() ([]Workspace, error) {
	var resp struct {
		Data []Workspace `json:"data"`
	}
	if err := c.get("/api/workspaces", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateWorkspace(name string) (*Workspace, error) {
	var ws Workspace
	if err := c.postJSON("/api/workspaces", CreateWorkspaceRequest{Name: name}, &ws); err != nil {
		return nil, err
	}
	return &ws, nil
}

type WorkspaceDetail struct {
	Workspace Workspace         `json:"workspace"`
	Role      string            `json:"role"`
	Members   []WorkspaceMember `json:"members"`
}

func (c *Client) GetWorkspace(slugOrID string) (*WorkspaceDetail, error) {
	var detail WorkspaceDetail
	if err := c.get(fmt.Sprintf("/api/workspaces/%s", slugOrID), &detail); err != nil {
		return nil, err
	}
	return &detail, nil
}

func (c *Client) UpdateWorkspace(slugOrID string, req UpdateWorkspaceRequest) (*Workspace, error) {
	var ws Workspace
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s", slugOrID), req, &ws); err != nil {
		return nil, err
	}
	return &ws, nil
}

func (c *Client) DeleteWorkspace(slugOrID string) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s", slugOrID), nil, nil)
}

func (c *Client) TransferOwnership(slugOrID string, newOwnerUserID int) error {
	body := map[string]int{"new_owner_user_id": newOwnerUserID}
	return c.postJSON(fmt.Sprintf("/api/workspaces/%s/transfer", slugOrID), body, nil)
}

func (c *Client) SetActiveWorkspace(workspaceID int) (*Workspace, error) {
	body := map[string]int{"workspace_id": workspaceID}
	var resp Workspace
	if err := c.postJSON("/api/me/active-workspace", body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ---------- members ----------

type WorkspaceMember struct {
	ID          int     `json:"id" yaml:"id"`
	WorkspaceID int     `json:"workspace_id" yaml:"workspace_id"`
	UserID      int     `json:"user_id" yaml:"user_id"`
	Role        string  `json:"role" yaml:"role"`
	JoinedAt    *string `json:"joined_at,omitempty" yaml:"joined_at,omitempty"`
	Email       string  `json:"email" yaml:"email"`
	Name        *string `json:"name" yaml:"name"`
	AvatarURL   *string `json:"avatar_url" yaml:"avatar_url"`
	DeletedAt   *string `json:"deleted_at,omitempty" yaml:"deleted_at,omitempty"`
}

func (c *Client) ListWorkspaceMembers(slugOrID string) ([]WorkspaceMember, error) {
	var resp struct {
		Data []WorkspaceMember `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/members", slugOrID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RemoveWorkspaceMember(slugOrID string, userID int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/members/%d", slugOrID, userID), nil, nil)
}

func (c *Client) LeaveWorkspace(slugOrID string) error {
	return c.postJSON(fmt.Sprintf("/api/workspaces/%s/leave", slugOrID), nil, nil)
}

// ---------- invitations ----------

type WorkspaceInvitation struct {
	ID             int     `json:"id" yaml:"id"`
	WorkspaceID    int     `json:"workspace_id" yaml:"workspace_id"`
	Email          string  `json:"email" yaml:"email"`
	Role           string  `json:"role" yaml:"role"`
	App            *string `json:"app,omitempty" yaml:"app,omitempty"`
	Token          string  `json:"token" yaml:"token"`
	Status         string  `json:"status" yaml:"status"`
	InvitedBy      int     `json:"invited_by" yaml:"invited_by"`
	InvitedByEmail *string `json:"invited_by_email,omitempty" yaml:"invited_by_email,omitempty"`
	WorkspaceName  string  `json:"workspace_name,omitempty" yaml:"workspace_name,omitempty"`
	WorkspaceSlug  string  `json:"workspace_slug,omitempty" yaml:"workspace_slug,omitempty"`
	ExpiresAt      string  `json:"expires_at" yaml:"expires_at"`
	CreatedAt      string  `json:"created_at" yaml:"created_at"`
}

type CreateInvitationResponse struct {
	Invitation        WorkspaceInvitation `json:"invitation"`
	InviteeHasAccount bool                `json:"invitee_has_account"`
	// EmailSent is the REAL result of trying to deliver the invitation, and it
	// was not read by this client until 2026-08-12 — `bk … invite send` printed
	// "Invitation sent to x." and, for an existing account, "They'll see it in
	// their inbox immediately", both of which are delivery claims made without
	// looking. Sending is best-effort by design (the row is written and valid
	// either way), so the two outcomes are genuinely different and the caller
	// has to be told which one happened.
	//
	// A bool, so an older server that omits the field decodes as `false` — the
	// safe direction: it produces "we could not confirm delivery, here is the
	// link" rather than a promise nothing checked.
	EmailSent bool `json:"email_sent"`
	// AcceptURL is the server's own link, which knows the deployment's public
	// origin (NEXTAUTH_URL behind a proxy). Preferred over the one this client
	// builds from its configured server address; the local build stays as the
	// fallback for a server that does not send it.
	AcceptURL string `json:"accept_url"`
}

// SendInvitation invites `email` to a workspace. `app` is optional: empty means
// an org-level invite (accepting grants whatever the workspace's apps hand out by
// default); set, it also grants that one app on accept, even where the app is
// invite_only — that is what makes invite_only workable.
// The `app` argument went on 2026-08-10: the server REJECTS a body carrying it
// (an invitation is into one app's workspace now), so sending it would be an
// error rather than a no-op.
func (c *Client) SendInvitation(slugOrID, email string) (*CreateInvitationResponse, error) {
	body := map[string]string{"email": email}
	var resp CreateInvitationResponse
	if err := c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/invitations", slugOrID),
		body,
		&resp,
	); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ListInvitations(slugOrID string, includeAll bool) ([]WorkspaceInvitation, error) {
	path := fmt.Sprintf("/api/workspaces/%s/invitations", slugOrID)
	if includeAll {
		path += "?all=true"
	}
	var resp struct {
		Data []WorkspaceInvitation `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RevokeInvitation(slugOrID string, id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/invitations/%d", slugOrID, id), nil, nil)
}

func (c *Client) AcceptInvitation(token string) error {
	return c.postJSON("/api/invitations/accept", map[string]string{"token": token}, nil)
}

func (c *Client) DeclineInvitation(token string) error {
	return c.postJSON("/api/invitations/decline", map[string]string{"token": token}, nil)
}

func (c *Client) ListPendingInvitationsForMe() ([]WorkspaceInvitation, error) {
	var resp struct {
		Data []WorkspaceInvitation `json:"data"`
	}
	if err := c.get("/api/me/pending-invitations", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ListInviteCandidates returns people the active workspace owner can invite
// without retyping an email. Owner-only. The endpoint returns
// { "data": [...], "is_super_admin": bool }; we return just the data slice.
func (c *Client) ListInviteCandidates() ([]InviteCandidate, error) {
	path, err := c.wsPath("invite-candidates")
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data         []InviteCandidate `json:"data"`
		IsSuperAdmin bool              `json:"is_super_admin"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ---------- inbox ----------

type InboxMessage struct {
	ID          int             `json:"id" yaml:"id"`
	UserID      int             `json:"user_id" yaml:"user_id"`
	WorkspaceID *int            `json:"workspace_id" yaml:"workspace_id"`
	Type        string          `json:"type" yaml:"type"`
	EntityType  *string         `json:"entity_type" yaml:"entity_type"`
	EntityID    *int            `json:"entity_id" yaml:"entity_id"`
	ActorUserID *int            `json:"actor_user_id" yaml:"actor_user_id"`
	Payload     json.RawMessage `json:"payload" yaml:"-"`
	ReadAt      *string         `json:"read_at" yaml:"read_at"`
	ArchivedAt  *string         `json:"archived_at" yaml:"archived_at"`
	CreatedAt   string          `json:"created_at" yaml:"created_at"`
}

type InboxPage struct {
	Data        []InboxMessage `json:"data" yaml:"data"`
	NextCursor  *int           `json:"next_cursor" yaml:"next_cursor"`
	UnreadCount int            `json:"unread_count" yaml:"unread_count"`
}

// ListInbox reads the caller's notifications.
//
// workspaceID scopes the read to one workspace when > 0. The route has always
// read `?workspace_id=` — `listInbox`/`countUnread` filter on it — and nothing
// in the CLI ever sent it, so `inbox list` was every workspace, going back
// weeks, with no way to narrow it. Verified against a running route on
// 2026-08-12: the request the CLI sent was `/api/me/inbox?limit=200` and
// `--ws` changed nothing about it.
func (c *Client) ListInbox(unreadOnly, includeArchived bool, workspaceID int) (*InboxPage, error) {
	path := "/api/me/inbox?limit=200"
	if unreadOnly {
		path += "&unread=true"
	}
	if includeArchived {
		path += "&include_archived=true"
	}
	if workspaceID > 0 {
		path += "&workspace_id=" + strconv.Itoa(workspaceID)
	}
	var page InboxPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) InboxUnreadCount() (int, error) {
	var resp struct {
		UnreadCount int `json:"unread_count"`
	}
	if err := c.get("/api/me/inbox?count_only=true", &resp); err != nil {
		return 0, err
	}
	return resp.UnreadCount, nil
}

func (c *Client) MarkInboxRead(ids []int, all bool) (int, error) {
	body := map[string]any{}
	if all {
		body["all"] = true
	} else {
		body["ids"] = ids
	}
	var resp struct {
		MarkedRead int `json:"marked_read"`
	}
	if err := c.postJSON("/api/me/inbox/mark-read", body, &resp); err != nil {
		return 0, err
	}
	return resp.MarkedRead, nil
}

func (c *Client) ArchiveInbox(ids []int) (int, error) {
	body := map[string]any{"ids": ids}
	var resp struct {
		Archived int `json:"archived"`
	}
	if err := c.postJSON("/api/me/inbox/archive", body, &resp); err != nil {
		return 0, err
	}
	return resp.Archived, nil
}

// ---------- labels ----------

type Label struct {
	ID          int     `json:"id" yaml:"id"`
	WorkspaceID int     `json:"workspace_id" yaml:"workspace_id"`
	Name        string  `json:"name" yaml:"name"`
	Color       string  `json:"color" yaml:"color"`
	Description *string `json:"description" yaml:"description"`
	// Which app owns this label. Empty/null means SHARED — visible to every app
	// in the workspace, which is what every label created before the column
	// existed is. A server only ever returns labels it can see, so this is never
	// another app's slug; it is here so `label list` can say WHICH of the two a
	// row is, rather than leaving an agent to infer it.
	App        *string `json:"app,omitempty" yaml:"app,omitempty"`
	IssueCount int     `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	CreatedAt  *string `json:"created_at" yaml:"created_at"`
}

// Scope is the human word for `App`: the app slug, or "shared".
func (l Label) Scope() string {
	if l.App == nil || *l.App == "" {
		return "shared"
	}
	return *l.App
}

func (c *Client) ListLabels(slugOrID string) ([]Label, error) {
	var resp struct {
		Data []Label `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/labels", slugOrID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetLabel(slugOrID string, id int) (*Label, error) {
	var label Label
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/labels/%d", slugOrID, id), &label); err != nil {
		return nil, err
	}
	return &label, nil
}

type CreateLabelRequest struct {
	Name        string  `json:"name"`
	Color       string  `json:"color,omitempty"`
	Description *string `json:"description,omitempty"`
}

func (c *Client) CreateLabel(slugOrID string, req CreateLabelRequest) (*Label, error) {
	var label Label
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/labels", slugOrID), req, &label); err != nil {
		return nil, err
	}
	return &label, nil
}

// UpdateLabelRequest carries only the fields being changed — omitted pointers
// leave the value untouched, matching the PATCH semantics of every edit route.
type UpdateLabelRequest struct {
	Name        *string `json:"name,omitempty"`
	Color       *string `json:"color,omitempty"`
	Description *string `json:"description,omitempty"`
}

func (c *Client) UpdateLabel(slugOrID string, id int, req UpdateLabelRequest) (*Label, error) {
	var label Label
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/labels/%d", slugOrID, id), req, &label); err != nil {
		return nil, err
	}
	return &label, nil
}

func (c *Client) DeleteLabel(slugOrID string, id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/labels/%d", slugOrID, id), nil, nil)
}

func (c *Client) AttachIssueLabel(slugOrID string, issueID, labelID int) error {
	body := map[string]int{"label_id": labelID}
	return c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/labels", slugOrID, issueID),
		body,
		nil,
	)
}

func (c *Client) DetachIssueLabel(slugOrID string, issueID, labelID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/labels/%d", slugOrID, issueID, labelID),
		nil,
		nil,
	)
}

// AttachIssueLabelByName posts a NAME rather than an id. The route has always
// accepted either — `{"name": …}` matches case-insensitively and CREATES the
// label if it does not exist, which is the same resolution
// `bk issues issue create --label urgent` uses. Only the CLI insisted on an id,
// via a strconv.Atoi that had no counterpart on the server.
func (c *Client) AttachIssueLabelByName(slugOrID string, issueID int, name string) error {
	return c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/labels", slugOrID, issueID),
		map[string]string{"name": name},
		nil,
	)
}

// ListIssueLabels returns the labels currently on one issue.
//
// It exists so a name can be turned into an id for DETACH, which the route only
// takes by id — and deliberately reads the ISSUE's labels rather than the
// workspace's. Detaching is removing something that is already there, so the
// only names that can succeed are on this list, and resolving against the wider
// set would let `--label-remove typo` resolve to a real label the issue does
// not carry and report a removal that removed nothing.
func (c *Client) ListIssueLabels(slugOrID string, issueID int) ([]Label, error) {
	var resp struct {
		Data []Label `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/issues/%d/labels", slugOrID, issueID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// DetachIssueLabelByName resolves a name against the issue's own labels, then
// detaches by id.
//
// A miss is an ERROR naming what the issue does have, never a silent success.
// "removed a label that was not there" and "removed it" must not print the same
// line — that is the shape of the defect this whole triage was about.
func (c *Client) DetachIssueLabelByName(slugOrID string, issueID int, name string) error {
	labels, err := c.ListIssueLabels(slugOrID, issueID)
	if err != nil {
		return err
	}
	want := strings.ToLower(strings.TrimSpace(name))
	for _, l := range labels {
		if strings.ToLower(l.Name) == want {
			return c.DetachIssueLabel(slugOrID, issueID, l.ID)
		}
	}
	if len(labels) == 0 {
		return fmt.Errorf("issue %d has no labels, so %q cannot be removed", issueID, name)
	}
	have := make([]string, 0, len(labels))
	for _, l := range labels {
		have = append(have, l.Name)
	}
	return fmt.Errorf("issue %d has no label %q — it has: %s", issueID, name, strings.Join(have, ", "))
}

// ---------- project updates ----------

func (c *Client) ListProjectUpdates(slugOrID string, projectID int) ([]ProjectUpdate, error) {
	var resp struct {
		Data []ProjectUpdate `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/projects/%d/updates", slugOrID, projectID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateProjectUpdate(slugOrID string, projectID int, req CreateProjectUpdateRequest) (*ProjectUpdate, error) {
	var upd ProjectUpdate
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/projects/%d/updates", slugOrID, projectID), req, &upd); err != nil {
		return nil, err
	}
	return &upd, nil
}

func (c *Client) DeleteProjectUpdate(slugOrID string, projectID, updateID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/projects/%d/updates/%d", slugOrID, projectID, updateID),
		nil,
		nil,
	)
}

// ---------- workspace-scoped comments (issues, tasks, projects) ----------

func (c *Client) ListIssueCommentsWS(slugOrID string, issueID int) ([]WorkspaceComment, error) {
	var resp struct {
		Data []WorkspaceComment `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/issues/%d/comments", slugOrID, issueID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateIssueCommentWS(slugOrID string, issueID int, content string) (*WorkspaceComment, error) {
	var cm WorkspaceComment
	if err := c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/comments", slugOrID, issueID),
		map[string]string{"content": content},
		&cm,
	); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) ListTaskComments(slugOrID string, taskID int) ([]WorkspaceComment, error) {
	var resp struct {
		Data []WorkspaceComment `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/tasks/%d/comments", slugOrID, taskID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateTaskComment(slugOrID string, taskID int, content string) (*WorkspaceComment, error) {
	var cm WorkspaceComment
	if err := c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/tasks/%d/comments", slugOrID, taskID),
		map[string]string{"content": content},
		&cm,
	); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) ListProjectComments(slugOrID string, projectID int) ([]WorkspaceComment, error) {
	var resp struct {
		Data []WorkspaceComment `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/projects/%d/comments", slugOrID, projectID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateProjectComment(slugOrID string, projectID int, content string) (*WorkspaceComment, error) {
	var cm WorkspaceComment
	if err := c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/projects/%d/comments", slugOrID, projectID),
		map[string]string{"content": content},
		&cm,
	); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) EditComment(slugOrID string, commentID int, content string) (*WorkspaceComment, error) {
	var cm WorkspaceComment
	if err := c.patchJSON(
		fmt.Sprintf("/api/workspaces/%s/comments/%d", slugOrID, commentID),
		map[string]string{"content": content},
		&cm,
	); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) DeleteComment(slugOrID string, commentID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/comments/%d", slugOrID, commentID),
		nil,
		nil,
	)
}

// ---------- issue watchers ----------

func (c *Client) WatchIssue(slugOrID string, issueID int) error {
	return c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/watch", slugOrID, issueID),
		nil,
		nil,
	)
}

func (c *Client) UnwatchIssue(slugOrID string, issueID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/watch", slugOrID, issueID),
		nil,
		nil,
	)
}

func (c *Client) GetWatchStatus(slugOrID string, issueID int) (bool, error) {
	var resp struct {
		Watching bool `json:"watching"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/issues/%d/watch", slugOrID, issueID), &resp); err != nil {
		return false, err
	}
	return resp.Watching, nil
}

// ---------- recycle bin (trash) ----------

// ListTrash lists binned items. typ is "" for all, or issue|project|task.
func (c *Client) ListTrash(slugOrID, typ string) ([]TrashItem, error) {
	path := fmt.Sprintf("/api/workspaces/%s/trash", slugOrID)
	if typ != "" {
		path += "?type=" + typ
	}
	var resp struct {
		Data []TrashItem `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RestoreTrash(slugOrID string, req RestoreTrashRequest) (*RestoreTrashResponse, error) {
	var resp RestoreTrashResponse
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/trash/restore", slugOrID), req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) PurgeTrash(slugOrID string, req PurgeTrashRequest) (*PurgeTrashResult, error) {
	var resp PurgeTrashResult
	if err := c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/trash/purge", slugOrID), req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) EmptyTrash(slugOrID string) (*PurgeTrashResult, error) {
	var resp PurgeTrashResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/trash/empty", slugOrID), nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ---------- inbox unarchive ----------

func (c *Client) UnarchiveInbox(ids []int) (int, error) {
	body := map[string]any{"ids": ids}
	var resp struct {
		Unarchived int `json:"unarchived"`
	}
	if err := c.postJSON("/api/me/inbox/unarchive", body, &resp); err != nil {
		return 0, err
	}
	return resp.Unarchived, nil
}

// ---------- API tokens ----------

func (c *Client) ListTokens() ([]APIToken, error) {
	var tokens []APIToken
	if err := c.get("/api/tokens", &tokens); err != nil {
		return nil, err
	}
	return tokens, nil
}

func (c *Client) CreateToken(name string, expiresAt *string) (*CreatedToken, error) {
	body := map[string]any{"name": name}
	if expiresAt != nil {
		body["expires_at"] = *expiresAt
	}
	var tok CreatedToken
	if err := c.postJSON("/api/tokens", body, &tok); err != nil {
		return nil, err
	}
	return &tok, nil
}

func (c *Client) DeleteToken(id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/tokens/%d", id), nil, nil)
}

// ---------- profile ----------

func (c *Client) GetMe() (*Me, error) {
	var me Me
	if err := c.get("/api/me", &me); err != nil {
		return nil, err
	}
	return &me, nil
}

func (c *Client) UpdateProfile(req UpdateProfileRequest) (*Me, error) {
	var me Me
	if err := c.patchJSON("/api/me", req, &me); err != nil {
		return nil, err
	}
	return &me, nil
}

// ---------- workspace member role ----------
//
// Deliberately empty. `UpdateWorkspaceMemberRole` lived here until Phase 5 and
// was broken from the day it was written: it sent PATCH to
// /api/workspaces/{ws}/members/{userId}, which only ever exported DELETE. There
// is no route that edits a member's role — ownership moves via
// `bk workspace transfer`, and everything else is a per-app grant
// (`bk app access grant`), so nothing was lost by deleting it.
//
// THE BLIND SPOT IS THE REUSABLE FINDING, not the bug. cli-parity.test.ts
// compares two sets: routes on disk, and routes a *command* annotates. This
// method was reachable from no command, so it appeared in neither — a client
// method can name a route that does not exist and stay invisible to the guard
// that exists to catch exactly that. The same shape of hole has now been found
// twice in the guardrails (the first: `routes` annotations were optional, fixed
// by routes_test.go).
//
// It is documented rather than closed. Closing it would mean parsing Go call
// sites for c.get/c.patchJSON/... and reconciling their format strings with the
// route tree — a second, weaker route-extractor to keep honest alongside the
// annotations. The annotations are the contract; an unreferenced client method
// is dead code, and dead code is what code review and `go vet`-adjacent linting
// are for. What parity guarantees is precisely: every route an agent can reach
// is reachable, and every route a *command* claims exists. Anything the
// commands do not claim is outside its stated scope.

// InvitationPreview is what `bk <app> invite show <token>` prints: the facts the
// web's `/invitations/{token}` page renders before you commit to accepting.
//
// The server only returns this to the person the invitation was ISSUED to — a
// token alone is not enough, and a token for somebody else is refused with a
// message naming the CALLER rather than the invitee. See the route's header:
// whose invitation a token is for is not something the holder gets to learn.
type InvitationPreview struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expires_at"`
	Workspace struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"workspace"`
	InvitedBy struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"invited_by"`
}

// ShowInvitation previews an invitation without accepting it.
func (c *Client) ShowInvitation(token string) (*InvitationPreview, error) {
	var out InvitationPreview
	if err := c.get("/api/invitations/"+url.PathEscape(token), &out); err != nil {
		return nil, err
	}
	return &out, nil
}
