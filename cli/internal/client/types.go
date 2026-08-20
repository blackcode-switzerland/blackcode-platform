package client

import "encoding/json"

type Me struct {
	ID              int     `json:"id" yaml:"id"`
	Email           string  `json:"email" yaml:"email"`
	Name            *string `json:"name" yaml:"name"`
	Tagline         *string `json:"tagline" yaml:"tagline"`
	AvatarURL       *string `json:"avatar_url" yaml:"avatar_url"`
	Role            string  `json:"role" yaml:"role"`
	Via             string  `json:"via" yaml:"via"`
	ConnectedGoogle bool    `json:"connected_google,omitempty" yaml:"connected_google,omitempty"`
	AvatarEditable  bool    `json:"avatar_editable,omitempty" yaml:"avatar_editable,omitempty"`
	IsSuperAdmin    bool    `json:"is_super_admin,omitempty" yaml:"is_super_admin,omitempty"`
}

// Changelog models GET /api/changelog: the dated log, newest first. Bodies are
// carried as both Markdown and rendered HTML; the CLI uses the Markdown.
//
// The old `reference` field (a pinned Platform Reference) is gone — the current
// surface is the guide embedded in this binary. ReferenceMovedTo carries the
// server's one-line pointer so an old client sees an explanation rather than a
// missing field.
type Changelog struct {
	CLILatestVersion string `json:"cli_latest_version" yaml:"cli_latest_version"`
	CLIMinVersion    string `json:"cli_min_version" yaml:"cli_min_version"`
	// Apps lists the sections that have a changelog file: "platform" first, then
	// each app. Added 2026-08-04 with the per-app split; empty against a server
	// older than that, which is why the command falls back rather than requiring
	// it.
	Apps             []string         `json:"apps,omitempty" yaml:"apps,omitempty"`
	Entries          []ChangelogEntry `json:"entries" yaml:"entries"`
	ReferenceMovedTo string           `json:"reference_moved_to,omitempty" yaml:"reference_moved_to,omitempty"`
}

type ChangelogEntry struct {
	Date string `json:"date" yaml:"date"`
	// App is which file the entry came from: "platform" or an app slug. Added
	// 2026-08-04; empty from an older server.
	App      string `json:"app,omitempty" yaml:"app,omitempty"`
	Title    string `json:"title" yaml:"title"`
	Markdown string `json:"markdown" yaml:"markdown"`
	HTML     string `json:"html" yaml:"html"`
}

