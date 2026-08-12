package issues

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The issues vocabularies, written down here so that `--help` can answer
// "which values?" without a round trip to the server.
//
// ---------------------------------------------------------------------------
// THIS IS A SECOND COPY OF apps/issues/lib/work-items.ts, ON PURPOSE
// ---------------------------------------------------------------------------
// The standing rule is that a DYNAMIC value lives on the server and never in
// this binary, because the web app and the CLI ship separately: add a status,
// deploy web, and a hardcoded Go list is silently wrong until the next CLI
// release. That rule is not being weakened. It exists to prevent SILENT drift,
// not duplication as such, and this copy is not silent:
// `apps/issues/lib/cli-vocabulary.test.ts` holds every list below against
// `apps/issues/lib/work-items.ts` and goes red in BOTH directions.
//
// It is the same trade `cli/internal/commands/sales/vocab.go` already takes for
// the sales app, and for the same reason — Go cannot import TypeScript.
//
// WHAT THIS IS NOT: it is not the authority. `bk meta` is, and every flag
// description built from these lists still says so.
//
// A GUIDE TOPIC MUST STILL NOT RESTATE THESE (`guide_test.go` enforces it). A
// topic is prose shipped as documentation; a flag description is part of the
// flag, and the flag is where a caller is standing when it needs the values.
// Only one of the two has a build-time guard holding it to the source.
var vocabularies = map[string][]string{
	// ── apps/issues/lib/work-items.ts ───────────────────────────────────────
	// IN SERVED ORDER. The TypeScript guard compares these lists element by
	// element against what GET /api/meta serves, so a reordering there is drift
	// here — which is right: `--help` prints them in this order.
	"issue_statuses":        {"backlog", "todo", "in_progress", "done", "cancelled"},
	"issue_priorities":      {"5", "1", "2", "3", "4"},
	"project_statuses":      {"backlog", "planned", "in_progress", "completed", "cancelled"},
	"project_priorities":    {"P4", "P0", "P1", "P2", "P3"},
	"project_update_health": {"on_track", "at_risk", "off_track"},
}

// ---------------------------------------------------------------------------
// ONE PRIORITY VOCABULARY, TWO STORAGE SHAPES
// ---------------------------------------------------------------------------
// `bk issues issue create --priority` took an INT (1-5) and
// `bk issues project create --priority` took a NAME, inside one app. An agent
// that learned one was failed by the other, which is the inconsistency this
// table closes: both commands now take the SAME five names, and each maps them
// to what its own table stores.
//
// The two storage shapes are real and are not being unified — `issues.priority`
// is `integer CHECK (1..5)` and `projects.priority` is `varchar(10)` holding
// P0..P4. Renaming either is a migration on a live app and buys nothing a
// mapping does not.
//
// THE LABEL COLUMN IS WHAT MAKES THIS MAPPING CHECKABLE. A name here is only
// correct if it is the name the app itself gives that value, so `Label` is held
// against `ISSUE_PRIORITIES` and `PROJECT_PRIORITIES` — both of them, on the
// same row — by apps/issues/lib/cli-vocabulary.test.ts. Without it, "urgent =
// P0" would be an unfalsifiable guess sitting between a caller and a write.
type priorityAlias struct {
	Name    string // what the CLI accepts and prints
	Label   string // what the app calls it, verbatim from work-items.ts
	Issue   int    // issues.priority
	Project string // projects.priority
}

var priorityAliases = []priorityAlias{
	{Name: "urgent", Label: "Urgent", Issue: 1, Project: "P0"},
	{Name: "high", Label: "High", Issue: 2, Project: "P1"},
	{Name: "medium", Label: "Medium", Issue: 3, Project: "P2"},
	{Name: "low", Label: "Low", Issue: 4, Project: "P3"},
	{Name: "none", Label: "No priority", Issue: 5, Project: "P4"},
}

// priorityNames renders the shared half of both --priority descriptions.
func priorityNames() string {
	names := make([]string, 0, len(priorityAliases))
	for _, a := range priorityAliases {
		names = append(names, a.Name)
	}
	return strings.Join(names, " | ")
}

