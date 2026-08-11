// ═══════════════════════════════════════════════════════════════════════════
// THIS GUARD MATCHES TEXT. READ THIS BEFORE YOU CHANGE A PATTERN IN IT. (D-42)
// ═══════════════════════════════════════════════════════════════════════════
// **The granularity of a text scan is part of what it checks**, and this repo
// has found five guards inert for exactly that reason — every one of them
// looking like working protection:
//
//	#4  three globs that matched none of the imports that actually escape an
//	    app, and that SURVIVED THEIR OWN DIAGNOSIS, still green on the real
//	    shape four days later, sitting beside the working replacement
//	#9  a substring match over six hand-written strings, which passed a topic
//	    containing an entire stale vocabulary and banned the CORRECT spelling
//	#11 a scan of whole FILES, so one component vouched for two others; then
//	    rewritten to match the WORD `focus`, which `const focus = null`
//	    satisfies. Two inert versions in one sitting
//	#13 an import regex that knew `import` and `from` but not `require` — the
//	    one spelling of "reach into another app" that does not say *import*
//
// And a sixth mechanism that is not about patterns at all: **a correct change
// can silently retarget an assertion** (#10). When you widen or rename a value,
// grep for what asserts on it; the diff that breaks a guard rarely touches the
// guard.
//
// TWO RULES FOR CHANGING ANYTHING BELOW:
//  1. Break the thing this guards, watch it go red, restore. A pattern you have
//     not watched fail is not a pattern.
//  2. Keep the input assertion. A scan that finds nothing must FAIL, not pass —
//     every "did we find anything to check?" case in this repo exists because a
//     guard that found nothing would otherwise report success.
package guide

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The guide's whole value is that it can't disagree with the binary. Two ways it
// could rot silently, both guarded here.

func TestTopicsParse(t *testing.T) {
	got := Topics()
	if len(got) < 10 {
		t.Fatalf("expected the full topic set, got %d", len(got))
	}
	seen := map[string]bool{}
	for _, top := range got {
		if top.Slug == "" || strings.Contains(top.Slug, ".md") {
			t.Errorf("bad slug %q", top.Slug)
		}
		// Every slug carries its section. Two apps will both want `pitfalls`.
		if !strings.HasPrefix(top.Slug, top.Section+"/") {
			t.Errorf("topic %q is not qualified by its section %q", top.Slug, top.Section)
		}
		if top.Title == "" || top.Title == top.Slug {
			t.Errorf("topic %q has no `# Title` heading", top.Slug)
		}
		if top.Summary == "" {
			t.Errorf("topic %q has no summary line", top.Slug)
		}
		// A summary lifted out of a fenced code block ("bash", "```") means the
		// extractor regressed.
		if top.Summary == "bash" || strings.HasPrefix(top.Summary, "```") {
			t.Errorf("topic %q summary came from a code fence: %q", top.Slug, top.Summary)
		}
		if seen[top.Slug] {
			t.Errorf("duplicate slug %q", top.Slug)
		}
		seen[top.Slug] = true
		if !strings.Contains(top.Body, "Related commands:") {
			t.Errorf("topic %q is missing its `Related commands:` line", top.Slug)
		}
	}
}

