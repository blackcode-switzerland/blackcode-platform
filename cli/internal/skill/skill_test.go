package skill

import (
	"errors"
	"strings"
	"testing"
)

// The skill's one design rule: it contains NO facts that can rot. If someone
// adds a status value, a byte cap or an HTTP route to the template, a stale
// installed copy starts actively misleading agents instead of merely pointing
// at the right commands.
func TestTemplateContainsNoRottableFacts(t *testing.T) {
	banned := []string{
		"100MB", "on_track", "at_risk", "backlog", "in_progress",
		"/api/", "Bearer", "openapi", "P0", "P1",
	}
	for _, b := range banned {
		if strings.Contains(template, b) {
			t.Errorf("skill template mentions %q — it must only point at `bk guide` / `bk meta`", b)
		}
	}
	if n := len(strings.Split(strings.TrimSpace(template), "\n")); n > 40 {
		t.Errorf("skill template is %d lines; keep it ~30 — specifics belong behind `bk guide`", n)
	}
}

// D-17. The skill covers the CLI, and the CLI drives every app. A skill that
// names ONE app is a skill an agent doing work in another one skips — which is
// the single failure the rename was for, and it comes back the moment somebody
// writes a helpful example using a real noun.
func TestTemplateNamesNoSingleApp(t *testing.T) {
	if strings.Contains(template, LegacyName) {
		t.Errorf("the template still says %q — the whole point of the rename was that it does not", LegacyName)
	}
	// The identity in the front matter and the identity on disk must agree.
	// They are read by different things — a skill loader and bk — and a
	// disagreement means the loader advertises a name bk cannot find or update.
	want := "name: " + Name + "\n"
	if !strings.Contains(template, want) {
		t.Errorf("front matter must declare %q to match the install directory", strings.TrimSpace(want))
	}
	// The one fact the skill MUST carry, because an agent cannot infer it: that
	// there is more than one app and this skill covers them all.
	if !strings.Contains(template, "bk app list") {
		t.Error("the template must point at `bk app list`; without it an agent has no way to learn a second app exists")
	}
}

func TestRenderRoundTripsTheVersionStamp(t *testing.T) {
	out := Render("1.9.0")
	if got := StampedVersion(out); got != "1.9.0" {
		t.Errorf("StampedVersion(Render(1.9.0)) = %q, want 1.9.0", got)
	}
	if StampedVersion("no stamp here") != "" {
		t.Error("an unstamped file must report an empty version, not a false match")
	}
}

func TestUpsertAgentsSectionReplacesInPlace(t *testing.T) {
	doc := "# My project\n\nSome prose.\n"
	first := UpsertAgentsSection(doc, RenderAgentsSection("1.9.0"))
	if !strings.Contains(first, "My project") {
		t.Fatal("upsert dropped the host document")
	}
	second := UpsertAgentsSection(first, RenderAgentsSection("1.9.1"))
	if strings.Count(second, blockBegin) != 1 {
		t.Errorf("re-running install duplicated the section (%d copies)", strings.Count(second, blockBegin))
	}
	if !strings.Contains(second, "1.9.1") || strings.Contains(second, "bk 1.9.0 -->") {
		t.Error("re-running install did not update the version stamp in place")
	}
	// Headings must be demoted so the block nests under the host document.
	if strings.Contains(second, "\n# "+Name) {
		t.Error("the AGENTS.md section kept a top-level heading")
	}
}

// An AGENTS.md written by a pre-2.0.0 bk carries the old markers. If they were
// not recognised, `install --format agents-md` would APPEND a second section
// rather than replace the first, and the file would grow one copy per release.
func TestUpsertAgentsSectionReplacesTheLegacyBlock(t *testing.T) {
	doc := "# My project\n\n" + legacyBlockBegin + "\nold body\n\n<!-- bk 2.0.0 -->\n" + legacyBlockEnd +
		"\n\n## After\n"
	got := UpsertAgentsSection(doc, RenderAgentsSection("2.0.0"))
	if n := strings.Count(got, BlockBegin); n != 1 {
		t.Errorf("got %d current begin markers, want 1", n)
	}
	if strings.Contains(got, legacyBlockBegin) {
		t.Error("the legacy markers survived; the block was appended rather than replaced")
	}
	for _, keep := range []string{"My project", "## After"} {
		if !strings.Contains(got, keep) {
			t.Errorf("upsert dropped host content: %q", keep)
		}
	}
	if strings.Contains(got, "old body") {
		t.Error("upsert did not refresh the managed block")
	}
}

