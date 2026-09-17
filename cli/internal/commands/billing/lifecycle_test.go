package billing

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

// ---------------------------------------------------------------------------
// `bk billing invoice void` — THE CONFIRMATION THAT ACTUALLY GUARDS
// ---------------------------------------------------------------------------
// Four properties, each a way this guard has failed somewhere in this repo:
//
//  1. --confirm is required EVEN WITH --yes AND BK_NO_PROMPT=1 — the two things
//     that make cmdutil.Confirm() return true without asking.
//  2. it is compared with the invoice's REAL printed number, read from the
//     server, not with the <ref> argument (`void 7 --confirm 7` must fail)
//  3. the value SENT is the trimmed value compared — never the raw flag
//  4. a refusal is a UsageError whose message contains "required" (exit 2)
//
// Watched failing on 2026-09-17, each restored:
//   - the local `--confirm` presence check deleted → the no-confirm case made a
//     request (the GET) before refusing
//   - checkVoidConfirm compared against `ref` instead of `target.Ref` → the
//     `--confirm 7` case voided, AND the correct-number case was refused
//   - the raw flag sent instead of the trimmed value → the wire carried the spaces
//     (the first spelling of this mutation left `confirm` unused and did not
//     COMPILE — a red that proved nothing, redone as one that builds)
//   - strings.EqualFold in checkVoidConfirm → the lower-case row of the table passed

type recorded struct {
	Method, Path, Body, IdempotencyKey string
}

// fakeBilling serves one invoice, numbered BC-2026-0007, at #7, and records
// every request so a test can assert what reached the wire — including that
// nothing did.
func fakeBilling(t *testing.T) (*[]recorded, func()) {
	t.Helper()
	var mu sync.Mutex
	hits := []recorded{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		hits = append(hits, recorded{r.Method, r.URL.Path, string(b), r.Header.Get("Idempotency-Key")})
		mu.Unlock()
		status := "sent"
		if r.Method == http.MethodPost {
			status = "void"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"seq":7,"company":"acme","number":"BC-2026-0007","status":"` + status +
			`","currency":"CHF","client":{"name":"Junod SA"},"items":[],"totals":{"total":"1590.00"}}`))
	}))

	dir := t.TempDir()
	t.Setenv("BK_CONFIG_DIR", dir)
	t.Setenv("BK_NO_PROMPT", "1")
	cfg, _ := json.Marshal(map[string]any{
		"token":             "bk_live_test",
		"home_app":          "billing",
		"home_server":       srv.URL,
		"app_servers":       map[string]string{"billing": srv.URL},
		"active_workspaces": map[string]any{"billing": map[string]any{"id": 1, "slug": "acme-ws"}},
	})
	if err := os.WriteFile(filepath.Join(dir, "config.json"), cfg, 0o600); err != nil {
		t.Fatal(err)
	}
	return &hits, srv.Close
}

func runVoid(t *testing.T, args ...string) error {
	t.Helper()
	cmd := newInvoiceVoidCmd()
	cmd.SetArgs(args)
	cmd.SetOut(io.Discard)
	cmd.SetErr(io.Discard)
	return cmd.Execute()
}

func requireUsage(t *testing.T, err error) {
	t.Helper()
	var use *cmdutil.UsageError
	if !errors.As(err, &use) || !strings.Contains(err.Error(), "required") {
		t.Fatalf("want a UsageError containing \"required\" (exit 2, as the server's 409 would be), got %T: %v", err, err)
	}
}

func TestVoidConfirmRule(t *testing.T) {
	const number = "BC-2026-0007"
	for _, tc := range []struct {
		flag, want string
		ok         bool
	}{
		{"BC-2026-0007", "BC-2026-0007", true},
		{"  BC-2026-0007\t", "BC-2026-0007", true}, // trimmed, and the TRIMMED value is returned
		{"", "", false},
		{"   ", "", false},
		{"bc-2026-0007", "", false}, // a number is not case-insensitive
		{"BC-2026-0008", "", false},
		{"7", "", false}, // the #number is not the printed number
	} {
		got, err := checkVoidConfirm(tc.flag, number)
		if tc.ok && (err != nil || got != tc.want) {
			t.Errorf("checkVoidConfirm(%q) = %q, %v; want %q", tc.flag, got, err, tc.want)
		}
		if !tc.ok {
			if err == nil {
				t.Errorf("checkVoidConfirm(%q) accepted it; a wrong confirmation must refuse", tc.flag)
				continue
			}
			requireUsage(t, err)
		}
	}
}

