package platform

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk meta --vocab` is the AUTHORITY the enumerated flag help defers to, so the
// two things that can quietly break it are tested here: which spelling of the
// flag reaches the key, and which block of `/api/meta` the values come from.

func metaWithVocabulary(t *testing.T, nested, topLevel string) *client.Meta {
	t.Helper()
	m := &client.Meta{CurrentApp: "sales", Apps: map[string]client.MetaApp{
		"sales":  {IsCurrent: true},
		"issues": {},
	}}
	if nested != "" {
		a := m.Apps["sales"]
		a.Vocabulary = json.RawMessage(nested)
		m.Apps["sales"] = a
	}
	if topLevel != "" {
		m.Vocabulary = json.RawMessage(topLevel)
	}
	return m
}

const salesVocab = `{"stages":[{"value":"new_lead","label":"New lead","color":"#8a8578"},` +
	`{"value":"won","label":"Won","color":"#10a37f"}],` +
	`"document_kinds":[{"value":"pdf","label":"PDF"}]}`

// run executes renderVocab and returns what landed on stdout.
//
// `output.Render` writes to os.Stdout directly — that is the contract every
// command in this binary renders under — so the pipe is what makes this test
// observe the real thing rather than a buffer only this test can see.
func run(t *testing.T, meta *client.Meta, key string, format output.Format) (string, string, error) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	var errOut bytes.Buffer
	cmd := &cobra.Command{Use: "meta"}
	cmd.SetErr(&errOut)
	renderErr := renderVocab(cmd, format, meta, key)
	os.Stdout = saved
	_ = w.Close()
	var stdout bytes.Buffer
	if _, err := stdout.ReadFrom(r); err != nil {
		t.Fatal(err)
	}
	return stdout.String(), errOut.String(), renderErr
}

// THE POSITIVE CASE FIRST, and it asserts the OUTPUT rather than a side effect
// on the way to it (CLAUDE.md finding #21): the values have to be ON STDOUT.
func TestVocabPrintsTheValues(t *testing.T) {
	stdout, _, err := run(t, metaWithVocabulary(t, salesVocab, ""), "stages", output.FormatTable)
	if err != nil {
		t.Fatalf("--vocab stages: %v", err)
	}
	for _, want := range []string{"new_lead", "New lead", "won", "Won"} {
		if !strings.Contains(stdout, want) {
			t.Errorf("`bk meta --vocab stages` did not print %q:\n%s", want, stdout)
		}
	}
	// One per line, so it can be piped without a parser — which is the reason
	// this command exists rather than `bk meta --json` plus jq.
	if lines := strings.Count(strings.TrimSpace(stdout), "\n") + 1; lines != 2 {
		t.Errorf("expected one line per value, got %d:\n%s", lines, stdout)
	}
}

// `--json` must print the SERVER'S array, not a re-serialised struct: `color` is
// a field this binary does not model, and dropping it is how `limits` and
// `media` went invisible to `bk meta` before v1.9.0.
func TestVocabJSONKeepsFieldsThisBinaryDoesNotModel(t *testing.T) {
	stdout, _, err := run(t, metaWithVocabulary(t, salesVocab, ""), "stages", output.FormatJSON)
	if err != nil {
		t.Fatalf("--vocab stages --json: %v", err)
	}
	if !strings.Contains(stdout, "#10a37f") {
		t.Errorf("--json dropped `color`, a field the server sent and this binary does not "+
			"model — anything added server-side would vanish the same way:\n%s", stdout)
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(stdout), &arr); err != nil {
		t.Fatalf("--json is not a plain array, so it does not pipe: %v\n%s", err, stdout)
	}
}

// An unknown key names the keys that exist. The command's whole purpose is to
// stop a caller guessing, and "unknown key" full stop is one guess earlier in
// the same problem.
func TestVocabUnknownKeyNamesTheKeysThatExist(t *testing.T) {
	_, _, err := run(t, metaWithVocabulary(t, salesVocab, ""), "stagez", output.FormatTable)
	if err == nil {
		t.Fatal("an unknown vocabulary key was accepted")
	}
	for _, want := range []string{"stages", "document_kinds"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error for an unknown key does not name %q: %v", want, err)
		}
	}
}

func TestVocabWithNoKeyListsTheKeys(t *testing.T) {
	stdout, _, err := run(t, metaWithVocabulary(t, salesVocab, ""), "", output.FormatTable)
	if err != nil {
		t.Fatalf("--vocab with no key: %v", err)
	}
	if !strings.Contains(stdout, "stages") || !strings.Contains(stdout, "document_kinds") {
		t.Errorf("`bk meta --vocab` did not list the keys:\n%s", stdout)
	}
}

// The nested block wins over the deprecated top-level one. `apps/issues` serves
// BOTH during the overlap, and reading the wrong one is how this command would
// start answering from a copy nobody maintains.
func TestVocabPrefersTheNestedBlock(t *testing.T) {
	stale := `{"stages":[{"value":"REMOVED_YEARS_AGO","label":"stale"}]}`
	stdout, _, err := run(t, metaWithVocabulary(t, salesVocab, stale), "stages", output.FormatTable)
	if err != nil {
		t.Fatalf("--vocab stages: %v", err)
	}
	if strings.Contains(stdout, "REMOVED_YEARS_AGO") {
		t.Errorf("read the deprecated top-level `vocabulary` while a nested one was served:\n%s", stdout)
	}
}

// ...and the top-level one is still read when that is all there is, so this
// works against a server that predates the nested block.
func TestVocabFallsBackToTheTopLevelBlock(t *testing.T) {
	stdout, _, err := run(t, metaWithVocabulary(t, "", salesVocab), "stages", output.FormatTable)
	if err != nil {
		t.Fatalf("--vocab stages against a pre-Phase-5 server: %v", err)
	}
	if !strings.Contains(stdout, "new_lead") {
		t.Errorf("no values from the top-level `vocabulary` block:\n%s", stdout)
	}
}

// BOTH SPELLINGS OF THE FLAG REACH THE SAME KEY.
//
// This is the one piece of the command that is clever rather than obvious:
// pflag gives a flag with a NoOptDefVal its default instead of the next word,
// so `--vocab stages` leaves "stages" sitting in args. Parsed here through the
// REAL command, so the assertion cannot drift from how the flag is registered.
func TestVocabAcceptsBothSpellings(t *testing.T) {
	for _, argv := range [][]string{
		{"--vocab", "stages"},
		{"--vocab=stages"},
	} {
		cmd := newMetaCmd()
		if err := cmd.ParseFlags(argv); err != nil {
			t.Fatalf("%v: %v", argv, err)
		}
		got := vocabKeyFrom(cmd.Flags().Lookup("vocab").Value.String(), cmd.Flags().Args())
		if got != "stages" {
			t.Errorf("`bk meta %s` resolved to key %q, want \"stages\"", strings.Join(argv, " "), got)
		}
	}

	// ...and a bare `--vocab` is the "list the keys" request, not an error.
	cmd := newMetaCmd()
	if err := cmd.ParseFlags([]string{"--vocab"}); err != nil {
		t.Fatalf("bare --vocab: %v", err)
	}
	if got := vocabKeyFrom(cmd.Flags().Lookup("vocab").Value.String(), cmd.Flags().Args()); got != "" {
		t.Errorf("bare `--vocab` resolved to key %q, want the empty \"list the keys\" request", got)
	}
}

// A positional with no --vocab is refused rather than ignored. `bk meta stages`
// used to be accepted silently, which is the shape of guess this command exists
// to answer.
func TestMetaRefusesAStrayArgument(t *testing.T) {
	cmd := newMetaCmd()
	if err := cmd.Args(cmd, []string{"stages"}); err == nil {
		t.Error("`bk meta stages` was accepted; it should say where a vocabulary key goes")
	}
	if err := cmd.Args(cmd, []string{}); err != nil {
		t.Errorf("`bk meta` with no arguments was refused: %v", err)
	}

	// THE POSITIVE HALF: the same argument IS accepted once --vocab is present,
	// which is the only reason the validator can be this strict. A check built
	// only on "was this refused?" cannot tell a working rule from one that
	// refuses everything (CLAUDE.md finding #16).
	withFlag := newMetaCmd()
	if err := withFlag.ParseFlags([]string{"--vocab", "stages"}); err != nil {
		t.Fatal(err)
	}
	if err := withFlag.Args(withFlag, withFlag.Flags().Args()); err != nil {
		t.Errorf("`bk meta --vocab stages` was refused by its own Args validator: %v", err)
	}
}
