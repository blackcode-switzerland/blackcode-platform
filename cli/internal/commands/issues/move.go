package issues

import (
	"fmt"
	"io"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/output"
	"github.com/spf13/cobra"
)

// newMoveCmd and newCopyCmd share one implementation; `move` soft-deletes the
// source after copying, `copy` leaves it in place.
func newMoveCmd() *cobra.Command { return newTransferCmd("move") }
func newCopyCmd() *cobra.Command { return newTransferCmd("copy") }

func newTransferCmd(mode string) *cobra.Command {
	var target string
	var projects, tasks, issues []int
	var cascadeTasks, cascadeIssues bool

	short := "Move projects/tasks/issues to another workspace (copies, then bins the source)"
	long := `Move items from the active workspace into another workspace you belong to.

The source ({active workspace}) is copied into the target in a single
transaction, then the originals are moved to the recycle bin. If anything
fails, nothing is written to the target and the source is left untouched — no
data can be lost. Items get fresh #numbers in the target, labels are matched or
created by name, and any user reference (assignee/reporter/lead/owner/watcher/
member/@mention) that isn't a member of the target workspace is dropped and
listed under "adjustments".`
	if mode == "copy" {
		short = "Copy projects/tasks/issues to another workspace (leaves the source in place)"
		long = `Copy items from the active workspace into another workspace you belong to.

Identical to ` + "`bk issues move`" + ` except the source items are left exactly where they
are — you end up with the items in BOTH workspaces.`
	}

	cmd := &cobra.Command{
		Use:         mode,
		Annotations: map[string]string{"routes": "POST /api/workspaces/{ws}/move"},
		Short:       short,
		Long:        long,
		RunE: func(cmd *cobra.Command, args []string) error {
			if target == "" {
				return fmt.Errorf("--to (target workspace slug or id) is required")
			}
			if len(projects) == 0 && len(tasks) == 0 && len(issues) == 0 {
				return fmt.Errorf("select at least one of --project, --task, or --issue")
			}
			format, err := output.Resolve(cmd)
			if err != nil {
				return err
			}
			c, err := cmdutil.NewClient()
			if err != nil {
				return err
			}

			req := client.MoveItemsRequest{
				Target:   target,
				Mode:     mode,
				Projects: projects,
				Tasks:    tasks,
				Issues:   issues,
			}
			// Only send cascade flags when the user overrode the default (true),
			// so the server's default is authoritative otherwise.
			if cmd.Flags().Changed("cascade-tasks") {
				req.CascadeTasks = &cascadeTasks
			}
			if cmd.Flags().Changed("cascade-issues") {
				req.CascadeIssues = &cascadeIssues
			}

			report, err := c.MoveItems(req)
			if err != nil {
				return err
			}
			return output.Render(format, report, func(w io.Writer) error {
				return renderMoveReport(w, mode, report)
			})
		},
	}

	cmd.Flags().StringVar(&target, "to", "", "Target workspace (slug or id) to move/copy into")
	cmd.Flags().IntSliceVar(&projects, "project", nil, "Project #number to transfer (repeatable)")
	cmd.Flags().IntSliceVar(&tasks, "task", nil, "Task #number to transfer (repeatable)")
	cmd.Flags().IntSliceVar(&issues, "issue", nil, "Issue #number to transfer (repeatable)")
	cmd.Flags().BoolVar(&cascadeTasks, "cascade-tasks", true, "Also carry a transferred project's tasks")
	cmd.Flags().BoolVar(&cascadeIssues, "cascade-issues", true, "Also carry a transferred project's/task's issues")
	return cmd
}

func renderMoveReport(w io.Writer, mode string, report map[string]any) error {
	moved, _ := report["moved"].(map[string]any)
	count := func(key string) int {
		if moved == nil {
			return 0
		}
		if arr, ok := moved[key].([]any); ok {
			return len(arr)
		}
		return 0
	}
	verb := "Moved"
	if mode == "copy" {
		verb = "Copied"
	}
	tgt := "?"
	if t, ok := report["target"].(map[string]any); ok {
		if name, ok := t["name"].(string); ok {
			tgt = name
		}
	}
	fmt.Fprintf(w, "%s to %q: %d project(s), %d task(s), %d issue(s)\n",
		verb, tgt, count("projects"), count("tasks"), count("issues"))

	if adj, ok := report["adjustments"].([]any); ok && len(adj) > 0 {
		fmt.Fprintf(w, "\n%d adjustment(s) (data that couldn't be carried as-is):\n", len(adj))
		for _, a := range adj {
			m, ok := a.(map[string]any)
			if !ok {
				continue
			}
			kind, _ := m["kind"].(string)
			detail, _ := m["detail"].(string)
			fmt.Fprintf(w, "  - %s: %s\n", kind, detail)
		}
	}
	if mode == "move" {
		// `bk trash` until 2026-08-11: the bin became per app on 2026-08-10, so
		// the bare spelling exits 2. This line prints AFTER a successful move,
		// which is exactly when somebody reaches for the recovery it names.
		fmt.Fprintln(w, "\nSource items were moved to the recycle bin (restore with `bk issues trash restore`).")
	}
	return nil
}
