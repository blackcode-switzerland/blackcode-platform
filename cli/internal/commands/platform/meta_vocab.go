package platform

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// `bk meta --vocab <key>` — the flat answer to "what are the valid values?".
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE `bk meta`
// ---------------------------------------------------------------------------
// `bk meta` prints prose and a workspace table; `bk meta --json` is a deeply
// nested document. Neither answers "which stages are there?" without a parser,
// which is why an agent that wanted the values reached for `--help` instead —
// and `--help` is a document inside the binary, which is exactly the thing that
// can be a release behind the server.
//
// So this is the half that keeps the enumerated flag help honest. The flags in
// `bk sales …` name their values as a fast path (guarded against drift by
// `apps/sales/lib/cli-vocabulary.test.ts`); THIS reads `/api/meta` and is
// therefore correct with no CLI release at all. When the two disagree, this one
// is right.
//
// ---------------------------------------------------------------------------
// IT IS A BARE VERB AND STAYS ONE
// ---------------------------------------------------------------------------
// Vocabularies are per app, so `bk sales meta` looks like the natural spelling —
// and it is not. `meta` is your ACCOUNT and this BINARY (D-11 / the two verb
// tiers), and it reports the HOME app's vocabulary; `bk --app-server sales meta`
// targets another deployment. Adding an app tier to `meta` would give the binary
// two answers to "who am I", which is the failure the tiers exist to prevent.

// vocabAsked is what `--vocab` holds when it was passed with no `=value`.
// Unspellable on a command line on purpose: it must not collide with a real key.
const vocabAsked = "\x00asked"

// vocabKeyFrom reads the key back out of the two spellings pflag produces.
//
// A flag with a NoOptDefVal takes its value from `=` or from the default, never
// from the next word — so `--vocab=stages` arrives as ("stages", []) and
// `--vocab stages` as (vocabAsked, ["stages"]). Both are the same request, and
// a caller should not have to know which one pflag prefers. An empty key means
// "list the keys".
//
// Kept out of RunE so it can be tested without a server: this is the one piece
// of the command a reader would have to take on trust.
func vocabKeyFrom(flagValue string, args []string) string {
	if flagValue != vocabAsked {
		return strings.TrimSpace(flagValue)
	}
	if len(args) == 1 {
		return strings.TrimSpace(args[0])
	}
	return ""
}

// vocabEntry is the shape every app serves a vocabulary in: a wire value and
// the label a human reads. `color` and anything else the server adds is
// deliberately not modelled — `--json` prints the server's array verbatim, so a
// field added there reaches the caller without a CLI release.
type vocabEntry struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// vocabularyOf finds the vocabulary block for the app that answered.
//
// It reads `apps.<current>.vocabulary` first and the deprecated top-level
// `vocabulary` second, in that order: `apps/issues` still serves both for older
// binaries and `apps/sales` has only ever served the nested one, so preferring
// the nested key is what makes this work against both without asking which app
// it is talking to.
func vocabularyOf(meta *client.Meta) (map[string]json.RawMessage, string, error) {
	decode := func(raw json.RawMessage) (map[string]json.RawMessage, bool) {
		if len(raw) == 0 {
			return nil, false
		}
		var out map[string]json.RawMessage
		if err := json.Unmarshal(raw, &out); err != nil || len(out) == 0 {
			return nil, false
		}
		return out, true
	}

	slug := meta.CurrentApp
	if a, ok := meta.Apps[slug]; ok {
		if v, ok := decode(a.Vocabulary); ok {
			return v, slug, nil
		}
	}
	// A pre-Phase-5 server, or one whose `current_app` this binary does not
	// recognise: fall back to the app entry that says it is current.
	for s, a := range meta.Apps {
		if !a.IsCurrent {
			continue
		}
		if v, ok := decode(a.Vocabulary); ok {
			return v, s, nil
		}
	}
	if v, ok := decode(meta.Vocabulary); ok {
		if slug == "" {
			slug = "this app"
		}
		return v, slug, nil
	}
	return nil, slug, fmt.Errorf(
		"this server serves no vocabulary block — run `bk meta --json` to see what it does serve")
}

// renderVocab answers one `--vocab` invocation: the keys, or one key's values.
func renderVocab(cmd *cobra.Command, format output.Format, meta *client.Meta, key string) error {
	vocab, app, err := vocabularyOf(meta)
	if err != nil {
		return err
	}

	keys := make([]string, 0, len(vocab))
	for k := range vocab {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	// No key: say which ones exist. The whole point of the command is to stop a
	// caller guessing, and a caller who does not know the key names is one guess
	// earlier in the same problem.
	if key == "" {
		return output.Render(format, keys, func(w io.Writer) error {
			fmt.Fprintf(cmd.ErrOrStderr(), "vocabularies served by %s:\n", app)
			for _, k := range keys {
				fmt.Fprintln(w, k)
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "\nrun `bk meta --vocab <key>` for one of them\n")
			return nil
		})
	}

	raw, ok := vocab[key]
	if !ok {
		// Naming what EXISTS, not only what was wrong. An error that says
		// "unknown key" and stops has cost a round trip and bought nothing.
		return cmdutil.Usagef("no vocabulary %q in %s — it serves: %s",
			key, app, strings.Join(keys, ", "))
	}

	var entries []vocabEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return fmt.Errorf("%s served %q in a shape this binary does not understand (%v) "+
			"— `bk meta --json` prints it verbatim", app, key, err)
	}

	// Machine formats get the SERVER'S array, verbatim and unmodelled, for the
	// same reason `bk meta --json` does: a field the server adds must reach the
	// caller without a CLI release. Re-serialising `entries` would drop `color`
	// today and anything added tomorrow.
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}

	return output.Render(format, payload, func(w io.Writer) error {
		tw := output.Tabwriter(w)
		for _, e := range entries {
			if strings.TrimSpace(e.Label) == "" {
				fmt.Fprintf(tw, "%s\n", e.Value)
				continue
			}
			fmt.Fprintf(tw, "%s\t%s\n", e.Value, e.Label)
		}
		if err := tw.Flush(); err != nil {
			return err
		}
		if len(entries) == 0 {
			fmt.Fprintf(cmd.ErrOrStderr(), "(%s serves %q as an empty list)\n", app, key)
		}
		return nil
	})
}
