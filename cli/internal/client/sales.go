// Client methods for the sales app — the wire types and the calls behind
// `bk sales …`.
//
// ---------------------------------------------------------------------------
// `Number`, NEVER `ID`
// ---------------------------------------------------------------------------
// Every sales entity is addressed by its workspace #number. The serial row id is
// not served by any route and must not appear in a struct here: once it reaches
// a caller it ends up in a script, and then it is a contract nobody agreed to.
//
// ---------------------------------------------------------------------------
// MONEY AND DATES ARRIVE AS STRINGS, ON PURPOSE
// ---------------------------------------------------------------------------
// `Value` is `numeric(14,2)` and arrives as `"24000.00"`. Decoding it into a
// float64 would round it, silently, in a CRM — and no consumer of this CLI does
// arithmetic on a deal value. `NextAction.Due` is a Postgres `date`
// (`"2026-08-11"`), not an instant: parsing it into a time.Time would make it
// midnight in some timezone, and a due date has no time of day.
package client

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// SalesLabel is a `platform.labels` row attached to a prospect, app-scoped to
// sales (D-14).
type SalesLabel struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Color string `json:"color" yaml:"color"`
}

// SalesOwner is the deal owner — a real platform user. Unlike the actor labels
// elsewhere in this app, this is never an agent: an agent can log a call and
// write history, it cannot own a deal.
type SalesOwner struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Email string `json:"email" yaml:"email"`
}

// SalesNextAction is what the owner owes this prospect next.
//
// `Due` is the resolved date and `DueLabel` is the phrase the agent actually
// wrote ("this week"). The label is displayed in preference to the date and
// never parsed — the difference between "due Friday" and "sometime this week,
// Friday is my guess" is exactly what a human needs when the follow-up is late.
type SalesNextAction struct {
	Type     string `json:"type" yaml:"type"`
	Due      string `json:"due" yaml:"due"`
	DueLabel string `json:"due_label" yaml:"due_label"`
	Note     string `json:"note" yaml:"note"`
	Owner    string `json:"owner" yaml:"owner"`
}

// SalesJourneyStep is one rung of the deal ladder, including the ones not
// reached yet (`status: upcoming`, with no date and no actor).
type SalesJourneyStep struct {
	Stage      string `json:"stage" yaml:"stage"`
	Status     string `json:"status" yaml:"status"`
	OccurredAt string `json:"occurred_at" yaml:"occurred_at"`
	Actor      string `json:"actor" yaml:"actor"`
	Note       string `json:"note" yaml:"note"`
}

// Prospect is the core object: the company AND the deal in one row (D-5).
type Prospect struct {
	Number int    `json:"number" yaml:"number"`
	Name   string `json:"name" yaml:"name"`
	City   string `json:"city" yaml:"city"`
	Sector string `json:"sector" yaml:"sector"`
	// The identity card (sales #34, migration 0008). `website` is the COMPANY's
	// site; a PERSON's link is SalesContact.LinkedIn.
	Website string `json:"website" yaml:"website"`
	Address string `json:"address" yaml:"address"`
	// The segment strategy this prospect belongs to (#37), by #NUMBER — never
	// the row id. Zero means unlinked. `GamePlan` is the angle for THIS
	// prospect on top of the shared one (#35).
	Strategy     int             `json:"strategy" yaml:"strategy"`
	GamePlan     string          `json:"game_plan" yaml:"game_plan"`
	Stage        string          `json:"stage" yaml:"stage"`
	Value        string          `json:"value" yaml:"value"`
	Currency     string          `json:"currency" yaml:"currency"`
	Owner        *SalesOwner     `json:"owner" yaml:"owner"`
	Source       string          `json:"source" yaml:"source"`
	Summary      string          `json:"summary" yaml:"summary"`
	NextAction   SalesNextAction `json:"next_action" yaml:"next_action"`
	ClosedAt     string          `json:"closed_at" yaml:"closed_at"`
	ClosedReason string          `json:"closed_reason" yaml:"closed_reason"`
	Labels       []SalesLabel    `json:"labels" yaml:"labels"`
	URN          string          `json:"urn" yaml:"urn"`
	CreatedAt    string          `json:"created_at" yaml:"created_at"`
	UpdatedAt    string          `json:"updated_at" yaml:"updated_at"`
	DeletedAt    string          `json:"deleted_at" yaml:"deleted_at"`

	// Served by the single-prospect route only; empty on a listing.
	Journey []SalesJourneyStep `json:"journey,omitempty" yaml:"journey,omitempty"`
	// Likewise — and it is here because sales #34 and #33 were both filed as
	// "the prospect record holds nothing about the people" while `contacts` had
	// held name/role/email/phone/notes since day one. They were reachable only
	// through `bk sales contact list <n>`, which is a command you have to know
	// exists. `prospect show` prints them now.
	Contacts []SalesContact `json:"contacts,omitempty" yaml:"contacts,omitempty"`

	// There is no `Links` field, and `SalesLink` is gone (2026-08-12). The
	// prospect route stopped serving `links` on 2026-08-10 when this app
	// stopped reading `platform.links`, so the struct decoded an absent key
	// into an empty slice on every call and `prospect show` printed a LINKED
	// section that could not appear. Cross-app references are not supported;
	// the far end's URN goes in the prospect's own summary.
}

// SalesDeleted is what an irreversible sales command prints: WHAT was destroyed,
// captured by the server before the delete. A count alone is the difference
// between a mistake caught in a minute and one found in a month.
type SalesDeleted struct {
	Deleted bool   `json:"deleted" yaml:"deleted"`
	Type    string `json:"type" yaml:"type"`
	Number  int    `json:"number" yaml:"number"`
	Name    string `json:"name" yaml:"name"`
}

// ListProspectsOpts mirrors `bk sales prospect list`'s flags. Zero values mean
// "no filter", so an empty struct is the whole workspace.
type ListProspectsOpts struct {
	Stages         []string
	Owner          string // an email, or the literal "me"
	Label          string
	Query          string
	Limit          int
	Cursor         int
	IncludeDeleted bool
}

// ProspectsPage is the `{ data, next_cursor }` envelope every list route serves.
type ProspectsPage struct {
	Data       []Prospect `json:"data" yaml:"data"`
	NextCursor *int       `json:"next_cursor" yaml:"next_cursor"`
}

