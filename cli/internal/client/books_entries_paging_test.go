package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// `bk books entry list` reads the WHOLE journal — issue #69.
//
// Until #69 this client decoded `{data}` and threw `next_cursor` away, so a
// book with more than one page of écritures was served one page and the CLI
// presented it as the journal. The server was asserting the same thing (the
// cursor was hardcoded null), so nothing on either side of the wire noticed.
//
// The server half is fixed and tested in `apps/books`. This is the client half:
// with no --limit it must follow the cursor to the end, and with one it must
// take a single page and still report the total so the caller can be told what
// they are not seeing.

// journalStub serves `total` écritures in pages, honouring `limit` and `cursor`
// the way the real route does: entry numbers are 1..total, ordered, and the
// cursor is the last entry_no of the page.
func journalStub(t *testing.T, total int) (*Client, *[]string) {
	t.Helper()
	var hits []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.RawQuery)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 {
			limit = 100
		}
		after, _ := strconv.Atoi(r.URL.Query().Get("cursor"))

		rows := []BooksEntry{}
		for no := after + 1; no <= total && len(rows) < limit; no++ {
			rows = append(rows, BooksEntry{Number: no, EntryNo: no})
		}
		body := map[string]any{"data": rows, "total": total, "next_cursor": nil}
		if len(rows) > 0 {
			if last := rows[len(rows)-1].EntryNo; last < total {
				body["next_cursor"] = last
			}
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL, "t", "acme"), &hits
}

// The loop only runs above the server's 500-row ceiling, so the journal here is
// deliberately bigger than one page. An earlier version of this test used the
// ticket's 115 and passed without the cursor ever being followed — a test that
// could not fail, which is worse than no test.
func TestEntryListFollowsTheCursorToTheEnd(t *testing.T) {
	const total = 1150 // three pages at the 500 ceiling
	c, hits := journalStub(t, total)
	page, err := c.ListBooksEntries("acme", BooksScope{}, "", "", "", 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Entries) != total {
		t.Fatalf("got %d écritures, want the whole journal of %d — the tail was dropped", len(page.Entries), total)
	}
	if page.Total != total {
		t.Errorf("total = %d, want %d", page.Total, total)
	}
	// Gapless and in order: a cursor bug shows up as a repeat or a hole.
	for i, e := range page.Entries {
		if e.EntryNo != i+1 {
			t.Fatalf("entry %d of the journal has entry_no %d — the pages do not join up", i+1, e.EntryNo)
		}
	}
	if len(*hits) != 3 {
		t.Errorf("made %d requests for %d écritures at 500 a page, want 3: %v", len(*hits), total, *hits)
	}
}

// The ticket's own number, on the path a real book takes: one page, whole.
func TestEntryListServesNorthgateWhole(t *testing.T) {
	c, _ := journalStub(t, 115)
	page, err := c.ListBooksEntries("acme", BooksScope{}, "", "", "", 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Entries) != 115 {
		t.Fatalf("got %d, want 115 — the count in #69, of which 100 used to arrive", len(page.Entries))
	}
}

// A journal that fits in one page must not cost a second request.
func TestEntryListStopsWhenTheCursorIsNull(t *testing.T) {
	c, hits := journalStub(t, 12)
	page, err := c.ListBooksEntries("acme", BooksScope{}, "", "", "", 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Entries) != 12 {
		t.Fatalf("got %d, want 12", len(page.Entries))
	}
	if len(*hits) != 1 {
		t.Errorf("made %d requests for a single-page journal: %v", len(*hits), *hits)
	}
}

// --limit is a caller asking for exactly that many. It gets one page — and the
// total, which is what lets the command say "showing 10 of 115" instead of
// printing ten rows as though they were the journal.
func TestEntryListWithLimitTakesOnePageAndKnowsTheTotal(t *testing.T) {
	c, hits := journalStub(t, 115)
	page, err := c.ListBooksEntries("acme", BooksScope{}, "", "", "", 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(page.Entries) != 10 {
		t.Fatalf("got %d écritures, want the 10 that were asked for", len(page.Entries))
	}
	if page.Total != 115 {
		t.Errorf("total = %d, want 115 — without it the footer cannot say what is missing", page.Total)
	}
	if len(*hits) != 1 {
		t.Errorf("an explicit --limit must not page: %v", *hits)
	}
}