// vocab renders a flag description's value half: the values, then any notes,
// then the pointer at the live authority.
//
//	vocab("issue_statuses")
//	→ backlog | todo | in_progress | done | cancelled (bk meta for values)
//
// The `bk meta` pointer is appended here rather than by the caller so that no
// flag can enumerate without it: the enumeration is the fast path, the server
// is still what decides, and a caller reading only the fast path has to be told
// where the slow one is.
func vocab(key string, notes ...string) string {
	values, ok := vocabularies[key]
	if !ok || len(values) == 0 {
		// A programming error every invocation of `bk` would hit — the command
		// tree is built on startup — so it is loud here rather than a flag whose
		// help silently says nothing. `vocab_test.go` builds the whole tree, so
		// it cannot reach a release.
		panic(fmt.Sprintf("issues: no vocabulary %q — see cli/internal/commands/issues/vocab.go", key))
	}
	return withMetaPointer(strings.Join(values, " | "), notes...)
}

// vocabPriority renders a --priority description. It names the NAMES first,
// because they are the spelling shared with the other command, and the raw
// codes second, because every existing script passes one and none of them
// stopped working.
func vocabPriority(kind string, notes ...string) string {
	var raw string
	switch kind {
	case "issue":
		raw = "or 1-5 (1=urgent)"
	case "project":
		raw = "or " + strings.Join(sortedProjectCodes(), "/") + " (P0=urgent)"
	default:
		panic(fmt.Sprintf("issues: unknown priority kind %q", kind))
	}
	return withMetaPointer(priorityNames()+", "+raw, notes...)
}

func sortedProjectCodes() []string {
	codes := make([]string, 0, len(priorityAliases))
	for _, a := range priorityAliases {
		codes = append(codes, a.Project)
	}
	sort.Strings(codes)
	return codes
}

// NOT backquoted. pflag reads the first backquoted word in a usage string as the
// flag's VALUE PLACEHOLDER, so "`bk meta`" would render the flag as
// `--priority bk meta` — a flag whose help says its argument is the words "bk
// meta". This bit sales six times before it was noticed.
func withMetaPointer(values string, notes ...string) string {
	return values + " (" + strings.Join(append(append([]string{}, notes...), "bk meta for values"), "; ") + ")"
}

// parseIssuePriority turns --priority into what `issues.priority` stores.
//
// Returns 0 for an empty value, which every caller reads as "not given" — the
// flag is only sent when `Changed()` or non-empty, so 0 never reaches the route.
func parseIssuePriority(raw string) (int, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	if v == "" {
		return 0, nil
	}
	for _, a := range priorityAliases {
		if v == a.Name {
			return a.Issue, nil
		}
	}
	// A bare integer is the OLD spelling and still the stored shape. It is
	// range-checked HERE rather than left to the route's 400: `--priority 9` used
	// to cost a round trip to be told "priority must be 1-5", and a caller that
	// can be told locally should be.
	if n, err := strconv.Atoi(v); err == nil {
		if n < 1 || n > 5 {
			return 0, fmt.Errorf("invalid --priority %q — an integer priority is 1-5 (1=urgent, 5=none), or use a name: %s",
				raw, priorityNames())
		}
		return n, nil
	}
	return 0, fmt.Errorf("invalid --priority %q — use one of %s, or an integer 1-5 (1=urgent, 5=none)",
		raw, priorityNames())
}

// parseProjectPriority turns --priority into what `projects.priority` stores.
//
// The P-codes are accepted case-insensitively and normalised UP, because that is
// the only spelling the column holds and the only one the web app renders.
//
// IT REFUSES ANYTHING ELSE, AND THAT IS THE FIX. Until 2026-08-12 this flag was
// passed through to the route verbatim, the route did no vocabulary check, and
// the CLI's own help told callers to type `urgent` — so `--priority urgent`
// wrote the literal string "urgent" into a column the UI reads as P0..P4 and
// rendered the project as "No priority" everywhere, silently. Verified against a
// running route before the fix (project #153, priority='urgent').
func parseProjectPriority(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", nil
	}
	lower := strings.ToLower(v)
	for _, a := range priorityAliases {
		if lower == a.Name {
			return a.Project, nil
		}
		if strings.EqualFold(v, a.Project) {
			return a.Project, nil
		}
	}
	return "", fmt.Errorf("invalid --priority %q — use one of %s, or a code: %s",
		raw, priorityNames(), strings.Join(sortedProjectCodes(), "/"))
}

// issuePriorityName is the reverse: the name for a stored issue priority, for
// confirmation lines. Falls back to the bare number, never to a wrong word.
func issuePriorityName(n int) string {
	for _, a := range priorityAliases {
		if a.Issue == n {
			return a.Name
		}
	}
	return ""
}