// --- ownership: bk must never destroy what a human wrote ---------------------
//
// `bk skill sync` is the one command agents run unprompted, so a destructive
// write here would silently delete a team's hand-written rules the first time an
// agent auto-recovered from a version bump — and nobody would know why the agent
// started behaving differently. Before v1.9.1 it did exactly that.

const handWritten = `---
name: blackcode-issues
---
# Our team's rules
- Always use the "acme" workspace.
- Ask Dana before deleting anything.
`

func TestClassify(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    Ownership
	}{
		{"empty", "", Absent},
		{"whitespace only", "\n\n  \n", Absent},
		{"hand-written", handWritten, Foreign},
		{"bk 1.9.0 output (stamped, unmarked)", "# blackcode issues\n\n<!-- generated by bk skill install · cli 1.9.0 · do not edit -->\n", Legacy},
		{"current output", Render("v1.9.1"), Managed},
		// THE MIGRATION GUARANTEE. Every skill file installed before 2.0.0
		// carries the old markers. If this said Foreign, `bk skill sync` — the
		// one command agents run unprompted — would refuse to touch it and warn
		// about hand-written content nobody wrote, and the file would freeze at
		// whatever version installed it. Silently, for everyone, forever.
		{"pre-2.0.0 output (old markers)", legacyBlockBegin + "\nbody\n\n" +
			"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + legacyBlockEnd, Managed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Classify(c.content); got != c.want {
				t.Errorf("Classify() = %v, want %v", got, c.want)
			}
		})
	}
}

func TestUpsertRefusesForeignFile(t *testing.T) {
	if _, err := UpsertSkillFile(handWritten, "v1.9.1"); !errors.Is(err, ErrForeign) {
		t.Fatalf("UpsertSkillFile on a hand-written file = %v, want ErrForeign", err)
	}
}

// A legacy file was written entirely by bk 1.9.0, so rewriting it is safe — and
// it migrates the file to the marked format so future syncs are surgical.
func TestUpsertMigratesLegacyFile(t *testing.T) {
	legacy := "# blackcode issues\n\n<!-- generated by bk skill install · cli 1.9.0 · do not edit -->\n"
	got, err := UpsertSkillFile(legacy, "v1.9.1")
	if err != nil {
		t.Fatalf("UpsertSkillFile: %v", err)
	}
	if Classify(got) != Managed {
		t.Error("a migrated legacy file should now be Managed")
	}
	if StampedVersion(got) != "v1.9.1" {
		t.Errorf("stamp = %q, want v1.9.1", StampedVersion(got))
	}
}

// The whole point of the markers: a user may write around bk's block, and every
// future sync must leave their words alone while refreshing bk's.
func TestUpsertPreservesContentAroundTheBlock(t *testing.T) {
	withExtras := "---\nname: blackcode-issues\ndescription: our tweaked description\n---\n\n" +
		BlockBegin + "\nold generated body\n\n<!-- generated by bk skill install · cli 1.9.0 · do not edit -->\n" + BlockEnd +
		"\n\n## Team additions\n- Ask Dana before deleting anything.\n"

	got, err := UpsertSkillFile(withExtras, "v1.9.1")
	if err != nil {
		t.Fatalf("UpsertSkillFile: %v", err)
	}
	for _, keep := range []string{"our tweaked description", "## Team additions", "Ask Dana before deleting anything"} {
		if !strings.Contains(got, keep) {
			t.Errorf("sync dropped user content: %q", keep)
		}
	}
	if strings.Contains(got, "old generated body") {
		t.Error("sync did not refresh the managed block")
	}
	if StampedVersion(got) != "v1.9.1" {
		t.Errorf("stamp = %q, want v1.9.1", StampedVersion(got))
	}
	if n := strings.Count(got, BlockBegin); n != 1 {
		t.Errorf("got %d begin markers, want exactly 1", n)
	}
}

