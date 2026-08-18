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

import "fmt"

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
// `Label` is left as raw JSON shape (fr + enSuffix) in the payload; the CLI prints
// the French, which is the statutory wording.
type BooksAccount struct {
	No    string `json:"no"`
	Class int    `json:"class"`
	Label struct {
		Fr string `json:"fr"`
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

// BooksEntry is one écriture.
//
// Note BOTH numbers. `Number` is the workspace #number this CLI addresses rows
// by; `EntryNo` is the statutory journal number, gapless per (book, year), which
// is what a tax authority reads. Neither substitutes for the other.
type BooksEntry struct {
	Number       int              `json:"number"`
	EntryNo      int              `json:"entry_no"`
	Date         string           `json:"date"`
	Status       string           `json:"status"`
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
	Staged       int `json:"staged"`
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
func (c *Client) GetBooksEntry(ws string, number int) (*BooksEntry, error) {
	var out BooksEntry
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/entries/%d", ws, number), &out); err != nil {
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

func (c *Client) GetBooksCr(ws string, s BooksScope) (*BooksCr, error) {
	var out BooksCr
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/compte-resultat%s", ws, s.query()), &out); err != nil {
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
		Amount float64 `json:"amount"`
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
