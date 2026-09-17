// Client methods for the b/billing app — the wire types and the calls behind
// `bk billing …`.
//
// ---------------------------------------------------------------------------
// MONEY AND DATES ARE STRINGS. IN AN INVOICING APP THAT IS NOT A STYLE CHOICE.
// ---------------------------------------------------------------------------
// Amounts are `numeric(14,2)` and arrive as `"1590.00"`. Decoding one into a
// float64 rounds it silently, and an invoice wrong in the last rappen is a
// document that does not match the payment slip stapled to it — which means a
// bank reconciliation that does not close and a bill somebody has to reissue.
//
// No consumer of this CLI does arithmetic on an amount. Dates are Postgres
// `date` (`"2026-01-05"`), not instants: parsing one into a `time.Time` puts it
// at midnight in some timezone, and an issue date has no time of day.
//
// **Keep every amount and every date a string in this file.**
//
// ---------------------------------------------------------------------------
// `Number`, NEVER `ID` — AND THIS APP HAS TWO NUMBERS
// ---------------------------------------------------------------------------
// The serial row id is served by no route and must not appear in a struct here:
// once it reaches a caller it ends up in a script, and then it is a contract
// nobody agreed to.
//
// But b/billing has one more identifier than the other apps, and they are not
// interchangeable:
//
//	Number  the workspace #number — the ADDRESS. `bk billing invoice show 7`,
//	        the URN `bc:billing:acme/invoice/7`, the route path.
//	Ref     the STATUTORY number printed on the document, `BC-2026-0007`,
//	        embedded in the payment reference and permanent.
//
// A command that printed `Number` where a person expected the invoice number
// would be showing an internal address for a legal document.
package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ===========================================================================
// COMPANIES
// ===========================================================================

// BillingAddress is a structured address, in the QR-bill's own field widths.
// The standard's combined-address option is gone, so there is no free-text form.
type BillingAddress struct {
	Name       string `json:"name"`
	Street     string `json:"street,omitempty"`
	Building   string `json:"building,omitempty"`
	PostalCode string `json:"postal_code,omitempty"`
	City       string `json:"city,omitempty"`
	Country    string `json:"country,omitempty"`
}

// BillingCompanyDefaults are prefills for NEW invoices and their lines. The
// server never reads them at render time, so changing one does not alter a
// document already issued.
type BillingCompanyDefaults struct {
	Currency string `json:"currency"`
	Language string `json:"language"`
	RefType  string `json:"ref_type"`
	// A decimal string, or empty for "no VAT on new lines".
	VatRate          string `json:"vat_rate,omitempty"`
	PricesIncludeVat bool   `json:"prices_include_vat"`
	PaymentTermsDays int    `json:"payment_terms_days"`
}

