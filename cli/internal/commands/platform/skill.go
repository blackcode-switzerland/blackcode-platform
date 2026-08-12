package platform

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/skill"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
	"github.com/spf13/cobra"
)

// UpdateAvailableError is returned by `bk skill check` / `bk skill sync` when a
// newer binary exists. main.go maps it to exit code 9 — a distinct code so an
// agent can branch on "I need to upgrade" without parsing stderr.
type UpdateAvailableError struct {
	Current, Latest string
	// SkillOnly means the BINARY is fine and only the skill file needs writing.
	// Both situations exit 9, but they need opposite instructions: telling an
	// agent to `npm install` when the binary is already current sends it into a
	// loop — upgrade, nothing changes, re-check, same message.
	SkillOnly bool
}

func (e *UpdateAvailableError) Error() string {
	if e.SkillOnly {
		return fmt.Sprintf(
			"bk %s is current; the agent skill file is not — run:\n"+
				"  bk skill install",
			e.Current)
	}
	return fmt.Sprintf(
		"bk %s is behind %s — upgrade, then re-run:\n"+
			"  npm install -g @blackcode_sa/bc-issues@latest\n"+
			"  bk skill sync",
		e.Current, e.Latest)
}

// `bk skill` manages the agent skill file — the ~30-line pointer document a
// coding agent reads to learn that this project is driven by `bk`.
//
// It deliberately contains no facts that can rot: everything specific lives
// behind `bk guide` (static, embedded) and `bk meta` (dynamic, live). So the
// file is the same for everyone and `sync` is a cheap, safe thing to run.
func newSkillCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Install and keep the agent skill file current (install once, then sync)",
		// THE LOOP, SPELLED OUT, because the report that prompted this ran a full
		// session across two apps, used `install`, and never learned `check` or
		// `sync` existed. Naming the three verbs in a list is what a reader who
		// arrived here for `install` scrolls past; naming WHEN to run each is not.
		Long: `Manage the agent skill file for blackcode.

THE LOOP — three verbs, and you only ever need the first two:

  bk skill install    ONCE per project. Writes ./.claude/skills/blackcode/SKILL.md
  bk skill sync       WHENEVER something stops working, or after you upgrade bk.
                      Rewrites the skill, and tells you if the binary is behind.
  bk skill check      the same question, WITHOUT writing anything. Exit 9 means
                      an update is available; 0 means you are current.

` + "`bk skill sync`" + ` is the one command an agent is ever told to run, and it is
what every "this may have been renamed" hint points at. It is NOT run
automatically on every invocation — it is an HTTP call and a file write, and
paying that on every command to solve a discovery problem is the wrong trade.

The skill is a pointer, not a copy: it tells an agent to run ` + "`bk guide`" + ` for
usage and ` + "`bk meta`" + ` for live data. That is why it never goes stale on its
own, and why sync is cheap and safe to run at any time.`,
	}
	cmd.AddCommand(
		newSkillInstallCmd(),
		newSkillPathCmd(),
		newSkillCheckCmd(),
		newSkillSyncCmd(),
		newSkillUninstallCmd(),
	)
	return cmd
}

// resolveTarget returns the directory the skill file belongs in: --dir when
// given, else the default (project-local .claude/, else ~/.claude/).
func resolveTarget(dirFlag string) (string, error) {
	if strings.TrimSpace(dirFlag) != "" {
		return filepath.Abs(dirFlag)
	}
	d, err := skill.DefaultDir()
	if err != nil {
		return "", err
	}
	return filepath.Abs(d)
}

