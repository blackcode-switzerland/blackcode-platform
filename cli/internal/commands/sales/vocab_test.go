package sales

import (
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// EVERY FLAG THAT TAKES A VOCABULARY VALUE NAMES ITS VALUES.
//
// ── WHAT THIS CATCHES, AND WHAT IT DOES NOT ─────────────────────────────────
// It catches a flag registered with a hand-typed description that bypasses
// `vocab()` — which is how this app got into the state that prompted the work:
// twenty vocabulary flags, six of which enumerated and fourteen of which said
// "run `bk meta`", so an agent learned the values were in the help from one flag
// and was failed by the next.
//
// It does NOT catch drift against the server. Nothing in Go can: the
// vocabularies are TypeScript constants in `apps/sales/lib/pipeline.ts` and the
// two ship separately. That is `apps/sales/lib/cli-vocabulary.test.ts`'s job,
// and the two guards are a pair — this one holds the FLAGS to `vocab.go`, that
// one holds `vocab.go` to the source of truth. Either alone passes on the bug
// the other exists for.
//
// ── THE TABLE IS HAND-WRITTEN, AND THAT IS A REAL WEAKNESS ──────────────────
// A NEW vocabulary flag added tomorrow will not appear here and this test will
// not notice, exactly as `required_flags_test.go` says of its own table. Add
// the row in the same commit as the flag, the way a `routes` annotation goes in
// with its command.
func TestVocabularyFlagsNameTheirValues(t *testing.T) {
	// command path under `bk sales` → flag → the vocabulary it takes.
	cases := []struct{ path, flag, key string }{
		{"prospect list", "stage", "stages"},
		{"prospect create", "stage", "stages"},
		{"prospect next", "type", "next_action_types"},

		{"journey add", "stage", "stages"},
		{"journey add", "status", "stage_entry_statuses"},

		{"meeting list", "status", "meeting_statuses"},
		{"meeting schedule", "type", "meeting_types"},
		{"meeting log", "type", "meeting_types"},

		{"comm list", "channel", "channels"},
		{"comm list", "dir", "comm_directions"},
		{"comm log", "channel", "channels"},
		{"comm log", "dir", "comm_directions"},

		{"objection raise", "type", "objection_types"},

		{"product list", "category", "product_categories"},
		{"product create", "category", "product_categories"},
		{"product edit", "category", "product_categories"},

		{"template list", "channel", "template_channels"},
		{"template list", "category", "template_categories"},
		{"template list", "stage", "stages"},
		{"template create", "channel", "template_channels"},
		{"template create", "category", "template_categories"},
		{"template create", "stage", "stages"},
		{"template edit", "channel", "template_channels"},
		{"template edit", "category", "template_categories"},
		{"template edit", "stage", "stages"},

		{"doc list", "kind", "document_kinds"},
		{"doc add", "kind", "document_kinds"},
		{"doc edit", "kind", "document_kinds"},

		{"search", "type", "search_types"},
		{"preferences set", "ui-mode", "ui_modes"},
	}

	root := NewGroup()
	for _, tc := range cases {
		t.Run(tc.path+" --"+tc.flag, func(t *testing.T) {
			cmd, _, err := root.Find(strings.Fields(tc.path))
			if err != nil {
				t.Fatalf("`bk sales %s` does not resolve: %v — this table is stale", tc.path, err)
			}
			f := cmd.Flags().Lookup(tc.flag)
			if f == nil {
				t.Fatalf("`bk sales %s` has no --%s — this table is stale", tc.path, tc.flag)
			}
			values, ok := vocabularies[tc.key]
			if !ok || len(values) == 0 {
				t.Fatalf("no vocabulary %q in vocab.go — this table is stale", tc.key)
			}
			for _, v := range values {
				if !strings.Contains(f.Usage, v) {
					t.Errorf("`bk sales %s --%s` does not name %q, so a caller cannot learn "+
						"the values from --help:\n  %s", tc.path, tc.flag, v, f.Usage)
				}
			}
			// The enumeration is the fast path, never the authority. A help
			// string that lists values and does not say where the live ones are
			// is the drift the standing rule is about.
			if !strings.Contains(f.Usage, "bk meta") {
				t.Errorf("`bk sales %s --%s` enumerates without pointing at `bk meta`:\n  %s",
					tc.path, tc.flag, f.Usage)
			}
		})
	}
}

// ASSERT THE INPUT. Every case above resolves a command out of NewGroup(); if
// that tree were empty, `Find` would fail and every subtest would read as a
// stale table rather than as a broken build. `required_flags_test.go` guards the
// same tree the same way — this one guards the count of THIS table, which is the
// input a reviewer would otherwise take on trust.
func TestTheVocabularyTableIsPopulated(t *testing.T) {
	if len(vocabularies) < 13 {
		t.Fatalf("only %d vocabularies in vocab.go — apps/sales/lib/pipeline.ts has more, "+
			"and cli-vocabulary.test.ts is what says which", len(vocabularies))
	}
}

// A vocabulary nobody's flag uses is dead weight, and dead weight is what a
// reader mistakes for coverage. Every key in vocab.go must be reachable from at
// least one flag — otherwise it is a list being maintained against pipeline.ts
// for nothing, which is a cost with no reader.
func TestEveryVocabularyIsUsedByAFlag(t *testing.T) {
	used := map[string]bool{}
	var walk func(*cobra.Command)
	walk = func(c *cobra.Command) {
		c.Flags().VisitAll(func(f *pflag.Flag) {
			for key, values := range vocabularies {
				if len(values) == 0 {
					continue
				}
				// `+ " ("` matters: `vocab()` always closes the list with the
				// notes bracket, and without the boundary `template_channels`
				// (email | whatsapp | call) reads as used by any `--channel`
				// flag carrying the longer `channels` list, which starts with
				// the same three values. A prefix is not a use.
				if strings.Contains(f.Usage, strings.Join(values, " | ")+" (") {
					used[key] = true
				}
			}
		})
		for _, sub := range c.Commands() {
			walk(sub)
		}
	}
	walk(NewGroup())

	for key := range vocabularies {
		if !used[key] {
			t.Errorf("vocabulary %q is in vocab.go and no flag enumerates it — either wire it "+
				"to the flag that takes it, or delete it", key)
		}
	}
}