// Dynamic values must never be baked into a topic — that is the one rule that
// makes "embedded guide + live meta" coherent. If a topic hardcodes a status
// name or a byte cap, it will be wrong the first time we change it, and the
// agent has no way to tell.
//
// Run per section, so the failure names which half of the guide rotted. An app
// section is the likelier offender: its topics are the ones sitting next to the
// vocabularies.
// Values that live in lib/work-items.ts, lib/limits.ts or lib/upload.ts and can
// change without a CLI release.
//
// WIDENED 2026-08-06, after watching the previous version NOT fire. It was a
// substring match over six hand-written strings, and a topic containing the
// ENTIRE issue status vocabulary, the ENTIRE priority vocabulary and a stale
// "50 MB" limit passed every section. Three separate holes, each worth naming
// because each needs a different kind of rule:
//
//  1. The two most-restated vocabularies — issue statuses and priorities — were
//     simply absent from the list.
//  2. The list banned "100MB", the CORRECT spelling of the limit. A topic that
//     had gone stale and said "50 MB" was the one case it could not catch, which
//     is backwards: a wrong number is worse than a right one. Sizes are matched
//     by SHAPE now, not by value.
//  3. Bare status words ("done", "todo") cannot be banned outright — they are
//     ordinary English and appear all over the guide as prose. So membership is
//     counted instead: three or more of one vocabulary in a single topic is a
//     restatement, not a sentence.
//
// CALIBRATED in the same change, after the first version failed the REAL topics
// and both hits were legitimate. The distinction that matters is ENUMERATING a
// vocabulary versus ILLUSTRATING a command:
//
//   - `bk issues issue edit 42 --status in_progress` is a worked example. An
//     example has to name some value to be worth reading, and this one teaches
//     flag shape, not the status set. Banning it buys nothing and costs every
//     runnable example in the guide.
//   - "the CLI also accepts the friendly words `urgent|high|medium|low|none`"
//     is STATIC behaviour of this binary's flag parser — precisely what the
//     guide is for — and that passage already ends "Do not hardcode either —
//     `bk meta` is authoritative."
//
// So a vocabulary enumeration is only a finding when the topic does NOT send the
// reader to `bk meta`. A guard that fails on correct writing gets weakened or
// deleted, and then it protects nothing at all.
var (
	// Distinctive machine values. Safe as substrings — none is ordinary prose,
	// and none is a plausible value to show in a worked example.
	bannedLiterals = []string{
		"on_track", "at_risk", "off_track", // project_update_health
		"image/svg+xml", // media.blocked_mime_types
	}

	// Any size limit, right or wrong: `100MB`, `50 MB`, `100 mb`.
	bannedSizeShape = regexp.MustCompile(`(?i)\b\d+\s?[MG]B\b`)

	// Counted, not banned. Three of one set in a topic = a restated vocabulary.
	//
	// ---------------------------------------------------------------------
	// DERIVED FROM EACH APP'S OWN MODULE, NOT TYPED OUT HERE (2026-08-07)
	// ---------------------------------------------------------------------
	// It was a hardcoded map of two issues vocabularies, and the third round of
	// this guard's recurring failure was waiting in it: `topics/sales/` could
	// restate the ENTIRE pipeline vocabulary and stay green, because the map had
	// never heard of a stage. Verified by writing exactly that line into a real
	// topic and watching the test pass.
	//
	// Widening the map by hand would fix today and rot the same way — the next
	// app's vocabulary is absent again, and so is the next VALUE added to an
	// existing one. So the words come from the modules that own them
	// (`lib/work-items.ts`, `lib/pipeline.ts`), which is where every route, the
	// meta route and the UI already read them, and `TestVocabularySourcesAreReal`
	// asserts the extraction actually found something.
	//
	// This test file naming the values is not the thing the rule forbids: the
	// rule is about what a TOPIC says to an agent. A checker has to know the
	// words to count them.
	countedVocabularies = appVocabularies()
)

// vocabularySources maps a label to the app module that declares its
// vocabularies, relative to the repo root.
//
// Adding an app means adding a line. An app that is missing simply is not
// checked — which is why the input assertion below counts the SOURCES it read
// and not only the values.
var vocabularySources = map[string]string{
	"issues": "apps/issues/lib/work-items.ts",
	"sales":  "apps/sales/lib/pipeline.ts",
}

// optionValue matches `{ value: 'in_progress', …` — the shape both modules use
// for every vocabulary whose values are strings.
var optionValue = regexp.MustCompile(`\bvalue:\s*'([a-z_][a-z0-9_]*)'`)

// optionLabel is the FALLBACK, and it exists because of one real vocabulary.
//
// `ISSUE_PRIORITIES` stores an int (`value: 1`), so its machine values are
// numbers nobody restates in prose — what an agent would copy into a topic is
// the LABEL set: Urgent, High, Medium, Low, No priority. That is exactly what
// the hand-written map this replaced contained, and losing it while "improving"
// the guard would have been a silent reduction in coverage. Verified by counting
// what the extraction produced before and after.
var optionLabel = regexp.MustCompile(`\blabel:\s*'([^']+)'`)

// exportedVocabulary matches `export const STAGES: Option[] = [` and friends, so
// the values can be grouped by the constant that declares them. Grouping matters:
// the rule is "three from ONE set", and a flat bag of every word in the file
// would fire on three unrelated ones.
var exportedVocabulary = regexp.MustCompile(`export const ([A-Z][A-Z0-9_]*)\s*:\s*[A-Za-z]+\[\]\s*=\s*\[`)