func newSkillInstallCmd() *cobra.Command {
	var dirFlag, format string
	var force bool

	cmd := &cobra.Command{
		Use:   "install",
		Short: "Write the agent skill file (default: ./.claude/skills/blackcode/SKILL.md)",
		Long: `Write the agent skill file.

Target, in order of preference:
  --dir PATH                              explicit
  ./.claude/skills/blackcode/             when a .claude/ exists in cwd or above
  ~/.claude/skills/blackcode/             otherwise

  --format agents-md    instead append (or update in place) a delimited
                        "blackcode" section in ./AGENTS.md

The skill was called ` + "`blackcode-issues`" + ` before 2.0.0.
` + "`bk skill sync`" + ` moves an existing one; this command does not, so
that installing never deletes anything.

Offline: the template ships inside this binary.`,
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			if format == "agents-md" {
				return installAgentsMd(cmd, dirFlag)
			}
			if format != "" && format != "claude" {
				return fmt.Errorf("invalid --format %q (want: claude | agents-md)", format)
			}

			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			path := skill.FilePath(dir)

			existing, err := readIfExists(path)
			if err != nil {
				return err
			}

			content := skill.Render(version.Version)
			if !force {
				content, err = skill.UpsertSkillFile(existing, version.Version)
				if errors.Is(err, skill.ErrForeign) {
					return foreignFileError(path)
				} else if err != nil {
					return err
				}
			}

			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), path)
			verb := "installed"
			if skill.Classify(existing) == skill.Managed {
				verb = "updated"
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "%s %s skill (bk %s). Next: bk guide\n", verb, skill.Name, version.Version)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to write the skill into (overrides the default target)")
	cmd.Flags().StringVar(&format, "format", "claude", "Container: claude (SKILL.md) | agents-md (a section in ./AGENTS.md)")
	cmd.Flags().BoolVar(&force, "force", false, "Overwrite a SKILL.md that bk did not write (destroys hand-written content)")
	return cmd
}

// readIfExists returns a file's content, or "" when it isn't there.
func readIfExists(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(b), nil
}

// foreignFileError is what a caller gets instead of silently destroying a
// hand-written skill. It names every way forward, because the agent that hits
// this cannot ask anyone.
func foreignFileError(path string) error {
	return fmt.Errorf(
		"%s already exists and was not written by bk — refusing to overwrite it.\n"+
			"      Keep both: add these two lines to that file and re-run; bk will manage only what is between them:\n"+
			"        %s\n        %s\n"+
			"      Or: `bk skill install --dir <other-path>` to write elsewhere,\n"+
			"          `bk skill install --format agents-md` to use ./AGENTS.md instead,\n"+
			"          `bk skill install --force` to replace it (destroys the current contents).",
		path, skill.BlockBegin, skill.BlockEnd)
}

// installAgentsMd writes the same content into ./AGENTS.md, delimited by HTML
// comment markers so a re-run updates in place rather than appending a copy.
func installAgentsMd(cmd *cobra.Command, dirFlag string) error {
	base := strings.TrimSpace(dirFlag)
	if base == "" {
		var err error
		if base, err = os.Getwd(); err != nil {
			return err
		}
	}
	path := filepath.Join(base, "AGENTS.md")

	existing := ""
	if b, err := os.ReadFile(path); err == nil {
		existing = string(b)
	} else if !os.IsNotExist(err) {
		return err
	}

	updated := skill.UpsertAgentsSection(existing, skill.RenderAgentsSection(version.Version))
	if err := os.WriteFile(path, []byte(updated), 0o644); err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), path)
	fmt.Fprintf(cmd.ErrOrStderr(), "updated the %s section in AGENTS.md (bk %s)\n", skill.Name, version.Version)
	return nil
}

func newSkillPathCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:         "path",
		Short:       "Print where the skill file would be (or already is)",
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), skill.FilePath(dir))
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to resolve against (overrides the default target)")
	return cmd
}

// skillStatus is the shared state `check` and `sync` both compute.
type skillStatus struct {
	Path string `json:"path"`
	// LegacyPath is a pre-2.0.0 install sitting beside the target, when one
	// exists and the target does not. Surfaced rather than silently handled so
	// `check --json` tells an agent WHY it is being sent to `sync` — "no skill
	// installed" next to a skill that plainly is installed reads as a bug.
	LegacyPath      string `json:"legacy_path,omitempty"`
	Installed       bool   `json:"installed"`
	InstalledFrom   string `json:"installed_from_cli_version"`
	RunningVersion  string `json:"running_cli_version"`
	LatestVersion   string `json:"latest_cli_version"`
	SkillIsCurrent  bool   `json:"skill_is_current"`
	BinaryIsCurrent bool   `json:"binary_is_current"`
}

