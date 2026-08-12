package commands

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// ---------------------------------------------------------------------------
// WHY: "unknown flag: --health" AND THREE ROUND TRIPS
// ---------------------------------------------------------------------------
// The reported failure, in full (2026-08-12 CLI report, §5):
//
//	bk issues project updates add --project 12 --health on_track --body "…"
//	error: unknown flag: --project
//	hint:  … run `bk issues project updates add --help`
//
//	bk issues project updates add 12 --health on_track --body "…"
//	error: unknown flag: --health
//	hint:  … run `bk issues project updates add --help`      ← already did that
//
// Both hints were CORRECT and neither was useful: the caller had read the help
// and misremembered it. The binary knows the flag set at the moment it refuses
// — naming the near miss is the difference between a retry inside the same run
// and a second read of the same page.
//
// This is deliberately NOT a second hint mechanism. It is called from
// hintFor()'s existing `unknown flag` branch in cmd/bk/main.go, after
// DeprecationHint (a named rename beats a guess) and before the generic advice,
// and its output is folded into that one `hint:` line.
//
// ---------------------------------------------------------------------------
// WHY EDIT DISTANCE ALONE IS NOT ENOUGH — AND THE HONEST ANSWER TO IT
// ---------------------------------------------------------------------------
// `--health` → `--status` is distance 5. Every purely mechanical suggester
// misses the exact example it would be built for. So there are THREE rules
// here, tried in order, and the first two are what catch the reported cases:
//
//  1. the name is a POSITIONAL argument of this command (`--project` on
//     `add <project-id>`) — read off the command's own Use string,
//  2. a small hand-written SYNONYM map, every entry of which is a miss that has
//     actually been reported, and
//  3. edit distance / prefix, for ordinary typos.
//
// Every rule is filtered through "does that flag EXIST on this command?", so
// the table cannot invent a flag, and an entry that stops being true stops
// firing rather than starting to lie.
//
// ONE suggestion, or none. Two is a menu, and a menu is what `--help` is for.

var unknownFlagRe = regexp.MustCompile(`unknown flag: --([A-Za-z0-9][-A-Za-z0-9_]*)`)

// flagSynonyms maps what a caller typed to what they meant. Every key is a
// semantic miss (not a typo) that a real session produced, or a split this
// binary actually has between two apps.
//
// Kept small on purpose, and for the same reason verbSynonyms is: a table that
// tries to cover English starts resolving things the caller did not mean. The
// cost of a wrong entry here is lower than in verbSynonyms — this only ever
// prints a sentence, it never runs anything — but a confident wrong suggestion
// still costs a round trip, which is the thing being fixed.
var flagSynonyms = map[string][]string{
	// The reported case. `project updates add --status on_track|at_risk|off_track`
	// is a project HEALTH update, and --health is the obvious guess for it.
	"health": {"status"},
	"state":  {"status"},
	// This binary genuinely disagrees with itself: issues have a --title,
	// projects/tasks/products have a --name.
	"title": {"name"},
	"name":  {"title"},
	// --description on issues, --body on comments and templates.
	"description": {"body"},
	"body":        {"description"},
	"text":        {"body", "description"},
	"message":     {"body"},
	// Who it is for.
	"owner": {"assignee", "lead"},
	"user":  {"assignee", "member"},
	"who":   {"assignee"},
	// Dates.
	"due":      {"due-date"},
	"deadline": {"due-date"},
	"date":     {"due-date"},
	// Labels/tags.
	"tag":  {"label"},
	"tags": {"label", "tag"},
	// The global one, which is `--ws` and reads as an abbreviation nobody guesses.
	"workspace": {"ws"},
	"query":     {"search"},
	"q":         {"search"},
	"filter":    {"search"},
	"limit":     {"per-page"},
	"force":     {"yes", "confirm"},
	"format":    {"output"},
}

// FlagHint returns a one-line recovery for an `unknown flag` failure on cmd, or
// "" when there is nothing specific to say. cmd is the command cobra resolved
// before its flag parser refused — it is the only source of the real flag set,
// because cobra's message names no command at all.
func FlagHint(cmd *cobra.Command, msg string) string {
	if cmd == nil {
		return ""
	}
	m := unknownFlagRe.FindStringSubmatch(msg)
	if m == nil {
		// `unknown shorthand flag: 'x' in -x` deliberately gets nothing. A single
		// letter is too little to guess from, and this binary's shorthands are
		// few enough that every near miss would be a coin flip.
		return ""
	}
	typed := strings.ToLower(m[1])

	if p := positionalHint(cmd, typed); p != "" {
		return p
	}

	have := availableFlagNames(cmd)
	if len(have) == 0 {
		return ""
	}

	if best := firstExisting(flagSynonyms[typed], have); best != "" {
		return didYouMean(cmd, best)
	}
	if best := closestFlag(typed, have); best != "" {
		return didYouMean(cmd, best)
	}
	return ""
}

