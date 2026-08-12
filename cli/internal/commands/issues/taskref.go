package issues

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/cmdutil"
)

// "Which task?" — the same id-or-name question `resolveProjectRef` answers for
// projects, with the same rules, because `bk issues issue list --task` is the
// place people ask "which issues are in this grouping" and the thing they have
// in hand is the name they just typed into `task create`.
//
// The rules are deliberately identical to projectref.go's and not merely
// similar:
//
//   - a bare integer is a #number, anything else is a NAME;
//   - a name must match exactly ONE task, case-insensitively, on the whole name
//     (`search` narrows the candidates server-side, it does not decide);
//   - an ambiguous name is an ERROR listing every match with its #number, never
//     "pick the first".
//
// The third is what makes this worth a file rather than an inline loop. Task
// names collide far more readily than project names do — "Migration",
// "Follow-ups", "Q3" — and resolving a collision by taking the lowest id would
// filter a listing to the wrong grouping and print a perfectly ordinary table.
func resolveTaskRef(c *client.Client, ref string) (int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return 0, nil
	}
	// `#12` is how every listing in this app prints a #number, so accept it back.
	if n, err := strconv.Atoi(strings.TrimPrefix(ref, "#")); err == nil {
		return n, nil
	}

	tasks, err := c.ListTasks(0, ref)
	if err != nil {
		return 0, fmt.Errorf("resolve task %q: %w", ref, err)
	}
	var matches []client.Task
	for _, t := range tasks {
		if strings.EqualFold(strings.TrimSpace(t.Name), ref) {
			matches = append(matches, t)
		}
	}

	switch len(matches) {
	case 1:
		return matches[0].ID, nil
	case 0:
		return 0, cmdutil.Usagef(
			"no task named %q — run `bk issues task list` to see them, or pass its #number", ref)
	default:
		sort.Slice(matches, func(i, j int) bool { return matches[i].ID < matches[j].ID })
		ids := make([]string, 0, len(matches))
		for _, t := range matches {
			ids = append(ids, fmt.Sprintf("#%d", t.ID))
		}
		return 0, cmdutil.Usagef(
			"%q matches %d tasks (%s) — pass the #number instead",
			ref, len(matches), strings.Join(ids, ", "))
	}
}