// inspect gathers the local half (is the installed skill from this binary?) and,
// best-effort, the remote half (is this binary the latest?). The remote check is
// one cheap request whose only purpose is to read the X-BK-CLI-Latest header, so
// a network failure degrades to "assume current" rather than failing the command.
func inspect(dirFlag string) (skillStatus, error) {
	dir, err := resolveTarget(dirFlag)
	if err != nil {
		return skillStatus{}, err
	}
	st := skillStatus{
		Path:            skill.FilePath(dir),
		RunningVersion:  version.Version,
		BinaryIsCurrent: true,
	}

	if b, err := os.ReadFile(st.Path); err == nil {
		st.Installed = true
		st.InstalledFrom = skill.StampedVersion(string(b))
		st.SkillIsCurrent = st.InstalledFrom == version.Version
	} else if !os.IsNotExist(err) {
		return st, err
	}

	// Only when the target is empty. Once the new file exists the old one is
	// none of this command's business — which is what makes a repeat run of
	// `sync` a no-op rather than a second migration.
	if !st.Installed {
		legacy := skill.FilePath(skill.LegacyDir(dir))
		if _, err := os.Stat(legacy); err == nil {
			st.LegacyPath = legacy
		} else if !os.IsNotExist(err) {
			return st, err
		}
	}

	// One cheap call purely to harvest the version headers the API sets on every
	// response. `bk changelog`'s endpoint is public, so this works logged out.
	if err := harvestVersions(changelogClient("")); err != nil {
		return st, err
	}
	st.LatestVersion = client.LatestSeen
	if st.LatestVersion != "" && version.Less(version.Version, st.LatestVersion) {
		st.BinaryIsCurrent = false
	}
	return st, nil
}

// harvestVersions makes one cheap request whose only purpose is to read the
// X-BK-CLI-Latest / X-BK-CLI-Min headers the API sets on every response.
//
// It deliberately treats two failures differently:
//
//   - A NETWORK failure (or auth, or anything else) is IGNORED. `bk skill check`
//     and `bk skill sync` are what an agent runs to recover, and a blip must not
//     break the recovery path. The version headers simply stay unknown, and the
//     caller degrades to "assume current".
//   - A HARD FLOOR refusal PROPAGATES. Swallowing it was a bug: a binary below
//     X-BK-CLI-Min had every other command failing with exit 8, while `bk skill
//     sync` reported "skill synced" and exit 0 — telling an agent it was current
//     at the exact moment it was blocked. main.go maps this to exit 8 with the
//     upgrade instructions.
//
// The headers are recorded before the floor check fires, so LatestSeen/MinSeen
// are still populated when this returns an error.
func harvestVersions(c *client.Client) error {
	if _, err := c.Changelog(""); err != nil {
		var oe *client.OutdatedError
		if errors.As(err, &oe) {
			return err
		}
	}
	return nil
}

func newSkillCheckCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:   "check",
		Short: "Report whether the skill and the binary are current (exit 9 = update available)",
		Long: `Compare two things:
  a) the version stamp in the installed skill file vs. this binary
  b) this binary vs. the latest version the server advertises

Exit 0 = everything current. Exit 9 = something is behind; run ` + "`bk skill sync`" + `.`,
		Args: cobra.NoArgs,
		// The version headers are read off any response; the changelog endpoint
		// is the cheapest public one.
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		RunE: func(cmd *cobra.Command, args []string) error {
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			st, err := inspect(dirFlag)
			if err != nil {
				return err
			}

			render := func(w io.Writer) error {
				switch {
				case !st.BinaryIsCurrent:
					fmt.Fprintf(w, "bk %s is behind %s — run: bk skill sync\n", st.RunningVersion, st.LatestVersion)
				case !st.Installed && st.LegacyPath != "":
					fmt.Fprintf(w, "the skill is installed under its old name at %s — run: bk skill sync\n", st.LegacyPath)
				case !st.Installed:
					fmt.Fprintf(w, "no skill installed at %s — run: bk skill install\n", st.Path)
				case !st.SkillIsCurrent:
					fmt.Fprintf(w, "skill at %s was written by bk %s (running %s) — run: bk skill sync\n",
						st.Path, orNone(st.InstalledFrom), st.RunningVersion)
				default:
					fmt.Fprintf(w, "current: skill and bk %s are both up to date\n", st.RunningVersion)
				}
				return nil
			}
			if err := output.Render(format, st, render); err != nil {
				return err
			}
			if !st.BinaryIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, Latest: st.LatestVersion}
			}
			if !st.Installed || !st.SkillIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, SkillOnly: true}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to check (overrides the default target)")
	return cmd
}