func TestVoidWithoutConfirmRefusesBeforeAnyRequest_EvenWithYesAndNoPrompt(t *testing.T) {
	hits, done := fakeBilling(t)
	defer done()

	err := runVoid(t, "7", "--reason", "wrong entity", "--yes")
	requireUsage(t, err)
	if len(*hits) != 0 {
		t.Fatalf("a void with no --confirm reached the server (%v) — under --yes and BK_NO_PROMPT=1 "+
			"nothing else stands between an agent and a cancelled bill", *hits)
	}
}

func TestVoidConfirmIsCheckedAgainstTheRealNumberNotTheRef(t *testing.T) {
	hits, done := fakeBilling(t)
	defer done()

	err := runVoid(t, "7", "--reason", "wrong entity", "--confirm", "7", "--yes")
	requireUsage(t, err)
	for _, h := range *hits {
		if h.Method == http.MethodPost {
			t.Fatalf("`void 7 --confirm 7` sent the void — the same typo twice is not a confirmation")
		}
	}
	if len(*hits) != 1 || (*hits)[0].Method != http.MethodGet {
		t.Fatalf("want exactly one GET of the target before refusing, got %v", *hits)
	}
}

func TestVoidSendsTheTrimmedConfirmAndTheIdempotencyKey(t *testing.T) {
	hits, done := fakeBilling(t)
	defer done()

	err := runVoid(t, "7", "--reason", "wrong entity", "--confirm", " BC-2026-0007 ", "--yes", "--idempotency-key", "order-991-void")
	if err != nil {
		t.Fatalf("a correct, space-padded confirmation was refused: %v", err)
	}
	var post *recorded
	for i := range *hits {
		if (*hits)[i].Method == http.MethodPost {
			post = &(*hits)[i]
		}
	}
	if post == nil {
		t.Fatalf("no POST reached the server: %v", *hits)
	}
	if !strings.HasSuffix(post.Path, "/invoices/7/void") {
		t.Fatalf("POST went to %s", post.Path)
	}
	var body client.VoidBillingInvoiceRequest
	if err := json.Unmarshal([]byte(post.Body), &body); err != nil {
		t.Fatal(err)
	}
	if body.Confirm != "BC-2026-0007" {
		t.Fatalf("the wire carried confirm=%q — the binary compared a trimmed value and sent another", body.Confirm)
	}
	if body.ReasonFr != "wrong entity" || body.ReasonEn != "wrong entity" {
		t.Fatalf("one --reason should serve both languages, got fr=%q en=%q", body.ReasonFr, body.ReasonEn)
	}
	if post.IdempotencyKey != "order-991-void" {
		t.Fatalf("Idempotency-Key on the wire = %q", post.IdempotencyKey)
	}
}

// Phase 1's help said `create` sends an idempotency key, and nothing did. The
// flag now does — and an empty flag sends NO header, because an empty key is
// not a key.
func TestCreateSendsTheIdempotencyKeyOnlyWhenGiven(t *testing.T) {
	hits, done := fakeBilling(t)
	defer done()

	cfgDir := os.Getenv("BK_CONFIG_DIR")
	raw, _ := os.ReadFile(filepath.Join(cfgDir, "config.json"))
	var cfg struct {
		HomeServer string `json:"home_server"`
	}
	_ = json.Unmarshal(raw, &cfg)

	cl := client.New(cfg.HomeServer, "bk_live_test", "acme-ws")
	if _, err := cl.CreateBillingInvoice("acme-ws", client.CreateBillingInvoiceRequest{Company: "acme"}, "appointment-4411"); err != nil {
		t.Fatal(err)
	}
	if _, err := cl.CreateBillingInvoice("acme-ws", client.CreateBillingInvoiceRequest{Company: "acme"}, "  "); err != nil {
		t.Fatal(err)
	}
	if len(*hits) != 2 {
		t.Fatalf("want 2 requests, got %v", *hits)
	}
	if (*hits)[0].IdempotencyKey != "appointment-4411" {
		t.Fatalf("the key did not reach the wire: %q", (*hits)[0].IdempotencyKey)
	}
	if (*hits)[1].IdempotencyKey != "" {
		t.Fatalf("a blank key was sent as %q; blank means no header", (*hits)[1].IdempotencyKey)
	}
}
