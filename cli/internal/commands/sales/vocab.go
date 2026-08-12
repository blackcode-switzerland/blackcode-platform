package sales

import (
	"fmt"
	"strings"
)

// The sales vocabularies, written down here so that `--help` can answer
// "which values?" without a round trip to the server.
//
// ---------------------------------------------------------------------------
// THIS IS A SECOND COPY OF apps/sales/lib/pipeline.ts, ON PURPOSE
// ---------------------------------------------------------------------------
// The standing rule is that a DYNAMIC value lives on the server and never in
// this binary, because the web app and the CLI ship separately: add a stage,
// deploy web, and a hardcoded Go list is silently wrong until the next CLI
// release. `cli/internal/guide/guide_test.go` fails the build on a guide topic
// that restates one, and that rule is not being weakened.
//
// It is not being weakened because the rule exists to prevent SILENT DRIFT, not
// duplication as such, and this copy is not silent. `apps/sales/lib/cli-vocabulary.test.ts`
// holds every list below against `apps/sales/lib/pipeline.ts` and goes red in
// BOTH directions — a value added there and not here, and a value here that is
// not there. It is the same trade the repo already takes one file over:
//
//	`apps/sales/lib/db/label-default-color.test.ts` holds a constant against a
//	migration literal, "because SQL cannot import a constant, so the second copy
//	is unavoidable and the test is what stops it drifting."
//
// Go cannot import TypeScript either. Same shape, same answer.
//
// WHAT THIS IS NOT: it is not the authority. `bk meta` is, and every flag
// description built from these lists still says so. The enumeration is the fast
// path for the common case; a value added to the server between CLI releases
// appears in `bk meta --vocab <key>` first, and the server is what validates.
//
// A GUIDE TOPIC MUST STILL NOT RESTATE THESE. The distinction is that a topic is
// prose about how the tool behaves, shipped and read as documentation, while a
// flag description is part of the flag — and the flag is exactly where a caller
// is standing when it needs the values. Only one of the two has a build-time
// guard holding it to the source, and it is this one.
var vocabularies = map[string][]string{
	// ── apps/sales/lib/pipeline.ts ──────────────────────────────────────────
	"stages":               {"new_lead", "contacted", "meeting", "negotiation", "won", "lost"},
	"stage_entry_statuses": {"done", "current", "upcoming"},
	"channels":             {"email", "whatsapp", "call", "note", "discovery", "system"},
	"comm_directions":      {"out", "in"},
	"meeting_types":        {"video", "call", "in_person"},
	"meeting_statuses":     {"upcoming", "done", "cancelled"},
	"objection_types":      {"pricing", "complexity", "existing_solution", "timing", "decision_pending"},
	"product_categories":   {"module", "service", "licence"},
	"template_channels":    {"email", "whatsapp", "call"},
	"template_categories":  {"intro", "follow_up", "objection", "meeting", "kickoff"},
	"document_kinds":       {"pdf", "deck", "image", "video", "link"},
	"next_action_types":    {"email", "call", "demo", "demo_prep", "follow_up", "check_in", "wait"},
	"ui_modes":             {"read_only", "full"},

	// ── apps/sales/lib/db/queries/search.ts → SEARCH_TYPES ──────────────────
	// Not a pipeline vocabulary and deliberately WIDER than the addressable
	// types: a contact and an objection are searchable and have no #number.
	"search_types": {"prospect", "contact", "meeting", "communication", "objection", "product", "template", "document", "match"},
}

// vocab renders a flag description's value half: the values, then any notes,
// then the pointer at the live authority.
//
//	vocab("document_kinds", "required")
//	→ pdf | deck | image | video | link (required; `bk meta` for values)
//
// The `bk meta` pointer is appended by this function rather than by the caller
// so that no flag can enumerate without it. The enumeration is the fast path;
// the server is still what decides, and a caller reading only the fast path has
// to be told where the slow one is.
func vocab(key string, notes ...string) string {
	values, ok := vocabularies[key]
	if !ok || len(values) == 0 {
		// A programming error, and one every invocation of `bk` would hit: the
		// command tree is built on startup. Loud here rather than a flag whose
		// help silently says nothing — and `vocab_test.go` builds the whole tree,
		// so it cannot reach a release.
		panic(fmt.Sprintf("sales: no vocabulary %q — see cli/internal/commands/sales/vocab.go", key))
	}
	// NOT backquoted. pflag reads the first backquoted word in a usage string as
	// the flag's VALUE PLACEHOLDER, so "`bk meta`" rendered every one of these as
	// `--kind bk meta` — a flag whose help said its argument was the words "bk
	// meta". It had been that way on the six flags that already enumerated.
	return strings.Join(values, " | ") + " (" +
		strings.Join(append(append([]string{}, notes...), "bk meta for values"), "; ") + ")"
}
