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

// BooksNote is the scaffold's placeholder entity, carried while phase 0 is in
// progress so this app has a route and a command to be parity-checked against.
// Phase 1 replaces it with the ledger entry and this type goes with it.
type BooksNote struct {
	Number    int     `json:"number" yaml:"number"`
	Title     string  `json:"title" yaml:"title"`
	Body      *string `json:"body" yaml:"body"`
	CreatedAt string  `json:"created_at" yaml:"created_at"`
}

type CreateBooksNoteRequest struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
}

// ListBooksNotes unwraps the `{ data, next_cursor }` envelope every list route
// serves.
func (c *Client) ListBooksNotes(slugOrID string, limit int) ([]BooksNote, error) {
	path := fmt.Sprintf("/api/workspaces/%s/notes", slugOrID)
	if limit > 0 {
		path += fmt.Sprintf("?limit=%d", limit)
	}
	var resp struct {
		Data []BooksNote `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateBooksNote(slugOrID string, req CreateBooksNoteRequest) (*BooksNote, error) {
	var out BooksNote
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/notes", slugOrID), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