// appVocabularies reads each app's vocabulary module and returns the value sets
// it declares, keyed "<app> <CONSTANT>".
func appVocabularies() map[string][]string {
	out := map[string][]string{}
	for app, rel := range vocabularySources {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", rel))
		if err != nil {
			// Reported by TestVocabularySourcesAreReal rather than swallowed —
			// a source that cannot be read is a vocabulary nothing is checking.
			continue
		}
		src := string(raw)
		locs := exportedVocabulary.FindAllStringSubmatchIndex(src, -1)
		for i, loc := range locs {
			name := src[loc[2]:loc[3]]
			end := len(src)
			if i+1 < len(locs) {
				end = locs[i+1][0]
			}
			block := src[loc[1]:end]
			var values []string
			for _, m := range optionValue.FindAllStringSubmatch(block, -1) {
				values = append(values, m[1])
			}
			// A numeric-valued vocabulary yields nothing above; its restatable
			// form is its labels. See optionLabel.
			if len(values) < 3 {
				values = nil
				for _, m := range optionLabel.FindAllStringSubmatch(block, -1) {
					values = append(values, strings.ToLower(m[1]))
				}
			}
			// Fewer than three cannot trip a "three from one set" rule, so a
			// two-value vocabulary is not worth carrying.
			if len(values) >= 3 {
				out[app+" "+name] = values
			}
		}
	}
	return out
}

// The extraction is the whole guard: a regex that stops matching yields an empty
// map, and an empty map makes TestTopicsDoNotHardcodeDynamicValues pass against
// every topic in the repo. Assert the inputs before trusting the conclusion.
func TestVocabularySourcesAreReal(t *testing.T) {
	for app, rel := range vocabularySources {
		if _, err := os.ReadFile(filepath.Join("..", "..", "..", rel)); err != nil {
			t.Errorf("cannot read %s's vocabulary source %s: %v — its vocabularies are "+
				"going unchecked in every topic", app, rel, err)
		}
	}
	if len(countedVocabularies) < len(vocabularySources) {
		t.Fatalf("extracted %d vocabularies from %d sources — the extraction regex has "+
			"stopped matching, and an empty set passes every topic",
			len(countedVocabularies), len(vocabularySources))
	}
	for app := range vocabularySources {
		found := 0
		for key := range countedVocabularies {
			if strings.HasPrefix(key, app+" ") {
				found++
			}
		}
		if found == 0 {
			t.Errorf("no vocabulary extracted for %q — its topics can restate anything", app)
		}
	}
}

func TestTopicsDoNotHardcodeDynamicValues(t *testing.T) {
	for _, section := range Sections() {
		t.Run(section, func(t *testing.T) {
			topics := TopicsIn(section)
			if len(topics) == 0 {
				t.Fatalf("section %q has no topics", section)
			}
			for _, top := range topics {
				body := strings.ToLower(top.Body)

				for _, b := range bannedLiterals {
					if strings.Contains(body, strings.ToLower(b)) {
						t.Errorf("topic %q hardcodes %q — point at `bk meta` instead", top.Slug, b)
					}
				}

				if m := bannedSizeShape.FindString(top.Body); m != "" {
					t.Errorf("topic %q hardcodes the size limit %q — it is served by `bk meta` "+
						"(limits.upload_max_label) and changes without a CLI release", top.Slug, m)
				}

				// An enumeration is a finding unless `bk meta` is RIGHT THERE.
				//
				// The escape was topic-wide for one draft, and that made this
				// branch inert: every topic worth writing mentions `bk meta`
				// somewhere, so a bare enumeration anywhere else in the file got
				// a permanent free pass. Caught by injecting the enumeration and
				// watching it stay green. The window is the line plus its
				// neighbours, which is what the real `issues/items` passage
				// looks like — the values on one line, "`bk meta` is
				// authoritative" on the next.
				lines := strings.Split(body, "\n")
				for name, vocab := range countedVocabularies {
					for i, line := range lines {
						var hits []string
						for _, v := range vocab {
							if strings.Contains(line, v) {
								hits = append(hits, v)
							}
						}
						if len(hits) < 3 {
							continue
						}
						near := strings.Join(lines[max(0, i-1):min(len(lines), i+2)], "\n")
						if strings.Contains(near, "bk meta") {
							continue
						}
						t.Errorf("topic %q line %d restates the %s vocabulary (%s) with no "+
							"`bk meta` pointer beside it — say \"run `bk meta` for the current "+
							"values\" instead", top.Slug, i+1, name, strings.Join(hits, ", "))
					}
				}
			}
		})
	}
}