// Skill loaders require YAML front matter at the very top; a leading HTML
// comment would break parsing.
func TestRenderKeepsFrontMatterFirst(t *testing.T) {
	out := Render("v1.9.1")
	if !strings.HasPrefix(out, "---\n") {
		t.Fatalf("Render() must start with front matter, got: %.40q", out)
	}
	if strings.Index(out, BlockBegin) < strings.Index(out, "\n---\n") {
		t.Error("the managed block must come after the front matter")
	}
}

// --- the 2.0.0 rename: blackcode-issues -> blackcode (D-17) ------------------

// A file installed by an older bk must convert to the current markers on its
// first sync, WITHOUT disturbing a byte the user wrote around them. Both halves
// matter: converting is what stops the legacy branch living forever, and the
// preservation is what stops the conversion being a destructive rewrite.
func TestUpsertConvertsLegacyMarkersAndKeepsUserContent(t *testing.T) {
	old := "---\nname: blackcode-issues\ndescription: our own words\n---\n\n" +
		legacyBlockBegin + "\nold generated body\n\n" +
		"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + legacyBlockEnd +
		"\n\n## Team additions\n- Ask Dana first.\n"

	got, err := UpsertSkillFile(old, "2.0.0")
	if err != nil {
		t.Fatalf("UpsertSkillFile: %v", err)
	}
	if strings.Contains(got, legacyBlockBegin) || strings.Contains(got, legacyBlockEnd) {
		t.Error("the legacy markers survived the sync; the file would keep taking the compatibility path forever")
	}
	if n := strings.Count(got, BlockBegin); n != 1 {
		t.Errorf("got %d current begin markers, want exactly 1", n)
	}
	for _, keep := range []string{"our own words", "## Team additions", "Ask Dana first"} {
		if !strings.Contains(got, keep) {
			t.Errorf("sync dropped user content: %q", keep)
		}
	}
	if strings.Contains(got, "old generated body") {
		t.Error("sync did not refresh the managed block")
	}
	if StampedVersion(got) != "2.0.0" {
		t.Errorf("stamp = %q, want 2.0.0", StampedVersion(got))
	}
	// And it must now be a stable fixed point: a second sync changes nothing but
	// the stamp, and never produces a second block.
	again, err := UpsertSkillFile(got, "2.0.0")
	if err != nil {
		t.Fatalf("second UpsertSkillFile: %v", err)
	}
	if again != got {
		t.Error("a second sync of an already-migrated file was not a no-op")
	}
}

func TestLegacyDirSitsBesideTheTarget(t *testing.T) {
	if got := LegacyDir("/home/u/.claude/skills/" + Name); got != "/home/u/.claude/skills/"+LegacyName {
		t.Errorf("LegacyDir = %q", got)
	}
	// --dir must migrate the copy beside IT, not one in the user's home.
	if got := LegacyDir("/tmp/project/.claude/skills/" + Name); got != "/tmp/project/.claude/skills/"+LegacyName {
		t.Errorf("LegacyDir(--dir) = %q", got)
	}
}