type User struct {
	ID        int     `json:"id" yaml:"id"`
	Email     string  `json:"email" yaml:"email"`
	Name      *string `json:"name" yaml:"name"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
	Role      string  `json:"role" yaml:"role"`
}

// Meta models GET /api/meta — the agent bootstrap. `Workspaces` lists every
// workspace the caller belongs to so an agent can pick its write target by
// name/slug (never by the opaque numeric id). `ActiveWorkspace` is only a
// default. Vocabulary/labels/projects/members are passed through raw.
// Meta is the typed view of GET /api/meta used to render the human table.
//
// Raw holds the server's response verbatim, and `bk meta --json` / `--yaml`
// print THAT rather than re-serialising this struct. That matters: /api/meta is
// where every dynamic value lives (limits, media rules, CLI versions,
// vocabularies), and the embedded guide deliberately points at it instead of
// restating them. If this struct were the JSON output, every server-side
// addition would be silently dropped until someone shipped a new CLI — which is
// exactly the drift the guide/meta split exists to prevent. `limits` and `media`
// were invisible to `bk meta` for this reason before v1.9.0.
type Meta struct {
	User            MetaUser             `json:"user" yaml:"user"`
	ActiveWorkspace *MetaActiveWorkspace `json:"active_workspace" yaml:"active_workspace"`
	Workspaces      []MetaWorkspace      `json:"workspaces" yaml:"workspaces"`
	// The app serving this server, and the apps this token can reach anywhere,
	// keyed by slug (Phase 4). Keyed rather than a list because Phase 5 nests each
	// app's vocabulary and limits inside its entry — additive, not a replacement.
	//
	// Absent from a pre-Phase-4 server, which is exactly why both are optional and
	// why the table renderer skips the block when it is empty. A CLI that
	// hard-required them would break against an older deployment.
	CurrentApp string             `json:"current_app,omitempty" yaml:"current_app,omitempty"`
	Apps       map[string]MetaApp `json:"apps,omitempty" yaml:"apps,omitempty"`
	Vocabulary json.RawMessage    `json:"vocabulary,omitempty" yaml:"vocabulary,omitempty"`
	// `apps/books` spells the same block `vocabularies`. Read, never written —
	// see the note on MetaApp.Vocabularies.
	Vocabularies json.RawMessage `json:"vocabularies,omitempty" yaml:"vocabularies,omitempty"`

	// The unmodified response body. Not a wire field of its own.
	Raw json.RawMessage `json:"-" yaml:"-"`
}

type MetaUser struct {
	ID           int     `json:"id" yaml:"id"`
	Email        string  `json:"email" yaml:"email"`
	Name         *string `json:"name" yaml:"name"`
	AvatarURL    *string `json:"avatar_url" yaml:"avatar_url"`
	Via          string  `json:"via" yaml:"via"`
	IsSuperAdmin bool    `json:"is_super_admin" yaml:"is_super_admin"`
}

type MetaActiveWorkspace struct {
	ID   int    `json:"id" yaml:"id"`
	Name string `json:"name" yaml:"name"`
	Slug string `json:"slug" yaml:"slug"`
	Role string `json:"role" yaml:"role"`
}

type MetaApp struct {
	// Slug repeats the map key so an entry stays self-describing once it is
	// pulled out of the map. Absent from a pre-Phase-5 server.
	Slug    string  `json:"slug,omitempty" yaml:"slug,omitempty"`
	Name    string  `json:"name" yaml:"name"`
	BaseURL *string `json:"base_url" yaml:"base_url"`
	// True for the app this server IS — the one whose nouns live under
	// `bk <slug> …` in this binary.
	IsCurrent bool `json:"is_current" yaml:"is_current"`
	// Workspace slugs where the caller can use this app.
	Workspaces []string `json:"workspaces" yaml:"workspaces"`

	// This app's enum vocabulary, server-enforced caps, and media rules (Phase
	// 5, §7.4). Held raw and untyped for the same reason Meta.Raw is: a typed
	// struct silently drops fields the server adds, so a new limit would be
	// invisible until someone shipped a new binary — which is exactly how
	// `limits` and `media` went unseen before v1.9.0.
	//
	// Present only on the CURRENT app's entry. This server knows its own
	// vocabulary and has no business inventing another app's; read a different
	// app's from its own /api/meta, which is what BaseURL is for.
	Vocabulary json.RawMessage `json:"vocabulary,omitempty" yaml:"vocabulary,omitempty"`
	// AND THE OTHER SPELLING OF THE SAME BLOCK.
	//
	// `apps/books` serves this key as `vocabularies`, nested and top-level, with
	// entries of exactly the shape above (`value`, `label`, `color`). Only the
	// key differs, so `bk meta --vocab` — the command whose whole job is to be
	// the AUTHORITY on an app's valid values — answered "this server serves no
	// vocabulary block" against books, while the values sat in the payload it
	// had just parsed. Found 2026-08-20 by running the command books' own help
	// points at.
	//
	// Read here rather than renamed there: the payload is a published wire shape
	// with a live deployment behind it, and a client that reads both spellings
	// costs nothing and breaks nobody.
	Vocabularies json.RawMessage `json:"vocabularies,omitempty" yaml:"vocabularies,omitempty"`
	Limits       json.RawMessage `json:"limits,omitempty" yaml:"limits,omitempty"`
	Media        json.RawMessage `json:"media,omitempty" yaml:"media,omitempty"`

	// A short fingerprint of everything above — sales #31. An agent polls this
	// instead of re-reading the whole block and the `--help` tree behind it: if
	// it has not moved since the last run, nothing in this app's contract has.
	//
	// Typed (unlike its neighbours) because `bk meta --contract-version` has to
	// reach into it. That is safe here for the reason the others are not: this
	// is one opaque string with no internal shape to be dropped, and the raw
	// passthrough still carries it for `--json`.
	//
	// Empty against a server that predates it. `--contract-version` says so
	// rather than printing nothing, because "" and "unchanged" must not look
	// alike to a caller comparing two runs.
	ContractVersion string `json:"contract_version,omitempty" yaml:"contract_version,omitempty"`
}

type MetaWorkspace struct {
	ID       int    `json:"id" yaml:"id"`
	Name     string `json:"name" yaml:"name"`
	Slug     string `json:"slug" yaml:"slug"`
	Role     string `json:"role" yaml:"role"`
	IsActive bool   `json:"is_active" yaml:"is_active"`
}

type Project struct {
	ID          int     `json:"id" yaml:"id"`
	Name        string  `json:"name" yaml:"name"`
	Summary     *string `json:"summary" yaml:"summary"`
	Description *string `json:"description" yaml:"description"`
	Status      *string `json:"status" yaml:"status"`
	Priority    *string `json:"priority" yaml:"priority"`
	Visibility  *string `json:"visibility" yaml:"visibility"`
	Color       *string `json:"color" yaml:"color"`
	StartDate   *string `json:"start_date" yaml:"start_date"`
	DueDate     *string `json:"due_date" yaml:"due_date"`
	OwnerID     *int    `json:"owner_id" yaml:"owner_id"`
	IssueCount  *int    `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	OpenIssues  *int    `json:"open_issues,omitempty" yaml:"open_issues,omitempty"`
	MemberRole  *string `json:"member_role,omitempty" yaml:"member_role,omitempty"`
	CreatedAt   *string `json:"created_at" yaml:"created_at"`
}