// BillingCompany is an issuing entity — whose name, address and bank account
// appear on the bill.
type BillingCompany struct {
	Number int    `json:"seq"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	// Goes on the payment part and must match the account holder of the credit
	// account. A mismatch is a bill a bank may refuse.
	LegalName string         `json:"legal_name"`
	Address   BillingAddress `json:"address"`
	Email     string         `json:"email,omitempty"`

	// Borrowed from b/books. OWNER-ONLY to change: an IBAN decides where money
	// lands, so a member who could edit one could redirect every future payment.
	Iban   string `json:"iban,omitempty"`
	QrIban string `json:"qr_iban,omitempty"`

	// False means VAT is OMITTED from its invoices — not charged at zero.
	VatRegistered bool   `json:"vat_registered"`
	Uid           string `json:"uid,omitempty"`
	VatNumber     string `json:"vat_number,omitempty"`

	Defaults BillingCompanyDefaults `json:"defaults"`
	// Read at DERIVATION time, unlike the defaults: changing it changes every
	// total this company has ever derived.
	Rounding     string `json:"rounding"`
	NumberFormat string `json:"number_format"`
	// The number the next invoice will take. Read-only on every surface.
	NextSeq int `json:"next_seq"`

	FooterFr string `json:"footer_fr,omitempty"`
	FooterEn string `json:"footer_en,omitempty"`
	// A retired company issues no new invoices and still renders its old ones.
	RetiredAt string `json:"retired_at,omitempty"`

	ExternalRef string            `json:"external_ref,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// CreateBillingCompanyRequest is `bk billing company create`.
type CreateBillingCompanyRequest struct {
	Slug          string                  `json:"slug"`
	Name          string                  `json:"name"`
	LegalName     string                  `json:"legal_name,omitempty"`
	Address       *BillingAddress         `json:"address,omitempty"`
	Email         string                  `json:"email,omitempty"`
	Iban          string                  `json:"iban,omitempty"`
	QrIban        string                  `json:"qr_iban,omitempty"`
	VatRegistered *bool                   `json:"vat_registered,omitempty"`
	Uid           string                  `json:"uid,omitempty"`
	VatNumber     string                  `json:"vat_number,omitempty"`
	Defaults      *BillingCompanyDefaults `json:"defaults,omitempty"`
	Rounding      string                  `json:"rounding,omitempty"`
	NumberFormat  string                  `json:"number_format,omitempty"`
	FooterFr      string                  `json:"footer_fr,omitempty"`
	FooterEn      string                  `json:"footer_en,omitempty"`
	ExternalRef   string                  `json:"external_ref,omitempty"`
	Metadata      map[string]string       `json:"metadata,omitempty"`
}

func (c *Client) ListBillingCompanies(ws string, includeRetired bool, externalRef string) ([]BillingCompany, error) {
	path := fmt.Sprintf("/api/workspaces/%s/companies", ws)
	q := url.Values{}
	if includeRetired {
		q.Set("include_retired", "true")
	}
	if externalRef != "" {
		q.Set("external_ref", externalRef)
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var resp struct {
		Data []BillingCompany `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetBillingCompany(ws, slug string) (*BillingCompany, error) {
	var out BillingCompany
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/companies/%s", ws, url.PathEscape(slug)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) CreateBillingCompany(ws string, req CreateBillingCompanyRequest) (*BillingCompany, error) {
	var out BillingCompany
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/companies", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// EditBillingCompany sends a sparse patch.
//
// `map[string]any` rather than a struct with pointers, because a PATCH must be
// able to send an explicit `null` to CLEAR a field, and `omitempty` on a
// `*string` cannot express the difference between "leave it alone" and "set it
// empty". The flag layer decides which keys to include.
func (c *Client) EditBillingCompany(ws, slug string, patch map[string]any) (*BillingCompany, error) {
	var out BillingCompany
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/companies/%s", ws, url.PathEscape(slug)), patch, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ===========================================================================
// INVOICES
// ===========================================================================

// BillingInvoiceLine is one line. `LineTotal` is DERIVED and served for
// convenience; nothing stores it.
type BillingInvoiceLine struct {
	LineNo      int    `json:"line_no"`
	Description string `json:"description"`
	Qty         string `json:"qty"`
	Unit        string `json:"unit,omitempty"`
	UnitPrice   string `json:"unit_price"`
	// EMPTY means this line carries NO VAT — an exempt act, or a company that is
	// not registered. `"0"` is a real rate (export, reverse charge) and prints
	// `TVA 0%`. The two are different facts on a VAT return; a `*string` would
	// be the precise shape and a plain string plus this comment is what the rest
	// of this file uses, so the distinction is carried by `HasVatRate` below.
	VatRate   string `json:"vat_rate,omitempty"`
	LineTotal string `json:"line_total"`
}

// BillingVatLine is one rate's contribution. One entry per distinct rate.
type BillingVatLine struct {
	Rate   string `json:"rate"`
	Base   string `json:"base"`
	Amount string `json:"amount"`
}

// BillingTotals is everything derived from the lines. **Nothing here is stored**
// — it is recomputed on every read from the lines, the price mode and the
// company's rounding policy.
type BillingTotals struct {
	Subtotal string           `json:"subtotal"`
	Vat      []BillingVatLine `json:"vat"`
	VatTotal string           `json:"vat_total"`
	// The adjustment the company's rounding policy produced, signed. Printed as
	// its own `Arrondi` line when it is not zero.
	Rounding string `json:"rounding"`
	Total    string `json:"total"`
}

// BillingVoid is the record of a cancellation. A void is a RECORD, never a
// deletion: the number stays consumed forever.
type BillingVoid struct {
	Ts     string            `json:"ts"`
	By     string            `json:"by"`
	Reason map[string]string `json:"reason"`
}

// BillingInvoice is a numbered legal document.
type BillingInvoice struct {
	// The workspace #number — the ADDRESS. See this file's header.
	Number int `json:"seq"`
	// The issuing company's slug. Frozen after create.
	Company string `json:"company"`
	// The STATUTORY number printed on the document. Permanent.
	Ref   string `json:"number"`
	SeqNo int    `json:"seq_no"`

	Status    string `json:"status"`
	IssueDate string `json:"issue_date"`
	DueDate   string `json:"due_date,omitempty"`
	PaidDate  string `json:"paid_date,omitempty"`

	Currency string `json:"currency"`
	// The DOCUMENT's language, not the operator's.
	Language string `json:"language"`

	RefType string `json:"ref_type"`
	// Without its check digit, which is derived on every render.
	RefBody string `json:"ref_body,omitempty"`

	Client BillingAddress `json:"client"`

	VatRate          string `json:"vat_rate,omitempty"`
	PricesIncludeVat bool   `json:"prices_include_vat"`

	Message string       `json:"message,omitempty"`
	Void    *BillingVoid `json:"void,omitempty"`

	// When it left draft. Empty until then.
	SentAt string `json:"sent_at,omitempty"`
	// The id of the email that carried it. EMPTY ON A SENT INVOICE MEANS IT WAS
	// SENT OUTSIDE THIS APP (`mark-sent`) — "sent by us, here is the message" and
	// "sent somehow, we were told" are different facts.
	SentMessageID string `json:"sent_message_id,omitempty"`
	// sha256 of the PDF bytes actually attached. Empty unless this app emailed it.
	PdfSha256 string `json:"pdf_sha256,omitempty"`

	Items  []BillingInvoiceLine `json:"items"`
	Totals BillingTotals        `json:"totals"`

	ExternalRef string            `json:"external_ref,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// CreateBillingInvoiceLineRequest is one `--item` on the command line.
type CreateBillingInvoiceLineRequest struct {
	Description string `json:"description"`
	Qty         string `json:"qty,omitempty"`
	Unit        string `json:"unit,omitempty"`
	UnitPrice   string `json:"unit_price"`
	// A pointer, because `nil` (no VAT) and `"0"` (zero-rated) are different
	// facts and `omitempty` on a plain string cannot tell them apart.
	VatRate *string `json:"vat_rate,omitempty"`
}

// CreateBillingInvoiceRequest is `bk billing invoice create`.
type CreateBillingInvoiceRequest struct {
	Company          string                            `json:"company"`
	Client           *BillingAddress                   `json:"client,omitempty"`
	Items            []CreateBillingInvoiceLineRequest `json:"items,omitempty"`
	Currency         string                            `json:"currency,omitempty"`
	Language         string                            `json:"language,omitempty"`
	RefType          string                            `json:"ref_type,omitempty"`
	VatRate          *string                           `json:"vat_rate,omitempty"`
	PricesIncludeVat *bool                             `json:"prices_include_vat,omitempty"`
	IssueDate        string                            `json:"issue_date,omitempty"`
	DueDate          string                            `json:"due_date,omitempty"`
	Message          string                            `json:"message,omitempty"`
	ExternalRef      string                            `json:"external_ref,omitempty"`
	Metadata         map[string]string                 `json:"metadata,omitempty"`
	// When set and different from the derived total, the create is REFUSED and
	// nothing is allocated. The refusal names the company's rounding policy and
	// its price mode, which is what explains almost every disagreement.
	ExpectedTotal string `json:"expected_total,omitempty"`
}

// BillingInvoicePage is one page of the list.
type BillingInvoicePage struct {
	Data       []BillingInvoice `json:"data"`
	NextCursor *int             `json:"next_cursor"`
}

type ListBillingInvoicesOptions struct {
	Company     string
	Status      string
	Currency    string
	ExternalRef string
	Limit       int
	Cursor      int
}

func (c *Client) ListBillingInvoices(ws string, o ListBillingInvoicesOptions) (*BillingInvoicePage, error) {
	q := url.Values{}
	if o.Company != "" {
		q.Set("company", o.Company)
	}
	if o.Status != "" {
		q.Set("status", o.Status)
	}
	if o.Currency != "" {
		q.Set("currency", o.Currency)
	}
	if o.ExternalRef != "" {
		q.Set("external_ref", o.ExternalRef)
	}
	if o.Limit > 0 {
		q.Set("limit", strconv.Itoa(o.Limit))
	}
	if o.Cursor > 0 {
		q.Set("cursor", strconv.Itoa(o.Cursor))
	}
	path := fmt.Sprintf("/api/workspaces/%s/invoices", ws)
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out BillingInvoicePage
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetBillingInvoice takes the #number OR the printed number, resolved in that
// order by the server.
func (c *Client) GetBillingInvoice(ws, ref string) (*BillingInvoice, error) {
	var out BillingInvoice
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/invoices/%s", ws, url.PathEscape(ref)), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateBillingInvoice drafts an invoice, consuming a number that cannot be
// reclaimed. Pass a non-empty idempotencyKey to make a retry of THIS request
// replay instead of minting a second bill; see postJSONIdempotent.
func (c *Client) CreateBillingInvoice(ws string, req CreateBillingInvoiceRequest, idempotencyKey string) (*BillingInvoice, error) {
	var out BillingInvoice
	if err := c.postJSONIdempotent(fmt.Sprintf("/api/workspaces/%s/invoices", ws), req, idempotencyKey, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// postJSONIdempotent is postJSON plus the Idempotency-Key header, when a key is
// given.
//
// ── THE KEY IS THE CALLER'S, NOT GENERATED HERE ────────────────────────────
// Until 2026-09-17 `bk billing invoice create`'s help said the command "sends an
// idempotency key", and no code in this binary did. A key generated per
// invocation would not have helped anyway: `bk` does not retry, so the only
// retry is the caller running the command again — which would generate a NEW
// key and mint a second bill. What protects a retry is a key that is the same
// on both runs, and only the caller knows what "the same request" means (their
// own order id, an appointment id). So it is a flag, and an empty one sends no
// header at all.
func (c *Client) postJSONIdempotent(path string, body any, idempotencyKey string, out any) error {
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
	if key := strings.TrimSpace(idempotencyKey); key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	return c.do(req, out)
}

// ===========================================================================
// THE LIFECYCLE: send, mark-sent, paid, void
// ===========================================================================

// SendBillingInvoiceRequest is `bk billing invoice send`. Subject and body
// default, server-side, to the invoice's DOCUMENT language.
type SendBillingInvoiceRequest struct {
	To      string   `json:"to"`
	Cc      []string `json:"cc,omitempty"`
	Subject string   `json:"subject,omitempty"`
	Body    string   `json:"body,omitempty"`
}

// SendBillingInvoice emails the invoice PDF and records the delivery.
func (c *Client) SendBillingInvoice(ws, ref string, req SendBillingInvoiceRequest, idempotencyKey string) (*BillingInvoice, error) {
	var out BillingInvoice
	path := fmt.Sprintf("/api/workspaces/%s/invoices/%s/send", ws, url.PathEscape(ref))
	if err := c.postJSONIdempotent(path, req, idempotencyKey, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// MarkBillingInvoiceSent records a delivery that happened outside this app.
func (c *Client) MarkBillingInvoiceSent(ws, ref, idempotencyKey string) (*BillingInvoice, error) {
	var out BillingInvoice
	path := fmt.Sprintf("/api/workspaces/%s/invoices/%s/mark-sent", ws, url.PathEscape(ref))
	if err := c.postJSONIdempotent(path, map[string]any{}, idempotencyKey, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// MarkBillingInvoicePaid asserts that the money arrived on paidDate. An
// assertion, never a reconciliation.
func (c *Client) MarkBillingInvoicePaid(ws, ref, paidDate, idempotencyKey string) (*BillingInvoice, error) {
	var out BillingInvoice
	path := fmt.Sprintf("/api/workspaces/%s/invoices/%s/paid", ws, url.PathEscape(ref))
	if err := c.postJSONIdempotent(path, map[string]string{"paid_date": paidDate}, idempotencyKey, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VoidBillingInvoiceRequest is `bk billing invoice void`. Confirm is sent so the
// server checks the same value the binary did — TRIMMED, by the command, before
// it gets here.
type VoidBillingInvoiceRequest struct {
	ReasonFr string `json:"reason_fr,omitempty"`
	ReasonEn string `json:"reason_en,omitempty"`
	Confirm  string `json:"confirm"`
}

// VoidBillingInvoice cancels an invoice with a reason. Its number stays consumed.
func (c *Client) VoidBillingInvoice(ws, ref string, req VoidBillingInvoiceRequest, idempotencyKey string) (*BillingInvoice, error) {
	var out BillingInvoice
	path := fmt.Sprintf("/api/workspaces/%s/invoices/%s/void", ws, url.PathEscape(ref))
	if err := c.postJSONIdempotent(path, req, idempotencyKey, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) EditBillingInvoice(ws, ref string, patch map[string]any) (*BillingInvoice, error) {
	var out BillingInvoice
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/invoices/%s", ws, url.PathEscape(ref)), patch, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SetBillingInvoiceLines replaces the whole line set.
//
// Replace rather than patch, because `line_no` is display order and a partial
// update has to answer "what happens to the gap?" every time a line is removed.
// Replacing makes the order the caller's statement.
func (c *Client) SetBillingInvoiceLines(ws, ref string, items []CreateBillingInvoiceLineRequest) (*BillingInvoice, error) {
	var out BillingInvoice
	body := map[string]any{"items": items}
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/invoices/%s", ws, url.PathEscape(ref)), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ===========================================================================
// THE AUDIT FEED
// ===========================================================================

type BillingAuditActor struct {
	UserID int    `json:"user_id,omitempty"`
	Email  string `json:"email,omitempty"`
	// `session` or `token` — the only structural difference between a human
	// write and an agent write. Both land in one log.
	Via string `json:"via"`
}

type BillingAuditEntry struct {
	// Monotonic per workspace. Pass it back as `--since` to continue.
	Number      int               `json:"seq"`
	SubjectType string            `json:"subject_type"`
	SubjectSeq  int               `json:"subject_seq"`
	Ts          string            `json:"ts"`
	Actor       BillingAuditActor `json:"actor"`
	Action      string            `json:"action"`
	Field       string            `json:"field,omitempty"`
	FromValue   string            `json:"from_value,omitempty"`
	ToValue     string            `json:"to_value,omitempty"`
	DetailFr    string            `json:"detail_fr,omitempty"`
	DetailEn    string            `json:"detail_en,omitempty"`
}

type BillingAuditPage struct {
	Data       []BillingAuditEntry `json:"data"`
	NextCursor *int                `json:"next_cursor"`
}

// ListBillingAudit reads the log.
//
// **`since` changes the ORDER, and that is a contract rather than a quirk.**
// Without it the newest row is first, which is what a person reading a panel
// wants. With it, rows come back ASCENDING from that cursor — which is what a
// poller needs, because a descending feed would make it re-read the same page
// forever.
func (c *Client) ListBillingAudit(ws string, subject string, since, limit int) (*BillingAuditPage, error) {
	q := url.Values{}
	if subject != "" {
		q.Set("subject", subject)
	}
	// `since=0` is meaningful: "everything from the beginning, ascending". So it
	// is sent whenever the caller asked for it, which the command layer signals
	// by passing -1 for "not asked".
	if since >= 0 {
		q.Set("since", strconv.Itoa(since))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := fmt.Sprintf("/api/workspaces/%s/audit", ws)
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out BillingAuditPage
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ===========================================================================
// THE OVERVIEW
// ===========================================================================

// BillingCurrencyTotal is one currency's figures. **Per currency, never
// merged** — adding CHF to EUR produces a number that is not money in any
// currency, and `Overdue` is a SUBSET of `Outstanding` rather than a third
// disjoint bucket.
type BillingCurrencyTotal struct {
	Currency    string `json:"currency"`
	Outstanding string `json:"outstanding"`
	Paid        string `json:"paid"`
	Overdue     string `json:"overdue"`
	Count       int    `json:"count"`
}

type BillingOverview struct {
	ByCurrency     []BillingCurrencyTotal `json:"by_currency"`
	NeedsAction    []BillingInvoice       `json:"needs_action"`
	RecentInvoices []BillingInvoice       `json:"recent_invoices"`
	RecentAudit    []BillingAuditEntry    `json:"recent_audit"`
}

func (c *Client) GetBillingOverview(ws, company string) (*BillingOverview, error) {
	path := fmt.Sprintf("/api/workspaces/%s/overview", ws)
	if company != "" {
		path += "?company=" + url.QueryEscape(company)
	}
	var out BillingOverview
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
