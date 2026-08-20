// Client methods for the b/books app — the wire types and the calls behind
// `bk books …`.
//
// ---------------------------------------------------------------------------
// `Number`, NEVER `ID`
// ---------------------------------------------------------------------------
// Every books entity is addressed by its workspace #number. The serial row id is
// not served by any route and must not appear in a struct here: once it reaches a
// caller it ends up in a script, and then it is a contract nobody agreed to.
//
// ---------------------------------------------------------------------------
// MONEY AND DATES ARRIVE AS STRINGS, AND IN AN ACCOUNTING APP THAT IS NOT A
// STYLE CHOICE
// ---------------------------------------------------------------------------
// Amounts are `numeric(14,2)` and arrive as `"1234.50"`. Decoding one into a
// float64 rounds it, silently, in a system whose whole purpose is that the books
// are correct — and no consumer of this CLI does arithmetic on a balance. Dates
// are Postgres `date` (`"2026-01-05"`), not instants: parsing one into a
// time.Time puts it at midnight in some timezone, and a booking date has no time
// of day.
//
// Keep every amount and every date a string in this file.
package client

import (
	"encoding/json"
	"fmt"
	"net/url"
)

// ===========================================================================
// THE STATUTORY CORE (phase 1)
// ===========================================================================
// Every amount below is a string. See this file's header: decoding
// `numeric(14,2)` into a float64 rounds it silently, in a system whose entire
// purpose is that the books are correct.

// BooksScope is the (book, year) pair every statutory read is scoped by.
//
// Sent as `?entity=&exercice=`, and both are optional: the server falls back to
// the first book and its most recent year, and says which it chose. Guessing is
// acceptable here because the answer is REPORTED in the payload rather than
// silently applied.
type BooksScope struct {
	Entity   string
	Exercice int
}

func (s BooksScope) query() string {
	q := ""
	if s.Entity != "" {
		q = "?entity=" + s.Entity
	}
	if s.Exercice > 0 {
		if q == "" {
			q = "?"
		} else {
			q += "&"
		}
		q += fmt.Sprintf("exercice=%d", s.Exercice)
	}
	return q
}

// BooksVat is the VAT block on a book. `Registered` false means below the CHF
// 100,000 threshold, which is AIOS SA's actual position in the seed.
type BooksVat struct {
	Registered bool   `json:"registered"`
	Method     string `json:"method"`
	Filing     string `json:"filing"`
}