type IssueAssignee struct {
	ID        int     `json:"id" yaml:"id"`
	Name      *string `json:"name" yaml:"name"`
	Email     string  `json:"email" yaml:"email"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
}

type IssueLabel struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Color string `json:"color" yaml:"color"`
}

type Issue struct {
	ID              int             `json:"id" yaml:"id"`
	WorkspaceID     *int            `json:"workspace_id,omitempty" yaml:"workspace_id,omitempty"`
	ProjectID       int             `json:"project_id" yaml:"project_id"`
	TaskID          *int            `json:"task_id" yaml:"task_id"`
	Title           string          `json:"title" yaml:"title"`
	Description     *string         `json:"description" yaml:"description"`
	Status          string          `json:"status" yaml:"status"`
	Priority        int             `json:"priority" yaml:"priority"`
	ReporterID      *int            `json:"reporter_id" yaml:"reporter_id"`
	StartDate       *string         `json:"start_date" yaml:"start_date"`
	DueDate         *string         `json:"due_date" yaml:"due_date"`
	EstimatedHours  json.RawMessage `json:"estimated_hours,omitempty" yaml:"-"`
	Assignees       []IssueAssignee `json:"assignees" yaml:"assignees"`
	Labels          []IssueLabel    `json:"labels,omitempty" yaml:"labels,omitempty"`
	TaskName        *string         `json:"task_name,omitempty" yaml:"task_name,omitempty"`
	ProjectName     *string         `json:"project_name,omitempty" yaml:"project_name,omitempty"`
	CommentCount    *int            `json:"comment_count,omitempty" yaml:"comment_count,omitempty"`
	AttachmentCount *int            `json:"attachment_count,omitempty" yaml:"attachment_count,omitempty"`
	Position        *int            `json:"position,omitempty" yaml:"position,omitempty"`
	CompletedAt     *string         `json:"completed_at,omitempty" yaml:"completed_at,omitempty"`
	CancelledAt     *string         `json:"cancelled_at,omitempty" yaml:"cancelled_at,omitempty"`
	CreatedAt       *string         `json:"created_at" yaml:"created_at"`
	UpdatedAt       *string         `json:"updated_at" yaml:"updated_at"`
}

type IssuesPage struct {
	Data       []Issue `json:"data" yaml:"data"`
	NextCursor *int    `json:"next_cursor" yaml:"next_cursor"`
	Total      *int    `json:"total,omitempty" yaml:"total,omitempty"`
}

// dataEnvelope is the generic { "data": [...] } wrapper returned by
// workspace-scoped list endpoints (members, comments, activity, attachments,
// tasks).
type projectMembersEnvelope struct {
	Data []ProjectMember `json:"data" yaml:"data"`
}

type commentsEnvelope struct {
	Data []Comment `json:"data" yaml:"data"`
}

type activityEnvelope struct {
	Data []ActivityItem `json:"data" yaml:"data"`
}

type attachmentsEnvelope struct {
	Data []Attachment `json:"data" yaml:"data"`
}

type tasksEnvelope struct {
	Data []Task `json:"data" yaml:"data"`
}

type ProjectsPage struct {
	Data       []Project `json:"data" yaml:"data"`
	NextCursor *int      `json:"next_cursor" yaml:"next_cursor"`
}

type ProjectMember struct {
	ID        int     `json:"id" yaml:"id"`
	ProjectID int     `json:"project_id" yaml:"project_id"`
	UserID    int     `json:"user_id" yaml:"user_id"`
	Role      string  `json:"role" yaml:"role"`
	Name      *string `json:"name" yaml:"name"`
	Email     string  `json:"email" yaml:"email"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
	CreatedAt *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
}

