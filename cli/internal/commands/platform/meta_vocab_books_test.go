package platform

import (
	"encoding/json"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
)

// `bk meta --vocab` COULD NOT READ THE APP ITS OWN HELP POINTS AT.
//
// `apps/issues` and `apps/sales` serve the block as `vocabulary`; `apps/books`
// serves the same entries — `{value, label, color}` — under `vocabularies`,
// nested under its app entry and again at the top level. Only the key differs,
// and this command answered:
//
//	$ bk meta --vocab recognition
//	error: this server serves no vocabulary block — run `bk meta --json` to see
//	       what it does serve
//
// …with the values sitting in the payload it had just parsed. It matters because
// `--vocab` is the AUTHORITY: a flag's `--help` lists the values the binary was
// built with, this reads the server. Found 2026-08-20 by running the command
// books' own help points at.

func rawVocab(t *testing.T, key string) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(map[string]any{
		key: []map[string]string{{"value": "known_recurring", "label": "Known recurring"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// The books spelling, nested under the current app — the shape a live
// `books.blackcode.ch` actually serves.
func TestVocabReadsTheBooksSpelling(t *testing.T) {
	meta := &client.Meta{
		CurrentApp: "books",
		Apps: map[string]client.MetaApp{
			"books": {IsCurrent: true, Vocabularies: rawVocab(t, "recognition")},
		},
	}
	vocab, app, err := vocabularyOf(meta)
	if err != nil {
		t.Fatalf("vocabularyOf: %v — `bk meta --vocab` cannot read the app whose own "+
			"help tells agents to run it", err)
	}
	if app != "books" {
		t.Errorf("app = %q, want books", app)
	}
	if _, ok := vocab["recognition"]; !ok {
		t.Errorf("keys = %v, want recognition", vocab)
	}
}

// The top-level books spelling, for a caller whose `current_app` this binary
// does not recognise.
func TestVocabReadsTheTopLevelBooksSpelling(t *testing.T) {
	meta := &client.Meta{Vocabularies: rawVocab(t, "entry_status")}
	vocab, _, err := vocabularyOf(meta)
	if err != nil {
		t.Fatalf("vocabularyOf: %v", err)
	}
	if _, ok := vocab["entry_status"]; !ok {
		t.Errorf("keys = %v, want entry_status", vocab)
	}
}

// AND THE ORIGINAL SPELLING STILL WINS WHERE IT EXISTS. Widening a reader is how
// the app it was written for stops being read (finding #10 in CLAUDE.md).
func TestVocabStillPrefersTheOriginalSpelling(t *testing.T) {
	meta := &client.Meta{
		CurrentApp: "issues",
		Apps: map[string]client.MetaApp{
			"issues": {IsCurrent: true, Vocabulary: rawVocab(t, "statuses")},
		},
	}
	vocab, app, err := vocabularyOf(meta)
	if err != nil {
		t.Fatalf("vocabularyOf: %v", err)
	}
	if app != "issues" {
		t.Errorf("app = %q, want issues", app)
	}
	if _, ok := vocab["statuses"]; !ok {
		t.Errorf("keys = %v, want statuses", vocab)
	}
}

// A server that really serves neither is still an error, not an empty list — the
// difference between "no values" and "I could not find them" is the whole point.
func TestVocabStillFailsWhenThereIsNoBlockAtAll(t *testing.T) {
	if _, _, err := vocabularyOf(&client.Meta{CurrentApp: "books"}); err == nil {
		t.Fatal("a server serving no vocabulary at all reported success")
	}
}