func TestPlanMigration(t *testing.T) {
	managedOld := legacyBlockBegin + "\nbody\n\n" +
		"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + legacyBlockEnd +
		"\n\n## Ours\n"

	t.Run("migrates a bk-owned file and keeps what the user added", func(t *testing.T) {
		plan, err := PlanMigration(managedOld, "", "2.0.0")
		if err != nil {
			t.Fatalf("PlanMigration: %v", err)
		}
		if !plan.RemoveOld {
			t.Error("a bk-owned old file should be removed after the move")
		}
		if !strings.Contains(plan.Content, "## Ours") {
			t.Error("the migration dropped the user's section")
		}
		if !strings.Contains(plan.Content, BlockBegin) {
			t.Error("the migrated content should carry the current markers")
		}
	})

	// IDEMPOTENCE, which is the requirement that makes `sync` safe to run on a
	// loop: once the new file exists the old one is not consulted, so a second
	// run cannot move anything, cannot delete anything, and cannot produce a
	// second directory.
	t.Run("does nothing once the new file exists", func(t *testing.T) {
		plan, err := PlanMigration(managedOld, Render("2.0.0"), "2.0.0")
		if err != nil {
			t.Fatalf("PlanMigration: %v", err)
		}
		if plan.RemoveOld || plan.Content != "" {
			t.Errorf("second run wanted to act: %+v", plan)
		}
	})

	t.Run("does nothing when there is no old file", func(t *testing.T) {
		plan, err := PlanMigration("", "", "2.0.0")
		if err != nil || plan.RemoveOld || plan.Content != "" {
			t.Errorf("plan=%+v err=%v", plan, err)
		}
	})

	// The one that must never go wrong. A hand-written file under the old name
	// is not bk's to move OR to delete, and bk must not install a second skill
	// beside it either — two skills claiming the same tool is worse than one
	// with a stale name.
	t.Run("refuses a hand-written old file, and removes nothing", func(t *testing.T) {
		plan, err := PlanMigration(handWritten, "", "2.0.0")
		if !errors.Is(err, ErrForeign) {
			t.Fatalf("err = %v, want ErrForeign", err)
		}
		if plan.RemoveOld || plan.Content != "" {
			t.Errorf("a foreign file produced an actionable plan: %+v", plan)
		}
	})
}

// The half of the rename that a directory move does not do. A file sitting in
// `skills/blackcode/` while still declaring `name: blackcode-issues` is a skill
// the LOADER goes on advertising under the old name — D-17's failure surviving
// D-17's fix. Found by migrating a real file and reading it.
func TestMigrationRenamesTheFrontMatterIdentity(t *testing.T) {
	old := "---\nname: " + LegacyName + "\ndescription: our own words\n---\n\n" +
		legacyBlockBegin + "\nbody\n\n" +
		"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + legacyBlockEnd + "\n"

	plan, err := PlanMigration(old, "", "2.0.0")
	if err != nil {
		t.Fatalf("PlanMigration: %v", err)
	}
	if !strings.Contains(plan.Content, "name: "+Name+"\n") {
		t.Error("the migrated file still does not declare the new name")
	}
	if strings.Contains(plan.Content, "name: "+LegacyName) {
		t.Error("the old name survived in the front matter")
	}
	// Everything else the user wrote in the front matter is theirs.
	if !strings.Contains(plan.Content, "description: our own words") {
		t.Error("the migration overwrote the user's description")
	}
}

// …and the boundary: a name the USER chose is not bk's to change. bk picked
// `blackcode-issues`, so bk may rename that one and nothing else. The front
// matter sits outside the managed block precisely so a retitle survives sync.
func TestMigrationLeavesAUserChosenNameAlone(t *testing.T) {
	old := "---\nname: acme-internal\ndescription: ours\n---\n\n" +
		legacyBlockBegin + "\nbody\n\n" +
		"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + legacyBlockEnd + "\n"

	plan, err := PlanMigration(old, "", "2.0.0")
	if err != nil {
		t.Fatalf("PlanMigration: %v", err)
	}
	if !strings.Contains(plan.Content, "name: acme-internal") {
		t.Error("the migration renamed a skill the user had named themselves")
	}
}

// An ordinary sync of an already-migrated file must NOT touch the front matter,
// or the "retitle survives" guarantee quietly stops being true.
func TestOrdinarySyncNeverRewritesTheName(t *testing.T) {
	mine := "---\nname: acme-internal\n---\n\n" + BlockBegin + "\nbody\n\n" +
		"<!-- generated by bk skill install · cli 2.0.0 · do not edit -->\n" + BlockEnd + "\n"
	got, err := UpsertSkillFile(mine, "3.1.1")
	if err != nil {
		t.Fatalf("UpsertSkillFile: %v", err)
	}
	if !strings.Contains(got, "name: acme-internal") {
		t.Error("a plain sync rewrote the skill's name")
	}
}