type Task struct {
	ID          int     `json:"id" yaml:"id"`
	ProjectID   int     `json:"project_id" yaml:"project_id"`
	Name        string  `json:"name" yaml:"name"`
	Description *string `json:"description" yaml:"description"`
	DueDate     *string `json:"due_date" yaml:"due_date"`
	// DERIVED from the task's issues, never stored: empty|active|done|cancelled.
	// The server computes it (apps/issues/lib/db/queries/tasks.ts) precisely so
	// that a client cannot arrive at a different answer by counting a page of
	// issues. Do not compute it here, and do not send it — the route answers
	// `task_status_derived` with a 400.
	Status          *string `json:"status,omitempty" yaml:"status,omitempty"`
	LeadID          *int    `json:"lead_id" yaml:"lead_id"`
	LeadName        *string `json:"lead_name,omitempty" yaml:"lead_name,omitempty"`
	LeadEmail       *string `json:"lead_email,omitempty" yaml:"lead_email,omitempty"`
	ProjectName     *string `json:"project_name,omitempty" yaml:"project_name,omitempty"`
	IssueCount      *int    `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	CompletedIssues *int    `json:"completed_issues,omitempty" yaml:"completed_issues,omitempty"`
	CancelledIssues *int    `json:"cancelled_issues,omitempty" yaml:"cancelled_issues,omitempty"`
	OpenIssues      *int    `json:"open_issues,omitempty" yaml:"open_issues,omitempty"`
	CreatedAt       *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	UpdatedAt       *string `json:"updated_at,omitempty" yaml:"updated_at,omitempty"`
	Issues          []Issue `json:"issues,omitempty" yaml:"issues,omitempty"`
}

type Comment struct {
	ID           int     `json:"id" yaml:"id"`
	ParentType   *string `json:"parent_type,omitempty" yaml:"parent_type,omitempty"`
	ParentID     *int    `json:"parent_id,omitempty" yaml:"parent_id,omitempty"`
	UserID       *int    `json:"user_id" yaml:"user_id"`
	Content      string  `json:"content" yaml:"content"`
	AuthorName   *string `json:"author_name,omitempty" yaml:"author_name,omitempty"`
	AuthorAvatar *string `json:"author_avatar,omitempty" yaml:"author_avatar,omitempty"`
	CreatedAt    *string `json:"created_at" yaml:"created_at"`
	UpdatedAt    *string `json:"updated_at,omitempty" yaml:"updated_at,omitempty"`
}

type ActivityItem struct {
	ID            int             `json:"id" yaml:"id"`
	Type          string          `json:"type" yaml:"type"`
	Content       *string         `json:"content,omitempty" yaml:"content,omitempty"`
	OperationType *string         `json:"operation_type,omitempty" yaml:"operation_type,omitempty"`
	OldData       json.RawMessage `json:"old_data,omitempty" yaml:"-"`
	NewData       json.RawMessage `json:"new_data,omitempty" yaml:"-"`
	UserID        *int            `json:"user_id" yaml:"user_id"`
	UserName      *string         `json:"user_name,omitempty" yaml:"user_name,omitempty"`
	UserAvatar    *string         `json:"user_avatar,omitempty" yaml:"user_avatar,omitempty"`
	CreatedAt     *string         `json:"created_at" yaml:"created_at"`
}

// activityFeedEnvelope is the keyset-paginated envelope returned by the
// workspace-scoped activity feed route: { "data": [...], "next_cursor": <id|null> }.
type activityFeedEnvelope struct {
	Data       []ActivityFeedItem `json:"data" yaml:"data"`
	NextCursor *int               `json:"next_cursor" yaml:"next_cursor"`
}

type ActivityFeedItem struct {
	ID int `json:"id" yaml:"id"`
	// Which app produced the event, and the cross-app address of its subject
	// (Phase 6). App is a pointer because rows written during the window between
	// migration 0035 and the deploy that sets it carry NULL — see the migration's
	// note on expand→migrate→contract. SubjectURN is null for subjects that are
	// not projected entities: a member, an invitation, a label.
	App         *string         `json:"app,omitempty" yaml:"app,omitempty"`
	SubjectURN  *string         `json:"subject_urn,omitempty" yaml:"subject_urn,omitempty"`
	EntityType  string          `json:"entity_type" yaml:"entity_type"`
	EntityID    *int            `json:"entity_id" yaml:"entity_id"` // #number for issue/task/project, own id otherwise; null if purged
	Action      string          `json:"action" yaml:"action"`
	ActorUserID *int            `json:"actor_user_id" yaml:"actor_user_id"`
	ActorName   *string         `json:"actor_name,omitempty" yaml:"actor_name,omitempty"`
	ActorEmail  *string         `json:"actor_email,omitempty" yaml:"actor_email,omitempty"`
	Diff        json.RawMessage `json:"diff,omitempty" yaml:"-"`
	Meta        json.RawMessage `json:"meta,omitempty" yaml:"-"`
	OccurredAt  *string         `json:"occurred_at" yaml:"occurred_at"`
}

type CreateIssueRequest struct {
	ProjectID   int             `json:"project_id"`
	Title       string          `json:"title"`
	Description string          `json:"description,omitempty"`
	Status      string          `json:"status,omitempty"`
	Priority    int             `json:"priority,omitempty"`
	AssigneeIDs []int           `json:"assignee_ids,omitempty"`
	TaskID      json.RawMessage `json:"task_id,omitempty"`
	StartDate   *string         `json:"start_date,omitempty"`
	DueDate     *string         `json:"due_date,omitempty"`
	Labels      []string        `json:"labels,omitempty"`
}

// UpdateIssueRequest uses json.RawMessage for task_id, start_date, due_date
// so they can be sent as null to clear, a value to set, or omitted to leave
// untouched. AssigneeIDs replaces the full assignee list when present (empty
// array = clear all assignees).
type UpdateIssueRequest struct {
	Title       *string         `json:"title,omitempty"`
	Description *string         `json:"description,omitempty"`
	Status      *string         `json:"status,omitempty"`
	Priority    *int            `json:"priority,omitempty"`
	AssigneeIDs json.RawMessage `json:"assignee_ids,omitempty"`
	TaskID      json.RawMessage `json:"task_id,omitempty"`
	// ProjectID moves the issue between projects inside one workspace — the
	// project's #number, or the literal `null` to unscope it. RawMessage, like
	// TaskID, because `omitempty` on a *int cannot distinguish "not given" from
	// "clear it" and both are meaningful here.
	ProjectID json.RawMessage `json:"project_id,omitempty"`
	StartDate json.RawMessage `json:"start_date,omitempty"`
	DueDate   json.RawMessage `json:"due_date,omitempty"`
}

type CreateProjectRequest struct {
	Name        string  `json:"name"`
	Summary     string  `json:"summary,omitempty"`
	Description string  `json:"description,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	Visibility  *string `json:"visibility,omitempty"`
	Color       *string `json:"color,omitempty"`
	// Icon / IconURL / BannerURL are json.RawMessage so that CLEARING one is
	// expressible: `null` (remove the logo) has to be distinguishable from the
	// field being absent (leave it alone), and an omitempty *string cannot say
	// the first. Built with cmdutil.StringOrNullJSON.
	//
	// IconURL is the project's logo — a url this workspace has already uploaded;
	// `bk issues upload <file>` returns one.
	Icon      json.RawMessage `json:"icon,omitempty"`
	IconURL   json.RawMessage `json:"icon_url,omitempty"`
	BannerURL json.RawMessage `json:"banner_url,omitempty"`
	// LeadUserID is `lead_user_id` on the wire and `owner_id` in the column.
	// Sending `owner_id` is accepted by no write path — the web settings modal
	// did exactly that and its lead changes were dropped (fixed 2026-08-13).
	// json.RawMessage so `null` (clear the lead) is distinguishable from unset.
	LeadUserID json.RawMessage `json:"lead_user_id,omitempty"`
	StartDate  *string         `json:"start_date,omitempty"`
	DueDate    *string         `json:"due_date,omitempty"`
}