// docs/platform-architecture.md §7.2: a topic under topics/<app>/ may not describe
// another app.
//
// It was written while there was one app, when it could not fail — saying so was
// more useful than pretending otherwise, and its job started the day
// `topics/sales/` existed, which is exactly when nobody would have thought to
// write it. That day was 2026-08-07, and the first thing it did was surface a
// needle that was wrong; see below.
func TestAppTopicsDoNotDescribeAnotherApp(t *testing.T) {
	apps := AppSections()
	if len(apps) == 0 {
		t.Fatal("no app sections found — the guide split did not happen")
	}
	if len(apps) == 1 {
		t.Logf("only one app (%q): this check is structural until a second exists", apps[0])
	}

	for _, app := range apps {
		for _, top := range TopicsIn(app) {
			for _, other := range apps {
				if other == app {
					continue
				}
				// THE NEEDLES ARE THE SHAPES THIS RULE ACTUALLY MEANS, and the
				// bare `other + "/"` that used to be here is deliberately gone.
				//
				// It was trying to catch a reference to another app's GUIDE
				// TOPICS, and it matched any slash-suffixed occurrence of an app
				// name. `apps/sales` has an entity called `template`, whose URN is
				// `bc:sales:{ws}/template/{n}` — so a sales topic teaching its own
				// address scheme would have been reported as describing the
				// `_scaffold` app. That is a guard failing on correct writing,
				// which is how a guard gets weakened or deleted and then protects
				// nothing; CLAUDE.md finding #9 is the same guard's previous
				// round of exactly this. **Do not restore the bare form as a
				// tightening.**
				//
				// `bk <other> ` stays unchanged: it is unambiguous, and it is the
				// one that catches a topic teaching another app's commands.
				for _, needle := range []string{
					"bk " + other + " ",       // another app's commands
					"topics/" + other + "/",   // another app's topic files
					"bk guide " + other + "/", // another app's topics, as a reader reaches them
				} {
					if strings.Contains(top.Body, needle) {
						t.Errorf("topic %q mentions the %q app (%q) — an app topic describes "+
							"its own app only; shared behaviour belongs in topics/platform/",
							top.Slug, other, needle)
					}
				}
			}
		}
	}
}

// The guide must not teach a spelling the CLI is deprecating. This one is NOT
// structural — it would have caught the whole guide as written before Phase 5,
// where every `bk issue create` example became wrong the moment the commands
// moved. A guide that teaches the deprecated form is worse than none: it is
// confidently wrong, and the agent has no reason to doubt it.
//
// EXTENDED in 2.0.0 for the app-owned tier (docs/sales-app-plan.md D-11).
// `upload`, `trash` and `label` moved behind the app name for the same reason
// the nouns did, and the same failure mode applies with more force: a topic that
// still says the bare form is teaching an agent to file a sales contract under
// issues. Adding these caught nine stale topics in the commit that moved the
// commands — which is the point. They are listed separately from the nouns
// because the two migrations prune on different schedules.
//
// EXTENDED AGAIN on 2026-08-10 (multiAppFinalRefactor Phase 4), for eight more
// verbs and one deletion. `storage` and `search` are in the list NOW and were
// deliberately excluded before — that is a change of FACT, not of opinion, and
// worth stating because the previous version of this comment forbade adding them:
//
//   - `storage` was kept bare by D-28 because "one ledger, one quota, the same
//     rows from every app". Phase 3 made the upload LEDGER per app. Two
//     deployments now answer differently, which is the test D-28 itself set.
//   - `search` read `platform.entities`, which every app projected into. Sales
//     stopped projecting, and its `…/search` route was unmounted after it was
//     measured serving issues' titles to a sales-only member.
//
// `link` is here too, and it is the only entry that names a REMOVED command
// rather than a moved one. A topic that still teaches it is teaching a command
// that cannot run.
func TestTopicsUseNamespacedAppCommands(t *testing.T) {
	moved := []string{
		// 1.10.0 — the app nouns.
		"issue", "task", "project", "analytics", "move", "copy",
		// 2.0.0 — the first app-owned platform verbs.
		"upload", "trash", "label",
		// 2.1.0 — the rest of them, when the cross-app tier stopped existing.
		"workspace", "member", "invite", "user", "inbox", "storage", "search",
		"activity",
		// 2.1.0 — removed outright, with no namespaced form to move to.
		"link",
	}
	for _, top := range Topics() {
		for _, n := range moved {
			for _, bad := range []string{"bk " + n + " ", "bk " + n + "|", "bk " + n + "\n", "bk " + n + "`"} {
				if strings.Contains(top.Body, bad) {
					t.Errorf("topic %q uses a pre-namespace spelling %q — it sits behind its "+
						"app name (`bk <app> %s …`)", top.Slug, strings.TrimSpace(bad), n)
				}
			}
		}
	}
}

