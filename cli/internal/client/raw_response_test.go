package client

// RawResponse is a MODE of do(), not a second request path — and these tests are
// what holds that to be true. A PDF fetch has to keep everything do() does
// around the body: the token, the error envelope with its hint, the version
// floor. A second client would have been a second copy of each, and the copy
// nobody tests is the one that drifts.
//
// WATCHED FAILING, 2026-09-18 — each restored:
//   - the `wantsRaw` branch moved ABOVE the `resp.StatusCode >= 400` block
//       → TestRawResponseErrorIsStillAnAPIError red (a JSON error came back as "a PDF")
//   - `raw.Body = body` replaced with `raw.Body = bytes.TrimSpace(body)`
//       → TestRawResponseBytesAreUntouched red

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Deliberately hostile bytes: a leading and trailing newline, a NUL, and
// invalid UTF-8. Anything that treats the body as text damages at least one.
var rawBody = []byte("\n%PDF-1.7\x00\xff\xfe binary \r\n\n")

func TestRawResponseBytesAreUntouched(t *testing.T) {
	var gotAccept, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccept, gotAuth = r.Header.Get("Accept"), r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("X-Billing-Pdf-Sha256", "abc")
		_, _ = w.Write(rawBody)
	}))
	defer srv.Close()

	var raw RawResponse
	if err := New(srv.URL, "tok", "acme").get("/x", &raw); err != nil {
		t.Fatalf("get: %v", err)
	}
	if !bytes.Equal(raw.Body, rawBody) {
		t.Fatalf("body was altered:\n got %q\nwant %q", raw.Body, rawBody)
	}
	if raw.ContentType != "application/pdf" || raw.Header.Get("X-Billing-Pdf-Sha256") != "abc" {
		t.Fatalf("content type / headers not carried: %q %v", raw.ContentType, raw.Header)
	}
	if gotAuth != "Bearer tok" {
		t.Fatalf("the raw mode dropped the token: %q", gotAuth)
	}
	if gotAccept != "*/*" {
		t.Fatalf("Accept = %q; a raw fetch that says application/json asks for the wrong thing", gotAccept)
	}
}

func TestRawResponseErrorIsStillAnAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"error":"invoice X would carry an invalid payment part","code":"payment_part_invalid","suggestion":"fix the address"}`))
	}))
	defer srv.Close()

	var raw RawResponse
	err := New(srv.URL, "tok", "acme").get("/x", &raw)
	var ae *APIError
	if !errors.As(err, &ae) {
		t.Fatalf("want *APIError, got %T: %v", err, err)
	}
	if ae.Status != 422 || ae.ErrorMsg == "" || ae.Suggestion != "fix the address" {
		t.Fatalf("the envelope was not decoded: %+v", ae)
	}
	if len(raw.Body) != 0 {
		t.Fatalf("an error body was handed back as content: %q", raw.Body)
	}
}

func TestBillingPdfRefusesAnAnswerThatIsNotAPdf(t *testing.T) {
	// A 200 that is not a PDF — a proxy's login page, a misrouted JSON answer —
	// must never be written to disk under a `.pdf` name.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>sign in</html>"))
	}))
	defer srv.Close()
	if _, err := New(srv.URL, "tok", "acme").GetBillingInvoicePdf("acme", "7"); err == nil {
		t.Fatal("an HTML 200 was accepted as a PDF")
	}
}