type UpdateProjectRequest struct {
	Name        *string `json:"name,omitempty"`
	Summary     *string `json:"summary,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty"`
	Priority    *string `json:"priority,omitempty"`
	Visibility  *string `json:"visibility,omitempty"`
	Color       *string `json:"color,omitempty"`
	/* See CreateProjectRequest for icon / icon_url / banner_url / lead_user_id. */
	Icon       json.RawMessage `json:"icon,omitempty"`
	IconURL    json.RawMessage `json:"icon_url,omitempty"`
	BannerURL  json.RawMessage `json:"banner_url,omitempty"`
	LeadUserID json.RawMessage `json:"lead_user_id,omitempty"`
	StartDate  *string         `json:"start_date,omitempty"`
	DueDate    *string         `json:"due_date,omitempty"`
}

type AddMemberRequest struct {
	Email string `json:"email"`
	Role  string `json:"role,omitempty"`
}

// No Status field on either request, deliberately: a task's status is derived
// from its issues. Both routes answer `task_status_derived` if one is sent.
type CreateTaskRequest struct {
	ProjectID   int     `json:"project_id"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	DueDate     *string `json:"due_date,omitempty"`
	// RawMessage so `--lead none` can send an explicit JSON null. Omitted and
	// null are DIFFERENT requests here: omitted defaults the lead to you,
	// null means the task has no lead. A *int could not express the second.
	LeadUserID json.RawMessage `json:"lead_user_id,omitempty"`
}

type UpdateTaskRequest struct {
	Name        *string         `json:"name,omitempty"`
	Description *string         `json:"description,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
	// RawMessage, not *int: `--lead none` must send an explicit JSON null to
	// clear it, and omitempty would drop a *int(nil) rather than sending null.
	LeadUserID json.RawMessage `json:"lead_user_id,omitempty"`
}

type CreateCommentRequest struct {
	Content         string `json:"content"`
	ParentCommentID int    `json:"parent_comment_id,omitempty"`
}

type UploadResponse struct {
	URL         string `json:"url" yaml:"url"`
	Filename    string `json:"filename" yaml:"filename"`
	Size        int    `json:"size" yaml:"size"`
	ContentType string `json:"contentType" yaml:"contentType"`
}

type Attachment struct {
	ID         int     `json:"id" yaml:"id"`
	IssueID    int     `json:"issue_id" yaml:"issue_id"`
	Filename   string  `json:"filename" yaml:"filename"`
	FileURL    string  `json:"file_url" yaml:"file_url"`
	FileSize   *int    `json:"file_size" yaml:"file_size"`
	MimeType   string  `json:"mime_type" yaml:"mime_type"`
	UploadedBy *int    `json:"uploaded_by,omitempty" yaml:"uploaded_by,omitempty"`
	CreatedAt  *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
}

// WorkspaceAttachment is one row of the owner-only workspace-wide attachments
// view (the `attachments` table joined to its issue + uploader).
type WorkspaceAttachment struct {
	ID           int     `json:"id" yaml:"id"`
	IssueID      int     `json:"issue_id" yaml:"issue_id"`
	IssueSeq     *int    `json:"issue_seq" yaml:"issue_seq"`
	IssueTitle   *string `json:"issue_title" yaml:"issue_title"`
	Filename     string  `json:"filename" yaml:"filename"`
	FileURL      string  `json:"file_url" yaml:"file_url"`
	FileSize     *int    `json:"file_size" yaml:"file_size"`
	MimeType     *string `json:"mime_type" yaml:"mime_type"`
	UploaderName *string `json:"uploader_name,omitempty" yaml:"uploader_name,omitempty"`
	CreatedAt    *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
}

type workspaceAttachmentsEnvelope struct {
	Data []WorkspaceAttachment `json:"data" yaml:"data"`
}