func TestLookup(t *testing.T) {
	// Qualified, and the tolerated variants.
	for _, in := range []string{
		"platform/files", "PLATFORM/FILES", "platform/04-files", "platform/04-files.md",
		"issues/items", "issues/pitfalls", "platform/pitfalls",
	} {
		if _, ok := Lookup(in); !ok {
			t.Errorf("Lookup(%q) failed", in)
		}
	}

	// Bare slugs still resolve while unique — every pre-1.10.0 skill says
	// `bk guide files`, and those must not break in the release that renames the
	// commands.
	for _, in := range []string{"files", "FILES", "items", "workspaces", "move-copy"} {
		got, ok := Lookup(in)
		if !ok {
			t.Errorf("Lookup(%q) failed; bare slugs must keep resolving while unambiguous", in)
			continue
		}
		if !strings.HasSuffix(got.Slug, "/"+strings.ToLower(in)) {
			t.Errorf("Lookup(%q) resolved to %q", in, got.Slug)
		}
	}

	// `pitfalls` exists in both platform/ and issues/, so the bare form is
	// ambiguous and must refuse — naming both candidates rather than guessing.
	if _, ok := Lookup("pitfalls"); ok {
		t.Error("Lookup(\"pitfalls\") resolved despite existing in two sections")
	}
	amb := Ambiguous("pitfalls")
	if len(amb) < 2 {
		t.Errorf("Ambiguous(\"pitfalls\") = %v; want both candidates named", amb)
	}

	if _, ok := Lookup("nope"); ok {
		t.Error("Lookup should reject an unknown slug")
	}
	if _, ok := Lookup("issues/nope"); ok {
		t.Error("Lookup should reject an unknown qualified slug")
	}
}

func TestRenderIncludesEveryTopic(t *testing.T) {
	out := Render("1.9.0")
	if !strings.Contains(out, "bk 1.9.0") {
		t.Error("rendered guide does not state the binary version")
	}
	for _, top := range Topics() {
		if !strings.Contains(out, top.Title) {
			t.Errorf("rendered guide is missing topic %q", top.Slug)
		}
	}
	// Platform before any app: an agent reading top to bottom should learn what a
	// workspace is before it meets an app's nouns.
	for _, app := range AppSections() {
		p := strings.Index(out, "## PLATFORM")
		a := strings.Index(out, "## APP: "+app)
		if p < 0 || a < 0 {
			t.Fatalf("render is missing a section heading (platform=%d, %s=%d)", p, app, a)
		}
		if p > a {
			t.Errorf("app %q is rendered before the platform section", app)
		}
	}
}

func TestRenderSectionScopes(t *testing.T) {
	for _, section := range Sections() {
		t.Run(section, func(t *testing.T) {
			out := RenderSection("1.10.0", section)
			for _, top := range TopicsIn(section) {
				if !strings.Contains(out, top.Title) {
					t.Errorf("--app %s is missing its own topic %q", section, top.Slug)
				}
			}
			// And nothing from another section.
			for _, other := range Sections() {
				if other == section {
					continue
				}
				for _, top := range TopicsIn(other) {
					if strings.Contains(out, "# "+top.Title+"\n") {
						t.Errorf("--app %s leaked topic %q from section %q",
							section, top.Slug, other)
					}
				}
			}
		})
	}
}
