package guide_test

import (
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/commands"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/guide"
	"github.com/spf13/cobra"
)

// The guide's pagination claim must match the binary's actual flags.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS — it was WRONG, measured 2026-08-12
// ═══════════════════════════════════════════════════════════════════════════
// `platform/07-output-and-exit-codes.md` said three feeds paginate — `bk issues
// activity`, `bk issues trash list` and `bk super-admin errors list` — and told
// agents to "follow `next_cursor` until it is `null`".
//
// `bk issues trash list` has NO `--limit` and NO `--cursor`, and its client
// method reads only `data` and discards `next_cursor` entirely. So the one
// instruction the topic gave for that command could not be carried out, and an
// agent following it would either loop on a field that is never printed or
// conclude the CLI was broken.
//
// guide_test.go already bans a topic from restating a DYNAMIC value (a status
// vocabulary, a size cap). This is the other direction: a claim about the
// BINARY'S OWN SHAPE, which no `bk meta` can correct and which nothing was
// checking. Both sides are derived here — the flags from the real command tree,
// the names from the shipped topic — so neither is a hand-written list that can
// quietly stop describing the other.
// ═══════════════════════════════════════════════════════════════════════════

func TestGuideNamesExactlyTheCommandsThatPaginate(t *testing.T) {
	// Side one: what the binary actually offers.
	paginating := map[string]bool{}
	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		for _, sub := range c.Commands() {
			walk(sub)
		}
		if !c.Runnable() {
			return
		}
		if c.Flags().Lookup("cursor") != nil && c.Flags().Lookup("limit") != nil {
			paginating[c.CommandPath()] = true
		}
	}
	walk(commands.NewRoot())

	if len(paginating) == 0 {
		t.Fatal("found no command with --cursor and --limit — the walk is not seeing the tree, " +
			"so everything below would pass vacuously")
	}

	// Side two: what the topic says. Read from the embedded guide, so this is
	// the text that actually ships.
	topic, ok := guide.Lookup("platform/output-and-exit-codes")
	if !ok {
		t.Fatal("the topic platform/output-and-exit-codes is not in the embedded guide")
	}
	body := topic.Body
	idx := strings.Index(body, "These commands paginate")
	if idx < 0 {
		t.Fatal("the pagination sentence has been reworded — update this guard deliberately, " +
			"and check the new wording against the flags before you do")
	}
	// The paragraph, not the whole topic: a command named anywhere else in the
	// file (a `jq` example, the Related line) must not stand in for the claim.
	para := body[idx:]
	if end := strings.Index(para, "\n\n"); end > 0 {
		para = para[:end]
	}

	for path := range paginating {
		// `bk <app> activity` is spelled with the app placeholder in the guide,
		// because every app serves it — match on the verb after the app.
		// A verb every app serves is spelled with the placeholder in the guide
		// (`bk <app> activity`); one only a single app serves is spelled out.
		// Accept either, so the topic can name whichever is true.
		needle := path
		alt := path
		if parts := strings.SplitN(path, " ", 3); len(parts) == 3 && parts[1] != "super-admin" {
			alt = "bk <app> " + parts[2]
		}
		if !strings.Contains(para, needle) && !strings.Contains(para, alt) {
			t.Errorf("%s takes --limit/--cursor but the guide's pagination paragraph does not name it "+
				"(looked for %q or %q):\n%s", path, needle, alt, para)
		}
	}

	// And the other direction, which is the one that was actually wrong: a
	// command NAMED there that does not paginate.
	for _, claimed := range []string{"trash list", "issue list", "inbox list", "label list"} {
		if !strings.Contains(para, claimed) {
			continue
		}
		found := false
		for path := range paginating {
			if strings.HasSuffix(path, claimed) {
				found = true
			}
		}
		if !found {
			t.Errorf("the guide's pagination paragraph names %q, but no command with that suffix "+
				"has --limit and --cursor:\n%s", claimed, para)
		}
	}
}