func orNone(s string) string {
	if s == "" {
		return "an unknown version"
	}
	return s
}

// printWhatChanged lists the dated changes since the version this config last
// recorded — best-effort, after the sync has already succeeded.
//
// ── WHY `skill sync` OF ALL COMMANDS ───────────────────────────────────────
// This is the one command an agent is ever told to run when something drifts:
// it is named in every deprecation hint, in the generic drift hint, and in the
// exit-8 upgrade message. So it is the moment of HIGHEST ATTENTION the CLI
// gets — and until 2026-08-12 it spent that moment on one line saying "synced",
// which answers a question nobody asked. The caller ran it because something
// changed. Tell them what.
//
// Best-effort, and deliberately AFTER the success line: the sync has already
// happened and its exit code is already earned. A changelog fetch that fails
// (offline, an old server, a timeout) must not turn a completed sync into an
// error — so every failure path here is a silent return.
//
// Bounded to a handful of titles. The full text is one command away and a wall
// of markdown on an unrelated command is how a useful notice becomes noise.
func printWhatChanged(cmd *cobra.Command) {
	cfg, err := config.Load()
	if err != nil || cfg.LastVersionAt == "" {
		return
	}
	cl, err := changelogClient("").Changelog("")
	if err != nil {
		return
	}
	var recent []client.ChangelogEntry
	for _, e := range cl.Entries {
		if e.Date != "" && e.Date >= cfg.LastVersionAt {
			recent = append(recent, e)
		}
	}
	if len(recent) == 0 {
		return
	}

	const maxShown = 5
	w := cmd.ErrOrStderr()
	fmt.Fprintf(w, "\nChanged since %s:\n", cfg.LastVersionAt)
	for i, e := range recent {
		if i == maxShown {
			// Say what was dropped. A truncated list that does not admit it is
			// a list that reads as complete.
			fmt.Fprintf(w, "  … and %d more\n", len(recent)-maxShown)
			break
		}
		fmt.Fprintf(w, "  %s  %s%s\n", e.Date, appTag(e.App), e.Title)
	}
	fmt.Fprintf(w, "Full text: bk changelog --since %s --full\n", cfg.LastVersionAt)
}

func newSkillSyncCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:   "sync",
		Short: "Bring the agent skill (and, if needed, the binary) up to date",
		Long: `The one command an agent is ever told to run when something drifts.

  1. If a newer binary exists, print the exact upgrade command and exit 9.
     It does NOT self-mutate: this is an npm global install, and a
     self-replacing binary is fragile and often permission-blocked. Printing
     the command and returning a distinct exit code is more reliable, and an
     agent handles it fine.
  2. If a pre-2.0.0 skill sits under the old name, move it — carrying over
     anything you added around bk's block — and remove the old copy. A
     hand-written file under the old name is reported and left alone.
  3. If the binary is current, rewrite the skill file from the embedded
     template and exit 0.`,
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "GET /api/changelog"},
		RunE: func(cmd *cobra.Command, args []string) error {
			st, err := inspect(dirFlag)
			if err != nil {
				return err
			}
			if !st.BinaryIsCurrent {
				return &UpdateAvailableError{Current: st.RunningVersion, Latest: st.LatestVersion}
			}

			existing, err := readIfExists(st.Path)
			if err != nil {
				return err
			}

			// The 2.0.0 rename (D-17). Only fires when the target is empty and
			// something is sitting under the old name; `inspect` has already
			// established both, and once the new file exists it stops looking —
			// which is what makes a repeat run a no-op rather than a second
			// migration.
			if st.LegacyPath != "" {
				oldContent, err := readIfExists(st.LegacyPath)
				if err != nil {
					return err
				}
				plan, err := skill.PlanMigration(oldContent, existing, version.Version)
				if errors.Is(err, skill.ErrForeign) {
					// Not bk's file, so not bk's to move OR delete — and it must
					// not gain a sibling either: two skills claiming the same
					// tool is a worse outcome than one with a stale name.
					fmt.Fprintf(cmd.ErrOrStderr(),
						"%s is hand-managed — left where it is, under its old name.\n"+
							"      To adopt the new name yourself: move that file to %s.\n"+
							"      bk %s is current and `bk guide` always describes it, so you are not stale.\n",
						st.LegacyPath, st.Path, version.Version)
					return nil
				} else if err != nil {
					return err
				}
				if plan.RemoveOld {
					if err := os.MkdirAll(filepath.Dir(st.Path), 0o755); err != nil {
						return err
					}
					if err := os.WriteFile(st.Path, []byte(plan.Content), 0o644); err != nil {
						return err
					}
					// Only now, and only the file bk wrote. `os.Remove` on the
					// directory succeeds ONLY if it is empty, which is the point:
					// anything else the user put in there keeps the directory and
					// keeps itself.
					if err := os.Remove(st.LegacyPath); err != nil {
						return err
					}
					removedDir := os.Remove(filepath.Dir(st.LegacyPath)) == nil

					fmt.Fprintln(cmd.OutOrStdout(), st.Path)
					// Names WHAT moved and WHAT was deleted, not just a count:
					// this is the destructive path, and a wrong move should be
					// visible the moment it happens.
					fmt.Fprintf(cmd.ErrOrStderr(),
						"migrated the skill from %q to %q (bk %s).\n"+
							"      moved: %s -> %s\n      removed: %s%s\n",
						skill.LegacyName, skill.Name, version.Version,
						st.LegacyPath, st.Path, st.LegacyPath,
						map[bool]string{true: " and its now-empty directory", false: ""}[removedDir])
					return nil
				}
			}

			// Sync runs unattended, on an agent's own initiative. It must never
			// destroy a hand-written file: report and leave it alone. The binary
			// and `bk guide` — the things that actually carry current behaviour —
			// are already current at this point, so this is not a failure.
			content, err := skill.UpsertSkillFile(existing, version.Version)
			if errors.Is(err, skill.ErrForeign) {
				fmt.Fprintf(cmd.ErrOrStderr(),
					"skill file at %s is hand-managed — left untouched.\n"+
						"      bk %s is current and `bk guide` always describes it, so you are not stale.\n"+
						"      To let bk manage part of that file, add these two lines to it:\n"+
						"        %s\n        %s\n",
					st.Path, version.Version, skill.BlockBegin, skill.BlockEnd)
				return nil
			} else if err != nil {
				return err
			}

			dir := filepath.Dir(st.Path)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(st.Path, []byte(content), 0o644); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), st.Path)
			fmt.Fprintf(cmd.ErrOrStderr(),
				"skill synced from bk %s. Read `bk guide` for current usage.\n", version.Version)
			printWhatChanged(cmd)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to sync (overrides the default target)")
	return cmd
}

func newSkillUninstallCmd() *cobra.Command {
	var dirFlag string
	cmd := &cobra.Command{
		Use:         "uninstall",
		Short:       "Remove the installed skill file",
		Args:        cobra.NoArgs,
		Annotations: map[string]string{"routes": "none"},
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := resolveTarget(dirFlag)
			if err != nil {
				return err
			}
			path := skill.FilePath(dir)
			if err := os.Remove(path); err != nil {
				if os.IsNotExist(err) {
					fmt.Fprintf(cmd.ErrOrStderr(), "nothing to remove at %s\n", path)
					return nil
				}
				return err
			}
			fmt.Fprintf(cmd.ErrOrStderr(), "removed %s\n", path)
			return nil
		},
	}
	cmd.Flags().StringVar(&dirFlag, "dir", "", "Directory to remove from (overrides the default target)")
	return cmd
}
