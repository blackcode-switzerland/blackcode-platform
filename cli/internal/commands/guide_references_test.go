package commands

import (
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/guide"
	"github.com/spf13/cobra"
)

// ---------------------------------------------------------------------------
// EVERY `bk guide <topic>` A READER IS TOLD TO RUN MUST EXIST
// ---------------------------------------------------------------------------
// Help text and topics point at other topics by name: "run `bk guide
// billing/sending-and-status`". That name is a hand-written copy of a fact the
// binary owns — which topics are embedded — and CLAUDE.md finding #23 is what a
// prose copy of such a fact becomes: a dead end the reader has already been
// sent down by the time it fails.
//
// Found missing on 2026-09-17 by the only method that finds these: `bk billing
// invoice --help` was edited to name a topic that did not exist yet, and every
// suite stayed green. Nothing had ever checked a reference.
//
// Watched failing on 2026-09-17: with topics/billing/04-sending-and-status.md
// renamed away, this test named the command help and the two topics that
// reference it. Restored.
//
// What it does not check: that a reference is the RIGHT topic. A text scan can
// see that a name resolves, not that the page it resolves to answers the
// question (finding #11).

// `bk guide platform/workspaces`, `bk guide billing/invoices`. A bare name is
// either a whole section (`bk guide billing`) or a bare topic slug that
// `guide.Lookup` still accepts while it is unambiguous (`bk guide files`). The
// first draft of this test checked bare names against sections only, and its
// first run reported `bk guide files` — a reference that works — as missing.
var guideRef = regexp.MustCompile("bk guide ([a-z][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*)?)")

func TestEveryGuideReferenceResolves(t *testing.T) {
	sections := map[string]bool{}
	for _, s := range guide.Sections() {
		sections[s] = true
	}
	resolves := func(ref string) bool {
		if sections[ref] {
			return true
		}
		_, ok := guide.Lookup(ref)
		return ok
	}

	missing := map[string][]string{}
	checked := 0
	note := func(where, text string) {
		for _, m := range guideRef.FindAllStringSubmatch(text, -1) {
			checked++
			if !resolves(m[1]) {
				missing[m[1]] = append(missing[m[1]], where)
			}
		}
	}

	var walk func(c *cobra.Command)
	walk = func(c *cobra.Command) {
		where := "`" + c.CommandPath() + " --help`"
		note(where, c.Short)
		note(where, c.Long)
		note(where, c.Example)
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(NewRoot())
	for _, top := range guide.Topics() {
		note("topic "+top.Slug, top.Body)
	}

	// Assert the input: a regexp that matched nothing would pass everything.
	if checked < 10 {
		t.Fatalf("found only %d `bk guide` references across every command and topic — the scan is "+
			"not seeing them, so a pass here would mean nothing", checked)
	}
	refs := make([]string, 0, len(missing))
	for r := range missing {
		refs = append(refs, r)
	}
	sort.Strings(refs)
	for _, r := range refs {
		t.Errorf("`bk guide %s` names no topic, and is referenced from: %s",
			r, strings.Join(missing[r], "; "))
	}
	t.Logf("checked %d guide references", checked)
}