func (c *Client) ListProspects(slugOrID string, opts ListProspectsOpts) (*ProspectsPage, error) {
	q := url.Values{}
	if len(opts.Stages) > 0 {
		q.Set("stage", strings.Join(opts.Stages, ","))
	}
	if s := strings.TrimSpace(opts.Owner); s != "" {
		q.Set("owner", s)
	}
	if s := strings.TrimSpace(opts.Label); s != "" {
		q.Set("label", s)
	}
	if s := strings.TrimSpace(opts.Query); s != "" {
		q.Set("q", s)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor > 0 {
		q.Set("cursor", strconv.Itoa(opts.Cursor))
	}
	if opts.IncludeDeleted {
		q.Set("include_deleted", "true")
	}

	path := salesPath(slugOrID, "prospects")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page ProspectsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) GetProspect(slugOrID string, number int) (*Prospect, error) {
	var p Prospect
	if err := c.get(salesPath(slugOrID, fmt.Sprintf("prospects/%d", number)), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// CreateProspectRequest is the POST body. Every field is `omitempty` so an unset
// flag is ABSENT rather than an empty string — the route distinguishes the two,
// and sending `""` for a city would store an empty city.
type CreateProspectRequest struct {
	Name     string `json:"name"`
	City     string `json:"city,omitempty"`
	Sector   string `json:"sector,omitempty"`
	Website  string `json:"website,omitempty"`
	Address  string `json:"address,omitempty"`
	Strategy int    `json:"strategy,omitempty"`
	GamePlan string `json:"game_plan,omitempty"`
	Stage    string `json:"stage,omitempty"`
	Value    string `json:"value,omitempty"`
	Currency string `json:"currency,omitempty"`
	Owner    string `json:"owner,omitempty"`
	Source   string `json:"source,omitempty"`
	Summary  string `json:"summary,omitempty"`
}

func (c *Client) CreateProspect(slugOrID string, req CreateProspectRequest) (*Prospect, error) {
	var p Prospect
	if err := c.postJSON(salesPath(slugOrID, "prospects"), req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// NullString is a PATCH field that can be CLEARED.
//
// A PATCH has three states per field and a plain `string` can only express two.
// `nil` (the field omitted) means "leave it alone"; a pointer to "" marshals to
// JSON `null`, which the route reads as "clear it"; anything else is the new
// value. Without the third state there is no way to remove a city or unassign
// an owner, and the symptom is a flag that appears to do nothing.
//
// `omitempty` on a POINTER omits only when the pointer is nil — which is
// exactly the "absent" case — so the empty string still reaches MarshalJSON.
// This does not work with a plain `*string`: `omitempty` would keep it, and it
// would marshal to `""`, which the route's `str()` treats as absent.
type NullString string

func (n NullString) MarshalJSON() ([]byte, error) {
	if n == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(n))
}

// Clear is the explicit "remove this field" value, spelled so a call site reads
// as an intention rather than as an empty string somebody forgot to fill in.
func Clear() *NullString { return Set("") }

// Set wraps a value for a PATCH field.
func Set(v string) *NullString { n := NullString(v); return &n }

// UpdateProspectRequest is the PATCH body. See NullString for the three states.
type UpdateProspectRequest struct {
	Name    *NullString `json:"name,omitempty"`
	City    *NullString `json:"city,omitempty"`
	Sector  *NullString `json:"sector,omitempty"`
	Website *NullString `json:"website,omitempty"`
	Address *NullString `json:"address,omitempty"`
	// `*NullString` rather than `*int` so `--strategy ""` can UNLINK: the same
	// three states every other patchable field has. The route reads a JSON
	// number, a numeric string or null.
	Strategy *NullString `json:"strategy,omitempty"`
	GamePlan *NullString `json:"game_plan,omitempty"`
	Value    *NullString `json:"value,omitempty"`
	Currency *NullString `json:"currency,omitempty"`
	Owner    *NullString `json:"owner,omitempty"`
	Source   *NullString `json:"source,omitempty"`
	Summary  *NullString `json:"summary,omitempty"`
}

func (c *Client) UpdateProspect(slugOrID string, number int, req UpdateProspectRequest) (*Prospect, error) {
	var p Prospect
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d", number))
	if err := c.patchJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// SetProspectStageRequest moves a deal. `Reason` is only read for a terminal
// stage; `Note` becomes the journey step's note either way.
type SetProspectStageRequest struct {
	Stage  string `json:"stage"`
	Note   string `json:"note,omitempty"`
	Reason string `json:"reason,omitempty"`
}

func (c *Client) SetProspectStage(slugOrID string, number int, req SetProspectStageRequest) (*Prospect, error) {
	var p Prospect
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d/stage", number))
	if err := c.postJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteProspect bins a prospect. `confirm` must be the company's name and is
// checked BY THE SERVER — see the route's header. Sending it from here is not
// the guard; it is how the guard is satisfied.
func (c *Client) DeleteProspect(slugOrID string, number int, confirm string) (*SalesDeleted, error) {
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d", number)) +
		"?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// salesPath builds a workspace-scoped path for an explicitly named workspace.
//
// It does NOT use `c.wsPath`, which reads the client's cached active workspace:
// every sales command resolves the workspace itself (--ws, then the active one)
// and passes it in, so there is one place where "which workspace" is decided
// rather than two that can disagree.
func salesPath(slugOrID, suffix string) string {
	return "/api/workspaces/" + slugOrID + "/" + suffix
}

// ---------------------------------------------------------------------------
// The prospect's children — reached BY ROW ID, and that is not a slip
// ---------------------------------------------------------------------------
// A contact, a journey step, an objection and a match have no #number: none is
// independently addressable and none is projected into `platform.entities`, so
// there is no URN and nothing for `bk search` to return. They are reached
// through their prospect, by the id their own listing prints — which is exactly
// how `bk issues issue delete-comment` reaches a comment.
//
// The rule, in one line: a record with a URN is addressed by its #number and its
// row id is never exposed; a record without one is reached through its parent.

type SalesContact struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Role  string `json:"role" yaml:"role"`
	Email string `json:"email" yaml:"email"`
	Phone string `json:"phone" yaml:"phone"`
	// Migration 0008. LinkedIn is sales #34's one genuinely homeless identity
	// field; DecisionPower is #33's structured half — what this person can DO
	// in the deal, as opposed to `Notes`, which is the freeform half and
	// predates the issue.
	LinkedIn      string `json:"linkedin" yaml:"linkedin"`
	DecisionPower string `json:"decision_power" yaml:"decision_power"`
	IsPrimary     bool   `json:"is_primary" yaml:"is_primary"`
	Notes         string `json:"notes" yaml:"notes"`
}

type ContactRequest struct {
	Name          string `json:"name,omitempty"`
	Role          string `json:"role,omitempty"`
	Email         string `json:"email,omitempty"`
	Phone         string `json:"phone,omitempty"`
	LinkedIn      string `json:"linkedin,omitempty"`
	DecisionPower string `json:"decision_power,omitempty"`
	IsPrimary     *bool  `json:"is_primary,omitempty"`
	Notes         string `json:"notes,omitempty"`
}

func (c *Client) ListContacts(ws string, prospect int) ([]SalesContact, error) {
	var resp struct {
		Data []SalesContact `json:"data"`
	}
	if err := c.get(salesPath(ws, fmt.Sprintf("prospects/%d/contacts", prospect)), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) AddContact(ws string, prospect int, req ContactRequest) (*SalesContact, error) {
	var out SalesContact
	p := salesPath(ws, fmt.Sprintf("prospects/%d/contacts", prospect))
	if err := c.postJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateContact(ws string, prospect, contact int, req ContactRequest) (*SalesContact, error) {
	var out SalesContact
	p := salesPath(ws, fmt.Sprintf("prospects/%d/contacts/%d", prospect, contact))
	if err := c.patchJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) RemoveContact(ws string, prospect, contact int) (*SalesDeleted, error) {
	var out SalesDeleted
	p := salesPath(ws, fmt.Sprintf("prospects/%d/contacts/%d", prospect, contact))
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AddJourneyStepRequest records a step that did NOT move the deal. Moving it is
// SetProspectStage — two calls, because a flag defaulting to "also move it"
// would be a second, undocumented way to change a prospect's stage.
type AddJourneyStepRequest struct {
	Stage      string `json:"stage"`
	Status     string `json:"status,omitempty"`
	Note       string `json:"note,omitempty"`
	OccurredAt string `json:"occurred_at,omitempty"`
}

func (c *Client) ListJourney(ws string, prospect int) ([]SalesJourneyStep, error) {
	var resp struct {
		Data []SalesJourneyStep `json:"data"`
	}
	if err := c.get(salesPath(ws, fmt.Sprintf("prospects/%d/journey", prospect)), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) AddJourneyStep(ws string, prospect int, req AddJourneyStepRequest) (*SalesJourneyStep, error) {
	var out SalesJourneyStep
	p := salesPath(ws, fmt.Sprintf("prospects/%d/journey", prospect))
	if err := c.postJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesObjection keeps the three text columns apart: what they SAID, what we
// think they MEAN, and what we say back. Collapsing them would delete the only
// structured sales insight in the product.
type SalesObjection struct {
	ID       int    `json:"id" yaml:"id"`
	Type     string `json:"type" yaml:"type"`
	RaisedBy string `json:"raised_by" yaml:"raised_by"`
	RaisedAt string `json:"raised_at" yaml:"raised_at"`
	Status   string `json:"status" yaml:"status"`
	Spoken   string `json:"spoken" yaml:"spoken"`
	RealFear string `json:"real_fear" yaml:"real_fear"`
	Counter  string `json:"counter" yaml:"counter"`
}

type RaiseObjectionRequest struct {
	Type     string `json:"type"`
	RaisedBy string `json:"raised_by,omitempty"`
	RaisedAt string `json:"raised_at,omitempty"`
	Spoken   string `json:"spoken,omitempty"`
	RealFear string `json:"real_fear,omitempty"`
}

type UpdateObjectionRequest struct {
	Status   string `json:"status,omitempty"`
	Type     string `json:"type,omitempty"`
	Spoken   string `json:"spoken,omitempty"`
	RealFear string `json:"real_fear,omitempty"`
	Counter  string `json:"counter,omitempty"`
}

func (c *Client) ListObjections(ws string, prospect int) ([]SalesObjection, error) {
	var resp struct {
		Data []SalesObjection `json:"data"`
	}
	if err := c.get(salesPath(ws, fmt.Sprintf("prospects/%d/objections", prospect)), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RaiseObjection(ws string, prospect int, req RaiseObjectionRequest) (*SalesObjection, error) {
	var out SalesObjection
	p := salesPath(ws, fmt.Sprintf("prospects/%d/objections", prospect))
	if err := c.postJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateObjection(ws string, prospect, objection int, req UpdateObjectionRequest) (*SalesObjection, error) {
	var out SalesObjection
	p := salesPath(ws, fmt.Sprintf("prospects/%d/objections/%d", prospect, objection))
	if err := c.patchJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesObjectionDeleted is what an objection removal reports. The row is GONE —
// objections carry no bin state — so this echo and the event are the only
// remaining record of what it said.
type SalesObjectionDeleted struct {
	Deleted       bool   `json:"deleted" yaml:"deleted"`
	ID            int    `json:"id" yaml:"id"`
	ObjectionType string `json:"objection_type" yaml:"objection_type"`
	Spoken        string `json:"spoken" yaml:"spoken"`
}

func (c *Client) DeleteObjection(ws string, prospect, objection int, confirm string) (*SalesObjectionDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("prospects/%d/objections/%d", prospect, objection)) +
		"?confirm=" + url.QueryEscape(confirm)
	var out SalesObjectionDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesMatch is the agent's stored verdict for one (prospect, product) pair.
// The app never computes it — see the route.
type SalesMatch struct {
	ProductNumber  int    `json:"product_number" yaml:"product_number"`
	ProductName    string `json:"product_name" yaml:"product_name"`
	TemplateNumber *int   `json:"template_number" yaml:"template_number"`
	TemplateName   string `json:"template_name" yaml:"template_name"`
	Fit            *int   `json:"fit" yaml:"fit"`
	Why            string `json:"why" yaml:"why"`
	ComputedAt     string `json:"computed_at" yaml:"computed_at"`
	ComputedBy     string `json:"computed_by" yaml:"computed_by"`
}

type SetMatchRequest struct {
	Product  int    `json:"product"`
	Fit      *int   `json:"fit,omitempty"`
	Template *int   `json:"template,omitempty"`
	Why      string `json:"why,omitempty"`
}

func (c *Client) ListMatches(ws string, prospect int) ([]SalesMatch, error) {
	var resp struct {
		Data []SalesMatch `json:"data"`
	}
	if err := c.get(salesPath(ws, fmt.Sprintf("prospects/%d/matches", prospect)), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) SetMatch(ws string, prospect int, req SetMatchRequest) (*SalesMatch, error) {
	var out SalesMatch
	p := salesPath(ws, fmt.Sprintf("prospects/%d/matches", prospect))
	if err := c.postJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesStrategy is a segment strategy (#37): WHY a vertical/area was chosen and
// what we lead with. Reusable across prospects, and addressable — it has a
// #number and a URN, unlike the five prospect children.
type SalesStrategy struct {
	Number      int                    `json:"number" yaml:"number"`
	Name        string                 `json:"name" yaml:"name"`
	Vertical    string                 `json:"vertical" yaml:"vertical"`
	Area        string                 `json:"area" yaml:"area"`
	Rationale   string                 `json:"rationale" yaml:"rationale"`
	CaseStudies string                 `json:"case_studies" yaml:"case_studies"`
	Products    []SalesStrategyProduct `json:"products" yaml:"products"`
	// How many live deals this segment covers. The number you want before
	// retiring one — the server reports it rather than making the caller count.
	ProspectCount int    `json:"prospect_count" yaml:"prospect_count"`
	URN           string `json:"urn" yaml:"urn"`
	CreatedAt     string `json:"created_at" yaml:"created_at"`
	UpdatedAt     string `json:"updated_at" yaml:"updated_at"`
	DeletedAt     string `json:"deleted_at" yaml:"deleted_at"`

	// Served by the single-strategy route only; empty on a listing.
	Prospects []SalesStrategyProspect `json:"prospects,omitempty" yaml:"prospects,omitempty"`
}

type SalesStrategyProduct struct {
	Number int    `json:"number" yaml:"number"`
	Name   string `json:"name" yaml:"name"`
}

type SalesStrategyProspect struct {
	Number int    `json:"number" yaml:"number"`
	Name   string `json:"name" yaml:"name"`
	Stage  string `json:"stage" yaml:"stage"`
}

// StrategyRequest is both the POST body and the PATCH body.
//
// `Products` is a POINTER to a slice so the three states stay distinct on the
// wire: nil omits the key (leave the set alone), an empty non-nil slice
// marshals to `[]` (clear it), and a populated one replaces it. A plain
// `[]int` with `omitempty` would make "clear" unexpressible — the same trap
// NullString exists for on the string fields.
type StrategyRequest struct {
	Name        string      `json:"name,omitempty"`
	Vertical    *NullString `json:"vertical,omitempty"`
	Area        *NullString `json:"area,omitempty"`
	Rationale   *NullString `json:"rationale,omitempty"`
	CaseStudies *NullString `json:"case_studies,omitempty"`
	Products    *[]int      `json:"products,omitempty"`
}

func (c *Client) ListStrategies(ws, query string) ([]SalesStrategy, error) {
	var resp struct {
		Data []SalesStrategy `json:"data"`
	}
	p := salesPath(ws, "strategies")
	if q := strings.TrimSpace(query); q != "" {
		p += "?q=" + url.QueryEscape(q)
	}
	if err := c.get(p, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetStrategy(ws string, number int) (*SalesStrategy, error) {
	var out SalesStrategy
	if err := c.get(salesPath(ws, fmt.Sprintf("strategies/%d", number)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateStrategy(ws string, req StrategyRequest) (*SalesStrategy, error) {
	var out SalesStrategy
	if err := c.postJSON(salesPath(ws, "strategies"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateStrategy(ws string, number int, req StrategyRequest) (*SalesStrategy, error) {
	var out SalesStrategy
	p := salesPath(ws, fmt.Sprintf("strategies/%d", number))
	if err := c.patchJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesStrategyDeleted carries `prospect_count` because binning a segment leaves
// that many live deals pointing at something no longer in the listing, and the
// caller should learn it from the command rather than from a prospect page
// three days later.
type SalesStrategyDeleted struct {
	Deleted       bool   `json:"deleted" yaml:"deleted"`
	Type          string `json:"type" yaml:"type"`
	Number        int    `json:"number" yaml:"number"`
	Name          string `json:"name" yaml:"name"`
	ProspectCount int    `json:"prospect_count" yaml:"prospect_count"`
}

func (c *Client) DeleteStrategy(ws string, number int) (*SalesStrategyDeleted, error) {
	var out SalesStrategyDeleted
	p := salesPath(ws, fmt.Sprintf("strategies/%d", number))
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesProspectNote is one entry of a prospect's research log (#39).
//
// `ID`, not `Number`: a note is never addressed on its own, so it has no
// #number — the same call the four other prospect children make.
//
// There is NO UpdateProspectNote and no `edit` command. The log is append-only:
// `prospect edit --summary` is the field you overwrite, and this is the one you
// add to. See the route header.
type SalesProspectNote struct {
	ID        int    `json:"id" yaml:"id"`
	Body      string `json:"body" yaml:"body"`
	Kind      string `json:"kind" yaml:"kind"`
	Author    string `json:"author" yaml:"author"`
	CreatedAt string `json:"created_at" yaml:"created_at"`
}

type AddProspectNoteRequest struct {
	Body string `json:"body"`
	Kind string `json:"kind,omitempty"`
}

func (c *Client) ListProspectNotes(ws string, prospect int) ([]SalesProspectNote, error) {
	var resp struct {
		Data []SalesProspectNote `json:"data"`
	}
	p := salesPath(ws, fmt.Sprintf("prospects/%d/notes", prospect))
	if err := c.get(p, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) AddProspectNote(ws string, prospect int, req AddProspectNoteRequest) (*SalesProspectNote, error) {
	var out SalesProspectNote
	p := salesPath(ws, fmt.Sprintf("prospects/%d/notes", prospect))
	if err := c.postJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteProspectNote destroys a note. `confirm` must be the note's own id and is
// checked BY THE SERVER before anything is removed — sending it from here is not
// the guard, it is how the guard is satisfied.
func (c *Client) DeleteProspectNote(ws string, prospect, noteID int, confirm string) (*SalesDeletedNote, error) {
	var out SalesDeletedNote
	p := salesPath(ws, fmt.Sprintf("prospects/%d/notes/%d", prospect, noteID)) +
		"?confirm=" + url.QueryEscape(confirm)
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesDeletedNote is the RECEIPT for an irreversible delete: the row is gone,
// so this is the last record of what it said. CLAUDE.md — an irreversible
// command reports WHAT it did, not how many.
type SalesDeletedNote struct {
	Deleted bool   `json:"deleted" yaml:"deleted"`
	Type    string `json:"type" yaml:"type"`
	ID      int    `json:"id" yaml:"id"`
	Kind    string `json:"kind" yaml:"kind"`
	Body    string `json:"body" yaml:"body"`
}

func (c *Client) ClearMatch(ws string, prospect, product int) error {
	p := salesPath(ws, fmt.Sprintf("prospects/%d/matches", prospect)) +
		fmt.Sprintf("?product=%d", product)
	return c.deleteJSON(p, nil, nil)
}

// SetNextActionRequest is what we owe this prospect next — all four columns at
// once, because a type with no due date is half a commitment. `Due` is a
// RESOLVED date; `DueLabel` keeps the words the agent wrote.
type SetNextActionRequest struct {
	Type     *NullString `json:"type,omitempty"`
	Due      *NullString `json:"due,omitempty"`
	DueLabel *NullString `json:"due_label,omitempty"`
	Note     *NullString `json:"note,omitempty"`
	Owner    *NullString `json:"owner,omitempty"`
}

func (c *Client) SetNextAction(ws string, prospect int, req SetNextActionRequest) (*Prospect, error) {
	var out Prospect
	p := salesPath(ws, fmt.Sprintf("prospects/%d/next-action", prospect))
	if err := c.patchJSON(p, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// The two ledgers
// ---------------------------------------------------------------------------

type SalesMeeting struct {
	Number         int      `json:"number" yaml:"number"`
	ProspectNumber int      `json:"prospect_number" yaml:"prospect_number"`
	ProspectName   string   `json:"prospect_name" yaml:"prospect_name"`
	StartsAt       string   `json:"starts_at" yaml:"starts_at"`
	DurationMin    *int     `json:"duration_min" yaml:"duration_min"`
	Type           string   `json:"type" yaml:"type"`
	Status         string   `json:"status" yaml:"status"`
	Title          string   `json:"title" yaml:"title"`
	Attendees      []string `json:"attendees" yaml:"attendees"`
	Agenda         string   `json:"agenda" yaml:"agenda"`
	Outcome        string   `json:"outcome" yaml:"outcome"`
	// Where an online meeting happens. Empty on the calls and in-person
	// meetings that are most of this ledger; renderers omit the row entirely
	// rather than printing an em dash on every one of them.
	MeetingURL string `json:"meeting_url" yaml:"meeting_url"`
	URN        string `json:"urn" yaml:"urn"`
	DeletedAt  string `json:"deleted_at" yaml:"deleted_at"`
}

type ListMeetingsOpts struct {
	Prospect       int
	Statuses       []string
	From, To       string
	Limit, Cursor  int
	IncludeDeleted bool
}

type MeetingsPage struct {
	Data       []SalesMeeting `json:"data" yaml:"data"`
	NextCursor *int           `json:"next_cursor" yaml:"next_cursor"`
}

func (c *Client) ListMeetings(ws string, opts ListMeetingsOpts) (*MeetingsPage, error) {
	q := url.Values{}
	if opts.Prospect > 0 {
		q.Set("prospect", strconv.Itoa(opts.Prospect))
	}
	if len(opts.Statuses) > 0 {
		q.Set("status", strings.Join(opts.Statuses, ","))
	}
	if opts.From != "" {
		q.Set("from", opts.From)
	}
	if opts.To != "" {
		q.Set("to", opts.To)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor > 0 {
		q.Set("cursor", strconv.Itoa(opts.Cursor))
	}
	if opts.IncludeDeleted {
		q.Set("include_deleted", "true")
	}
	path := salesPath(ws, "meetings")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page MeetingsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) GetMeeting(ws string, n int) (*SalesMeeting, error) {
	var m SalesMeeting
	if err := c.get(salesPath(ws, fmt.Sprintf("meetings/%d", n)), &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// CreateMeetingRequest covers both `schedule` and `log`: one insert, and the
// caller's `Status` (or the presence of an outcome) says which moment it is.
type CreateMeetingRequest struct {
	Prospect    int      `json:"prospect"`
	At          string   `json:"at"`
	Type        string   `json:"type"`
	Status      string   `json:"status,omitempty"`
	Title       string   `json:"title"`
	DurationMin *int     `json:"duration_min,omitempty"`
	Attendees   []string `json:"attendees,omitempty"`
	Agenda      string   `json:"agenda,omitempty"`
	Outcome     string   `json:"outcome,omitempty"`
	MeetingURL  string   `json:"meeting_url,omitempty"`
}

func (c *Client) CreateMeeting(ws string, req CreateMeetingRequest) (*SalesMeeting, error) {
	var out SalesMeeting
	if err := c.postJSON(salesPath(ws, "meetings"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type UpdateMeetingRequest struct {
	Status      string      `json:"status,omitempty"`
	Title       string      `json:"title,omitempty"`
	Outcome     *NullString `json:"outcome,omitempty"`
	Agenda      *NullString `json:"agenda,omitempty"`
	At          string      `json:"at,omitempty"`
	DurationMin *int        `json:"duration_min,omitempty"`
	Attendees   []string    `json:"attendees,omitempty"`
	// *NullString, like Outcome and Agenda: a meeting that moves from Teams to
	// a phone call has to be able to LOSE its link, and a plain string with
	// omitempty cannot express "set this to null" — the empty value and the
	// absent one would serialise identically.
	MeetingURL *NullString `json:"meeting_url,omitempty"`
}

func (c *Client) UpdateMeeting(ws string, n int, req UpdateMeetingRequest) (*SalesMeeting, error) {
	var out SalesMeeting
	if err := c.patchJSON(salesPath(ws, fmt.Sprintf("meetings/%d", n)), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteMeeting(ws string, n int, confirm string) (*SalesDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("meetings/%d", n)) + "?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SalesComm struct {
	Number         int    `json:"number" yaml:"number"`
	ProspectNumber int    `json:"prospect_number" yaml:"prospect_number"`
	ProspectName   string `json:"prospect_name" yaml:"prospect_name"`
	Channel        string `json:"channel" yaml:"channel"`
	Direction      string `json:"direction" yaml:"direction"`
	OccurredAt     string `json:"occurred_at" yaml:"occurred_at"`
	Subject        string `json:"subject" yaml:"subject"`
	Body           string `json:"body" yaml:"body"`
	Contact        string `json:"contact" yaml:"contact"`
	LoggedBy       string `json:"logged_by" yaml:"logged_by"`
	URN            string `json:"urn" yaml:"urn"`
	DeletedAt      string `json:"deleted_at" yaml:"deleted_at"`
}

type ListCommsOpts struct {
	Prospect       int
	Channels       []string
	Direction      string
	From, To       string
	Limit, Cursor  int
	IncludeDeleted bool
}

type CommsPage struct {
	Data       []SalesComm `json:"data" yaml:"data"`
	NextCursor *int        `json:"next_cursor" yaml:"next_cursor"`
}

func (c *Client) ListComms(ws string, opts ListCommsOpts) (*CommsPage, error) {
	q := url.Values{}
	if opts.Prospect > 0 {
		q.Set("prospect", strconv.Itoa(opts.Prospect))
	}
	if len(opts.Channels) > 0 {
		q.Set("channel", strings.Join(opts.Channels, ","))
	}
	if opts.Direction != "" {
		q.Set("dir", opts.Direction)
	}
	if opts.From != "" {
		q.Set("from", opts.From)
	}
	if opts.To != "" {
		q.Set("to", opts.To)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor > 0 {
		q.Set("cursor", strconv.Itoa(opts.Cursor))
	}
	if opts.IncludeDeleted {
		q.Set("include_deleted", "true")
	}
	path := salesPath(ws, "communications")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page CommsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) GetComm(ws string, n int) (*SalesComm, error) {
	var out SalesComm
	if err := c.get(salesPath(ws, fmt.Sprintf("communications/%d", n)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type LogCommRequest struct {
	Prospect  int    `json:"prospect"`
	Channel   string `json:"channel"`
	Direction string `json:"direction"`
	At        string `json:"at,omitempty"`
	Subject   string `json:"subject,omitempty"`
	Body      string `json:"body,omitempty"`
	Contact   *int   `json:"contact,omitempty"`
}

func (c *Client) LogComm(ws string, req LogCommRequest) (*SalesComm, error) {
	var out SalesComm
	if err := c.postJSON(salesPath(ws, "communications"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteComm(ws string, n int, confirm string) (*SalesDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("communications/%d", n)) + "?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// The catalog: products, templates, documents
// ---------------------------------------------------------------------------

type SalesProduct struct {
	Number      int      `json:"number" yaml:"number"`
	Category    string   `json:"category" yaml:"category"`
	Name        string   `json:"name" yaml:"name"`
	PriceLabel  string   `json:"price_label" yaml:"price_label"`
	PriceFrom   string   `json:"price_from" yaml:"price_from"`
	PriceTo     string   `json:"price_to" yaml:"price_to"`
	Currency    string   `json:"currency" yaml:"currency"`
	Description string   `json:"description" yaml:"description"`
	Fit         []string `json:"fit" yaml:"fit"`
	Pitch       string   `json:"pitch" yaml:"pitch"`
	StatusLabel string   `json:"status_label" yaml:"status_label"`
	Refs        []string `json:"refs" yaml:"refs"`

	// ── INTERNAL-ONLY (migration 0011, sales #27) ────────────────────────
	// What to quote if somebody asks. Served to an authenticated workspace
	// member and to nothing else — if a public product page is ever built
	// (#26) it needs its own projection that omits these three.
	InternalPriceMin  string `json:"internal_price_min" yaml:"internal_price_min"`
	InternalPriceMax  string `json:"internal_price_max" yaml:"internal_price_max"`
	InternalPriceNote string `json:"internal_price_note" yaml:"internal_price_note"`

	// How far our own site carries it (sales #29): `internal | external`.
	// `ExternalURL` is where an external product actually lives — its own
	// field rather than an entry in Refs, which is reference CUSTOMERS.
	Reach       string `json:"reach" yaml:"reach"`
	ExternalURL string `json:"external_url" yaml:"external_url"`

	URN       string `json:"urn" yaml:"urn"`
	DeletedAt string `json:"deleted_at" yaml:"deleted_at"`
}

type ProductRequest struct {
	InternalPriceMin  string `json:"internal_price_min,omitempty"`
	InternalPriceMax  string `json:"internal_price_max,omitempty"`
	InternalPriceNote string `json:"internal_price_note,omitempty"`
	Reach             string `json:"reach,omitempty"`
	ExternalURL       string `json:"external_url,omitempty"`

	Category    string   `json:"category,omitempty"`
	Name        string   `json:"name,omitempty"`
	PriceLabel  string   `json:"price_label,omitempty"`
	PriceFrom   string   `json:"price_from,omitempty"`
	PriceTo     string   `json:"price_to,omitempty"`
	Currency    string   `json:"currency,omitempty"`
	Description string   `json:"description,omitempty"`
	Fit         []string `json:"fit,omitempty"`
	Pitch       string   `json:"pitch,omitempty"`
	StatusLabel string   `json:"status_label,omitempty"`
	Refs        []string `json:"refs,omitempty"`
}

func (c *Client) ListProducts(ws, category, query string, limit int) ([]SalesProduct, error) {
	q := url.Values{}
	if category != "" {
		q.Set("category", category)
	}
	if query != "" {
		q.Set("q", query)
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := salesPath(ws, "products")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var resp struct {
		Data []SalesProduct `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetProduct(ws string, n int) (*SalesProduct, error) {
	var out SalesProduct
	if err := c.get(salesPath(ws, fmt.Sprintf("products/%d", n)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateProduct(ws string, req ProductRequest) (*SalesProduct, error) {
	var out SalesProduct
	if err := c.postJSON(salesPath(ws, "products"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateProduct(ws string, n int, req ProductRequest) (*SalesProduct, error) {
	var out SalesProduct
	if err := c.patchJSON(salesPath(ws, fmt.Sprintf("products/%d", n)), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteProduct(ws string, n int, confirm string) (*SalesDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("products/%d", n)) + "?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SalesTemplate struct {
	Number    int      `json:"number" yaml:"number"`
	Channel   string   `json:"channel" yaml:"channel"`
	Category  string   `json:"category" yaml:"category"`
	Stage     string   `json:"stage" yaml:"stage"`
	Name      string   `json:"name" yaml:"name"`
	Subject   string   `json:"subject" yaml:"subject"`
	Body      string   `json:"body" yaml:"body"`
	Variables []string `json:"variables" yaml:"variables"`
	URN       string   `json:"urn" yaml:"urn"`
	DeletedAt string   `json:"deleted_at" yaml:"deleted_at"`
}

type TemplateRequest struct {
	Channel  string `json:"channel,omitempty"`
	Category string `json:"category,omitempty"`
	Stage    string `json:"stage,omitempty"`
	Name     string `json:"name,omitempty"`
	Subject  string `json:"subject,omitempty"`
	Body     string `json:"body,omitempty"`
}

func (c *Client) ListTemplates(ws, channel, category, stage, query string, limit int) ([]SalesTemplate, error) {
	q := url.Values{}
	for k, v := range map[string]string{"channel": channel, "category": category, "stage": stage, "q": query} {
		if v != "" {
			q.Set(k, v)
		}
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := salesPath(ws, "templates")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var resp struct {
		Data []SalesTemplate `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetTemplate(ws string, n int) (*SalesTemplate, error) {
	var out SalesTemplate
	if err := c.get(salesPath(ws, fmt.Sprintf("templates/%d", n)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateTemplate(ws string, req TemplateRequest) (*SalesTemplate, error) {
	var out SalesTemplate
	if err := c.postJSON(salesPath(ws, "templates"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateTemplate(ws string, n int, req TemplateRequest) (*SalesTemplate, error) {
	var out SalesTemplate
	if err := c.patchJSON(salesPath(ws, fmt.Sprintf("templates/%d", n)), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteTemplate(ws string, n int, confirm string) (*SalesDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("templates/%d", n)) + "?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RenderedTemplate is a template filled in. Nothing was sent and nothing was
// recorded — rendering is a pure function over a stored template.
type RenderedTemplate struct {
	Number  int      `json:"number" yaml:"number"`
	Name    string   `json:"name" yaml:"name"`
	Channel string   `json:"channel" yaml:"channel"`
	Subject string   `json:"subject" yaml:"subject"`
	Body    string   `json:"body" yaml:"body"`
	Unused  []string `json:"unused" yaml:"unused"`
}

func (c *Client) RenderTemplate(ws string, n int, vars map[string]string) (*RenderedTemplate, error) {
	var out RenderedTemplate
	body := map[string]any{"vars": vars}
	if err := c.postJSON(salesPath(ws, fmt.Sprintf("templates/%d/render", n)), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SalesDocument struct {
	Number      int      `json:"number" yaml:"number"`
	Title       string   `json:"title" yaml:"title"`
	Kind        string   `json:"kind" yaml:"kind"`
	UploadURL   string   `json:"upload_url" yaml:"upload_url"`
	ExternalURL string   `json:"external_url" yaml:"external_url"`
	SizeBytes   *int     `json:"size_bytes" yaml:"size_bytes"`
	MimeType    string   `json:"mime_type" yaml:"mime_type"`
	Description string   `json:"description" yaml:"description"`
	Tags        []string `json:"tags" yaml:"tags"`
	AddedBy     string   `json:"added_by" yaml:"added_by"`
	Prospects   []int    `json:"prospects" yaml:"prospects"`
	Products    []int    `json:"products" yaml:"products"`
	URN         string   `json:"urn" yaml:"urn"`
	DeletedAt   string   `json:"deleted_at" yaml:"deleted_at"`
}

// URL returns wherever the document actually is. Exactly one of the two columns
// is set — the database CHECK enforces it — so this cannot be ambiguous.
func (d SalesDocument) URL() string {
	if d.UploadURL != "" {
		return d.UploadURL
	}
	return d.ExternalURL
}

type DocumentRequest struct {
	Title       string   `json:"title,omitempty"`
	Kind        string   `json:"kind,omitempty"`
	UploadURL   string   `json:"upload_url,omitempty"`
	ExternalURL string   `json:"external_url,omitempty"`
	Description string   `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// ListDocsOpts — the document library's filters.
//
// A STRUCT rather than more positional parameters. `ListDocuments` took
// (ws, kind, query, prospect, limit) and the next two filters would have made it
// seven positionals of which four are int-or-string, where transposing `prospect`
// and `limit` is a silent wrong answer rather than a compile error. Every other
// list in this file that grew past three filters is already shaped this way —
// `ListMeetingsOpts`, `ListCommsOpts`.
type ListDocsOpts struct {
	Kind  string
	Query string
	// Prospect and Product are FILTERS here — "documents linked to #n" — not
	// link targets. `doc add --prospect` and `doc link --prospect` name a thing
	// to attach TO and are `ints`; these name one thing to filter BY. Same word,
	// different job, deliberately different shape.
	Prospect int
	Product  int
	// Tags match with OR: a document carrying ANY of them. Sent as one
	// comma-separated `tag` parameter, which is the shape `parseList` reads on
	// the server and the same one `--status` uses on `meeting list`.
	Tags  []string
	Limit int
}

func (c *Client) ListDocuments(ws string, opts ListDocsOpts) ([]SalesDocument, error) {
	q := url.Values{}
	if opts.Kind != "" {
		q.Set("kind", opts.Kind)
	}
	if opts.Query != "" {
		q.Set("q", opts.Query)
	}
	if opts.Prospect > 0 {
		q.Set("prospect", strconv.Itoa(opts.Prospect))
	}
	if opts.Product > 0 {
		q.Set("product", strconv.Itoa(opts.Product))
	}
	if len(opts.Tags) > 0 {
		q.Set("tag", strings.Join(opts.Tags, ","))
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	path := salesPath(ws, "documents")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var resp struct {
		Data []SalesDocument `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetDocument(ws string, n int) (*SalesDocument, error) {
	var out SalesDocument
	if err := c.get(salesPath(ws, fmt.Sprintf("documents/%d", n)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) AddDocument(ws string, req DocumentRequest) (*SalesDocument, error) {
	var out SalesDocument
	if err := c.postJSON(salesPath(ws, "documents"), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UpdateDocument(ws string, n int, req DocumentRequest) (*SalesDocument, error) {
	var out SalesDocument
	if err := c.patchJSON(salesPath(ws, fmt.Sprintf("documents/%d", n)), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteDocument(ws string, n int, confirm string) (*SalesDeleted, error) {
	p := salesPath(ws, fmt.Sprintf("documents/%d", n)) + "?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(p, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DocumentLinkRequest names exactly ONE target. The route refuses zero or two.
type DocumentLinkRequest struct {
	Prospect *int `json:"prospect,omitempty"`
	Product  *int `json:"product,omitempty"`
	Template *int `json:"template,omitempty"`
}

func (c *Client) LinkDocument(ws string, n int, req DocumentLinkRequest) (*SalesDocument, error) {
	var out SalesDocument
	if err := c.postJSON(salesPath(ws, fmt.Sprintf("documents/%d/links", n)), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) UnlinkDocument(ws string, n int, req DocumentLinkRequest) (*SalesDocument, error) {
	q := url.Values{}
	if req.Prospect != nil {
		q.Set("prospect", strconv.Itoa(*req.Prospect))
	}
	if req.Product != nil {
		q.Set("product", strconv.Itoa(*req.Product))
	}
	if req.Template != nil {
		q.Set("template", strconv.Itoa(*req.Template))
	}
	// Query parameters rather than a body: a DELETE with a body is legal and
	// widely mishandled by proxies and clients.
	path := salesPath(ws, fmt.Sprintf("documents/%d/links", n)) + "?" + q.Encode()
	var out SalesDocument
	if err := c.deleteJSON(path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// The three aggregates — COMPUTED server-side, never stored (D-33)
// ---------------------------------------------------------------------------

type SalesDueAction struct {
	Number     int    `json:"number" yaml:"number"`
	Name       string `json:"name" yaml:"name"`
	Stage      string `json:"stage" yaml:"stage"`
	ActionType string `json:"action_type" yaml:"action_type"`
	Due        string `json:"due" yaml:"due"`
	DueLabel   string `json:"due_label" yaml:"due_label"`
	Note       string `json:"note" yaml:"note"`
	Owner      string `json:"owner" yaml:"owner"`
	Overdue    bool   `json:"overdue" yaml:"overdue"`
}

type SalesMeetingSlot struct {
	Number         int    `json:"number" yaml:"number"`
	ProspectNumber int    `json:"prospect_number" yaml:"prospect_number"`
	ProspectName   string `json:"prospect_name" yaml:"prospect_name"`
	Title          string `json:"title" yaml:"title"`
	StartsAt       string `json:"starts_at" yaml:"starts_at"`
	Type           string `json:"type" yaml:"type"`
	Status         string `json:"status" yaml:"status"`
}

type SalesToday struct {
	Date       string             `json:"date" yaml:"date"`
	DueActions []SalesDueAction   `json:"due_actions" yaml:"due_actions"`
	Meetings   []SalesMeetingSlot `json:"meetings" yaml:"meetings"`
	Counts     struct {
		DueToday      int `json:"due_today" yaml:"due_today"`
		Overdue       int `json:"overdue" yaml:"overdue"`
		MeetingsToday int `json:"meetings_today" yaml:"meetings_today"`
	} `json:"counts" yaml:"counts"`
}

func (c *Client) SalesToday(ws string) (*SalesToday, error) {
	var out SalesToday
	if err := c.get(salesPath(ws, "today"), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SalesStageBucket struct {
	Stage    string `json:"stage" yaml:"stage"`
	Count    int    `json:"count" yaml:"count"`
	Value    string `json:"value" yaml:"value"`
	Currency string `json:"currency" yaml:"currency"`
}

type SalesTotals struct {
	Count int    `json:"count" yaml:"count"`
	Value string `json:"value" yaml:"value"`
}

type SalesPipeline struct {
	Stages   []SalesStageBucket `json:"stages" yaml:"stages"`
	Open     SalesTotals        `json:"open" yaml:"open"`
	Won      SalesTotals        `json:"won" yaml:"won"`
	Lost     SalesTotals        `json:"lost" yaml:"lost"`
	Currency string             `json:"currency" yaml:"currency"`
}

func (c *Client) SalesPipeline(ws string) (*SalesPipeline, error) {
	var out SalesPipeline
	if err := c.get(salesPath(ws, "pipeline"), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SalesMetrics struct {
	PeriodDays int    `json:"period_days" yaml:"period_days"`
	From       string `json:"from" yaml:"from"`
	To         string `json:"to" yaml:"to"`
	Closed     struct {
		Won  SalesTotals `json:"won" yaml:"won"`
		Lost SalesTotals `json:"lost" yaml:"lost"`
		// Null when nothing closed. "We closed nothing" and "we lost
		// everything" are not the same month, so this is a pointer.
		WinRate    *string `json:"win_rate" yaml:"win_rate"`
		AverageWon *string `json:"average_won" yaml:"average_won"`
	} `json:"closed" yaml:"closed"`
	Created  SalesTotals `json:"created" yaml:"created"`
	Activity struct {
		Communications int `json:"communications" yaml:"communications"`
		Meetings       int `json:"meetings" yaml:"meetings"`
	} `json:"activity" yaml:"activity"`
	Currency string `json:"currency" yaml:"currency"`
}

func (c *Client) SalesMetrics(ws, period string) (*SalesMetrics, error) {
	path := salesPath(ws, "metrics")
	if period != "" {
		path += "?period=" + url.QueryEscape(period)
	}
	var out SalesMetrics
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesSearchHit is a full-text hit INSIDE this app's records — the other half
// of D-9. `Snippet` comes from a column `platform.entities` never holds, which
// is what makes this a different answer from `bk search`.
type SalesSearchHit struct {
	Type           string  `json:"type" yaml:"type"`
	Number         *int    `json:"number" yaml:"number"`
	ProspectNumber *int    `json:"prospect_number" yaml:"prospect_number"`
	Title          string  `json:"title" yaml:"title"`
	Snippet        string  `json:"snippet" yaml:"snippet"`
	Rank           float64 `json:"rank" yaml:"rank"`
	URN            string  `json:"urn" yaml:"urn"`
}

func (c *Client) SalesSearch(ws, query string, types []string, limit int) ([]SalesSearchHit, error) {
	q := url.Values{}
	q.Set("q", query)
	if len(types) > 0 {
		q.Set("type", strings.Join(types, ","))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	var resp struct {
		Data []SalesSearchHit `json:"data"`
	}
	if err := c.get(salesPath(ws, "sales-search")+"?"+q.Encode(), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// AttachProspectLabel / DetachProspectLabel are the sales half of
// `bk sales label attach|detach`. They post to a SALES route, which is why they
// live here and not in the shared appverbs package — see that package's header.
func (c *Client) AttachProspectLabel(ws string, prospect, labelID int) error {
	body := map[string]int{"label_id": labelID}
	return c.postJSON(salesPath(ws, fmt.Sprintf("prospects/%d/labels", prospect)), body, nil)
}

func (c *Client) DetachProspectLabel(ws string, prospect, labelID int) error {
	return c.deleteJSON(salesPath(ws, fmt.Sprintf("prospects/%d/labels/%d", prospect, labelID)), nil, nil)
}

// ---------------------------------------------------------------------------
// Preferences — a DISPLAY setting, and the client says so
// ---------------------------------------------------------------------------
// `ui_mode` decides what the WEB app renders (D-7). It is not a permission and
// the server never consults it: `bk` writes in either mode, and so does anybody
// else who has access. That sentence is repeated in the command's help because
// this is the one value in the product whose NAME invites the wrong reading.

// SalesPreferences is one person's display settings in one workspace.
type SalesPreferences struct {
	UIMode         string `json:"ui_mode" yaml:"ui_mode"`
	DefaultFilters any    `json:"default_filters" yaml:"default_filters"`
	UpdatedAt      string `json:"updated_at" yaml:"updated_at"`
}

func (c *Client) SalesPreferences(ws string) (*SalesPreferences, error) {
	var out SalesPreferences
	if err := c.get(salesPath(ws, "preferences"), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SalesSetPreferences patches the caller's own row. There is no way to name
// somebody else's, deliberately: a preference is not something one person sets
// for another, and a route that allowed it would be a route somebody would
// mistake for administration.
func (c *Client) SalesSetPreferences(ws string, body map[string]any) (*SalesPreferences, error) {
	var out SalesPreferences
	if err := c.patchJSON(salesPath(ws, "preferences"), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