// StorageReference is one thing that references a stored file.
type StorageReference struct {
	// App that owns the referencing row (Phase 7). Empty for a server that
	// predates it.
	App     string  `json:"app,omitempty" yaml:"app,omitempty"`
	Type    string  `json:"type" yaml:"type"`
	ID      int     `json:"id" yaml:"id"`
	Seq     *int    `json:"seq" yaml:"seq"`
	Label   *string `json:"label" yaml:"label"`
	Trashed bool    `json:"trashed" yaml:"trashed"`
}

// StorageFile is one file in workspace storage with its live references.
type StorageFile struct {
	ID int `json:"id" yaml:"id"`
	// Which app wrote the file. Null/empty for rows a pre-Phase-7 server wrote.
	App            *string            `json:"app,omitempty" yaml:"app,omitempty"`
	URL            string             `json:"url" yaml:"url"`
	Filename       string             `json:"filename" yaml:"filename"`
	Size           *int               `json:"size" yaml:"size"`
	MimeType       *string            `json:"mime_type" yaml:"mime_type"`
	UploaderName   *string            `json:"uploader_name,omitempty" yaml:"uploader_name,omitempty"`
	CreatedAt      *string            `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	ReferenceCount int                `json:"reference_count" yaml:"reference_count"`
	References     []StorageReference `json:"references" yaml:"references"`
}

// StorageListing is the GET /storage response: files + workspace usage.
type StorageListing struct {
	Data       []StorageFile `json:"data" yaml:"data"`
	Total      int           `json:"total" yaml:"total"`
	UsageBytes int64         `json:"usage_bytes" yaml:"usage_bytes"`
	LimitBytes *int64        `json:"limit_bytes" yaml:"limit_bytes"`
}

// AnalyticsPayload is a partial view of the analytics API response — enough to
// render the default summary table. JSON/YAML output uses the full raw payload,
// so this only needs the fields the table shows.
type AnalyticsPayload struct {
	Scope struct {
		Type  string `json:"type"`
		Label string `json:"label"`
	} `json:"scope"`
	Period struct {
		From     *string `json:"from"`
		To       *string `json:"to"`
		Interval string  `json:"interval"`
	} `json:"period"`
	Summary struct {
		TotalIssues          int      `json:"total_issues"`
		Open                 int      `json:"open"`
		InProgress           int      `json:"in_progress"`
		Done                 int      `json:"done"`
		Cancelled            int      `json:"cancelled"`
		Overdue              int      `json:"overdue"`
		Unassigned           int      `json:"unassigned"`
		CreatedInPeriod      int      `json:"created_in_period"`
		CompletedInPeriod    int      `json:"completed_in_period"`
		CompletionRate       float64  `json:"completion_rate"`
		AvgCycleTimeHours    *float64 `json:"avg_cycle_time_hours"`
		MedianCycleTimeHours *float64 `json:"median_cycle_time_hours"`
		ActiveMembers        int      `json:"active_members_in_period"`
		TotalMembers         int      `json:"total_members"`
	} `json:"summary"`
	ByStatus []struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	} `json:"by_status"`
	ByPriority []struct {
		Priority int `json:"priority"`
		Count    int `json:"count"`
	} `json:"by_priority"`
	ByAssignee []struct {
		Name  *string `json:"name"`
		Email string  `json:"email"`
		Open  int     `json:"open"`
		Done  int     `json:"done"`
	} `json:"by_assignee"`
	Message string `json:"message,omitempty"`
}

// ProjectUpdate is a single health/status post on a project.
type ProjectUpdate struct {
	ID          int     `json:"id" yaml:"id"`
	WorkspaceID int     `json:"workspace_id" yaml:"workspace_id"`
	ProjectID   int     `json:"project_id" yaml:"project_id"`
	Status      string  `json:"status" yaml:"status"`
	Body        *string `json:"body" yaml:"body"`
	AuthorID    int     `json:"author_id" yaml:"author_id"`
	AuthorName  *string `json:"author_name,omitempty" yaml:"author_name,omitempty"`
	CreatedAt   *string `json:"created_at" yaml:"created_at"`
	UpdatedAt   *string `json:"updated_at" yaml:"updated_at"`
}

type CreateProjectUpdateRequest struct {
	Status string  `json:"status"`
	Body   *string `json:"body,omitempty"`
}

// APIToken is a stored API token record (plaintext is never returned after creation).
type APIToken struct {
	ID         int      `json:"id" yaml:"id"`
	Name       string   `json:"name" yaml:"name"`
	Prefix     string   `json:"token_prefix" yaml:"prefix"`
	Scopes     []string `json:"scopes" yaml:"scopes"`
	LastUsedAt *string  `json:"last_used_at" yaml:"last_used_at"`
	ExpiresAt  *string  `json:"expires_at" yaml:"expires_at"`
	CreatedAt  *string  `json:"created_at" yaml:"created_at"`
}

// CreatedToken is returned once on token creation, includes the plaintext.
type CreatedToken struct {
	ID        int      `json:"id" yaml:"id"`
	Name      string   `json:"name" yaml:"name"`
	Token     string   `json:"plaintext" yaml:"token"`
	Prefix    string   `json:"prefix" yaml:"prefix"`
	Scopes    []string `json:"scopes" yaml:"scopes"`
	ExpiresAt *string  `json:"expires_at" yaml:"expires_at"`
	CreatedAt *string  `json:"created_at" yaml:"created_at"`
}

// WorkspaceComment is a comment returned from workspace-scoped endpoints
// (issues, tasks, projects). Has richer parent fields than the legacy Comment.
type WorkspaceComment struct {
	ID              int     `json:"id" yaml:"id"`
	WorkspaceID     int     `json:"workspace_id" yaml:"workspace_id"`
	ParentType      string  `json:"parent_type" yaml:"parent_type"`
	ParentID        int     `json:"parent_id" yaml:"parent_id"`
	UserID          *int    `json:"user_id" yaml:"user_id"`
	Content         string  `json:"content" yaml:"content"`
	ParentCommentID *int    `json:"parent_comment_id" yaml:"parent_comment_id"`
	EditedAt        *string `json:"edited_at" yaml:"edited_at"`
	AuthorName      *string `json:"author_name,omitempty" yaml:"author_name,omitempty"`
	AuthorEmail     *string `json:"author_email,omitempty" yaml:"author_email,omitempty"`
	AuthorAvatar    *string `json:"author_avatar,omitempty" yaml:"author_avatar,omitempty"`
	CreatedAt       *string `json:"created_at" yaml:"created_at"`
	UpdatedAt       *string `json:"updated_at" yaml:"updated_at"`
}

// InviteCandidate is a person the active workspace's owner can invite without
// retyping an email (e.g. someone they already share another workspace with).
// Fields are treated permissively; extra fields from the server are ignored.
type InviteCandidate struct {
	ID                  int     `json:"id" yaml:"id"`
	Name                *string `json:"name" yaml:"name"`
	Email               string  `json:"email" yaml:"email"`
	AvatarURL           *string `json:"avatar_url" yaml:"avatar_url"`
	AlreadyMember       bool    `json:"already_member" yaml:"already_member"`
	Invited             bool    `json:"invited" yaml:"invited"`
	SharedWorkspaceName *string `json:"shared_workspace_name,omitempty" yaml:"shared_workspace_name,omitempty"`
}

type UpdateProfileRequest struct {
	Name      *string `json:"name,omitempty"`
	Tagline   *string `json:"tagline,omitempty"`
	AvatarURL *string `json:"avatar_url,omitempty"`
}

// --- Recycle bin (trash) ---

// TrashEntityRef identifies one binned item.
//
// `Number` is the workspace #number and is what this binary SENDS — the same
// address `bk issue view` and every URN uses. `ID` is the row id: never sent,
// only read back from a response that still carries it.
//
// The two are separate fields rather than one renamed field, and that is
// load-bearing. Before 1.12.0 this struct sent `id` meaning the row id; if the
// server had simply reinterpreted `id` as a #number, every INSTALLED binary
// would have gone on sending row ids into the purge path and deleted whatever
// happened to have that #number. Distinct names make the two eras
// distinguishable, so an old client keeps working and a new one is unambiguous.
type TrashEntityRef struct {
	Type   string `json:"type" yaml:"type"`
	Number int    `json:"number,omitempty" yaml:"number,omitempty"`
	ID     int    `json:"id,omitempty" yaml:"id,omitempty"`
}

// TrashItem is one row in the recycle bin.
type TrashItem struct {
	Type          string  `json:"type" yaml:"type"`
	ID            int     `json:"id" yaml:"id"`
	Title         string  `json:"title" yaml:"title"`
	Seq           *int    `json:"seq" yaml:"seq"`
	Status        *string `json:"status" yaml:"status"`
	DeletedAt     string  `json:"deleted_at" yaml:"deleted_at"`
	DeletedByID   *int    `json:"deleted_by_id" yaml:"deleted_by_id"`
	DeletedByName *string `json:"deleted_by_name" yaml:"deleted_by_name"`
	BatchID       *int    `json:"batch_id" yaml:"batch_id"`
	BatchMode     *string `json:"batch_mode" yaml:"batch_mode"`
	BatchRootType *string `json:"batch_root_type" yaml:"batch_root_type"`
	BatchRootID   *int    `json:"batch_root_id" yaml:"batch_root_id"`
	ProjectID     *int    `json:"project_id" yaml:"project_id"`
	TaskID        *int    `json:"task_id" yaml:"task_id"`
}

// RestoreTrashRequest restores either a whole batch or an explicit item list.
// Resolutions are keyed "type:id" → "restore_parent" | "standalone".
type RestoreTrashRequest struct {
	BatchID     *int              `json:"batch_id,omitempty"`
	Items       []TrashEntityRef  `json:"items,omitempty"`
	Resolutions map[string]string `json:"resolutions,omitempty"`
}

type RestoreTrashResponse struct {
	Restored []TrashEntityRef `json:"restored"`
	Count    int              `json:"count"`
}

// PurgedItem is one thing a purge destroyed, captured server-side BEFORE the row
// was removed — the only moment its title still existed.
//
// Purge is the product's one irreversible action, so it reports WHAT it
// destroyed rather than only how many. That is also the last line of defence
// against a stale ref: a caller that pasted a pre-1.12.0 row id as a #number
// sees the title of what it actually deleted.
type PurgedItem struct {
	Type   string `json:"type" yaml:"type"`
	ID     int    `json:"id" yaml:"id"`
	Number *int   `json:"number" yaml:"number"`
	Title  string `json:"title" yaml:"title"`
}

// PurgeTrashResult is what `purge` and `empty` report back.
type PurgeTrashResult struct {
	Purged int          `json:"purged" yaml:"purged"`
	Items  []PurgedItem `json:"items" yaml:"items"`
	// Set by `empty` when more was destroyed than is listed. Purged is always
	// exact; Items is a sample, and a sample that reads as the whole list is its
	// own kind of lie.
	ItemsTruncated int `json:"items_truncated,omitempty" yaml:"items_truncated,omitempty"`
}

// PurgeTrashRequest permanently deletes a batch or an explicit item list.
type PurgeTrashRequest struct {
	BatchID *int             `json:"batch_id,omitempty"`
	Items   []TrashEntityRef `json:"items,omitempty"`
}

// ---- cross-app primitives (Phase 6) ----
//
// An Entity is one row of platform.entities: whatever an app has made
// addressable by URN. The CLI never has to know what an "issue" is to print one
// — which is the point of the projection, and why `bk search` works unchanged
// the day a second app starts writing to it.

type Entity struct {
	URN        string  `json:"urn" yaml:"urn"`
	App        string  `json:"app" yaml:"app"`
	EntityType string  `json:"entity_type" yaml:"entity_type"`
	Number     int     `json:"number" yaml:"number"`
	Title      string  `json:"title" yaml:"title"`
	URL        *string `json:"url,omitempty" yaml:"url,omitempty"`
	UpdatedAt  *string `json:"updated_at,omitempty" yaml:"updated_at,omitempty"`
	DeletedAt  *string `json:"deleted_at,omitempty" yaml:"deleted_at,omitempty"`
}

// `Link`, `CreateLinkRequest` and `CreateLinkResponse` were here until
// 2026-08-12. They decoded `bk link`'s three responses; the command went on
// 2026-08-10 and the route factory behind it went with these. Cross-app
// references are not supported — the far end's URN goes in the record's own
// text, which is a string and needs no type. `bk guide platform/cross-app`.

// EntityDriftReport is the reconciliation job's answer: how many rows the
// projection and the source tables disagree about, and which.
type EntityDriftReport struct {
	Scope           string         `json:"scope" yaml:"scope"`
	SourceCounts    map[string]int `json:"source_counts" yaml:"source_counts"`
	ProjectedCounts map[string]int `json:"projected_counts" yaml:"projected_counts"`
	CountsMatch     bool           `json:"counts_match" yaml:"counts_match"`
	DriftCount      int            `json:"drift_count" yaml:"drift_count"`
	Drift           []EntityDrift  `json:"drift" yaml:"drift"`
	DriftTruncated  int            `json:"drift_truncated" yaml:"drift_truncated"`
	Repaired        int            `json:"repaired" yaml:"repaired"`
}

type EntityDrift struct {
	URN        string `json:"urn" yaml:"urn"`
	EntityType string `json:"entity_type" yaml:"entity_type"`
	Number     int    `json:"number" yaml:"number"`
	Kind       string `json:"kind" yaml:"kind"`
	Detail     string `json:"detail" yaml:"detail"`
}

// BlobDriftReport is the storage reconciler's answer. The two counts are kept
// apart on purpose: `missing` is a file that another deployment could delete
// while it is still in use, `orphaned` is only leaked bytes. Collapsing them
// into one number would hide the difference between "act now" and "tidy up".
type BlobDriftReport struct {
	Scope         string         `json:"scope" yaml:"scope"`
	ScannedCounts map[string]int `json:"scanned_counts" yaml:"scanned_counts"`
	IndexedCounts map[string]int `json:"indexed_counts" yaml:"indexed_counts"`
	MissingCount  int            `json:"missing_count" yaml:"missing_count"`
	OrphanedCount int            `json:"orphaned_count" yaml:"orphaned_count"`
	DriftCount    int            `json:"drift_count" yaml:"drift_count"`
	// Index rows no workspace pass could reach — `workspace_id` null, or pointing
	// at a workspace that is gone. NOT drift: rows nobody looked at. Kept as its
	// own number because a zero DriftCount over a partially-examined index is the
	// most reassuring wrong answer this report can give.
	UnreconciledCount int         `json:"unreconciled_count" yaml:"unreconciled_count"`
	Drift             []BlobDrift `json:"drift" yaml:"drift"`
	DriftTruncated    int         `json:"drift_truncated" yaml:"drift_truncated"`
	Repaired          int         `json:"repaired" yaml:"repaired"`
}

type BlobDrift struct {
	URL         string `json:"url" yaml:"url"`
	App         string `json:"app" yaml:"app"`
	SourceType  string `json:"source_type" yaml:"source_type"`
	SourceID    int    `json:"source_id" yaml:"source_id"`
	WorkspaceID int    `json:"workspace_id" yaml:"workspace_id"`
	Kind        string `json:"kind" yaml:"kind"`
	Detail      string `json:"detail" yaml:"detail"`
}