// BooksEntity is one BOOK. A user may have any number of them.
type BooksEntity struct {
	Number int    `json:"number"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	// `SA` or `RI`. Drives the whole regime, and a database CHECK makes an SA with
	// simplified books impossible.
	LegalForm         string   `json:"legal_form"`
	Seat              string   `json:"seat"`
	BookkeepingRegime string   `json:"bookkeeping_regime"`
	RegimeElection    string   `json:"regime_election"`
	Vat               BooksVat `json:"vat"`
	AuditStatus       string   `json:"audit_status"`
	Accent            string   `json:"accent"`
}

type CreateBooksEntityRequest struct {
	Slug              string `json:"slug"`
	Name              string `json:"name"`
	LegalForm         string `json:"legal_form"`
	BookkeepingRegime string `json:"bookkeeping_regime,omitempty"`
	Seat              string `json:"seat,omitempty"`
}

// BooksExercice is a fiscal year. Dates are strings: a booking date has no time
// of day and parsing one into a time.Time puts it at midnight somewhere.
type BooksExercice struct {
	Year     int    `json:"year"`
	StartsOn string `json:"starts_on"`
	EndsOn   string `json:"ends_on"`
	Status   string `json:"status"`
}

type CreateBooksExerciceRequest struct {
	Entity string `json:"entity"`
	Year   int    `json:"year"`
}

// BooksAccount is one line of the Swiss PME chart.
//
// `Label` is `{fr, en}` since 2026-08-19 (the wire normalizes the mockup's
// enSuffix at the door); the CLI prints the French, the statutory wording.
type BooksAccount struct {
	No    string `json:"no"`
	Class int    `json:"class"`
	Label struct {
		Fr string `json:"fr"`
		En string `json:"en"`
	} `json:"label"`
	Statement         string `json:"statement"`
	StatementPosition string `json:"statement_position"`
}

// BooksEntryLine is one side of an écriture. `Account` is EMPTY on a staged
// entry whose meaning has not been resolved yet, which is the normal arrival
// state rather than corrupt data.
type BooksEntryLine struct {
	Account string `json:"account"`
	Debit   string `json:"debit"`
	Credit  string `json:"credit"`
}

// BooksFx is the original-currency story (0011): {original, rate, source},
// e.g. {"USD 5.00", "0.894", "card statement"}. All strings, all display.
type BooksFx struct {
	Original string `json:"original"`
	Rate     string `json:"rate"`
	Source   string `json:"source"`
}

// BooksEntry is one écriture.
//
// Note BOTH numbers. `Number` is the workspace #number this CLI addresses rows
// by; `EntryNo` is the statutory journal number, gapless per (book, year), which
// is what a tax authority reads. Neither substitutes for the other.
type BooksEntry struct {
	Number int `json:"number"`
	// Which book and which year (2026-08-19): `number` is workspace-wide,
	// these say whose écriture it is.
	Entity   string `json:"entity"`
	Exercice int    `json:"exercice"`
	EntryNo  int    `json:"entry_no"`
	Date     string `json:"date"`
	Status   string `json:"status"`
	// The RI journal's two fields. `entry list/show` serve BOTH journals since
	// phase 4A, and the caller knows which book it asked for; these are empty
	// on a grand-livre row, and Status/Lines are empty on an RI row.
	Direction    string           `json:"direction"`
	Amount       string           `json:"amount"`
	RawLabel     string           `json:"raw_label"`
	Counterparty string           `json:"counterparty"`
	Lines        []BooksEntryLine `json:"lines"`
	Recognition  string           `json:"recognition"`
	// `full`, `partial` or `bare`. `partial` and `bare` LOSE input VAT while
	// profit-tax deductibility may survive; the two consequences are independent.
	EvidenceTier string `json:"evidence_tier"`
	Tva          struct {
		Rate         string `json:"rate"`
		Amount       string `json:"amount"`
		InputClaimed bool   `json:"input_claimed"`
	} `json:"tva"`
	Piece *struct {
		DriveRef string `json:"drive_ref"`
		Captured string `json:"captured"`
	} `json:"piece"`
	// The original-currency story (0011). Display-only: `amount` is CHF — what
	// the card was actually charged — and this is the evidence of what it was
	// before the issuer converted.
	Fx *BooksFx `json:"fx"`
	// Provenance. Resolutions append here and the old state is kept forever;
	// without this field `--json` silently drops the one thing that proves a
	// resolved row was once unrecognized.
	History any `json:"history"`
}

// BooksBilanLine is one legal line of the balance sheet. Zero-balance lines ARE
// returned: a statutory line still exists at zero and is only collapsed visually.
type BooksBilanLine struct {
	Pos     string `json:"pos"`
	Related bool   `json:"related"`
	Amount  string `json:"amount"`
}

type BooksBilanGroup struct {
	Group struct {
		Fr string `json:"fr"`
	} `json:"group"`
	Side  string           `json:"side"`
	Lines []BooksBilanLine `json:"lines"`
}

type BooksBilan struct {
	Entity      string            `json:"entity"`
	Exercice    int               `json:"exercice"`
	Groups      []BooksBilanGroup `json:"groups"`
	TotalActif  string            `json:"totalActif"`
	TotalPassif string            `json:"totalPassif"`
	Resultat    string            `json:"resultat"`
	// Reported rather than asserted. A caller must be able to SEE that a bilan does
	// not balance, and by how much.
	Balanced bool   `json:"balanced"`
	Ecart    string `json:"ecart"`
}

type BooksCrLine struct {
	Pos    string `json:"pos"`
	Sign   int    `json:"sign"`
	Amount string `json:"amount"`
}

type BooksCr struct {
	Entity   string        `json:"entity"`
	Exercice int           `json:"exercice"`
	Lines    []BooksCrLine `json:"lines"`
	Resultat string        `json:"resultat"`
	// Months is present only when the caller asked for `by=month`. The annual
	// figures above stay alongside it: a grid still needs its total, and asking
	// twice would invite two views of one statement read from two moments.
	Months []BooksMonthlyCr `json:"months,omitempty"`
}

// BooksMonthlyCr is one month in the same statutory line structure as the year.
// A reading aid — art. 959b defines the ANNUAL statement, and no column here is
// filable.
type BooksMonthlyCr struct {
	Month    string        `json:"month"`
	Lines    []BooksCrLine `json:"lines"`
	Resultat string        `json:"resultat"`
}

// BooksOverviewBook carries whichever statement the book's legal form has.
// `Bilan` and `Ri` are separate pointers rather than one polymorphic field,
// because a sole proprietorship has no balance sheet under art. 957 al. 2.
type BooksOverviewBook struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	LegalForm string `json:"legal_form"`
	Exercice  int    `json:"exercice"`
	Bilan     *struct {
		Actif    string `json:"actif"`
		Passif   string `json:"passif"`
		Balanced bool   `json:"balanced"`
		Resultat string `json:"resultat"`
	} `json:"bilan"`
	Ri *struct {
		Recettes string `json:"recettes"`
		Depenses string `json:"depenses"`
		Resultat string `json:"resultat"`
	} `json:"ri"`
	Entries      int `json:"entries"`
	Unrecognized int `json:"unrecognized"`
	// What the worklist actually lists: unrecognized AND inferred.
	Worklist int `json:"worklist"`
	Staged   int `json:"staged"`
}

func (c *Client) ListBooksEntities(ws string) ([]BooksEntity, error) {
	var resp struct {
		Data []BooksEntity `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/entities", ws), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateBooksEntity(ws string, req CreateBooksEntityRequest) (*BooksEntity, error) {
	var out BooksEntity
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/entities", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListBooksExercices(ws, entity string) ([]BooksExercice, error) {
	path := fmt.Sprintf("/api/workspaces/%s/exercices", ws)
	if entity != "" {
		path += "?entity=" + entity
	}
	var resp struct {
		Data []BooksExercice `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateBooksExercice(ws string, req CreateBooksExerciceRequest) (*BooksExercice, error) {
	var out BooksExercice
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/exercices", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListBooksAccounts(ws string, s BooksScope) ([]BooksAccount, error) {
	var resp struct {
		Data []BooksAccount `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/accounts%s", ws, s.query()), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ListBooksEntries reads the grand livre. `status`, `recognition` and `account`
// are the same filters the web surface uses.
func (c *Client) ListBooksEntries(ws string, s BooksScope, status, recognition, account string, limit int) ([]BooksEntry, error) {
	q := s.query()
	sep := "?"
	if q != "" {
		sep = "&"
	}
	add := func(k, v string) {
		if v == "" {
			return
		}
		q += sep + k + "=" + v
		sep = "&"
	}
	add("status", status)
	add("recognition", recognition)
	add("account", account)
	if limit > 0 {
		q += sep + fmt.Sprintf("limit=%d", limit)
	}
	var resp struct {
		Data []BooksEntry `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/entries%s", ws, q), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// GetBooksEntry takes the workspace #number, never a row id.
func (c *Client) GetBooksEntry(ws string, number int, entity string) (*BooksEntry, error) {
	var out BooksEntry
	path := fmt.Sprintf("/api/workspaces/%s/entries/%d", ws, number)
	if entity != "" {
		path += "?entity=" + url.QueryEscape(entity)
	}
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetBooksBilan(ws string, s BooksScope) (*BooksBilan, error) {
	var out BooksBilan
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/bilan%s", ws, s.query()), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetBooksCr(ws string, s BooksScope, byMonth bool) (*BooksCr, error) {
	var out BooksCr
	q := s.query()
	if byMonth {
		if q == "" {
			q = "?by=month"
		} else {
			q += "&by=month"
		}
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/compte-resultat%s", ws, q), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetBooksOverview(ws string) ([]BooksOverviewBook, error) {
	var resp struct {
		Books []BooksOverviewBook `json:"books"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/overview", ws), &resp); err != nil {
		return nil, err
	}
	return resp.Books, nil
}

// BooksPatrimoine is the sole proprietorship's net-worth statement.
// `AsOf` is what it describes; `Compiled` is when it was produced.
type BooksPatrimoine struct {
	Number   int    `json:"number"`
	AsOf     string `json:"as_of"`
	Compiled string `json:"compiled"`
	Total    string `json:"total"`
	Items    []struct {
		Label struct {
			Fr string `json:"fr"`
		} `json:"label"`
		// A `numeric` string since 2026-08-19, like every other amount.
		Amount string `json:"amount"`
	} `json:"items"`
}

func (c *Client) ListBooksPatrimoine(ws string, s BooksScope) ([]BooksPatrimoine, error) {
	var resp struct {
		Data []BooksPatrimoine `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/patrimoine%s", ws, s.query()), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ---------------------------------------------------------------------------
// Phase 2: recognition — the worklist, the rules, and the first write
// ---------------------------------------------------------------------------

// BooksWorklistRow is one thing needing a human, from either bookkeeping
// regime. `SuggestedRules` is the machine's opinion, computed live server-side
// and applied by nobody until a human resolves.
type BooksWorklistRow struct {
	Kind           string `json:"kind"`
	Number         int    `json:"number"`
	Date           string `json:"date"`
	Status         string `json:"status"`
	RawLabel       string `json:"raw_label"`
	Counterparty   string `json:"counterparty"`
	Recognition    string `json:"recognition"`
	EvidenceTier   string `json:"evidence_tier"`
	Amount         string `json:"amount"`
	SuggestedRules []int  `json:"suggested_rules"`
	// Pieces only: entry #numbers this document could prove.
	SuggestedEntries []int `json:"suggested_entries"`
}

func (c *Client) GetBooksWorklist(ws string, s BooksScope) ([]BooksWorklistRow, error) {
	var resp struct {
		Entity   string             `json:"entity"`
		Exercice int                `json:"exercice"`
		Rows     []BooksWorklistRow `json:"rows"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/worklist%s", ws, s.query()), &resp); err != nil {
		return nil, err
	}
	return resp.Rows, nil
}

// BooksRule is a remembered judgment. The match key is the PAIR (source,
// counterparty), and `CreatedFrom` is the workspace #number of the entry that
// taught it, when one did.
type BooksRule struct {
	Number      int    `json:"number"`
	Active      bool   `json:"active"`
	SourceID    *int   `json:"source_id"`
	LearnedFrom string `json:"learned_from"`
	Pattern     struct {
		Counterparty string   `json:"counterparty"`
		AmountChf    *float64 `json:"amount_chf"`
		ToleranceChf *float64 `json:"tolerance_chf"`
		Interval     string   `json:"interval"`
	} `json:"pattern"`
	Explanation map[string]any `json:"explanation"`
	Account     string         `json:"account"`
	CreatedFrom *int           `json:"created_from"`
	CreatedOn   string         `json:"created_on"`
}

func (c *Client) ListBooksRules(ws string, s BooksScope) ([]BooksRule, error) {
	var resp struct {
		Data []BooksRule `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/rules%s", ws, s.query()), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// CreateBooksRuleRequest teaches a rule with no teaching entry: a contract or
// subscription known before the first franc moves.
type CreateBooksRuleRequest struct {
	Entity       string   `json:"-"`
	Counterparty string   `json:"counterparty"`
	SourceID     *int     `json:"source_id,omitempty"`
	AmountChf    *float64 `json:"amount_chf,omitempty"`
	ToleranceChf *float64 `json:"tolerance_chf,omitempty"`
	Interval     string   `json:"interval,omitempty"`
	Account      string   `json:"account,omitempty"`
	LearnedFrom  string   `json:"learned_from,omitempty"`
}

func (c *Client) CreateBooksRule(ws string, req CreateBooksRuleRequest) (*BooksRule, error) {
	var out BooksRule
	q := ""
	if req.Entity != "" {
		q = "?entity=" + req.Entity
	}
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/rules%s", ws, q), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResolveBooksEntryRequest is the first write: what this money was. `Rule`
// teaches one from the resolution; the server keys it to the entry's source.
type ResolveBooksEntryRequest struct {
	// Entity names a SIMPLIFIED book to resolve in its recettes-dépenses
	// journal; empty means the grand livre.
	Entity       string         `json:"entity,omitempty"`
	Explanation  map[string]any `json:"explanation"`
	Recognition  string         `json:"recognition,omitempty"`
	Counterparty string         `json:"counterparty,omitempty"`
	Account      string         `json:"account,omitempty"`
	// TVA usually arrives HERE: a bank line lands with no rate, and the rate
	// is known once somebody reads the invoice behind it.
	TvaRate         string `json:"tva_rate,omitempty"`
	TvaAmount       string `json:"tva_amount,omitempty"`
	TvaInputClaimed bool   `json:"tva_input_claimed,omitempty"`
	EvidenceTier    string `json:"evidence_tier,omitempty"`
	Rule            *struct {
		Counterparty string   `json:"counterparty"`
		AmountChf    *float64 `json:"amount_chf,omitempty"`
		ToleranceChf *float64 `json:"tolerance_chf,omitempty"`
		Interval     string   `json:"interval,omitempty"`
		LearnedFrom  string   `json:"learned_from,omitempty"`
	} `json:"rule,omitempty"`
}

// BooksResolveResult is what changed, including the taught rule when there is
// one, so an agent can report the whole consequence of its action.
type BooksResolveResult struct {
	Number      int            `json:"number"`
	Recognition string         `json:"recognition"`
	TaughtRule  *int           `json:"taught_rule"`
	History     []any          `json:"history"`
	Explanation map[string]any `json:"explanation"`
}

func (c *Client) ResolveBooksEntry(ws string, number int, req ResolveBooksEntryRequest) (*BooksResolveResult, error) {
	var out BooksResolveResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/entries/%d/resolve", ws, number), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Phase 3: the sources register and the pièces pipeline
// ---------------------------------------------------------------------------

// BooksSourceRow is one line of the register. `Status` is computed server-side
// from cadence against last_import and is not stored anywhere — which is the
// register's whole point.
type BooksSourceRow struct {
	Number         int      `json:"number"`
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	Layer          *string  `json:"layer"`
	Entity         *string  `json:"entity"`
	Method         *string  `json:"method"`
	Expected       *string  `json:"expected"`
	LastImport     *string  `json:"last_import"`
	Retired        bool     `json:"retired"`
	LedgerAccounts []string `json:"ledger_accounts"`
	Status         string   `json:"status"`
	Windows        struct {
		StaleAfterDays int `json:"stale_after_days"`
		GapAfterDays   int `json:"gap_after_days"`
	} `json:"windows"`
}

func (c *Client) ListBooksSources(ws, entity string) ([]BooksSourceRow, error) {
	q := ""
	if entity != "" {
		q = "?entity=" + entity
	}
	var resp struct {
		Data []BooksSourceRow `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/sources%s", ws, q), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// BooksSourceDetail adds what hangs off one source: the raw files pulled and
// the runbook. `Runbook.CredentialRef` is a vault reference, never a secret.
type BooksSourceDetail struct {
	BooksSourceRow
	Pulls []struct {
		File     string  `json:"file"`
		Period   *string `json:"period"`
		Format   *string `json:"format"`
		Hash     *string `json:"hash"`
		DriveRef *string `json:"drive_ref"`
		Pulled   *string `json:"pulled"`
	} `json:"pulls"`
	Runbook *struct {
		Version       string   `json:"version"`
		Updated       *string  `json:"updated"`
		LoginURL      *string  `json:"login_url"`
		CredentialRef *string  `json:"credential_ref"`
		Steps         []string `json:"steps"`
		Output        *string  `json:"output"`
	} `json:"runbook"`
}

func (c *Client) GetBooksSource(ws string, number int) (*BooksSourceDetail, error) {
	var out BooksSourceDetail
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/sources/%d", ws, number), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksManifestFile is one Drive file in the worker's ledger.
type BooksManifestFile struct {
	FileID     string  `json:"file_id"`
	Name       *string `json:"name"`
	State      string  `json:"state"`
	Fetched    *string `json:"fetched"`
	Archived   bool    `json:"archived"`
	ArchiveRef *string `json:"archive_ref"`
	Piece      *int    `json:"piece"`
}

func (c *Client) GetBooksManifest(ws string, sourceNumber int) ([]BooksManifestFile, error) {
	var resp struct {
		Files []BooksManifestFile `json:"files"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/sources/%d/manifest", ws, sourceNumber), &resp); err != nil {
		return nil, err
	}
	return resp.Files, nil
}

// BooksPiece is one inbox document. `Validation` is THE SERVER'S verdict; the
// worker's own claim sits inside `extraction` and is read by nothing.
type BooksPiece struct {
	Number       int     `json:"number"`
	Entity       *string `json:"entity"`
	Status       string  `json:"status"`
	Received     string  `json:"received"`
	DocumentType string  `json:"document_type"`
	Merchant     *string `json:"merchant"`
	Total        *string `json:"total"`
	Date         *string `json:"date"`
	NeedsReview  bool    `json:"needs_review"`
	DuplicateOf  *int    `json:"duplicate_of"`
	MatchedEntry *int    `json:"matched_entry"`
	// Which journal MatchedEntry's number lives in: "grand_livre" or, for a
	// simplified book, "recettes_depenses". Nil until matched.
	MatchedJournal *string `json:"matched_journal"`
	Validation     struct {
		Passed   bool     `json:"passed"`
		Problems []string `json:"problems"`
	} `json:"validation"`
}

func (c *Client) ListBooksPieces(ws, entity, status string) ([]BooksPiece, error) {
	q := url.Values{}
	if entity != "" {
		q.Set("entity", entity)
	}
	if status != "" {
		q.Set("status", status)
	}
	qs := ""
	if len(q) > 0 {
		qs = "?" + q.Encode()
	}
	var resp struct {
		Data []BooksPiece `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/pieces%s", ws, qs), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// BooksIngestResult reports what the door decided: created or converged,
// the server's verdict, and the duplicate it flagged if any.
type BooksIngestResult struct {
	Number      int  `json:"number"`
	Created     bool `json:"created"`
	NeedsReview bool `json:"needs_review"`
	DuplicateOf *int `json:"duplicate_of"`
	Validation  struct {
		Passed   bool     `json:"passed"`
		Problems []string `json:"problems"`
	} `json:"validation"`
}

// IngestBooksPiece posts a raw ExtractionResult payload. The payload travels
// as-is: the CLI does not pre-validate, because the SERVER's verdict is the
// only one that counts and a CLI that filtered first would hide exactly the
// documents a human must see.
func (c *Client) IngestBooksPiece(ws string, payload json.RawMessage) (*BooksIngestResult, error) {
	var out BooksIngestResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/pieces/ingest", ws), payload, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) MatchBooksPiece(ws string, piece, entry int) (*BooksPiece, error) {
	var out BooksPiece
	body := map[string]int{"entry": entry}
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/pieces/%d/match", ws, piece), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ===========================================================================
// THE BANK DOOR AND POSTING (phase 4A)
// ===========================================================================

// BooksImportSummary is what one statement import did — and did not — do.
type BooksImportSummary struct {
	Source  int    `json:"source"`
	File    string `json:"file"`
	Journal string `json:"journal"`
	Period  struct {
		From *string `json:"from"`
		To   *string `json:"to"`
	} `json:"period"`
	Opening      string `json:"opening"`
	Closing      string `json:"closing"`
	LinesTotal   int    `json:"lines_total"`
	Imported     int    `json:"imported"`
	Inferred     int    `json:"inferred"`
	Unrecognized int    `json:"unrecognized"`
	AlreadyKnown int    `json:"already_known"`
	WithFx       int    `json:"with_fx"`
	Staged       []int  `json:"staged"`
}

func (c *Client) ImportBooksSource(ws string, source int, file, xml string) (*BooksImportSummary, error) {
	var out BooksImportSummary
	body := map[string]string{"file": file, "xml": xml}
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/sources/%d/import", ws, source), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksPostResult reports one posting. `Already` marks the idempotent no-op.
type BooksPostResult struct {
	Number  int    `json:"number"`
	EntryNo int    `json:"entry_no"`
	Status  string `json:"status"`
	Already bool   `json:"already"`
}

func (c *Client) PostBooksEntry(ws string, entry int) (*BooksPostResult, error) {
	var out BooksPostResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/entries/%d/post", ws, entry), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ===========================================================================
// DECLARE AND THE REGISTER'S WRITE HALF (phase 4A)
// ===========================================================================

// DeclareBooksEntryRequest is money no feed will deliver: a cash expense,
// declared. Double-entry books need Account + Contra; RI books need Direction.
type DeclareBooksEntryRequest struct {
	Entity       string         `json:"entity"`
	Date         string         `json:"date"`
	Amount       string         `json:"amount"`
	Label        string         `json:"label"`
	Explanation  map[string]any `json:"explanation"`
	Counterparty string         `json:"counterparty,omitempty"`
	Direction    string         `json:"direction,omitempty"`
	Account      string         `json:"account,omitempty"`
	Contra       string         `json:"contra,omitempty"`
	// TVA. Rate is the percent as written on the invoice; the server derives
	// the amount from the TTC gross when it is omitted, and refuses a given
	// amount that disagrees by more than a rappen.
	TvaRate         string `json:"tva_rate,omitempty"`
	TvaAmount       string `json:"tva_amount,omitempty"`
	TvaInputClaimed bool   `json:"tva_input_claimed,omitempty"`
	EvidenceTier    string `json:"evidence_tier,omitempty"`
	// Lines carries an écriture with more than two sides — a salary is three:
	// salaires and charges sociales against the bank. Mutually exclusive with
	// Account/Contra, which IS the two-line shorthand.
	Lines []BooksDeclareLine `json:"lines,omitempty"`
}

// BooksDeclareLine is one side. Exactly one of Debit and Credit is set.
type BooksDeclareLine struct {
	Account string `json:"account"`
	Debit   string `json:"debit,omitempty"`
	Credit  string `json:"credit,omitempty"`
}

type BooksDeclareResult struct {
	Number  int    `json:"number"`
	Journal string `json:"journal"`
	EntryNo *int   `json:"entry_no"`
}

func (c *Client) DeclareBooksEntry(ws string, req DeclareBooksEntryRequest) (*BooksDeclareResult, error) {
	var out BooksDeclareResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/entries", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type CreateBooksSourceRequest struct {
	Entity         string         `json:"entity"`
	Name           string         `json:"name"`
	Type           string         `json:"type"`
	Expected       string         `json:"expected,omitempty"`
	LedgerAccounts []string       `json:"ledger_accounts,omitempty"`
	Method         string         `json:"method,omitempty"`
	Notes          map[string]any `json:"notes,omitempty"`
}

type BooksSourceWriteResult struct {
	Number  int    `json:"number"`
	Name    string `json:"name"`
	Type    string `json:"type,omitempty"`
	Retired bool   `json:"retired,omitempty"`
}

func (c *Client) CreateBooksSource(ws string, req CreateBooksSourceRequest) (*BooksSourceWriteResult, error) {
	var out BooksSourceWriteResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/sources", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// EditBooksSource sends only the fields the caller set; the server leaves the
// rest untouched.
func (c *Client) EditBooksSource(ws string, source int, patch map[string]any) (*BooksSourceWriteResult, error) {
	var out BooksSourceWriteResult
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/sources/%d", ws, source), patch, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type RecordBooksPullRequest struct {
	File     string `json:"file"`
	Period   string `json:"period,omitempty"`
	Format   string `json:"format,omitempty"`
	Hash     string `json:"hash,omitempty"`
	DriveRef string `json:"drive_ref,omitempty"`
	Pulled   string `json:"pulled,omitempty"`
}

type BooksPullRecordResult struct {
	File    string `json:"file"`
	Period  string `json:"period"`
	Hash    string `json:"hash"`
	Created bool   `json:"created"`
}

func (c *Client) RecordBooksPull(ws string, source int, req RecordBooksPullRequest) (*BooksPullRecordResult, error) {
	var out BooksPullRecordResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/sources/%d/pulls", ws, source), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SetBooksRunbook replaces the source's runbook in place — one per source,
// history belongs to git. The payload travels as-is; the server refuses a
// credential where a reference belongs.
func (c *Client) SetBooksRunbook(ws string, source int, body map[string]any) (map[string]any, error) {
	var out map[string]any
	if err := c.putJSON(fmt.Sprintf("/api/workspaces/%s/sources/%d/runbook", ws, source), body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Phase 4B: management — analytique, analyses, categories, tax snapshot
// ---------------------------------------------------------------------------

type BooksMonthlyFlow struct {
	Month    string `json:"month"`
	Produits string `json:"produits"`
	Charges  string `json:"charges"`
}

type BooksCategoryLine struct {
	Number       int    `json:"number"`
	Date         string `json:"date"`
	Counterparty string `json:"counterparty"`
	Amount       string `json:"amount"`
	Account      string `json:"account"`
}

type BooksCategoryBreakdown struct {
	Key      string              `json:"key"`
	Label    map[string]any      `json:"label"`
	Accounts []string            `json:"accounts"`
	Amount   string              `json:"amount"`
	Lines    []BooksCategoryLine `json:"lines"`
}

type BooksAnalytique struct {
	Entity       string                   `json:"entity"`
	Exercice     int                      `json:"exercice"`
	Categories   []BooksCategoryBreakdown `json:"categories"`
	MonthlyFlows []BooksMonthlyFlow       `json:"monthly_flows"`
}

func (c *Client) GetBooksAnalytique(ws string, s BooksScope) (*BooksAnalytique, error) {
	var out BooksAnalytique
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/analytique%s", ws, s.query()), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksAnalysis is one FILED answer: question, verdict, figures, and the
// based_on snapshot of what the agent read. The record never changes; a
// drifted answer is re-asked into a new row.
type BooksAnalysis struct {
	Number            int              `json:"number"`
	Entity            string           `json:"entity"`
	Asked             string           `json:"asked"`
	AskedBy           string           `json:"asked_by"`
	Agent             string           `json:"agent"`
	ScenarioLabel     any              `json:"scenario_label"`
	RunwayAfterMonths *float64         `json:"runway_after_months"`
	Question          any              `json:"question"`
	Verdict           any              `json:"verdict"`
	Figures           []map[string]any `json:"figures"`
	BasedOn           []map[string]any `json:"based_on"`
}

func (c *Client) ListBooksAnalyses(ws string, entity string) ([]BooksAnalysis, error) {
	var resp struct {
		Data []BooksAnalysis `json:"data"`
	}
	q := ""
	if entity != "" {
		q = "?entity=" + entity
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/analyses%s", ws, q), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetBooksAnalysis(ws string, number int) (*BooksAnalysis, error) {
	var out BooksAnalysis
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/analyses/%d", ws, number), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RecordBooksAnalysisRequest files one analysis — the agent write-back
// contract. based_on items are {label, value, href?}: the snapshot of what
// was read is the point of the record, and the server refuses one without it.
type RecordBooksAnalysisRequest struct {
	Entity            string           `json:"entity"`
	AskedBy           string           `json:"asked_by"`
	Agent             string           `json:"agent"`
	Question          any              `json:"question"`
	Verdict           any              `json:"verdict"`
	Figures           []map[string]any `json:"figures,omitempty"`
	BasedOn           []map[string]any `json:"based_on,omitempty"`
	ScenarioLabel     any              `json:"scenario_label,omitempty"`
	RunwayAfterMonths *float64         `json:"runway_after_months,omitempty"`
}

func (c *Client) RecordBooksAnalysis(ws string, req RecordBooksAnalysisRequest) (*BooksAnalysis, error) {
	var out BooksAnalysis
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/analyses", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type BooksCategory struct {
	Number   int            `json:"number"`
	Entity   string         `json:"entity"`
	Key      string         `json:"key"`
	Label    map[string]any `json:"label"`
	Accounts []string       `json:"accounts"`
	Retired  bool           `json:"retired"`
}

func (c *Client) ListBooksCategories(ws string, entity string) ([]BooksCategory, error) {
	var resp struct {
		Data []BooksCategory `json:"data"`
	}
	q := ""
	if entity != "" {
		q = "?entity=" + entity
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/analytique/categories%s", ws, q), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

type CreateBooksCategoryRequest struct {
	Entity   string   `json:"entity"`
	Key      string   `json:"key"`
	Label    any      `json:"label"`
	Accounts []string `json:"accounts"`
}

func (c *Client) CreateBooksCategory(ws string, req CreateBooksCategoryRequest) (*BooksCategory, error) {
	var out BooksCategory
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/analytique/categories", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type BooksVatPosition struct {
	OpeningDue      string `json:"opening_due"`
	OutputYtd       string `json:"output_ytd"`
	InputClaimedYtd string `json:"input_claimed_ytd"`
	NetDue          string `json:"net_due"`
}

type BooksProfitTax struct {
	Cantonal     string  `json:"cantonal"`
	Communal     string  `json:"communal"`
	Ifd          string  `json:"ifd"`
	Total        string  `json:"total"`
	StatutoryPct float64 `json:"statutory_pct"`
	EffectivePct float64 `json:"effective_pct"`
}

type BooksCapitalTax struct {
	Gross    string `json:"gross"`
	Credited string `json:"credited"`
	NetDue   string `json:"net_due"`
}

type BooksTaxSnapshot struct {
	Entity   string            `json:"entity"`
	Exercice int               `json:"exercice"`
	Profit   string            `json:"profit"`
	Equity   string            `json:"equity"`
	Vat      *BooksVatPosition `json:"vat"`
	Tax      *struct {
		Canton     string          `json:"canton"`
		Commune    string          `json:"commune"`
		ProfitTax  BooksProfitTax  `json:"profit_tax"`
		CapitalTax BooksCapitalTax `json:"capital_tax"`
		Params     map[string]any  `json:"params"`
	} `json:"tax"`
	Configured bool `json:"configured"`
}

func (c *Client) GetBooksTaxSnapshot(ws string, s BooksScope) (*BooksTaxSnapshot, error) {
	var out BooksTaxSnapshot
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/tax-snapshot%s", ws, s.query()), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Phase 5: compliance — rules, review, verdicts
// ---------------------------------------------------------------------------

type BooksComplianceRule struct {
	RuleID           string         `json:"rule_id"`
	Citation         string         `json:"citation"`
	AppliesTo        string         `json:"applies_to"`
	TriggerCondition string         `json:"trigger_condition"`
	CheckLogic       string         `json:"check_logic"`
	Severity         string         `json:"severity"`
	Consequence      string         `json:"consequence"`
	Summary          map[string]any `json:"summary"`
	SourceConfidence string         `json:"source_confidence"`
	ReviewState      string         `json:"review_state"`
	EditedLogic      string         `json:"edited_logic"`
	ReviewNote       string         `json:"review_note"`
	ReviewedBy       string         `json:"reviewed_by"`
	ReviewedAt       string         `json:"reviewed_at"`
}

func (c *Client) ListBooksComplianceRules() ([]BooksComplianceRule, error) {
	var resp struct {
		Data []BooksComplianceRule `json:"data"`
	}
	if err := c.get("/api/compliance-rules", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GetBooksComplianceRule(ruleID string) (*BooksComplianceRule, error) {
	var out BooksComplianceRule
	if err := c.get("/api/compliance-rules/"+ruleID, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ReviewBooksComplianceRuleRequest is the fiduciary's sign-off: approved,
// edited (with the corrected wording; the original stays), or rejected.
// There is no path back to draft — draft is where rules are born.
type ReviewBooksComplianceRuleRequest struct {
	State       string `json:"state"`
	EditedLogic string `json:"edited_logic,omitempty"`
	Note        string `json:"note,omitempty"`
}

func (c *Client) ReviewBooksComplianceRule(ruleID string, req ReviewBooksComplianceRuleRequest) (*BooksComplianceRule, error) {
	var out BooksComplianceRule
	if err := c.patchJSON("/api/compliance-rules/"+ruleID, req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RecordBooksVerdictRequest is the Devil's Advocate's structured verdict:
// accepted / accepted_with_warning / blocked, the rules that triggered, the
// worst case and what would resolve it. blocked refuses to post, server side.
type RecordBooksVerdictRequest struct {
	Entity    string   `json:"entity,omitempty"`
	Verdict   string   `json:"verdict"`
	Rules     []string `json:"rules"`
	WorstCase string   `json:"worst_case,omitempty"`
	Resolves  string   `json:"resolves,omitempty"`
}

type BooksVerdictResult struct {
	Journal string         `json:"journal"`
	Number  int            `json:"number"`
	Verdict map[string]any `json:"verdict"`
}

func (c *Client) RecordBooksVerdict(ws string, number int, req RecordBooksVerdictRequest) (*BooksVerdictResult, error) {
	var out BooksVerdictResult
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/entries/%d/verdict", ws, number), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Chart, openings and the close — the doors that let a real book start and end
// ---------------------------------------------------------------------------

// CreateBooksAccountRequest adds an account the PME template does not carry.
// The template is 24 accounts and a company's chart is its own: the seeded
// books already keep two extra banks.
type CreateBooksAccountRequest struct {
	Entity            string `json:"entity"`
	No                string `json:"no"`
	Class             int    `json:"class"`
	LabelFr           string `json:"label_fr"`
	LabelEn           string `json:"label_en,omitempty"`
	StatementPosition string `json:"statement_position"`
}

func (c *Client) CreateBooksAccount(ws string, req CreateBooksAccountRequest) (*BooksAccount, error) {
	var out BooksAccount
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/accounts", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksOpening is one line of a book's starting balance sheet.
type BooksOpening struct {
	Entity   string `json:"entity"`
	Exercice int    `json:"exercice"`
	Account  string `json:"account"`
	Amount   string `json:"amount"`
}

func (c *Client) ListBooksOpenings(ws string, s BooksScope) ([]BooksOpening, error) {
	var resp struct {
		Data []BooksOpening `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/openings%s", ws, s.query()), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// SetBooksOpeningsRequest REPLACES a year's openings. Whole set, never one
// line: a balance sheet is one statement that must balance, and the server
// refuses an unbalanced one.
type SetBooksOpeningsRequest struct {
	Entity   string             `json:"entity"`
	Exercice int                `json:"exercice,omitempty"`
	Balances []BooksOpeningLine `json:"balances"`
}

type BooksOpeningLine struct {
	Account string `json:"account"`
	Amount  string `json:"amount"`
}

type BooksOpeningsResult struct {
	Entity      string `json:"entity"`
	Exercice    int    `json:"exercice"`
	Written     int    `json:"written"`
	TotalActif  string `json:"totalActif"`
	TotalPassif string `json:"totalPassif"`
}

func (c *Client) SetBooksOpenings(ws string, req SetBooksOpeningsRequest) (*BooksOpeningsResult, error) {
	var out BooksOpeningsResult
	if err := c.putJSON(fmt.Sprintf("/api/workspaces/%s/openings", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksCloseResult is what closing a year produced: the result carried, the
// year it landed in, and the new balance of 2970.
type BooksCloseResult struct {
	Entity           string `json:"entity"`
	Year             int    `json:"year"`
	Resultat         string `json:"resultat"`
	CarriedInto      int    `json:"carriedInto"`
	Carried          int    `json:"carried"`
	RetainedEarnings string `json:"retainedEarnings"`
	ClosedAt         string `json:"closedAt"`
}

func (c *Client) CloseBooksExercice(ws string, year int, entity string) (*BooksCloseResult, error) {
	var out BooksCloseResult
	body := struct {
		Entity string `json:"entity"`
	}{Entity: entity}
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/exercices/%d/close", ws, year), body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Book facts, tax parameters, and switching a rule off
// ---------------------------------------------------------------------------

// EditBooksEntityRequest changes a book's own facts. Pointers throughout: a
// nil field is "leave it", which is not the same as "clear it", and the VAT
// registration flag in particular must be able to be set to false on purpose.
//
// Slug, legal form and bookkeeping regime are absent deliberately — the server
// refuses each by name.
type EditBooksEntityRequest struct {
	Name           *string `json:"name,omitempty"`
	Seat           *string `json:"seat,omitempty"`
	VatRegistered  *bool   `json:"vat_registered,omitempty"`
	VatMethod      *string `json:"vat_method,omitempty"`
	VatFiling      *string `json:"vat_filing,omitempty"`
	AuditStatus    *string `json:"audit_status,omitempty"`
	RegimeElection *string `json:"regime_election,omitempty"`
	FteCount       *string `json:"fte_count,omitempty"`
	Accent         *string `json:"accent,omitempty"`
}

func (c *Client) EditBooksEntity(ws, slug string, req EditBooksEntityRequest) (*BooksEntity, error) {
	var out BooksEntity
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/entities/%s", ws, slug), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BooksTaxParams is where a company is taxed and at what rates. `Configured`
// false is a real answer: nothing may assume a canton.
type BooksTaxParams struct {
	Entity     string         `json:"entity"`
	Configured bool           `json:"configured"`
	Canton     string         `json:"canton"`
	Commune    string         `json:"commune"`
	Params     map[string]any `json:"params"`
}

func (c *Client) GetBooksTaxParams(ws, entity string) (*BooksTaxParams, error) {
	var out BooksTaxParams
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/tax-params?entity=%s", ws, entity), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type SetBooksTaxParamsRequest struct {
	Entity                     string  `json:"entity"`
	Canton                     string  `json:"canton"`
	Commune                    string  `json:"commune"`
	IfdRatePct                 float64 `json:"ifd_rate_pct"`
	CantonalBaseRatePct        float64 `json:"cantonal_base_rate_pct"`
	CantonalCoefficientPct     float64 `json:"cantonal_coefficient_pct"`
	CommunalCoefficientPct     float64 `json:"communal_coefficient_pct"`
	CapitalTaxBaseRatePermille float64 `json:"capital_tax_base_rate_permille"`
}

func (c *Client) SetBooksTaxParams(ws string, req SetBooksTaxParamsRequest) (*BooksTaxParams, error) {
	var out BooksTaxParams
	if err := c.putJSON(fmt.Sprintf("/api/workspaces/%s/tax-params", ws), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeactivateBooksRule switches a rule off. Never deletes: a posted entry may
// cite it for the ten years art. 958f keeps the entry.
func (c *Client) DeactivateBooksRule(ws string, number int) error {
	body := struct {
		Active bool `json:"active"`
	}{Active: false}
	var out struct{}
	return c.patchJSON(fmt.Sprintf("/api/workspaces/%s/rules/%d", ws, number), body, &out)
}