func didYouMean(cmd *cobra.Command, flag string) string {
	return fmt.Sprintf("did you mean `--%s`? `%s --help` lists every flag on this command",
		flag, cmd.CommandPath())
}

// positionalRe pulls `<project-id>` / `<slug>` out of a command's Use string.
var positionalRe = regexp.MustCompile(`<([a-zA-Z0-9][-a-zA-Z0-9_]*)>`)

// positionalHint answers the OTHER half of the reported failure: `--project 12`
// on a command whose Use is `add <project-id>`. The value was right and the
// spelling was a flag, which no amount of flag matching can fix — and cobra's
// own message ("unknown flag: --project") points away from the answer.
//
// The Use string is the fact this is held against: rename the placeholder and
// the hint follows, or stops firing. It never invents an argument.
func positionalHint(cmd *cobra.Command, typed string) string {
	for _, m := range positionalRe.FindAllStringSubmatch(cmd.Use, -1) {
		p := strings.ToLower(m[1])
		if p == typed || strings.TrimSuffix(p, "-id") == typed || strings.TrimSuffix(p, "-name") == typed {
			return fmt.Sprintf("`--%s` is not a flag here — %s is a positional argument: %s",
				typed, m[0], cmd.UseLine())
		}
	}
	return ""
}

// availableFlagNames is every flag the caller could legitimately have typed on
// this command: its own plus the globals it inherits (--ws, --json, --output…),
// minus the hidden ones. Inherited flags are included because `--workspace` for
// `--ws` is one of the misses this exists for, and --ws lives on the root.
func availableFlagNames(cmd *cobra.Command) []string {
	seen := map[string]bool{}
	var out []string
	collect := func(f *pflag.Flag) {
		if f.Hidden || seen[f.Name] {
			return
		}
		seen[f.Name] = true
		out = append(out, f.Name)
	}
	cmd.Flags().VisitAll(collect)
	cmd.InheritedFlags().VisitAll(collect)
	return out
}

func firstExisting(candidates, have []string) string {
	for _, c := range candidates {
		for _, h := range have {
			if c == h {
				return h
			}
		}
	}
	return ""
}

// closestFlag returns the one flag close enough to be a typo of typed, or "" if
// there is no clear single winner.
//
// A TIE RETURNS NOTHING. `--stat` is distance 2 from both `--status` and
// `--start`, and picking one by iteration order is picking one by accident.
func closestFlag(typed string, have []string) string {
	// A prefix the caller cut short or ran long (`--work` for `--workspace`,
	// `--workspace` for `--ws`) is not a spelling error and edit distance scores
	// it badly. Requires 3 characters, so `--a` does not claim `--assignee`.
	if len(typed) >= 3 {
		var pref []string
		for _, h := range have {
			if len(h) >= 3 && (strings.HasPrefix(h, typed) || strings.HasPrefix(typed, h)) {
				pref = append(pref, h)
			}
		}
		if len(pref) == 1 {
			return pref[0]
		}
		if len(pref) > 1 {
			return ""
		}
	}

	// Distance 1 for short names, 2 from five characters up: at three characters
	// a distance of 2 relates almost anything to almost anything.
	max := 1
	if len(typed) >= 5 {
		max = 2
	}
	best, bestD, ties := "", max+1, 0
	for _, h := range have {
		d := levenshtein(typed, h)
		if d > max {
			continue
		}
		if d < bestD {
			best, bestD, ties = h, d, 1
		} else if d == bestD {
			ties++
		}
	}
	if ties != 1 {
		return ""
	}
	return best
}

func levenshtein(a, b string) int {
	ar, br := []rune(a), []rune(b)
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			cur[j] = min3(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}

// ClosestFlagForTest exposes the typo matcher to cmd/bk's tests, which own the
// hint's behaviour end to end. The tie-refusal it guards is a property of this
// function alone and cannot be reached through an argv: it needs a flag set
// with two equally-close names, and no command in the binary has one today —
// which is exactly the condition under which a guard goes quiet.
func ClosestFlagForTest(typed string, have []string) string { return closestFlag(typed, have) }
